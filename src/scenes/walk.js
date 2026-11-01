import { pushEventNotices } from "../ui/events.js";
import { advanceTime } from "../engine/time.js";
import { createSceneList, runScenes } from "../engine/loop.js";
import { locationById, walkMinutes, rollLocalEvents, passKey, recordPass, markEventSeen, eventById, EVENT_END } from "../systems/travel.js";
import { forgetScenes } from "./trip.js";
import { MissingCharacterError } from "./errors.js";

// `world.map.walk` is read afresh each time: an interrupted fight restores the whole state object.
const walkOf = (state) => state.world.map.walk;

/** Starts the walk to `to` (stored in `world.map.walk`, so a save resumes it). Legs and events are rolled when it begins. */
export function startWalk(state, data, to) {
  state.world.map.walk = { to, legs: null, events: [], step: 0, eventScene: null };
}

/**
 * A walk to the near location `to`, in minutes: no camp, no hunger. The way is split by the local events it meets (one try per
 * `walkSegmentMinutes`, at most `walkMaxEvents`; the chance thins with every earlier pass of the same way). Everything is kept
 * in `world.map.walk`: `legs` (minutes of each stretch), `events` (their ids) and `step` – 2i is stretch i, 2i + 1 is event i –
 * so a save made at any prompt resumes without counting the time twice or rolling again. Ends at `to`.
 */
export async function walk(ctx, to) {
  const { state, data } = ctx;
  if (!state.character) throw new MissingCharacterError();
  const place = locationById(data, to);
  const from = state.world.location;
  if (!walkOf(state)) startWalk(state, data, to);
  if (walkOf(state).legs === null) {
    const minutes = walkMinutes(data, from, to);
    const danger = Math.max(place.danger ?? 1, locationById(data, from)?.danger ?? 1); // the same chance both ways
    const events = rollLocalEvents(state, data, ctx.rng, danger, minutes, passKey(from, to), place.region);
    const part = Math.floor(minutes / (events.length + 1));
    const legs = Array.from({ length: events.length + 1 }, (_, i) => (i === events.length ? minutes - part * events.length : part));
    Object.assign(walkOf(state), { legs, events, step: 0 });
  }
  while (walkOf(state).step <= 2 * walkOf(state).events.length) {
    const w = walkOf(state);
    const i = w.step >> 1;
    if (w.step % 2 === 0) {
      w.step += 1;
      pushEventNotices(ctx, advanceTime(state, w.legs[i], data, ctx.rng));
      continue;
    }
    const event = eventById(data, w.events[i]);
    if (w.eventScene === null) { forgetScenes(state, event.scenes); delete state.world.heavyLoot; }
    const start = w.eventScene ?? event.scenes[0].id;
    await runScenes(ctx, createSceneList(event.scenes), start, { onScene: (id) => { walkOf(state).eventScene = id; }, endId: EVENT_END });
    markEventSeen(state, data, event.id);
    Object.assign(walkOf(state), { step: w.step + 1, eventScene: null });
  }
  state.world.location = to;
  recordPass(state, passKey(from, to));
  state.world.map.walk = null;
}
