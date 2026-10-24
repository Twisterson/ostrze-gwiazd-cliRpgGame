/** What the player knows of the map: locations and their spots, revealed (`discovered`) or only hinted at (`hinted`). */

const locations = (data) => (Array.isArray(data.travel?.locations) ? data.travel.locations : []);
const spotsOf = (location) => (Array.isArray(location?.spots) ? location.spots : []);

/** Ids of all locations and spots ("wilczy_brod", "wilczy_brod.karczma"). */
export function placeIds(data) {
  return locations(data).flatMap((l) => [l.id, ...spotsOf(l).map((s) => `${l.id}.${s.id}`)]);
}

/** The location (and spot, or null) behind a place id; undefined when unknown. */
export function placeById(data, id) {
  if (typeof id !== "string") return undefined;
  const [locationId, spotId, extra] = id.split(".");
  if (extra !== undefined) return undefined;
  const location = locations(data).find((l) => l.id === locationId);
  if (!location) return undefined;
  if (spotId === undefined) return { location, spot: null };
  const spot = spotsOf(location).find((s) => s.id === spotId);
  return spot ? { location, spot } : undefined;
}

/** A location is known when it is not `secret` or has been revealed; a spot also needs its own `secret` revealed. */
export function isKnown(state, data, id) {
  const place = placeById(data, id);
  if (!place) return false;
  const discovered = state.world?.discovered ?? [];
  if (place.location.secret && !discovered.includes(place.location.id)) return false;
  return !place.spot?.secret || discovered.includes(id);
}

/** Reveals a place once; returns the `odkryto` event, or nothing when it was known already. */
export function revealPlace(state, data, id) {
  if (isKnown(state, data, id)) return [];
  const discovered = (state.world.discovered ??= []);
  if (!discovered.includes(id)) discovered.push(id);
  // A spot of a location that is still hidden: remembered, shown once its location is revealed.
  return isKnown(state, data, placeById(data, id)?.location.id) ? [{ type: "odkryto", id }] : [];
}

/** Hints at a place once ("???" on the map); nothing when it is known or already hinted. */
export function hintPlace(state, data, id) {
  if (placeById(data, id)?.spot) id = placeById(data, id).location.id; // only whole locations are hinted at
  if (isKnown(state, data, id) || (state.world.hinted ??= []).includes(id)) return [];
  state.world.hinted.push(id);
  return [{ type: "zapowiedz_miejsca", id }];
}

/** Display name of a place: the spot's, else the location's. */
export function placeName(data, id) {
  const place = placeById(data, id);
  return place?.spot?.name ?? place?.location.name ?? id;
}

/** "Las Rubieży" or "Las Rubieży – Polana" for a place id. */
export function placeLabel(data, id) {
  const place = placeById(data, id);
  if (!place) return id;
  return place.spot ? `${place.location.name} – ${place.spot.name}` : place.location.name;
}

/** Drops unknown ids from `world.discovered` / `world.hinted`; returns them. */
export function repairPlaces(state, data) {
  const known = new Set(placeIds(data));
  const bad = [];
  for (const key of ["discovered", "hinted"]) {
    const list = Array.isArray(state.world[key]) ? state.world[key] : [];
    state.world[key] = list.filter((id) => {
      if (known.has(id)) return true;
      bad.push(String(id));
      return false;
    });
  }
  return bad;
}
