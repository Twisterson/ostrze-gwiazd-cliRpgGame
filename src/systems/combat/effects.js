/** Turn effects in combat: applying, start/end-of-turn processing, battlefield countdown. */
import { applyEffect, effectById, addToList } from "../effects.js";
import { enemyByUid } from "./state.js";
import { enemyById } from "./data.js";
import { dealDamage } from "./formulas.js";

const STRACH_MORALE = 20;

const entriesOf = (state, combat, who) => (who === "player" ? (state.character.effects ??= []) : enemyByUid(combat, who).effects);
const isTurn = (data, entry) => effectById(data, entry.id)?.unit === "turn";

/**
 * Applies a turn effect to an enemy: immune -> nothing; `effectResist[id]` (+ `chancePenalty`) is a percent roll to resist
 * (outcome per `rules.effects.resistOutcome`); `strach` lowers morale once per application; `duration` overrides the effect's own.
 * @returns {{ applied: boolean, resisted: boolean, immune: boolean }}
 */
export function applyToEnemy(data, combat, enemy, id, rng, { chancePenalty = 0, duration: lasting } = {}) {
  const def = effectById(data, id);
  if (!def) throw new Error(`applyToEnemy: nieznany efekt "${id}"`);
  const base = enemyById(data, enemy.id);
  if ((base.immune ?? []).includes(id)) return { applied: false, resisted: false, immune: true };
  const rules = data.rules.effects;
  const current = enemy.effects.find((e) => e.id === id);
  let duration = lasting ?? def.duration;
  const resist = Math.min(100, (base.effectResist?.[id] ?? 0) + chancePenalty);
  let resisted = false;
  if (resist > 0 && rng.int(1, 100) <= resist) {
    resisted = true;
    if (rules.resistOutcome === "cancel" || current) return { applied: false, resisted: true, immune: false };
    duration = Math.max(1, Math.floor(duration / 2));
  }
  addToList(enemy.effects, def, current, duration, rules);
  if (def.dazed) enemy.effects.find((e) => e.id === id).dazed = true; // lets isDazed work without data
  if (id === "strach" && enemy.morale !== null && enemy.morale !== undefined) enemy.morale = Math.max(0, enemy.morale - STRACH_MORALE);
  return { applied: true, resisted, immune: false };
}

/** Applies an effect to the player during combat (turn effects allowed; `duration` overrides the effect's own). */
export const applyToPlayer = (state, data, id, rng, { duration } = {}) => applyEffect(state, data, id, rng, { inCombat: true, duration });

/**
 * Start of `who`'s turn (after AP refresh): damage ticks (x stacks), `rozkojarzenie`-style AP loss, skip detection.
 * Every turn effect the holder has now is "armed" here: only armed ones count down at the end of the turn, so an effect
 * applied during its holder's own turn (a stun, a step-back free attack) still lasts its full duration of later turns.
 * @returns {{ events: object[], skip: boolean }}
 */
export function startTurnEffects(state, data, combat, who, rng) {
  const events = [];
  const target = who === "player" ? state.character : enemyByUid(combat, who);
  let skip = false;
  for (const entry of [...entriesOf(state, combat, who)]) {
    const def = effectById(data, entry.id);
    if (!def || def.unit !== "turn") continue;
    entry.armed = true;
    if (def.skipTurn) skip = true;
    const tick = def.tick;
    if (!tick) continue;
    if (tick.damage) {
      const amount = rng.int(tick.damage[0], tick.damage[1]) * entry.stacks;
      const damage = dealDamage(combat, target, amount);
      events.push({ type: "efekt_obrazenia", id: entry.id, damage, target: who });
    }
    if (tick.loseApChance && rng.int(1, 100) <= tick.loseApChance) {
      if (who === "player") combat.playerAp = Math.max(0, combat.playerAp - tick.loseAp);
      else target.ap = Math.max(0, target.ap - tick.loseAp);
      events.push({ type: "efekt_ap", id: entry.id, ap: tick.loseAp, target: who });
    }
  }
  return { events, skip };
}

/** End of `who`'s turn: counts down their armed turn effects (those applied during this very turn wait); returns `efekt_koniec` events. */
export function endTurnEffects(state, data, combat, who) {
  const entries = entriesOf(state, combat, who);
  const events = [];
  for (const entry of [...entries]) {
    const def = effectById(data, entry.id);
    if (!def || def.unit !== "turn") continue;
    if (!entry.armed) continue;
    entry.remaining -= 1;
    if (entry.remaining <= 0) {
      entries.splice(entries.indexOf(entry), 1);
      events.push({ type: "efekt_koniec", id: entry.id, target: who });
    }
  }
  return events;
}

/** End of a round: counts down battlefield effects; returns `efekt_koniec` events. */
export function endRoundBattlefield(combat) {
  const events = [];
  for (const entry of [...combat.battlefield]) {
    entry.remaining -= 1;
    if (entry.remaining <= 0) {
      combat.battlefield.splice(combat.battlefield.indexOf(entry), 1);
      events.push({ type: "efekt_koniec", id: entry.id, target: "battlefield" });
    }
  }
  return events;
}

/** True when the enemy has an effect with `dazed`. */
export const isDazed = (enemy) => enemy.effects.some((e) => e.dazed);

/** After combat: removes the player's turn effects (hour effects stay). */
export function clearTurnEffects(state, data) {
  state.character.effects = (state.character.effects ?? []).filter((e) => !isTurn(data, e));
}
