import { pushEventNotices } from "../ui/events.js";
import { advanceTime } from "../engine/time.js";
import { createSceneList, runScenes } from "../engine/loop.js";
import { locationById, walkMinutes, rollLocalEvent, markEventSeen, eventById, EVENT_END } from "../systems/travel.js";
import { forgetScenes } from "./trip.js";
import { MissingCharacterError } from "./errors.js";

// `world.map.walk` is read afresh each time: an interrupted fight restores the whole state object.
const walkOf = (state) => state.world.map.walk;

/** Starts the walk to `to` (stored in `world.map.walk`, so a save resumes it). */
export function startWalk(state, data, to) {
  state.world.map.walk = { to, step: 0, left: walkMinutes(data, state.world.location, to), event: null, eventScene: null };
}

/**
 * A short walk to the near location `to`, in minutes: no camp, no hunger. At most one local event on the way (the first half
 * of the walk, the event, the rest). Everything is kept in `world.map.walk` (`step` 0 – not started, 1 – the event is next,
 * 2 – the rest of the walk), so a save made at any prompt resumes without counting the time twice. Ends at `to`.
 */
export async function walk(ctx, to) {
  const { state, data } = ctx;
  if (!state.character) throw new MissingCharacterError();
  const place = locationById(data, to);
  if (!walkOf(state)) startWalk(state, data, to);
  if (walkOf(state).step === 0) {
    const w = walkOf(state);
    w.event = rollLocalEvent(state, data, ctx.rng, place.danger ?? 1);
    const first = w.event ? Math.floor(w.left / 2) : w.left;
    w.left -= first;
    w.step = w.event ? 1 : 2;
    pushEventNotices(ctx, advanceTime(state, first, data, ctx.rng));
  }
  if (walkOf(state).step === 1) {
    const event = eventById(data, walkOf(state).event);
    if (walkOf(state).eventScene === null) forgetScenes(state, event.scenes);
    const start = walkOf(state).eventScene ?? event.scenes[0].id;
    await runScenes(ctx, createSceneList(event.scenes), start, { onScene: (id) => { walkOf(state).eventScene = id; }, endId: EVENT_END });
    markEventSeen(state, data, event.id);
    Object.assign(walkOf(state), { step: 2, eventScene: null });
  }
  const { left } = walkOf(state);
  if (left > 0) pushEventNotices(ctx, advanceTime(state, left, data, ctx.rng));
  state.world.location = to;
  state.world.map.walk = null;
}
