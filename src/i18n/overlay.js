// Language overlay core: pure functions, no file access, no state.
//
// An overlay file data/lang/<lang>/<file> maps paths to translations:
//   { "<path>": { "t": "<translation>", "h": "<hashText of the Polish text>" } }
// A path joins segments with ".": an object key as is, an array element as
// "[id]" when it has an id and "#index" otherwise. In ui.json every key is a
// path of its own. Examples: "[miecz_krotki].name",
// "nodes.kuznia.options.[odlamek].text", "events.[pielgrzym].scenes.[pielgrzym_spotkanie].text".
import { createHash } from "node:crypto";

// Fields holding player-visible text, found by scanning data/ (the prose-coverage test pins this).
export const TEXT_KEYS = ["name", "nameAcc", "description", "text", "title", "label", "doneLabel", "speaker", "hint", "short", "client", "clientGen", "reportTo", "throwName", "listName", "noun"];
// Case forms: optional in an overlay; without a translation they take the translated base field
// (the key minus its case suffix: nameAcc → name, clientGen → client).
export const CASE_KEYS = ["nameAcc", "clientGen"];
// Action lists are mechanics: e.g. {"hint": "pole_bitwy"} there is a place id, not text.
const ACTION_LISTS = ["actions", "onComplete", "onStart"];

export const hashText = (s) => createHash("sha1").update(s, "utf8").digest("hex").slice(0, 8);

const isUi = (file) => file.replace(/\\/g, "/") === "ui.json";
const join = (path, seg) => (path === "" ? seg : `${path}.${seg}`);
const caseBase = (key) => key.replace(/[A-Z][a-z]*$/, "");
const isEntry = (e) => e !== null && typeof e === "object" && typeof e.t === "string";

function elementSegment(item, i) {
  const id = item !== null && typeof item === "object" && !Array.isArray(item) ? item.id : undefined;
  return typeof id === "string" || typeof id === "number" ? `[${id}]` : `#${i}`;
}

// Calls visit(path, value, { holder, key, parentPath, text }) for every node below the root.
function walk(file, json, visit) {
  if (isUi(file)) {
    if (json && typeof json === "object" && !Array.isArray(json)) {
      for (const [k, v] of Object.entries(json)) visit(k, v, { holder: json, key: k, parentPath: "", text: typeof v === "string" });
    }
    return;
  }
  const go = (v, path, inAction) => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        const p = join(path, elementSegment(x, i));
        visit(p, x, { holder: v, key: i, parentPath: path, text: false });
        go(x, p, inAction);
      });
    } else if (v !== null && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        const p = join(path, k);
        visit(p, x, { holder: v, key: k, parentPath: path, text: !inAction && typeof x === "string" && TEXT_KEYS.includes(k) });
        go(x, p, inAction || ACTION_LISTS.includes(k));
      }
    }
  };
  go(json, "", false);
}

export function textEntries(file, json) {
  const out = new Map();
  walk(file, json, (path, value, { text }) => { if (text) out.set(path, value); });
  return out;
}

export function applyOverlay(file, json, overlay) {
  const out = structuredClone(json);
  const ov = overlay ?? {};
  walk(file, out, (path, value, { holder, key, parentPath, text }) => {
    if (!text) return;
    const e = Object.hasOwn(ov, path) ? ov[path] : undefined;
    if (isEntry(e)) { holder[key] = e.t; return; }
    if (CASE_KEYS.includes(key)) {
      const basePath = join(parentPath, caseBase(key));
      const base = Object.hasOwn(ov, basePath) ? ov[basePath] : undefined;
      if (isEntry(base) && typeof holder[caseBase(key)] === "string") holder[key] = base.t;
    }
  });
  return out;
}

const varsOf = (s) => [...new Set([...s.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1].split("|")[0]))].sort();
// A token whose variable name is not \w+ is malformed (the renderer would print it raw): always a mismatch.
const sameVars = (a, b) => {
  const x = varsOf(a), y = varsOf(b);
  if ([...x, ...y].some((v) => !/^\w+$/.test(v))) return false;
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

export function checkOverlay(file, json, overlay) {
  const nodes = new Map();
  walk(file, json, (path, value, { key, text }) => nodes.set(path, { value, key, text }));
  const ov = overlay ?? {};
  // empty: a blank translation of non-blank Polish text (the game would refuse to start on it)
  const result = { missing: [], stale: [], orphan: [], varMismatch: [], nonText: [], empty: [] };
  for (const [path, { key, text }] of nodes) {
    if (text && !Object.hasOwn(ov, path) && !CASE_KEYS.includes(key)) result.missing.push(path);
  }
  for (const [path, e] of Object.entries(ov)) {
    const node = nodes.get(path);
    if (!node) { result.orphan.push(path); continue; }
    if (!node.text || !isEntry(e)) { result.nonText.push(path); continue; }
    if (e.t.trim() === "" && node.value.trim() !== "") { result.empty.push(path); continue; }
    if (e.h !== hashText(node.value)) result.stale.push(path);
    if (!sameVars(node.value, e.t)) result.varMismatch.push(path);
  }
  return result;
}
