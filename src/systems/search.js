/** The search level: how hard the imperial scouts look for the survivor (0–100, `world.search`). */

const clamp = (n) => Math.max(0, Math.min(100, n));

/** Adds `delta` (may be negative) to the level, kept in 0–100; returns the new level. */
export function addSearch(state, data, delta) {
  state.world.search = clamp((state.world.search ?? 0) + delta);
  return state.world.search;
}

/** "spokoj" | "czujnosc" | "poscig" | "oblawa" by the thresholds in `rules.search.levels`. */
export function searchLevel(state, data) {
  const level = state.world?.search ?? 0;
  const { levels } = data.rules.search;
  if (level >= levels.oblawa) return "oblawa";
  if (level >= levels.poscig) return "poscig";
  if (level >= levels.czujnosc) return "czujnosc";
  return "spokoj";
}

/** The level falls by `rules.search.decayPerDay` for each of `days` days. */
export function decaySearch(state, data, days = 1) {
  return addSearch(state, data, -data.rules.search.decayPerDay * days);
}
