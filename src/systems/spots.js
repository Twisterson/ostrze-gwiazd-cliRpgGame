/** Spots of a location (people to talk to, shops, a bed, a notice board, scenes) as the map scene plays them. */
import { evaluate } from "../engine/conditions.js";
import { clockOf } from "../engine/time.js";
import { isKnown, placeById } from "./places.js";

const PREFIX = "miejsce:";

/** Scene id of a spot's single synthetic scene ("miejsce:wilczy_brod.karczma"); it keys the scene's talk progress. */
export const spotSceneId = (locationId, spotId) => `${PREFIX}${locationId}.${spotId}`;

/** The scene list a spot plays: one synthetic scene for talk / shop / rest, the spot's own `scenes` for `scene`; null for a board or unknown spot. */
export function spotScenes(data, locationId, spotId) {
  if (typeof spotId === "string" && spotId.startsWith(VISITOR_PREFIX)) return visitorOf(data, locationId, spotId.slice(1))?.scenes ?? null;
  const place = placeById(data, `${locationId}.${spotId}`);
  const spot = place?.spot;
  if (!spot) return null;
  const id = spotSceneId(locationId, spotId);
  const art = spot.art ? { art: spot.art } : {};
  switch (spot.type) {
    case "talk": return [{ id, type: "dialogue", dialogue: spot.ref, ...art }];
    case "shop": return [{ id, type: "shop", shop: spot.ref, ...art }];
    case "rest": return [{ id, type: "rest", ...art }];
    case "scene":
    case "hunt": return spot.scenes;
    default: return null;
  }
}

/** The scenes a visit plays: the spot's own, led by its ambush scenes when `ambushed`. */
export function playedScenes(data, locationId, spotId, ambushed) {
  const own = spotScenes(data, locationId, spotId);
  const lead = ambushed ? placeById(data, `${locationId}.${spotId}`)?.spot?.ambush?.scenes : null;
  return own && lead ? [...lead, ...own] : own;
}

/** Id prefix of a visitor in `world.map.spot` ("@pielgrzym"). */
export const VISITOR_PREFIX = "@";

/** The visitor `id` of a location (or undefined). */
export const visitorOf = (data, locationId, id) => data.travel.locations.find((l) => l.id === locationId)?.visitors?.find((v) => v.id === id);

/** Who drops by: each visitor whose `if` holds gets one `rng.int(1, 100)` roll against its `chance`, the first hit wins; id or null. */
export function rollVisitor(state, data, locationId, rng) {
  const location = data.travel.locations.find((l) => l.id === locationId);
  for (const v of location?.visitors ?? []) {
    if (v.if && !evaluate(v.if, state, data)) continue;
    if (rng.int(1, 100) <= v.chance) return v.id;
  }
  return null;
}

/** The synthetic scene behind a "miejsce:…" id (for repairing saved talk progress), or undefined. */
export function spotSceneById(data, sceneId) {
  if (typeof sceneId !== "string" || !sceneId.startsWith(PREFIX)) return undefined;
  const [locationId, spotId] = sceneId.slice(PREFIX.length).split(".");
  return spotScenes(data, locationId, spotId)?.find((s) => s.id === sceneId);
}

/**
 * Known spots of a location in data order; `available` is false when the spot's `if` does not hold.
 * A secret spot with an `if` shows up by itself as soon as that `if` holds (no reveal action needed).
 */
export function visibleSpots(state, data, locationId) {
  const location = data.travel.locations.find((l) => l.id === locationId);
  return (location?.spots ?? [])
    .filter((spot) => isKnown(state, data, `${locationId}.${spot.id}`) || (spot.secret && spot.if && evaluate(spot.if, state, data)))
    .map((spot) => ({ spot, available: (!spot.if || evaluate(spot.if, state, data)) && (spot.type !== "hunt" || isHuntReady(state, data, locationId, spot)) }));
}

/**
 * Whether an ambush waits at the spot just entered: the spot's `ambush.if` holds and a `rng.int(1, 100)` roll is within `chance`,
 * at most once a day per spot (the day is written to `world.ambushes` on a hit). With `firstVisit` the first one is certain, no roll.
 */
export function rollAmbush(state, data, locationId, spot, rng) {
  const a = spot?.ambush;
  if (!a || (a.if && !evaluate(a.if, state, data))) return false;
  const key = `${locationId}.${spot.id}`;
  const day = clockOf(state.time.minutes).day;
  if ((state.world.ambushes ?? {})[key] === day) return false;
  const welcome = a.firstVisit === true && (state.world.ambushes ?? {})[key] === undefined;
  if (!welcome && rng.int(1, 100) > a.chance) return false;
  (state.world.ambushes ??= {})[key] = day;
  return true;
}

const huntKey = (locationId, spot) => `${locationId}.${spot.id}`;

/** A hunting ground (`hunt` spot) is open again `cooldownDays` (the spot's, else `rules.travel.huntCooldownDays`) after it was cleared. */
export function isHuntReady(state, data, locationId, spot) {
  const cleared = state.world.hunts?.[huntKey(locationId, spot)];
  if (cleared === undefined) return true;
  return clockOf(state.time.minutes).day >= cleared + (spot.cooldownDays ?? data.rules.travel.huntCooldownDays);
}

/**
 * After a visit: when the spot's fight was won (`combat_<clearedBy>_wygrana`) the day is written to `world.hunts` and the flag is
 * cleared, so the ground rests for its cooldown. A flight or a defeat does not close it.
 * @returns {boolean} whether the ground was cleared
 */
export function recordHunt(state, data, locationId, spot) {
  const flag = `combat_${spot.clearedBy}_wygrana`;
  if (!state.flags[flag]) return false;
  delete state.flags[flag];
  (state.world.hunts ??= {})[huntKey(locationId, spot)] = clockOf(state.time.minutes).day;
  return true;
}
