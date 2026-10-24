/** Spots of a location (people to talk to, shops, a bed, a notice board, scenes) as the map scene plays them. */
import { evaluate } from "../engine/conditions.js";
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
    case "scene": return spot.scenes;
    default: return null;
  }
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

/** Known spots of a location in data order; `available` is false when the spot's `if` does not hold. */
export function visibleSpots(state, data, locationId) {
  const location = data.travel.locations.find((l) => l.id === locationId);
  return (location?.spots ?? [])
    .filter((spot) => isKnown(state, data, `${locationId}.${spot.id}`))
    .map((spot) => ({ spot, available: !spot.if || evaluate(spot.if, state, data) }));
}
