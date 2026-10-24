/** Combat state: creation (with initiative order) and simple queries. Never saved. */
import { getStats } from "../stats.js";
import { enemyById } from "./data.js";

/**
 * Builds enemies for `groups` ([{ id, count }]) on `band`, numbered on from the `existing` enemies of the same id
 * ("Bandyta 3"). Names are numbered when more than one enemy of that id is in the fight; an earlier unnumbered
 * enemy of such an id is renamed to "... 1". Returns `existing` plus the new enemies (same array, appended).
 */
export function spawnEnemies(data, existing, groups, band) {
  const totals = {};
  for (const e of existing) totals[e.id] = (totals[e.id] ?? 0) + 1;
  for (const { id, count = 1 } of groups) totals[id] = (totals[id] ?? 0) + count;
  const counters = {};
  for (const e of existing) counters[e.id] = (counters[e.id] ?? 0) + 1;
  for (const e of existing) if (totals[e.id] > 1 && e.name === enemyById(data, e.id).name) e.name = `${e.name} ${e.uid.split("#")[1]}`;
  for (const { id, count = 1 } of groups) {
    const base = enemyById(data, id);
    if (!base) throw new Error(`createCombat: nieznany wróg ${id}`);
    for (let i = 1; i <= count; i++) {
      counters[id] = (counters[id] ?? 0) + 1;
      existing.push({
        uid: `${id}#${counters[id]}`, id, name: totals[id] > 1 ? `${base.name} ${counters[id]}` : base.name,
        hp: base.hp, hpMax: base.hp, band, morale: base.morale ?? null,
        effects: [], fled: false, dead: false, ap: 0,
      });
    }
  }
  return existing;
}

/**
 * Builds the combat object for scene definition `def` ({ enemies, start, canFlee, nonLethal, training, minutes }).
 * Rolls initiative once (the player still goes first unless `def.ambush`): player `derived.initiative + k10`, enemy `initiative + k10`; descending, ties keep list order (player first).
 */
export function createCombat(state, data, def, rng) {
  const enemies = spawnEnemies(data, [], def.enemies, def.start ?? "far");
  const rolls = [{ who: "player", score: getStats(state, data).derived.initiative + rng.int(1, 10) }];
  for (const e of enemies) rolls.push({ who: e.uid, score: enemyById(data, e.id).initiative + rng.int(1, 10) });
  const byScore = rolls.map((r, i) => ({ ...r, i })).sort((a, b) => b.score - a.score || a.i - b.i).map((r) => r.who);
  // The player always opens the fight (nothing happens before the first prompt) unless the scene is an `ambush`, where initiative decides.
  const order = def.ambush ? byScore : ["player", ...byScore.filter((who) => who !== "player")];
  return {
    def, enemies, order, turn: 0, round: 1, playerAp: 0, defendBonus: 0, battlefield: [], log: [],
    outcome: null, training: !!def.training, thrown: null, ready: false, reinforced: false,
  };
}

/** Enemies still in the fight (not dead, not fled). */
export const livingEnemies = (combat) => combat.enemies.filter((e) => !e.dead && !e.fled);

export const enemyByUid = (combat, uid) => combat.enemies.find((e) => e.uid === uid);

/**
 * "win" | "defeat" | "fled" | "draw" | null. An outcome already stored in `combat.outcome` (fled, draw) wins; then player
 * defeat (HP <= 0, in training HP 1), then victory (no enemy left, in training every living enemy at HP 1).
 */
export function outcomeOf(state, combat) {
  if (combat.outcome) return combat.outcome;
  const living = livingEnemies(combat);
  if (state?.character && state.character.hp <= (combat.training ? 1 : 0)) return "defeat";
  if (living.length === 0) return "win";
  return combat.training && living.every((e) => e.hp <= 1) ? "win" : null;
}

/** Same as `outcomeOf` (argument order kept for earlier callers). */
export const isOver = (combat, state) => outcomeOf(state, combat);

/** An enemy died: every other living enemy with morale loses `moraleOnAllyDeath` (floor 0). */
export function onAllyDeath(data, combat) {
  for (const other of livingEnemies(combat)) {
    if (other.morale !== null && other.morale !== undefined) other.morale = Math.max(0, other.morale - data.rules.combat.moraleOnAllyDeath);
  }
}
