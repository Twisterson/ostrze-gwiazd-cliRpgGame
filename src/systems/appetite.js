/** Appetite: a gauge that fills with the hours since the last meal; it only shows (the real hunger is the `glod` effect). */

const DEFAULTS = { fullHours: 18, hintAt: 85 };
const rulesOf = (data) => ({ ...DEFAULTS, ...data.rules?.appetite });

/** Percent (0–100) of the gauge: the hours since the last meal against `fullHours`; 0 before the first tick. */
export function appetitePercent(state, data) {
  const last = state.character?.lastMeal;
  if (last === undefined) return 0;
  const { fullHours } = rulesOf(data);
  return Math.max(0, Math.min(100, Math.floor(((state.time.minutes - last) * 100) / (fullHours * 60))));
}

/** A meal was eaten: the gauge starts again and the hero may hint again. */
export function resetAppetite(state) {
  state.character.lastMeal = state.time.minutes;
  delete state.character.appetiteHinted;
}

/** Hourly hook: starts the gauge on its first tick, and once per fill reports `glod_pora` when it passes `hintAt`. */
export function appetiteHour(state, data) {
  const ch = state.character;
  if (!ch) return [];
  ch.lastMeal ??= state.time.minutes - 60;
  if (ch.appetiteHinted || appetitePercent(state, data) < rulesOf(data).hintAt) return [];
  ch.appetiteHinted = true;
  return [{ type: "glod_pora" }];
}
