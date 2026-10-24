/** Weapon mastery: kinds of weapons, growth after won fights and the bonuses it gives (pure; no RNG). */
import { MASTERY_TYPES } from "../items.js";
import { enemyById } from "./data.js";

/** A mastery object with every kind at 0. */
export const emptyMastery = () => Object.fromEntries(MASTERY_TYPES.map((type) => [type, 0]));

/** Starting mastery of class `cls`: zeros plus its `masteryStart` (known kinds only). */
export function startMastery(cls) {
  const mastery = emptyMastery();
  for (const [type, v] of Object.entries(cls?.masteryStart ?? {})) if (type in mastery) mastery[type] = v;
  return mastery;
}

/** Mastery kind of an attack with `item` (`thrown`: a throw counts as `rzucana`); null for fists and unknown items. */
export function masteryTypeOf(item, { thrown = false } = {}) {
  if (!item) return null;
  if (thrown || item.type === "throwable") return "rzucana";
  return item.masteryType ?? null;
}

/** New mastery after defeating an enemy worth `enemyXp`: `value + xp/xpDiv × (1 − value/100)²`, rounded to 0.1, at most `max`. `rules` is the `rules.combat.mastery` block. */
export function masteryGain(value, enemyXp, rules) {
  const { xpDiv, max } = rules;
  const next = value + (enemyXp / xpDiv) * (1 - value / 100) ** 2;
  return Math.min(max, Math.round(next * 10) / 10);
}

/** Bonuses of the player's mastery in `type`: `{ hit, damagePercent, defense }` (whole numbers, floored). */
export function masteryBonuses(state, data, type) {
  const m = data.rules.combat.mastery;
  const b = type ? state.character?.mastery?.[type] ?? 0 : 0;
  return {
    hit: Math.floor((m.hitAt100 * b) / 100),
    damagePercent: Math.floor((m.damagePercentAt100 * b) / 100),
    defense: Math.floor((m.defenseAt100 * b) / 100),
  };
}

/**
 * Applies the growth for the enemies beaten by the player's blows (`killedBy` set), one after another on the running value.
 * Mutates `state.character.mastery`.
 * @returns {object[]} `bieglosc` events (only for gains of at least 0.1)
 */
export function applyMasteryGrowth(state, data, enemies) {
  const mastery = (state.character.mastery ??= emptyMastery());
  const events = [];
  for (const e of enemies) {
    if (!e.killedBy || !(e.killedBy in mastery)) continue;
    const before = mastery[e.killedBy];
    const after = masteryGain(before, enemyById(data, e.id).xp, data.rules.combat.mastery);
    mastery[e.killedBy] = after;
    if (Math.round((after - before) * 10) >= 1) events.push({ type: "bieglosc", masteryType: e.killedBy, before, after });
  }
  return events;
}
