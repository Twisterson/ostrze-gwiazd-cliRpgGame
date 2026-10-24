/** Natural phenomena: validation of phenomena.json. */
import { check } from "../engine/schema.js";
import { validateModifiers } from "./modifiers.js";

export const PHENOMENON_KINDS = ["magiczne", "pogodowe"];
export const ENEMY_MODIFIER_KEYS = ["hitChance", "damage", "defense"];
export const TRAVEL_STATES = ["normal", "slow", "dangerous"];

const ID = { type: "string", pattern: /^[a-z0-9_]+$/ };
const TEXT = { type: "string", nonEmpty: true };
const INT = { type: "integer" };
const INT_MIN0 = { type: "integer", min: 0 };
const strict = (required, fields) => ({ type: "object", required, fields, additional: false });

// `timeOfDay` may be null, so it is checked by hand (schema.js has no null type).
const PHENOMENON_SCHEMA = strict(["id", "name", "kind", "omen", "duration", "frequency", "world"], {
  id: ID, name: TEXT, kind: { type: "string" },
  omen: strict(["hoursBefore", "text"], { hoursBefore: INT_MIN0, text: TEXT }),
  duration: { type: "array" }, frequency: strict(["chancePerDay"], { chancePerDay: INT_MIN0 }),
  // `exposed` ("full" or { multiplier }) is checked by hand.
  onArtifacts: { type: "object", fields: { carried: strict(["multiplier"], { multiplier: { type: "number" } }) } },
  modifiers: { type: "object" }, bystroscSkillPenalty: INT,
  enemyModifiers: { type: "object", values: { type: "object" } }, blocks: { type: "array", items: ID },
  world: strict(["visibility", "travel"], { visibility: INT, travel: { type: "string", enum: TRAVEL_STATES } }),
});

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function validatePhenomenon(p, prefix, data) {
  if (!isObject(p)) return [`${prefix}: oczekiwano obiektu`];
  const { timeOfDay, ...rest } = p;
  const errors = check(rest, PHENOMENON_SCHEMA).map((m) => `${prefix} › ${m}`);
  const at = (field) => `${prefix} › ${field}`;
  if (typeof p.kind === "string" && !PHENOMENON_KINDS.includes(p.kind)) errors.push(`${at("kind")}: nieznany rodzaj ${JSON.stringify(p.kind)}`);
  const d = p.duration;
  if (d !== undefined && !(Array.isArray(d) && d.length === 2 && d.every(Number.isInteger) && d[0] >= 1 && d[0] <= d[1] && d[1] <= 24)) {
    errors.push(`${at("duration")}: oczekiwano [min, max] godzin 1–24`);
  }
  const periods = (data.rules?.timeOfDay ?? []).map((t) => t?.id);
  if (timeOfDay === undefined) errors.push(`${at("timeOfDay")}: brak wymaganego pola`);
  else if (timeOfDay !== null) {
    if (!Array.isArray(timeOfDay) || timeOfDay.length === 0) errors.push(`${at("timeOfDay")}: oczekiwano null lub niepustej listy pór`);
    else timeOfDay.forEach((id, i) => {
      if (!periods.includes(id)) errors.push(`${at(`timeOfDay[${i}]`)}: nieznana pora ${JSON.stringify(id)}`);
    });
  }
  if (isObject(p.frequency) && Number.isInteger(p.frequency.chancePerDay) && p.frequency.chancePerDay > 100) {
    errors.push(`${at("frequency.chancePerDay")}: wartość poza zakresem 0–100`);
  }
  for (const key of Object.keys(isObject(p.onArtifacts) ? p.onArtifacts : {})) {
    if (key !== "exposed" && key !== "carried") errors.push(`${at(`onArtifacts.${key}`)}: nieznane pole`);
  }
  const exposed = isObject(p.onArtifacts) ? p.onArtifacts.exposed : undefined;
  if (exposed !== undefined && exposed !== "full" && !(isObject(exposed) && Object.keys(exposed).length === 1 && typeof exposed.multiplier === "number")) {
    errors.push(`${at("onArtifacts.exposed")}: oczekiwano "full" lub { multiplier }`);
  }
  if (isObject(p.modifiers)) errors.push(...validateModifiers(p.modifiers, at("modifiers"), data));
  if (Number.isInteger(p.bystroscSkillPenalty) && p.bystroscSkillPenalty > 0) errors.push(`${at("bystroscSkillPenalty")}: wartość większa niż 0`);
  if (isObject(p.enemyModifiers)) {
    for (const [tag, mods] of Object.entries(p.enemyModifiers)) {
      if (!isObject(mods)) continue;
      for (const [key, v] of Object.entries(mods)) {
        if (!ENEMY_MODIFIER_KEYS.includes(key)) errors.push(`${at(`enemyModifiers.${tag}.${key}`)}: nieznany modyfikator`);
        else if (!Number.isInteger(v)) errors.push(`${at(`enemyModifiers.${tag}.${key}`)}: oczekiwano liczby całkowitej`);
      }
    }
  }
  const skillIds = (data.skills ?? []).map((s) => s?.id);
  if (Array.isArray(p.blocks)) {
    p.blocks.forEach((id, i) => {
      if (typeof id === "string" && !skillIds.includes(id)) errors.push(`${at(`blocks[${i}]`)}: nieznana umiejętność ${JSON.stringify(id)}`);
    });
  }
  return errors;
}

/** Validates the phenomena list (unique ids, fields, time-of-day and skill references); returns error messages. */
export function validatePhenomena(list, data) {
  if (!Array.isArray(list)) return ["phenomena.json: oczekiwano tablicy"];
  const errors = [];
  const ids = new Set();
  list.forEach((p, index) => {
    const id = typeof p?.id === "string" ? p.id : null;
    const prefix = `phenomena.json › ${id ?? `#${index}`}`;
    if (id !== null) {
      if (ids.has(id)) errors.push(`${prefix}: zduplikowane id`);
      ids.add(id);
    }
    errors.push(...validatePhenomenon(p, prefix, data));
  });
  return errors;
}

/** Returns the phenomenon with `id`, or undefined. */
export function phenomenonById(data, id) {
  return (data.phenomena ?? []).find((p) => p.id === id);
}

const MINUTES_PER_DAY = 24 * 60;

const covers = (entry, hour) => (entry.from < entry.to ? hour >= entry.from && hour < entry.to : hour >= entry.from || hour < entry.to);

/** Hours 0–23 of the day that fit the phenomenon's `timeOfDay` (any when null) and are not earlier than `fromHour`. */
function startHours(def, data, fromHour) {
  const periods = def.timeOfDay ? data.rules.timeOfDay.filter((t) => def.timeOfDay.includes(t.id)) : null;
  const hours = [];
  for (let h = fromHour; h < 24; h++) if (!periods || periods.some((t) => covers(t, h))) hours.push(h);
  return hours;
}

/**
 * Rolls the day's phenomenon when none is planned or running: each phenomenon in file order gets `rng.int(1,100) ≤ chancePerDay`;
 * the first hit picks a start hour of this day (fitting its time of day, not before the current hour) and a duration. At most
 * `rules.phenomena.maxPerDay` (the state holds one). No events (the omen comes from `update`).
 */
export function rollDaily(state, data, rng, dayStart) {
  if (state.world.phenomenon || data.rules.phenomena.maxPerDay < 1) return;
  const now = state.time.minutes;
  const fromHour = Math.max(0, Math.ceil((now - dayStart) / 60));
  for (const def of data.phenomena ?? []) {
    if (rng.int(1, 100) > def.frequency.chancePerDay) continue;
    const hours = startHours(def, data, fromHour);
    if (hours.length === 0) continue;
    const startsAt = dayStart + 60 * hours[rng.int(0, hours.length - 1)];
    const endsAt = startsAt + 60 * rng.int(def.duration[0], def.duration[1]);
    const omenAt = Math.max(now, startsAt - 60 * def.omen.hoursBefore);
    state.world.phenomenon = { id: def.id, startsAt, endsAt, omenAt, omenShown: false, started: false };
    return;
  }
}

/** Rolls the current day once: on the first full hour of a day not rolled yet. */
export function rollIfNewDay(state, data, rng) {
  if (!state.world || !data.phenomena) return;
  const day = Math.floor(state.time.minutes / MINUTES_PER_DAY) + 1;
  if ((state.world.phenomenonRolledDay ?? 0) >= day) return;
  state.world.phenomenonRolledDay = day;
  rollDaily(state, data, rng, (day - 1) * MINUTES_PER_DAY);
}

/**
 * Moves the planned/running phenomenon along at `now`: omen (once, before the start), start, end (state cleared).
 * @returns {Array<{ type: "zapowiedz_zjawiska" | "start_zjawiska" | "koniec_zjawiska", id: string }>}
 */
export function update(state, data, now) {
  const p = state.world?.phenomenon;
  if (!p) return [];
  const events = [];
  if (!p.omenShown && !p.started && now >= p.omenAt) {
    p.omenShown = true;
    events.push({ type: "zapowiedz_zjawiska", id: p.id });
  }
  if (!p.started && now >= p.startsAt) {
    p.started = true;
    events.push({ type: "start_zjawiska", id: p.id });
  }
  if (now >= p.endsAt) {
    state.world.phenomenon = null;
    events.push({ type: "koniec_zjawiska", id: p.id });
  }
  return events;
}

/** Starts phenomenon `id` now, replacing a planned or running one. */
export function forcePhenomenon(state, data, id, rng, now) {
  const def = phenomenonById(data, id);
  if (!def) throw new Error(`Nieznane zjawisko: ${id}`);
  const endsAt = now + 60 * rng.int(def.duration[0], def.duration[1]);
  state.world.phenomenon = { id, startsAt: now, endsAt, omenAt: now, omenShown: true, started: true };
  return [{ type: "start_zjawiska", id }];
}

/** The definition of the running phenomenon, or null. */
export function activePhenomenon(state, data) {
  const p = state.world?.phenomenon;
  return p?.started ? phenomenonById(data, p.id) ?? null : null;
}

/** The planned phenomenon whose omen was shown but which has not started yet, with its start minute; null otherwise. */
export function announcedPhenomenon(state, data) {
  const p = state.world?.phenomenon;
  return p && p.omenShown && !p.started ? { def: phenomenonById(data, p.id), startsAt: p.startsAt } : null;
}

/** Modifier objects of the running phenomenon (0–1 entries). */
export function phenomenonModifiers(state, data) {
  const def = activePhenomenon(state, data);
  return def?.modifiers ? [def.modifiers] : [];
}

/** The running phenomenon's penalty to Bystrość-based skills (0 without one). */
export function phenomenonBystroscPenalty(state, data) {
  return activePhenomenon(state, data)?.bystroscSkillPenalty ?? 0;
}

/** Sum of the running phenomenon's `enemyModifiers` over the tags of `enemy` (an object with `id`). */
export function phenomenonEnemyModifiers(state, data, enemy) {
  const total = { hitChance: 0, damage: 0, defense: 0 };
  const mods = activePhenomenon(state, data)?.enemyModifiers ?? {};
  const tags = (data.enemies ?? []).find((e) => e.id === enemy.id)?.tags ?? [];
  for (const tag of tags) {
    for (const key of ENEMY_MODIFIER_KEYS) total[key] += mods[tag]?.[key] ?? 0;
  }
  return total;
}

/** True when the running phenomenon blocks weapons of `skill`. */
export function blockedSkill(state, data, skill) {
  return (activePhenomenon(state, data)?.blocks ?? []).includes(skill);
}
