/** Travel: map (locations, regions, routes), the stage event table and validation of travel.json. */
import { check } from "../engine/schema.js";
import { artRefErrors } from "../engine/pix.js";
import { validateCondition, conditionOpts, evaluate } from "../engine/conditions.js";
import { advanceTime, timeOfDay } from "../engine/time.js";
import { phenomenonById, activePhenomenon } from "./phenomena.js";
import { itemById } from "./items.js";
import { addItem } from "./inventory.js";
import { getStats } from "./stats.js";

export const EVENT_KINDS = ["encounter", "attack", "weather", "story"];
/** Reserved `goto` target inside an event's scene list: ends the event. */
export const EVENT_END = "koniec";

const ID = { type: "string", pattern: /^[a-z0-9_]+$/ };
const TEXT = { type: "string", nonEmpty: true };
const INT_MIN0 = { type: "integer", min: 0 };
const INT_MIN1 = { type: "integer", min: 1 };
const strict = (required, fields) => ({ type: "object", required, fields, additional: false });

export const SPOT_TYPES = ["talk", "shop", "rest", "board", "scene"];
// `spots[].scenes` content is checked by the scene validator in data.js.
const SPOT_SCHEMA = strict(["id", "name", "type"], {
  id: ID, name: TEXT, type: { type: "string", enum: SPOT_TYPES }, ref: TEXT, scenes: { type: "array" }, if: { type: "object" }, secret: { type: "boolean" }, art: ID,
});
// A visitor: someone who drops by with some `chance` (1–100) when the player enters the location; `scenes` are checked in data.js.
const VISITOR_SCHEMA = strict(["id", "chance", "scenes"], { id: ID, chance: INT_MIN1, scenes: { type: "array" }, if: { type: "object" }, forced: { type: "boolean" } });
const LOCATION_SCHEMA = strict(["id", "name", "short", "region"], {
  id: ID, name: TEXT, short: TEXT, region: ID, temporary: { type: "boolean" },
  near: strict(["minutes"], { minutes: INT_MIN1, via: ID }), danger: INT_MIN1, secret: { type: "boolean" }, tracksSearch: { type: "boolean" }, hint: TEXT, art: ID, spots: { type: "array" }, visitors: { type: "array" },
});

/** Checks a location's near/danger/art and its spots (shape, `ref` per type, scenes presence, `if`); returns errors. */
function validateLocationExtras(l, at, data) {
  const errors = [];
  if (Number.isInteger(l.near?.minutes) && l.near.minutes > 180) errors.push(`${at("near.minutes")}: wartość większa niż 180`);
  if (typeof l.near?.via === "string") {
    const all = (Array.isArray(data.travel?.locations) ? data.travel.locations : []);
    const parent = all.find((x) => x?.id === l.near.via);
    if (!parent?.near || parent.region !== l.region) errors.push(`${at("near.via")}: oczekiwano bliskiej lokacji tego samego regionu, jest ${JSON.stringify(l.near.via)}`);
    else {
      const seen = new Set([l.id]);
      for (let cur = parent; cur?.near?.via; cur = all.find((x) => x?.id === cur.near.via)) {
        if (seen.has(cur.id)) { errors.push(`${at("near.via")}: cykl w przebiegu dróg`); break; }
        seen.add(cur.id);
      }
    }
  }
  if (Number.isInteger(l.danger) && l.danger > 4) errors.push(`${at("danger")}: wartość poza zakresem 1–4`);
  errors.push(...artRefErrors(data, l.art, "scene", at("art")));
  const visitorIds = new Set();
  (Array.isArray(l.visitors) ? l.visitors : []).forEach((v, i) => {
    const where = (f) => at(`visitors[${i}].${f}`);
    if (!isObject(v)) return errors.push(`${at(`visitors[${i}]`)}: oczekiwano obiektu`);
    errors.push(...check(v, VISITOR_SCHEMA).map((m) => `${at(`visitors[${i}]`)} › ${m}`));
    if (visitorIds.has(v.id)) errors.push(`${where("id")}: zduplikowane id`);
    visitorIds.add(v.id);
    if (Number.isInteger(v.chance) && v.chance > 100) errors.push(`${where("chance")}: wartość poza zakresem 1–100`);
    if (Array.isArray(v.scenes) && v.scenes.length === 0) errors.push(`${where("scenes")}: pusta lista scen`);
    if (isObject(v.if)) errors.push(...validateCondition(v.if, "if", conditionOpts(data)).map((m) => `${where("if")}: ${m}`));
  });
  const seen = new Set();
  (Array.isArray(l.spots) ? l.spots : []).forEach((s, i) => {
    const where = (f) => at(`spots[${i}].${f}`);
    if (!isObject(s)) return errors.push(`${at(`spots[${i}]`)}: oczekiwano obiektu`);
    errors.push(...check(s, SPOT_SCHEMA).map((m) => `${at(`spots[${i}]`)} › ${m}`));
    if (seen.has(s.id)) errors.push(`${where("id")}: zduplikowane id`);
    seen.add(s.id);
    if (s.type === "talk" && typeof s.ref === "string" && !(data.dialogues ?? []).some((d) => d?.id === s.ref)) errors.push(`${where("ref")}: nieznana rozmowa ${JSON.stringify(s.ref)}`);
    if (s.type === "shop" && typeof s.ref === "string" && !(data.shops ?? []).some((x) => x?.id === s.ref)) errors.push(`${where("ref")}: nieznany sklep ${JSON.stringify(s.ref)}`);
    if ((s.type === "talk" || s.type === "shop") && s.ref === undefined) errors.push(`${where("ref")}: wymagane dla ${s.type}`);
    if ((s.type === "rest" || s.type === "board" || s.type === "scene") && s.ref !== undefined) errors.push(`${where("ref")}: niedozwolone dla ${s.type}`);
    if (s.type === "scene" && !(Array.isArray(s.scenes) && s.scenes.length > 0)) errors.push(`${where("scenes")}: wymagana niepusta lista scen`);
    if (s.type !== "scene" && s.scenes !== undefined) errors.push(`${where("scenes")}: dozwolone tylko dla scene`);
    errors.push(...artRefErrors(data, s.art, "scene", where("art")));
    if (isObject(s.if)) errors.push(...validateCondition(s.if, "if", conditionOpts(data)).map((m) => `${where("if")}: ${m}`));
  });
  return errors;
}
const FORAGE_ENTRY = strict(["item", "qty", "weight"], { item: ID, qty: { type: "array" }, weight: INT_MIN1 });
const REGION_SCHEMA = strict(["name", "forage"], { name: TEXT, forage: { type: "array", items: FORAGE_ENTRY } });
const ROUTE_SCHEMA = strict(["id", "from", "to", "days", "region"], {
  id: ID, from: ID, to: ID, days: INT_MIN1, region: ID, fixed: { type: "object", values: ID },
});
// `scenes` content is checked by the scene validator in data.js.
const EVENT_SCHEMA = strict(["id", "kind", "weight"], {
  id: ID, kind: { type: "string", enum: EVENT_KINDS }, weight: INT_MIN0, if: { type: "object" }, once: { type: "boolean" }, endsTrip: { type: "boolean" },
  scenes: { type: "array" }, phenomenon: ID,
});

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (data, key) => (Array.isArray(data.travel?.[key]) ? data.travel[key] : []);

/** Returns the location with `id`, or undefined. */
export function locationById(data, id) {
  return list(data, "locations").find((l) => l?.id === id);
}
/** Returns the route with `id`, or undefined. */
export function routeById(data, id) {
  return list(data, "routes").find((r) => r?.id === id);
}
/** Returns the road event with `id` (travel.json or a quest's `events`), or undefined. */
export function eventById(data, id) {
  const questEvents = (Array.isArray(data.quests) ? data.quests : []).flatMap((q) => (Array.isArray(q?.events) ? q.events : []));
  return [...list(data, "events"), ...questEvents].find((e) => e?.id === id);
}

/** Checks a list of records with ids; returns errors (shape + duplicates) under `travel.json › <section> › <id>`. */
function records(section, items, schema, extra) {
  const errors = [];
  const seen = new Set();
  if (!Array.isArray(items)) return [`travel.json › ${section}: oczekiwano tablicy`];
  items.forEach((item, index) => {
    const id = typeof item?.id === "string" ? item.id : `#${index}`;
    const prefix = `travel.json › ${section} › ${id}`;
    if (seen.has(id)) errors.push(`${prefix}: zduplikowane id`);
    seen.add(id);
    if (!isObject(item)) return errors.push(`${prefix}: oczekiwano obiektu`);
    errors.push(...check(item, schema).map((m) => `${prefix} › ${m}`), ...extra(item, (field) => `${prefix} › ${field}`, prefix));
  });
  return errors;
}

/**
 * Validates travel.json apart from the scenes inside events (data.js checks those with the story's scene rules);
 * returns error messages.
 */
/** The trip stages that can have an illustration in `travel.json › stageArt`. */
export const STAGE_ART_KEYS = ["depart", "march", "camp"];

export function validateTravel(travel, data) {
  if (!isObject(travel)) return ["travel.json: oczekiwano obiektu"];
  const errors = [];
  const regions = isObject(travel.regions) ? travel.regions : {};
  if (!isObject(travel.regions)) errors.push("travel.json › regions: oczekiwano obiektu");
  const locations = new Set((Array.isArray(travel.locations) ? travel.locations : []).map((l) => l?.id));
  const events = new Set((Array.isArray(travel.events) ? travel.events : []).map((e) => e?.id));
  const regionRef = (id, at) => (typeof id === "string" && !Object.hasOwn(regions, id) ? [`${at}: nieznany region ${JSON.stringify(id)}`] : []);
  const locationRef = (id, at) => (typeof id === "string" && !locations.has(id) ? [`${at}: nieznana lokacja ${JSON.stringify(id)}`] : []);

  errors.push(...records("locations", travel.locations, LOCATION_SCHEMA, (l, at) => [...regionRef(l.region, at("region")), ...validateLocationExtras(l, at, data)]));
  for (const [id, region] of Object.entries(regions)) {
    const at = (field) => `travel.json › regions › ${id} › ${field}`;
    if (!isObject(region)) {
      errors.push(`travel.json › regions › ${id}: oczekiwano obiektu`);
      continue;
    }
    errors.push(...check(region, REGION_SCHEMA).map((m) => `travel.json › regions › ${id} › ${m}`));
    if (Array.isArray(region.forage) && region.forage.length === 0) errors.push(`${at("forage")}: pusta lista`);
    (Array.isArray(region.forage) ? region.forage : []).forEach((entry, i) => {
      if (!isObject(entry)) return;
      const q = entry.qty;
      if (Array.isArray(q) && !(q.length === 2 && q.every(Number.isInteger) && q[0] >= 1 && q[0] <= q[1])) {
        errors.push(`${at(`forage[${i}].qty`)}: oczekiwano [min, max] liczb całkowitych, 1 ≤ min ≤ max`);
      }
      if (typeof entry.item === "string" && !itemById(data, entry.item)) errors.push(`${at(`forage[${i}].item`)}: nieznany przedmiot ${JSON.stringify(entry.item)}`);
    });
  }
  errors.push(...records("routes", travel.routes, ROUTE_SCHEMA, (r, at) => {
    const msgs = [...locationRef(r.from, at("from")), ...locationRef(r.to, at("to")), ...regionRef(r.region, at("region"))];
    if (typeof r.from === "string" && r.from === r.to) msgs.push(`${at("to")}: cel taki sam jak start`);
    for (const [day, id] of Object.entries(isObject(r.fixed) ? r.fixed : {})) {
      const n = Number(day);
      if (Number.isInteger(r.days) && !(String(n) === day && n >= 1 && n <= r.days)) msgs.push(`${at(`fixed.${day}`)}: dzień poza zakresem 1–${r.days}`);
      if (typeof id === "string" && !events.has(id)) msgs.push(`${at(`fixed.${day}`)}: nieznane zdarzenie ${JSON.stringify(id)}`);
    }
    return msgs;
  }));
  // stageArt: illustrations of the trip's stages (depart, march, camp) or of a phenomenon that is active (a phenomenon id).
  for (const [key, id] of Object.entries(isObject(travel.stageArt) ? travel.stageArt : {})) {
    if (!STAGE_ART_KEYS.includes(key) && !phenomenonById(data, key)) errors.push(`travel.json › stageArt › ${key}: nieznany etap lub zjawisko`);
    errors.push(...artRefErrors(data, id, "scene", `travel.json › stageArt › ${key}`));
  }
  const opts = conditionOpts(data);
  errors.push(...records("events", travel.events, EVENT_SCHEMA, (e, at, prefix) => {
    const msgs = [];
    if ((e.scenes === undefined) === (e.phenomenon === undefined)) msgs.push(`${prefix}: wymagane dokładnie jedno z scenes / phenomenon`);
    if (Array.isArray(e.scenes) && e.scenes.length === 0) msgs.push(`${at("scenes")}: pusta lista scen`);
    if (typeof e.phenomenon === "string") {
      if (e.kind !== "weather") msgs.push(`${at("phenomenon")}: dozwolone tylko dla kind weather`);
      else if (!phenomenonById(data, e.phenomenon)) msgs.push(`${at("phenomenon")}: nieznane zjawisko ${JSON.stringify(e.phenomenon)}`);
    }
    if (e.endsTrip === true) {
      // The event that ends the whole trip: story only (fixed on a route), never rolled from the table.
      if (e.scenes === undefined) msgs.push(`${at("endsTrip")}: dozwolone tylko dla scenes`);
      if (e.weight !== 0) msgs.push(`${at("endsTrip")}: wymaga weight 0`);
      const fixedSomewhere = (Array.isArray(travel.routes) ? travel.routes : []).some((r) => isObject(r?.fixed) && Object.values(r.fixed).includes(e.id));
      if (!fixedSomewhere) msgs.push(`${at("endsTrip")}: zdarzenie nie jest wskazane w fixed żadnej trasy`);
    }
    if (isObject(e.if)) msgs.push(...validateCondition(e.if, "if", opts).map((m) => `${prefix} › ${m}`));
    return msgs;
  }));
  return errors;
}

// --- runtime ---

/**
 * Illustration id for a trip stage ("depart", "march", "camp"): an active phenomenon with a `stageArt` entry wins over the
 * stage's own entry (march and camp only); null when there is none.
 */
export function stageArtId(state, data, stage) {
  const arts = data.travel?.stageArt ?? {};
  if (stage !== "depart") {
    const weather = activePhenomenon(state, data);
    if (weather && arts[weather.id]) return arts[weather.id];
  }
  return arts[stage] ?? null;
}

/** Region of the current route while travelling, else of `world.location`; null when unknown. */
export function currentRegion(state, data) {
  const travel = state.world?.travel;
  if (travel) return routeById(data, travel.route)?.region ?? null;
  return locationById(data, state.world?.location)?.region ?? null;
}

/** Start and end location ids of a trip along `route` in its direction. */
export function tripEnds(data, routeId, reverse = false) {
  const route = routeById(data, routeId);
  return reverse ? { from: route.to, to: route.from } : { from: route.from, to: route.to };
}

/**
 * Starts the trip along `routeId` (backwards with `reverse`) at the departure of day 1; the character must stand at the
 * trip's start. `quest` is the quest the trip serves (its road events, no fixed route events).
 */
export function startTravel(state, data, routeId, { reverse = false, quest = null } = {}) {
  const route = routeById(data, routeId);
  if (!route) throw new Error(`startTravel: nieznana trasa "${routeId}"`);
  const { from } = tripEnds(data, routeId, reverse);
  if (state.world.location !== from) throw new Error(`startTravel: trasa ${routeId} zaczyna się w ${from}, a postać jest w ${state.world.location}`);
  state.world.travel = {
    route: routeId, day: 1, daysTotal: route.days, phase: "depart", event: null, eventHour: null, eventScene: null,
    hoursWalked: 0, slowHours: 0, slowBy: null, dangerous: false, delayed: false, foraged: false, reverse, quest, turnBack: false,
  };
}

/** An escort lost on the way there: the trip now leads back, as many days as were walked so far (today is the first). */
export function turnBack(state) {
  const travel = state.world.travel;
  Object.assign(travel, { reverse: !travel.reverse, turnBack: true, daysTotal: travel.day, day: 1 });
}

/** Records a `once` event as seen (other events may repeat). */
export function markEventSeen(state, data, id) {
  if (eventById(data, id)?.once && !state.world.eventsSeen.includes(id)) state.world.eventsSeen.push(id);
}

/** Weighted pick from entries with `weight`, one `rng.int(1, total)` roll; returns the entry. */
function pick(entries, rng) {
  let roll = rng.int(1, entries.reduce((sum, e) => sum + e.weight, 0));
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return entries.at(-1);
}

/**
 * Minutes of a walk between two places of the hub's neighbourhood. Each near location is `near.minutes` from the hub, or from the
 * location named by `near.via` (a road that branches off another place): the places form a tree rooted at the hub, and a walk
 * costs the legs of both branches up to their common ancestor.
 */
export function walkMinutes(data, fromId, toId) {
  if (fromId === toId) return 0;
  const chain = (id) => {
    const legs = [];
    for (let loc = locationById(data, id), guard = 0; loc?.near && guard < 20; loc = locationById(data, loc.near.via), guard++) legs.push({ id: loc.id, minutes: loc.near.minutes });
    return legs;
  };
  const a = chain(fromId);
  const b = chain(toId);
  while (a.length && b.length && a.at(-1).id === b.at(-1).id) { a.pop(); b.pop(); }
  return [...a, ...b].reduce((sum, leg) => sum + leg.minutes, 0);
}

/** The event kinds a short walk can meet. */
const LOCAL_EVENT_KINDS = ["encounter", "attack"];

/**
 * The local event of a short walk to a place of `danger` (≥ 3 raises the chance by `localDangerBonus`): one chance roll, then a
 * weighted pick among the walkable events (encounters and attacks that do not end a trip) whose `if` holds and `once` is unseen.
 * @returns {string | null} event id
 */
export function rollLocalEvent(state, data, rng, danger) {
  const t = data.rules.travel;
  const chance = t.localEventChance + (danger >= 3 ? t.localDangerBonus : 0);
  if (rng.int(1, 100) > chance) return null;
  const pool = list(data, "events").filter((e) => e.weight > 0 && LOCAL_EVENT_KINDS.includes(e.kind) && !e.endsTrip && Array.isArray(e.scenes)
    && !(e.once && state.world.eventsSeen.includes(e.id)) && (!e.if || evaluate(e.if, state, data)));
  return pool.length === 0 ? null : pick(pool, rng).id;
}

/**
 * Picks the stage's event: the route's fixed event of the day (only the hour is rolled), else one chance roll
 * (`dangerousEventChance` while a `dangerous` phenomenon runs), a weighted pick among events with weight > 0, a passing
 * `if` and not yet seen when `once` (attacks × `dangerousAttackWeight` in danger), then the hour. Sets `travel.dangerous`.
 * @returns {{ id: string, hour: number } | null}
 */
export function rollStageEvent(state, data, rng) {
  const t = data.rules.travel;
  const travel = state.world.travel;
  const [from, to] = t.eventHourRange;
  travel.dangerous = activePhenomenon(state, data)?.world.travel === "dangerous";
  const story = !travel.quest && !travel.reverse;
  const fixed = story ? routeById(data, travel.route).fixed?.[String(travel.day)] : undefined;
  if (fixed) return { id: fixed, hour: rng.int(from, to) };
  // On the way to a quest its own events and chance apply (the plain table when the quest has no events).
  const quest = travel.quest && !travel.reverse ? (data.quests ?? []).find((q) => q.id === travel.quest) : null;
  const questEvents = Array.isArray(quest?.events) && quest.events.length > 0 ? quest.events : null;
  const chance = quest?.eventChance ?? (travel.dangerous ? t.dangerousEventChance : t.eventChance);
  if (rng.int(1, 100) > chance) return null;
  const pool = (questEvents ?? list(data, "events"))
    .filter((e) => e.weight > 0 && !(e.once && state.world.eventsSeen.includes(e.id)) && (!e.if || evaluate(e.if, state, data)))
    .map((e) => ({ id: e.id, weight: e.weight * (travel.dangerous && e.kind === "attack" ? t.dangerousAttackWeight : 1) }));
  if (pool.length === 0) return null;
  const { id } = pick(pool, rng);
  return { id, hour: rng.int(from, to) };
}

/**
 * One hour of the march (time, phenomena, artifacts move as usual); counts the hour as slow when a `slow` phenomenon is
 * active as it starts (phenomena start and end on full hours, and the march hours are full hours).
 */
export function marchHour(state, data, rng, context = {}) {
  const travel = state.world.travel;
  const p = activePhenomenon(state, data);
  if (p?.world.travel === "slow") {
    travel.slowHours += 1;
    travel.slowBy = p.id;
  }
  const events = advanceTime(state, 60, data, rng, { ...context, travel: true });
  travel.hoursWalked += 1;
  return events;
}

/** End of the march: `slowMinHours` slow hours add one day to the trip, at most once per stage. */
export function finishStage(state, data) {
  const travel = state.world.travel;
  if (travel.delayed || travel.slowHours < data.rules.travel.slowMinHours) return { delayed: false };
  travel.daysTotal += 1;
  travel.delayed = true;
  return { delayed: true, by: travel.slowBy };
}

/** After the camp: the next day's departure with a fresh stage. */
export function nextDay(state) {
  Object.assign(state.world.travel, {
    day: state.world.travel.day + 1, phase: "depart", event: null, eventHour: null, eventScene: null,
    hoursWalked: 0, slowHours: 0, slowBy: null, dangerous: false, delayed: false, foraged: false,
  });
}

/** Arrival: the character stands at the route's end, the trip is over. */
export function endTravel(state, data) {
  const travel = state.world.travel;
  state.world.location = tripEnds(data, travel.route, travel.reverse).to;
  state.world.travel = null;
}

/** Chance (0–max) to find food now: base + per Bystrość point (capped at `max`), then the night and `slow` weather penalties. */
export function forageChance(state, data) {
  const f = data.rules.travel.forage;
  let chance = Math.min(f.max, f.base + f.perBystrosc * getStats(state, data).attributes.bystrosc);
  if (timeOfDay(state.time.minutes, data.rules) === "noc") chance += f.night;
  if (activePhenomenon(state, data)?.world.travel === "slow") chance += f.slow;
  return Math.max(0, chance);
}

/**
 * Searching the area for food: the clock moves first (`forage.minutes`), then the chance roll, the weighted pick from the
 * region's forage table and the quantity.
 * @returns {{ found: { id: string, qty: number } | null, events: object[] }}
 */
export function forage(state, data, rng) {
  const events = advanceTime(state, data.rules.travel.forage.minutes, data, rng);
  if (rng.int(1, 100) > forageChance(state, data)) return { found: null, events };
  const entry = pick(data.travel.regions[currentRegion(state, data)].forage, rng);
  const qty = rng.int(entry.qty[0], entry.qty[1]);
  addItem(state, data, entry.item, qty);
  return { found: { id: entry.item, qty }, events };
}

/**
 * Repairs `world.location`, `world.travel` and `world.eventsSeen` after loading. Unknown route → no trip; unknown event or
 * event scene → the current day's departure without an event; null/unknown location → the start location.
 * Mutates `state`; returns the bad ids (a null location is not reported).
 */
export function repairTravelState(state, data) {
  const bad = [];
  const w = state.world;
  if (!locationById(data, w.location)) {
    if (w.location !== null && w.location !== undefined) bad.push(String(w.location));
    w.location = data.rules.travel.startLocation;
  }
  w.eventsSeen = (Array.isArray(w.eventsSeen) ? w.eventsSeen : []).filter((id) => {
    if (eventById(data, id)) return true;
    bad.push(String(id));
    return false;
  });
  const t = w.travel ?? null;
  w.travel = t;
  if (t === null) return bad;
  if (typeof t !== "object" || !routeById(data, t.route)) {
    bad.push(String(t?.route ?? "?"));
    w.travel = null;
    return bad;
  }
  const event = t.event === null ? null : eventById(data, t.event);
  const sceneOk = t.eventScene === null || (event?.scenes ?? []).some((s) => s.id === t.eventScene);
  if ((t.event !== null && !event) || !sceneOk) {
    bad.push(String(t.event ?? t.eventScene));
    Object.assign(t, { phase: "depart", event: null, eventHour: null, eventScene: null, hoursWalked: 0, slowHours: 0, slowBy: null });
  }
  return bad;
}
