/** Appetite: a gauge that fills with the hours since the last meal; its levels are the stages of hunger (see `hungerHour` in food.js). */

const DEFAULTS = { fullHours: 24, hintAt: 85, starveAt: 150 };
export const appetiteRules = (data) => ({ ...DEFAULTS, ...data.rules?.appetite });

/** Percent of the gauge: the hours since the last meal against `fullHours`, past 100 when nobody eats; 0 before the first tick. */
export function appetitePercent(state, data) {
  const last = state.character?.lastMeal;
  if (last === undefined) return 0;
  return Math.max(0, Math.floor(((state.time.minutes - last) * 100) / (appetiteRules(data).fullHours * 60)));
}

/** A full meal at a table: the gauge starts again and the hero may hint again. */
export function resetAppetite(state) {
  state.character.lastMeal = state.time.minutes;
  delete state.character.appetiteHinted;
}

/** One piece of food: takes 100 points off the gauge, never below zero. */
export function feedAppetite(state, data) {
  const ch = state.character;
  const now = state.time.minutes;
  ch.lastMeal = Math.min(now, (ch.lastMeal ?? now) + appetiteRules(data).fullHours * 60);
  if (appetitePercent(state, data) < appetiteRules(data).hintAt) delete ch.appetiteHinted;
}

/** Hourly hook: starts the gauge on its first tick, and once per fill reports `glod_pora` when it passes `hintAt`. */
export function appetiteHour(state, data) {
  const ch = state.character;
  if (!ch) return [];
  ch.lastMeal ??= state.time.minutes - 60;
  if (ch.appetiteHinted || appetitePercent(state, data) < appetiteRules(data).hintAt) return [];
  ch.appetiteHinted = true;
  return [{ type: "glod_pora" }];
}
