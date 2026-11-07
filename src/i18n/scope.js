// Translation scopes: which act each text entry belongs to, so the translation can go act by act.
// A key is "<file>|<path>" (paths as in overlay.js textEntries; a map is the whole file, path "").
import { textEntries } from "./overlay.js";
import { JSON_PARTS } from "../engine/data.js";

export const SCOPES = ["wspolne", "akt1", "akt2", "akt3", "akt4", "akt5", "final"];
const ACTS = SCOPES.slice(1);

// story.json scenes by id prefix (the first match wins).
export const STORY_PREFIXES = [
  ["prolog", "akt1"], ["demo", "akt1"], ["akt2", "akt2"], ["akt3", "akt3"],
  ["akt4", "akt4"], ["schody", "akt4"], ["akt5", "akt5"], ["akt6", "final"],
];
// Scenes whose prefix lies about their act: the "demo_" tail after the prologue is the march to
// Wilczy Bród and the Wilczy Bród hub, which is act 2 (Pogórze), not the training camp of act 1.
export const SCENE_OVERRIDES = {
  demo_podroz: "akt2", demo_kurier: "akt2", demo_mapa: "akt2", demo_odpoczynek: "akt2", demo_zapis: "akt2", demo_dalej: "akt2",
};
// Locations whose name and short name belong to an earlier act than their region: Brzezina, the prologue's village, stands
// in the header from the first screen on, though its region (Pogórze) is act 2. Only the location's own texts move;
// routes, events, quests and dialogues that name it keep the region's scope.
export const LOCATION_OVERRIDES = { brzezina: "akt1" };
// travel.json regions. "morze" has no locations of its own: it is the crossing to Jarnowo (events only).
export const REGION_SCOPES = {
  pogorze: "akt2", glusz: "akt3", gwiazdy: "akt3", front: "akt4", stolica: "akt4", loch: "akt4", jarnowo: "akt5", morze: "akt5", wir: "final",
};

/** The earliest act among `scopes` (undefined and "wspolne" ignored); "wspolne" when there is none. */
export function earliest(scopes) {
  let best = null;
  for (const s of scopes) if (ACTS.includes(s) && (best === null || ACTS.indexOf(s) < ACTS.indexOf(best))) best = s;
  return best ?? "wspolne";
}

export function sceneScope(id) {
  if (Object.hasOwn(SCENE_OVERRIDES, id)) return SCENE_OVERRIDES[id];
  const hit = STORY_PREFIXES.find(([p]) => id.startsWith(p));
  return hit ? hit[1] : "wspolne";
}

const regionScope = (region) => (typeof region === "string" && Object.hasOwn(REGION_SCOPES, region) ? REGION_SCOPES[region] : "wspolne");

/** Every translatable file of loaded data: `{ file, json }` for the JSON parts and dialogues, `{ file, text }` for maps. */
export function textFiles(data) {
  const out = [];
  for (const part of JSON_PARTS) if (data[part] !== undefined) out.push({ file: `${part}.json`, json: data[part] });
  for (const d of Array.isArray(data.dialogues) ? data.dialogues : []) {
    if (d === null || typeof d !== "object") continue;
    const { file, ...json } = d;
    out.push({ file: `dialogues/${file}`, json });
  }
  for (const [region, text] of Object.entries(data.maps ?? {})) out.push({ file: `maps/${region}.txt`, text });
  return out;
}

/** Calls fn(value) for every string under key `key` anywhere in `v`. */
function eachValue(v, keys, fn) {
  if (Array.isArray(v)) v.forEach((x) => eachValue(x, keys, fn));
  else if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (keys.includes(k) && typeof x === "string") fn(x);
      eachValue(x, keys, fn);
    }
  }
}

/** Map "<file>|<path>" → scope for every text entry of `data` (Polish or overlaid: only ids and structure count). */
export function scopeOf(data) {
  const travel = data.travel ?? {};
  const list = (v) => (Array.isArray(v) ? v : []);
  const locRegion = new Map(list(travel.locations).map((l) => [l?.id, l?.region]));
  const locScope = (id) => regionScope(locRegion.get(id));
  const routeScope = new Map(list(travel.routes).map((r) => [r?.id, regionScope(r?.region)]));

  // events: the earliest region named in their condition (directly or through a location), or of a route that fixes them
  const eventScope = new Map();
  for (const e of list(travel.events)) {
    const found = [];
    eachValue(e?.if, ["region"], (r) => found.push(regionScope(r)));
    eachValue(e?.if, ["location"], (l) => found.push(locScope(l)));
    eventScope.set(e?.id, found);
  }
  for (const r of list(travel.routes)) {
    for (const id of Object.values(r?.fixed ?? {})) if (eventScope.has(id)) eventScope.get(id).push(routeScope.get(r.id));
  }
  for (const [id, found] of eventScope) eventScope.set(id, earliest(found));

  const questScope = new Map(list(data.quests).map((q) => [q?.id, earliest([locScope(q?.hub), locScope(q?.location)])]));

  // dialogues: the earliest scope of whatever starts them (story scene, location, event, quest)
  const dialogueIds = new Set(list(data.dialogues).map((d) => d?.id));
  const callers = new Map();
  const calls = (v, scope) => eachValue(v, ["dialogue", "ref"], (id) => {
    if (!dialogueIds.has(id)) return;
    if (!callers.has(id)) callers.set(id, []);
    callers.get(id).push(scope);
  });
  for (const s of list(data.story?.scenes)) calls(s, sceneScope(String(s?.id)));
  for (const l of list(travel.locations)) calls(l, locScope(l?.id));
  for (const e of list(travel.events)) calls(e, eventScope.get(e?.id));
  for (const q of list(data.quests)) calls(q, questScope.get(q?.id));

  const idOf = (seg) => (seg?.startsWith("[") ? seg.slice(1, -1) : undefined);
  const pathScope = {
    "story.json": ([a, b]) => (a === "scenes" && idOf(b) !== undefined ? sceneScope(idOf(b)) : "wspolne"),
    "travel.json": ([a, b]) => {
      if (a === "locations") return Object.hasOwn(LOCATION_OVERRIDES, idOf(b)) ? LOCATION_OVERRIDES[idOf(b)] : locScope(idOf(b));
      if (a === "regions") return regionScope(b);
      if (a === "routes") return routeScope.get(idOf(b)) ?? "wspolne";
      if (a === "events") return eventScope.get(idOf(b)) ?? "wspolne";
      return "wspolne";
    },
    "quests.json": ([a]) => questScope.get(idOf(a)) ?? "wspolne",
  };

  const out = new Map();
  for (const { file, json } of textFiles(data)) {
    if (json === undefined) {
      out.set(`${file}|`, regionScope(file.slice("maps/".length, -".txt".length)));
      continue;
    }
    const dialogueScope = file.startsWith("dialogues/") ? earliest(callers.get(json.id) ?? []) : null;
    for (const p of textEntries(file, json).keys()) {
      // a path segment never contains "." except inside "[id]" (ids are [a-z0-9_]), so a plain split is safe here
      const scope = dialogueScope ?? (pathScope[file] ? pathScope[file](p.split(".")) : "wspolne");
      out.set(`${file}|${p}`, scope);
    }
  }
  return out;
}

/** Entry counts per scope, in SCOPES order. */
export function scopeCounts(scopes) {
  const n = Object.fromEntries(SCOPES.map((s) => [s, 0]));
  for (const s of scopes.values()) n[s]++;
  return n;
}

/**
 * Narrows a translationReport to one scope: `warnings` and `perFile` count only that scope's entries
 * (the directory warning stays). "all" returns the report as is.
 */
export function scopedReport(report, scopes, scope) {
  if (scope === "all") return report;
  const warnings = report.warnings.filter((w) => !Object.hasOwn(report.perFile, w.slice(0, w.indexOf(":"))));
  const perFile = {};
  for (const [file, { missing, stale }] of Object.entries(report.entries)) {
    const mine = (paths) => paths.filter((p) => scopes.get(`${file}|${p}`) === scope);
    const m = mine(missing).length, s = mine(stale).length;
    perFile[file] = { missing: m, stale: s };
    if (m > 0 || s > 0) warnings.push(`${file}: brak ${m}, nieaktualne ${s}`);
  }
  return { ...report, warnings, perFile };
}
