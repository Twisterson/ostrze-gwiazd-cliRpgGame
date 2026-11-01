/** Quests and escorts: validation of quests.json and the quest log in `state.quests`. */
import { check } from "../engine/schema.js";
import { locationById, routeById, eventById } from "./travel.js";
import { evaluate, validateCondition, conditionOpts } from "../engine/conditions.js";
import { validateActions, runActions } from "./actions.js";
import { placeIds } from "./places.js";
import { spotScenes, playedScenes, visitorOf } from "./spots.js";

export const QUEST_KINDS = ["quest", "escort", "errand"];
export const QUEST_STATUSES = ["active", "done", "failed"];

const ID = { type: "string", pattern: /^[a-z0-9_]+$/ };
const TEXT = { type: "string", nonEmpty: true };
// `deadlineDays` may be null (schema.js has no null type), so it is checked by hand; `scenes`/`events` content is checked by data.js.
const QUEST_SCHEMA = {
  type: "object", additional: false,
  required: ["id", "kind", "name", "hub", "description", "location", "route", "scenes"],
  fields: {
    id: ID, kind: { type: "string", enum: QUEST_KINDS }, name: TEXT, hub: ID, description: TEXT, location: ID, route: ID,
    client: TEXT, clientGen: TEXT, eventChance: { type: "integer", min: 0 }, board: { type: "boolean" }, random: { type: "boolean" }, closedBy: { type: "object" },
    report: { type: "boolean" }, reportTo: TEXT, onComplete: { type: "array" }, onStart: { type: "array" },
    events: { type: "array" }, scenes: { type: "array" },
  },
};

// An errand has objectives at places instead of a trip; `deadlineDays` may only be null.
const ERRAND_SCHEMA = {
  type: "object", additional: false,
  required: ["id", "kind", "name", "hub", "description", "objectives"],
  fields: {
    id: ID, kind: { type: "string", enum: QUEST_KINDS }, name: TEXT, hub: ID, description: TEXT,
    requires: { type: "object" }, onComplete: { type: "array" }, onStart: { type: "array" }, objectives: { type: "array" }, board: { type: "boolean" }, main: { type: "boolean" }, random: { type: "boolean" }, closedBy: { type: "object" },
  },
};
const OBJECTIVE_SCHEMA = { type: "object", additional: false, required: ["id", "text", "at", "done"], fields: { id: ID, text: TEXT, at: TEXT, done: { type: "object" } } };

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Returns the quest with `id`, or undefined. */
export function questById(data, id) {
  return (Array.isArray(data.quests) ? data.quests : []).find((q) => q?.id === id);
}

function validateErrand(quest, prefix, data) {
  const { deadlineDays, ...rest } = quest;
  const errors = check(rest, ERRAND_SCHEMA).map((m) => `${prefix} › ${m}`);
  if (deadlineDays !== undefined && deadlineDays !== null) errors.push(`${prefix} › deadlineDays: dla zlecenia errand dozwolone tylko null`);
  const hub = locationById(data, quest.hub);
  if (typeof quest.hub === "string" && (!hub || hub.temporary)) errors.push(`${prefix} › hub: ${hub ? "lokacja tymczasowa nie może być punktem postoju" : `nieznana lokacja ${JSON.stringify(quest.hub)}`}`);
  const opts = conditionOpts(data);
  if (isObject(quest.requires)) errors.push(...validateCondition(quest.requires, "requires", opts).map((m) => `${prefix} › ${m}`));
  if (quest.onComplete !== undefined) errors.push(...validateActions(quest.onComplete, `${prefix} › onComplete`, data));
  if (quest.onStart !== undefined) errors.push(...validateActions(quest.onStart, `${prefix} › onStart`, data));
  if (Array.isArray(quest.objectives)) {
    if (quest.objectives.length === 0) errors.push(`${prefix} › objectives: pusta lista celów`);
    const seen = new Set();
    quest.objectives.forEach((o, i) => {
      const at = `${prefix} › objectives[${i}]`;
      if (!isObject(o)) return errors.push(`${at}: oczekiwano obiektu`);
      errors.push(...check(o, OBJECTIVE_SCHEMA).map((m) => `${at} › ${m}`));
      if (seen.has(o.id)) errors.push(`${at} › id: zduplikowane id celu`);
      seen.add(o.id);
      if (typeof o.at === "string" && !placeIds(data).includes(o.at)) errors.push(`${at} › at: nieznane miejsce ${JSON.stringify(o.at)}`);
      if (isObject(o.done)) errors.push(...validateCondition(o.done, "done", opts).map((m) => `${at} › ${m}`));
    });
  }
  return errors;
}

function validateQuest(quest, prefix, data) {
  if (quest.kind === "errand") return validateErrand(quest, prefix, data);
  const { deadlineDays, ...rest } = quest;
  const errors = check(rest, QUEST_SCHEMA).map((m) => `${prefix} › ${m}`);
  const at = (field) => `${prefix} › ${field}`;
  if (deadlineDays === undefined) errors.push(`${at("deadlineDays")}: brak wymaganego pola`);
  const hub = locationById(data, quest.hub);
  if (typeof quest.hub === "string") {
    if (!hub) errors.push(`${at("hub")}: nieznana lokacja ${JSON.stringify(quest.hub)}`);
    else if (hub.temporary) errors.push(`${at("hub")}: lokacja tymczasowa nie może być punktem postoju`);
  }
  const target = locationById(data, quest.location);
  if (typeof quest.location === "string") {
    if (!target) errors.push(`${at("location")}: nieznana lokacja ${JSON.stringify(quest.location)}`);
    else if (!target.temporary) errors.push(`${at("location")}: lokacja nie jest tymczasowa`);
  }
  if (typeof quest.route === "string") {
    // The way there is the route's own direction: the trip code reads `reverse` as "on the way back".
    const route = routeById(data, quest.route);
    const links = route && ((route.from === quest.hub && route.to === quest.location) || (route.to === quest.hub && route.from === quest.location));
    if (!route) errors.push(`${at("route")}: nieznana trasa ${JSON.stringify(quest.route)}`);
    else if (!links) errors.push(`${at("route")}: trasa nie łączy ${quest.hub} z ${quest.location}`);
    else if (route.from !== quest.hub) errors.push(`${at("route")}: trasa musi zaczynać się w ${quest.hub}`);
  }
  const d = quest.deadlineDays;
  if (d !== undefined && d !== null) {
    if (!Number.isInteger(d)) errors.push(`${at("deadlineDays")}: oczekiwano null lub liczby całkowitej`);
    else if (d < 1) errors.push(`${at("deadlineDays")}: wartość mniejsza niż 1`);
  }
  for (const field of ["client", "clientGen"]) {
    if (quest.kind === "escort" && quest[field] === undefined) errors.push(`${at(field)}: wymagane dla eskorty`);
    if (quest.kind === "quest" && quest[field] !== undefined) errors.push(`${at(field)}: dozwolone tylko dla eskorty`);
  }
  if (quest.report === true && quest.reportTo === undefined) errors.push(`${at("reportTo")}: wymagane przy report`);
  if (quest.onComplete !== undefined) errors.push(...validateActions(quest.onComplete, `${prefix} › onComplete`, data));
  if (Number.isInteger(quest.eventChance) && quest.eventChance > 100) errors.push(`${at("eventChance")}: wartość poza zakresem 0–100`);
  if (Array.isArray(quest.scenes) && quest.scenes.length === 0) errors.push(`${at("scenes")}: pusta lista scen`);
  return errors;
}

/** Validates quests.json apart from the scenes (data.js checks those with the story's scene rules); returns error messages. */
export function validateQuests(list, data) {
  if (!Array.isArray(list)) return ["quests.json: oczekiwano tablicy"];
  const errors = [];
  const seen = new Set();
  list.forEach((quest, index) => {
    const id = typeof quest?.id === "string" ? quest.id : `#${index}`;
    const prefix = `quests.json › ${id}`;
    if (seen.has(id)) errors.push(`${prefix}: zduplikowane id`);
    seen.add(id);
    if (!isObject(quest)) errors.push(`${prefix}: oczekiwano obiektu`);
    else errors.push(...validateQuest(quest, prefix, data));
  });
  return errors;
}

/** Active quests, in quests.json order; only those of `hub` when given. */
export function activeQuests(state, data, hub) {
  return (data.quests ?? []).filter((q) => state.quests?.[q.id]?.status === "active" && (hub === undefined || q.hub === hub));
}

/** True when a trip quest's work is done and only the report to the client is left (`report: true` quests). */
export const reportedQuest = (state, id) => state.quests?.[id]?.reported === true;

/** Active quests of `hub` that are trips (quest / escort) still to be done: the ones that are lost when the story moves on. */
export function tripQuests(state, data, hub) {
  return activeQuests(state, data, hub).filter((q) => q.kind !== "errand" && !reportedQuest(state, q.id));
}

/** Takes the quest on (once): active from now, the deadline `deadlineDays` days later. Over `rules.quests.maxActive` it is refused. An errand starts with no objective done. */
export function startQuest(state, data, id) {
  const quest = questById(data, id);
  if (!quest) throw new Error(`startQuest: nieznane zadanie "${id}"`);
  state.quests ??= {};
  if (state.quests[id] && !retakeable(quest, state.quests[id])) return []; // a lost quest may be taken again
  // The main thread of a hub (`main`) always fits: it is the signpost, not a task that takes a slot.
  if (!quest.main && activeQuests(state, data).filter((q) => !q.main).length >= data.rules.quests.maxActive) return [{ type: "zadanie_limit", id }];
  const now = state.time.minutes;
  state.quests[id] = { status: "active", acceptedAt: now, deadline: quest.deadlineDays ? now + quest.deadlineDays * 24 * 60 : null, departed: quest.kind === "errand" };
  if (quest.kind === "errand") state.quests[id].done = [];
  const started = quest.onStart ? runActions(state, data, quest.onStart, { int: (a) => a }).events : []; // flags, items; no roll needed
  return [{ type: "zadanie_start", id }, ...started];
}

function close(state, id, status, type) {
  const entry = state.quests?.[id];
  if (entry?.status !== "active") return [];
  entry.status = status;
  return [{ type, id }];
}

/** Marks an active quest done; anything else is left as it is. */
export function completeQuest(state, data, id) {
  if (!questById(data, id)) throw new Error(`completeQuest: nieznane zadanie "${id}"`);
  return close(state, id, "done", "zadanie_wykonane");
}

/** `onComplete` actions of `quest`; a small errand or quest that pays nothing (no money, item or XP) gets `rules.quests.microXp` PD. */
function rewardActions(data, quest) {
  const actions = quest.onComplete ?? [];
  const pays = actions.some((a) => "giveMoney" in a || "giveItem" in a || "xp" in a);
  return pays || quest.kind === "escort" || !data.rules.quests.microXp ? actions : [...actions, { xp: data.rules.quests.microXp }];
}

/** Marks an active quest done and pays its `onComplete` (once: a quest that is not active is left alone). */
export function finishQuest(state, data, id, rng) {
  const events = completeQuest(state, data, id);
  if (events.length === 0) return [];
  return [...events, ...runActions(state, data, rewardActions(data, questById(data, id)), rng).events];
}

/** Marks an active quest failed; anything else is left as it is. */
export function failQuest(state, data, id) {
  if (!questById(data, id)) throw new Error(`failQuest: nieznane zadanie "${id}"`);
  return close(state, id, "failed", "zadanie_przepadlo");
}

/** A lost (failed) quest may be taken again, until it is done; the main thread of a hub is only ever taken once. */
const retakeable = (quest, entry) => entry.status === "failed" && quest.main !== true;

/** True when the quest may be taken now: not taken yet or lost, its `requires` met, room under `maxActive`. */
export function canStartQuest(state, data, id, { ignoreRequires = false } = {}) {
  const quest = questById(data, id);
  if (!quest || (state.quests?.[id] && !retakeable(quest, state.quests[id]))) return false;
  if (activeQuests(state, data).filter((q) => !q.main).length >= data.rules.quests.maxActive) return false;
  return ignoreRequires || !quest.requires || evaluate(quest.requires, state, data);
}

/** Quests a notice board of `hub` offers: those marked `board: true` that can be taken now. */
export function boardQuests(state, data, hub) {
  return (data.quests ?? []).filter((q) => q.board === true && q.hub === hub && canStartQuest(state, data, q.id));
}

/** Active errands (of `hub` when given). */
export const activeErrands = (state, data, hub) => activeQuests(state, data, hub).filter((q) => q.kind === "errand");

/** The errand's objectives with their done flag (latched in `state.quests[id].done`) and the current one (first not done), or null. */
export function errandProgress(state, data, quest) {
  const done = state.quests?.[quest.id]?.done ?? [];
  const objectives = quest.objectives.map((o) => ({ ...o, done: done.includes(o.id) }));
  const current = objectives.find((o) => !o.done) ?? null;
  return { objectives, current, complete: current === null };
}

/** The mandatory (main-thread) errands of a hub. */
export function mainQuestsOf(data, hubId) {
  return (data.quests ?? []).filter((q) => q.kind === "errand" && q.main === true && q.hub === hubId);
}

/** How near a condition is to holding, 0–1: a counter `{ var, gte }` fills up, `all` averages, `any` takes the best, the rest is 0 or 1. */
function conditionProgress(cond, state, data) {
  if (evaluate(cond, state, data)) return 1;
  if (Object.hasOwn(cond, "var") && cond.gte > 0) return Math.min(1, (state.vars?.[cond.var] ?? 0) / cond.gte);
  if (Array.isArray(cond.all) && cond.all.length > 0) return cond.all.reduce((sum, c) => sum + conditionProgress(c, state, data), 0) / cond.all.length;
  if (Array.isArray(cond.any) && cond.any.length > 0) return Math.max(...cond.any.map((c) => conditionProgress(c, state, data)));
  return 0;
}

/**
 * Progress through the mandatory threads of a hub, for the journal: the share of their objectives done (a finished thread counts
 * fully, a dropped one keeps what was latched, the objective in progress counts in part), or null when the hub has no such thread.
 * @returns {{ percent: number, done: number, total: number } | null}
 */
export function hubProgress(state, data, hubId) {
  const quests = mainQuestsOf(data, hubId);
  const total = quests.reduce((n, q) => n + q.objectives.length, 0);
  if (total === 0) return null;
  let credit = 0, done = 0;
  for (const quest of quests) {
    const entry = state.quests?.[quest.id];
    if (entry?.status === "done") { credit += quest.objectives.length; done += quest.objectives.length; continue; }
    if (!entry) continue;
    const latched = entry.done ?? [];
    let current = true;
    for (const o of quest.objectives) {
      if (latched.includes(o.id)) { credit += 1; done += 1; continue; }
      if (current && entry.status === "active") credit += conditionProgress(o.done, state, data);
      current = false;
    }
  }
  return { percent: Math.min(100, Math.round((credit / total) * 100)), done, total };
}

/** Ids of the quests named in `condition`. */
function questsIn(condition) {
  if (Array.isArray(condition)) return condition.flatMap(questsIn);
  if (!isObject(condition)) return [];
  return [...(condition.questStatus ? [condition.questStatus.id] : []), ...Object.values(condition).flatMap(questsIn)];
}

/** The optional quests of a hub: not a main thread, not something a main thread asks for, not rolled on the road (`random`). */
export function sideQuestsOf(data, hubId) {
  const needed = new Set(mainQuestsOf(data, hubId).flatMap((q) => q.objectives.flatMap((o) => questsIn(o.done))));
  return (data.quests ?? []).filter((q) => q.hub === hubId && q.main !== true && q.random !== true && !needed.has(q.id));
}

/**
 * The hub's optional quests still open, for the journal: closed are the finished, the failed and those the story has made pointless
 * (`closedBy`, e.g. done another way); one nobody has heard of yet is still open. Null when the hub has none.
 * @returns {{ closed: number, total: number, left: number } | null}
 */
export function sideProgress(state, data, hubId) {
  const quests = sideQuestsOf(data, hubId);
  if (quests.length === 0) return null;
  const closed = quests.filter((q) => {
    const status = state.quests?.[q.id]?.status;
    if (status === "done" || status === "failed") return true;
    return status !== "active" && q.closedBy !== undefined && evaluate(q.closedBy, state, data);
  }).length;
  return { closed, total: quests.length, left: quests.length - closed };
}

/** Current objective of every active errand, for the map's markers. */
export function currentObjectives(state, data) {
  return activeErrands(state, data).map((quest) => ({ quest, objective: errandProgress(state, data, quest).current })).filter((c) => c.objective);
}

/**
 * Latches the objectives of active errands whose condition holds (in order, several at once), completes errands with no
 * objective left (their `onComplete` runs once) and repeats while that changes anything (a reward may start another errand).
 */
export function advanceErrands(state, data, rng) {
  const events = [];
  for (let again = true; again;) {
    again = false;
    for (const quest of activeErrands(state, data)) {
      const entry = state.quests[quest.id];
      entry.done ??= [];
      for (const o of quest.objectives) {
        if (entry.done.includes(o.id)) continue;
        if (!evaluate(o.done, state, data)) break;
        entry.done.push(o.id);
      }
      if (!quest.objectives.every((o) => entry.done.includes(o.id))) continue;
      events.push(...completeQuest(state, data, quest.id), ...runActions(state, data, rewardActions(data, quest), rng).events);
      again = true;
    }
  }
  return events;
}

/** Active quests not yet set out for whose departure deadline has passed: failed (`expired: true` in the event). */
export function expireQuests(state, data) {
  const now = state.time.minutes;
  const events = [];
  for (const quest of activeQuests(state, data)) {
    const entry = state.quests[quest.id];
    if (entry.departed || entry.deadline === null || now <= entry.deadline) continue;
    entry.status = "failed";
    events.push({ type: "zadanie_przepadlo", id: quest.id, expired: true });
  }
  return events;
}

/** Leaving `hub` along the story: its active quests are lost. */
export function abandonHub(state, data, hub) {
  return tripQuests(state, data, hub).flatMap((quest) => failQuest(state, data, quest.id));
}

/** Leaving a hub for good: every active quest of `hub` (errands too) is lost. */
export function abandonQuestsOf(state, data, hub) {
  return activeQuests(state, data).filter((q) => q.hub === hub).flatMap((q) => failQuest(state, data, q.id));
}

/** Map destinations of `hub`: its active quests still within their deadline, with the trip length and whole days left (rounded up). */
export function mapOptions(state, data, hub) {
  const now = state.time.minutes;
  return tripQuests(state, data, hub)
    .filter((quest) => {
      const entry = state.quests[quest.id];
      return entry.departed || entry.deadline === null || now <= entry.deadline;
    })
    .map((quest) => {
      const { deadline, departed } = state.quests[quest.id];
      return {
        quest,
        location: locationById(data, quest.location),
        days: routeById(data, quest.route).days,
        deadlineLeft: deadline === null || departed ? null : Math.ceil((deadline - now) / (24 * 60)),
      };
    });
}

/**
 * Drops unknown quests from `state.quests`; a map state with an unknown hub becomes null, one with an unknown quest or
 * quest scene goes back to choosing. Mutates `state`; returns the bad ids.
 */
export function repairQuestState(state, data) {
  const bad = [];
  state.quests = state.quests && typeof state.quests === "object" ? state.quests : {};
  for (const id of Object.keys(state.quests)) {
    if (questById(data, id) && QUEST_STATUSES.includes(state.quests[id]?.status)) continue;
    bad.push(id);
    delete state.quests[id];
  }
  for (const quest of activeErrands(state, data)) {
    const done = state.quests[quest.id].done;
    state.quests[quest.id].done = (Array.isArray(done) ? done : []).filter((id) => {
      if (quest.objectives.some((o) => o.id === id)) return true;
      bad.push(`${quest.id}.${id}`);
      return false;
    });
  }
  const map = state.world.map ?? null;
  state.world.map = map;
  if (map === null) return bad;
  map.spot ??= null;
  map.spotScene ??= null;
  map.visitor ??= null;
  if (map.visitor !== null && !visitorOf(data, state.world.location, map.visitor)) map.visitor = null;
  map.walk ??= null;
  map.far ??= null;
  if (map.phase === "far" && !(map.far && routeById(data, map.far.route))) {
    bad.push(String(map.far?.route ?? "?"));
    Object.assign(map, { phase: "choose", far: null });
    state.world.travel = null;
  }
  if (map.phase === "spot" && !spotScenes(data, state.world.location, map.spot)) {
    bad.push(String(map.spot));
    Object.assign(map, { phase: "place", spot: null, spotScene: null, ambush: null });
  }
  if (!locationById(data, map.hub) || locationById(data, map.hub).temporary) {
    bad.push(String(map.hub));
    state.world.map = null;
    return bad;
  }
  if (map.walk !== null && (!Array.isArray(map.walk?.events) || map.walk.events.some((id) => !eventById(data, id)))) {
    bad.push(String(map.walk?.events ?? "?"));
    Object.assign(map, { phase: "choose", walk: null });
  }
  if (map.phase === "walk" && map.walk === null) map.phase = "choose"; // a walk that did not survive (e.g. a save from before it began)
  if (map.spotScene !== null && !(playedScenes(data, state.world.location, map.spot, map.ambush) ?? []).some((s) => s.id === map.spotScene)) {
    bad.push(String(map.spotScene));
    map.spotScene = null;
  }
  if (map.walk !== null && !(locationById(data, map.walk?.to)?.near || map.walk?.to === map.hub)) {
    bad.push(String(map.walk?.to));
    Object.assign(map, { phase: "choose", walk: null });
  }
  const quest = map.quest === null ? null : questById(data, map.quest);
  const sceneOk = map.questScene === null || (quest?.scenes ?? []).some((s) => s.id === map.questScene);
  if ((map.quest !== null && !quest) || !sceneOk) {
    bad.push(String(map.quest ?? map.questScene));
    Object.assign(map, { phase: "choose", quest: null, questScene: null });
  }
  return bad;
}
