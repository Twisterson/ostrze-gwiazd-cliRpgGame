/** Turn flow of a fight: turn start/end, enemy turns, the 200-round limit and the after-fight rewards. */
import { getStats } from "../stats.js";
import { effectById } from "../effects.js";
import { addXp } from "../character.js";
import { runActions } from "../actions.js";
import { advanceTime } from "../../engine/time.js";
import { enemyById } from "./data.js";
import { enemyByUid, livingEnemies, onAllyDeath, outcomeOf } from "./state.js";
import { startTurnEffects, endTurnEffects, endRoundBattlefield, clearTurnEffects } from "./effects.js";
import { enemyTurn } from "./ai.js";
import { applyMasteryGrowth } from "./mastery.js";

export { outcomeOf };

export const MAX_ROUNDS = 200;

/** Sum of an enemy's active effect modifiers for `key` (x stacks). */
const effectMod = (data, enemy, key) =>
  enemy.effects.reduce((acc, e) => acc + (effectById(data, e.id)?.modifiers?.[key] ?? 0) * (e.stacks ?? 1), 0);

/**
 * Starts the turn of the current participant: refreshes AP (player: `derived.ap`, `defendBonus` reset; enemy: `ap` + effect
 * modifier), ticks effects and reports a skipped turn. Enemies killed by a tick are announced once.
 * @returns {{ who: string, skip: boolean, events: object[] }}
 */
export function beginTurn(state, data, combat, rng) {
  const who = combat.order[combat.turn];
  const enemy = who === "player" ? null : enemyByUid(combat, who);
  if (enemy) enemy.ap = Math.max(0, enemyById(data, enemy.id).ap + effectMod(data, enemy, "ap"));
  else {
    combat.playerAp = getStats(state, data).derived.ap;
    combat.defendBonus = 0;
    combat.ready = false; // the ready stance lasts until the player's next turn
  }
  const { events, skip } = startTurnEffects(state, data, combat, who, rng);
  if (enemy?.dead) {
    events.push({ type: "wrog_pokonany", target: who });
    onAllyDeath(data, combat);
  }
  if (skip && !enemy?.dead) events.push({ type: "tura_przepada", target: who });
  return { who, skip, events };
}

/**
 * Ends the current turn: counts down the holder's turn effects, moves to the next living enemy or the player;
 * a full round also counts down battlefield effects. Past round 200 the fight is a draw.
 * @returns {object[]} events
 */
export function endTurn(state, data, combat) {
  const events = endTurnEffects(state, data, combat, combat.order[combat.turn]);
  const present = (who) => who === "player" || livingEnemies(combat).some((e) => e.uid === who);
  for (let i = 0; i < combat.order.length; i++) {
    combat.turn += 1;
    if (combat.turn >= combat.order.length) {
      combat.turn = 0;
      events.push(...endRoundBattlefield(combat));
      combat.round += 1;
      if (combat.round > MAX_ROUNDS && !combat.outcome) { combat.outcome = "draw"; events.push({ type: "remis" }); }
    }
    if (present(combat.order[combat.turn])) break;
  }
  return events;
}

/** Plays enemy turns until it is the player's turn again or the fight ends. */
export function runEnemyTurns(state, data, combat, rng) {
  const events = [];
  while (!outcomeOf(state, combat) && combat.order[combat.turn] !== "player") {
    const begun = beginTurn(state, data, combat, rng);
    events.push(...begun.events);
    const enemy = enemyByUid(combat, begun.who);
    if (!begun.skip && !enemy.dead && !outcomeOf(state, combat)) events.push(...enemyTurn(state, data, combat, begun.who, rng));
    if (outcomeOf(state, combat)) break;
    events.push(...endTurn(state, data, combat));
  }
  events.push(...lowHpHint(state, data, combat));
  return events;
}

/** Once per fight, when the hero's HP first drops to `lowHpPercent` of the maximum: a nudge to bandage up or run. */
export function lowHpHint(state, data, combat) {
  const { lowHpPercent } = data.rules.combat;
  const hp = state.character.hp;
  if (combat.lowHpHinted || !lowHpPercent || hp <= 0 || hp * 100 > getStats(state, data).derived.hpMax * lowHpPercent) return [];
  combat.lowHpHinted = true;
  return [{ type: "slabosc" }];
}

/**
 * Wraps the fight up: clears turn effects and the thrown weapon, advances world time, and on a win pays XP (defeated + half for fled, rounded down
 * each) mastery growth (per enemy finished by the player's blow) and loot (from the defeated, then the scene's own `loot`), then sets `combat_<scene>_wygrana|_ucieczka|_porazka`. A draw counts as fleeing.
 * @returns {{ outcome: string, xp: number, events: object[] }}
 */
export function finishCombat(state, data, combat, rng) {
  const outcome = outcomeOf(state, combat);
  if (!outcome) throw new Error("finishCombat: walka jeszcze trwa");
  clearTurnEffects(state, data);
  combat.thrown = null; // the thrown weapon never left the bag: it simply comes back
  const events = advanceTime(state, combat.def.minutes ?? data.rules.combat.defaultMinutes, data, rng, { combat, sceneTags: combat.def.tags ?? [] });
  let xp = 0;
  if (outcome === "win") {
    // In training the spared enemies (HP 1) count as defeated.
    const beaten = combat.enemies.filter((e) => !e.fled && (e.dead || combat.training));
    xp = beaten.reduce((sum, e) => sum + enemyById(data, e.id).xp, 0)
      + combat.enemies.filter((e) => e.fled).reduce((sum, e) => sum + Math.floor(enemyById(data, e.id).xp / 2), 0);
    addXp(state.character, xp, data);
    events.push({ type: "pd", amount: xp });
    events.push(...applyMasteryGrowth(state, data, beaten));
    for (const e of beaten) {
      for (const { chance, ...action } of enemyById(data, e.id).loot ?? []) {
        if (rng.int(1, 100) <= chance) events.push(...runActions(state, data, [action], rng).events);
      }
    }
    // Scene loot, once per win (a second copy of an artifact is skipped by runActions).
    for (const { chance, ...action } of combat.def.loot ?? []) {
      if (rng.int(1, 100) <= chance) events.push(...runActions(state, data, [action], rng).events);
    }
  }
  const suffix = outcome === "win" ? "wygrana" : outcome === "defeat" ? "porazka" : "ucieczka";
  (state.flags ??= {})[`combat_${combat.def.id}_${suffix}`] = true;
  return { outcome, xp, events };
}
