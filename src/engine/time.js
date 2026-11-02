import { decaySearch } from "../systems/search.js";
import { tickHour } from "../systems/effects.js";
import { hungerHour } from "../systems/food.js";
import { regenerate } from "../systems/artifacts.js";
import { rollIfNewDay, update, activePhenomenon } from "../systems/phenomena.js";

const MINUTES_PER_DAY = 24 * 60;

/** Converts absolute game minutes (day 1 starts at 0) into a day/hour/minute clock reading. */
export function clockOf(minutes) {
  const day = Math.floor(minutes / MINUTES_PER_DAY) + 1;
  const rest = minutes % MINUTES_PER_DAY;
  return { day, hour: Math.floor(rest / 60), minute: rest % 60 };
}

const covers = (entry, hour) =>
  entry.from < entry.to ? hour >= entry.from && hour < entry.to : hour >= entry.from || hour < entry.to;

/** Returns the id of the time-of-day period covering the hour of the given absolute minutes. */
export function timeOfDay(minutes, rules) {
  const { hour } = clockOf(minutes);
  const entry = rules.timeOfDay.find((e) => covers(e, hour));
  if (!entry) throw new Error(`brak pory doby dla godziny ${hour}`);
  return entry.id;
}

/** Hooks run on every full hour: (state, data, atMinutes) => Event[]. Shared module-level registry. */
export const HOURLY_HOOKS = [];

/**
 * Advances the clock, stepping to each full hour; returns events in time order. Every stretch first charges the artifacts
 * (`context = { combat?, sceneTags? }` feeds their conditions); on a full hour come, in order: the day's phenomenon roll (first full
 * hour of a new day), the phenomenon omen/start/end, `zmiana_pory`, the effect ticks, then the hook results.
 */
export function advanceTime(state, minutes, data, rng, context = {}) {
  const events = [];
  let left = minutes;
  while (left > 0) {
    const step = Math.min(left, 60 - (state.time.minutes % 60));
    const before = timeOfDay(state.time.minutes, data.rules);
    if (state.inventory) events.push(...regenerate(state, data, step, { ...context, phenomenon: activePhenomenon(state, data) }));
    state.time.minutes += step;
    left -= step;
    if (state.time.minutes % 60 !== 0) continue;
    if (state.world) {
      if (state.time.minutes % 1440 === 0) decaySearch(state, data, 1);
      rollIfNewDay(state, data, rng);
      events.push(...update(state, data, state.time.minutes));
    }
    const after = timeOfDay(state.time.minutes, data.rules);
    if (after !== before) events.push({ type: "zmiana_pory", to: after, at: state.time.minutes });
    if (state.character) events.push(...tickHour(state, data, rng), ...hungerHour(state, data, rng));
    for (const hook of HOURLY_HOOKS) events.push(...hook(state, data, state.time.minutes));
  }
  return events;
}
