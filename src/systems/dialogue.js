/** Dialogues: data validation, skill checks and node/option logic (no UI). */
import { check } from "../engine/schema.js";
import { artRefErrors } from "../engine/pix.js";
import { evaluate, validateCondition, conditionOpts } from "../engine/conditions.js";
import { advanceTime } from "../engine/time.js";
import { getStats } from "./stats.js";
import { validateActions, runActions } from "./actions.js";

const ID = { type: "string", pattern: /^[a-z0-9_]+$/ };
const TEXT = { type: "string", nonEmpty: true };

const DIALOGUE_SCHEMA = {
  type: "object",
  required: ["id", "start", "nodes"],
  fields: { id: ID, file: { type: "string" }, portrait: ID, start: ID, minutes: { type: "integer", min: 0 }, nodes: { type: "object" } },
  additional: false,
};
const NODE_SCHEMA = {
  type: "object",
  required: ["speaker", "text"],
  fields: { speaker: TEXT, text: TEXT, portrait: ID, actions: { type: "array" }, options: { type: "array" } },
  additional: false,
};
const OPTION_SCHEMA = {
  type: "object",
  required: ["text"],
  fields: {
    id: ID, text: TEXT, requires: { type: "object" }, showLocked: { type: "boolean" }, actions: { type: "array" },
    goto: { type: "string" }, check: { type: "object" }, success: { type: "string" }, failure: { type: "string" }, retry: { type: "boolean" },
  },
  additional: false,
};
const CHECK_SCHEMA = {
  type: "object",
  required: ["difficulty"],
  fields: { skill: ID, attribute: ID, difficulty: { type: "integer", min: 0 } },
  additional: false,
};
const MAX_DIFFICULTY = 150;

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** `optionKey` identifies an option inside a node: its `id`, else its index. */
export const optionKey = (option, index) => option.id ?? String(index);
export const failedKey = (dialogId, nodeId, key) => `${dialogId}:${nodeId}:${key}`;

const END_RESULT = /^[a-z0-9_]+$/;
const isEndTarget = (t) => t === "end" || (typeof t === "string" && t.startsWith("end:"));

/** A goto/success/failure target: existing node, `end` or `end:<result>`. */
function validateTarget(value, at, nodes) {
  if (typeof value !== "string") return [`${at}: oczekiwano tekstu`];
  if (value === "end") return [];
  if (value.startsWith("end:")) return END_RESULT.test(value.slice(4)) ? [] : [`${at}: niepoprawny wynik "${value.slice(4)}"`];
  return Object.hasOwn(nodes, value) ? [] : [`${at}: nieznany węzeł ${JSON.stringify(value)}`];
}

function validateCheck(c, at, data) {
  const errors = check(c, CHECK_SCHEMA, at);
  if (errors.length) return errors;
  if (c.difficulty > MAX_DIFFICULTY) errors.push(`${at}.difficulty: wartość większa niż ${MAX_DIFFICULTY}`);
  const hasSkill = c.skill !== undefined;
  if (hasSkill === (c.attribute !== undefined)) return [...errors, `${at}: oczekiwano dokładnie jednego z skill albo attribute`];
  if (hasSkill && !data.skills?.some((s) => s?.id === c.skill)) errors.push(`${at}.skill: nieznana umiejętność ${JSON.stringify(c.skill)}`);
  if (!hasSkill && !data.attributes?.some((a) => a?.id === c.attribute)) errors.push(`${at}.attribute: nieznany atrybut ${JSON.stringify(c.attribute)}`);
  return errors;
}

function validateOption(option, at, nodes, seenKeys, index, data) {
  const errors = check(option, OPTION_SCHEMA, at);
  if (!isObject(option)) return errors;
  const key = optionKey(option, index);
  if (seenKeys.has(key)) errors.push(option.id !== undefined ? `${at}.id: powtórzone id ${JSON.stringify(key)}` : `${at}: klucz ${JSON.stringify(key)} koliduje z id innej opcji`);
  seenKeys.add(key);
  const hasGoto = option.goto !== undefined;
  const hasCheck = option.check !== undefined;
  if (hasGoto === hasCheck) errors.push(`${at}: dokładnie jedno z goto albo check`);
  if (hasGoto && typeof option.goto === "string") errors.push(...validateTarget(option.goto, `${at}.goto`, nodes));
  if (hasGoto) {
    for (const f of ["success", "failure"]) if (option[f] !== undefined) errors.push(`${at}.${f}: dozwolone tylko z check`);
  }
  if (hasCheck) {
    if (option.id === undefined) errors.push(`${at}.id: wymagane przy check`);
    if (isObject(option.check)) errors.push(...validateCheck(option.check, `${at}.check`, data));
    for (const f of ["success", "failure"]) {
      if (option[f] === undefined) errors.push(`${at}.${f}: brak wymaganego pola`);
      else if (typeof option[f] === "string") errors.push(...validateTarget(option[f], `${at}.${f}`, nodes));
    }
  }
  if (isObject(option.requires)) errors.push(...validateCondition(option.requires, `${at}.requires`, conditionOpts(data)));
  if (Array.isArray(option.actions)) errors.push(...validateActions(option.actions, `${at}.actions`, data));
  return errors;
}

/** Nodes reachable from `start` through option targets. */
function reachable(d) {
  const seen = new Set();
  const queue = [d.start];
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id) || !isObject(d.nodes[id])) continue;
    seen.add(id);
    for (const o of Array.isArray(d.nodes[id].options) ? d.nodes[id].options : []) {
      if (!isObject(o)) continue;
      for (const t of [o.goto, o.success, o.failure]) if (typeof t === "string" && !isEndTarget(t)) queue.push(t);
    }
  }
  return seen;
}

function validateNodes(d, data) {
  const errors = [];
  for (const [nodeId, node] of Object.entries(d.nodes)) {
    const at = `nodes.${nodeId}`;
    if (!ID.pattern.test(nodeId)) errors.push(`${at}: niepoprawny identyfikator węzła`);
    const shape = check(node, NODE_SCHEMA, at);
    errors.push(...shape);
    if (!isObject(node)) continue;
    errors.push(...artRefErrors(data, node.portrait, "portrait", `${at}.portrait`));
    if (Array.isArray(node.actions)) errors.push(...validateActions(node.actions, `${at}.actions`, data));
    if (!Array.isArray(node.options)) continue;
    const seenKeys = new Set();
    node.options.forEach((o, i) => errors.push(...validateOption(o, `${at}.options[${i}]`, d.nodes, seenKeys, i, data)));
    // Every talk node with options needs a way out that no condition or roll can block.
    if (node.options.length > 0 && !node.options.some((o) => isObject(o) && o.requires === undefined && o.check === undefined)) {
      errors.push(`${at}: brak opcji zawsze dostępnej`);
    }
  }
  return errors;
}

/** Validates all dialogues; messages are `dialogues/<file> › path: description`. */
export function validateDialogues(dialogues, data) {
  if (!Array.isArray(dialogues)) return ["dialogues: oczekiwano tablicy"];
  const errors = [];
  const ids = new Set();
  dialogues.forEach((d, index) => {
    const id = isObject(d) && typeof d.id === "string" ? d.id : null;
    const file = isObject(d) && typeof d.file === "string" ? d.file : `${id ?? `#${index}`}.json`;
    const prefix = `dialogues/${file}`;
    const msgs = check(d, DIALOGUE_SCHEMA);
    if (id !== null) {
      if (ids.has(id)) msgs.push("id: zduplikowane id");
      ids.add(id);
      if (`${id}.json` !== file) msgs.push("id: niezgodne z nazwą pliku");
    }
    if (isObject(d)) msgs.push(...artRefErrors(data, d.portrait, "portrait", "portrait"));
    if (isObject(d) && isObject(d.nodes)) {
      if (typeof d.start === "string" && !Object.hasOwn(d.nodes, d.start)) msgs.push(`start: nieznany węzeł ${JSON.stringify(d.start)}`);
      msgs.push(...validateNodes(d, data));
      if (Object.hasOwn(d.nodes, d.start)) {
        const seen = reachable(d);
        for (const nodeId of Object.keys(d.nodes)) if (!seen.has(nodeId)) msgs.push(`nodes.${nodeId}: węzeł nieosiągalny`);
      }
    }
    errors.push(...msgs.map((m) => `${prefix} › ${m}`));
  });
  return errors;
}

function dialogueById(data, id) {
  const d = data.dialogues?.find((x) => x.id === id);
  if (!d) throw new Error(`dialogue: nieznana rozmowa ${JSON.stringify(id)}`);
  return d;
}

function nodeById(data, dialogId, nodeId) {
  const node = dialogueById(data, dialogId).nodes[nodeId];
  if (!node) throw new Error(`dialogue: nieznany węzeł ${JSON.stringify(nodeId)} w rozmowie ${dialogId}`);
  return node;
}

/** Success chance (chanceMin–chanceMax) of a skill or attribute check, from final stats. */
export function checkChance(state, data, c) {
  const r = data.rules.dialogue;
  const stats = getStats(state, data);
  const value = c.skill !== undefined ? stats.skills[c.skill] : stats.attributes[c.attribute] * r.attributeMult;
  return Math.min(r.chanceMax, Math.max(r.chanceMin, value - c.difficulty + r.skillBase));
}

const checkName = (data, c) => (c.skill !== undefined ? data.skills : data.attributes).find((x) => x.id === (c.skill ?? c.attribute)).name;

/** State of one option: `undefined` when hidden, else its availability. */
function optionState(state, data, dialogId, nodeId, option, index) {
  if (option.requires && !evaluate(option.requires, state, data)) {
    return option.showLocked ? { disabled: true, reason: "dialogue.locked" } : undefined;
  }
  if (state.world.failedChecks.includes(failedKey(dialogId, nodeId, optionKey(option, index)))) {
    return { disabled: true, reason: "dialogue.failed" };
  }
  return { disabled: false };
}

/**
 * What the player sees at a node. Options with unmet `requires` are hidden (or greyed with `showLocked`);
 * a failed check stays greyed. `chance` of a check is only given with `debug`.
 */
export function nodeView(state, data, dialogId, nodeId, { debug = false } = {}) {
  const node = nodeById(data, dialogId, nodeId);
  const options = [];
  (node.options ?? []).forEach((option, index) => {
    const s = optionState(state, data, dialogId, nodeId, option, index);
    if (!s) return;
    const view = { key: optionKey(option, index), label: option.text, ...s };
    if (option.check) {
      view.check = { name: checkName(data, option.check), difficulty: option.check.difficulty };
      if (debug) view.check.chance = checkChance(state, data, option.check);
    }
    options.push(view);
  });
  return { speaker: node.speaker, text: node.text, portrait: node.portrait ?? dialogueById(data, dialogId).portrait, isEnd: !node.options?.length, options };
}

/** Runs the node's entry actions. */
export function enterNode(state, data, dialogId, nodeId, rng) {
  const node = nodeById(data, dialogId, nodeId);
  return { events: runActions(state, data, node.actions ?? [], rng).events };
}

/**
 * Picks an option: rolls its check, runs its actions, resolves the target.
 * Throws for unknown, hidden or greyed options (programmer error).
 * @returns {{ next?: string, end?: string, events: object[], check?: object, combat?: object }}
 */
export function chooseOption(state, data, dialogId, nodeId, key, rng) {
  const node = nodeById(data, dialogId, nodeId);
  const index = (node.options ?? []).findIndex((o, i) => optionKey(o, i) === key);
  if (index < 0) throw new Error(`dialogue: nieznana opcja ${JSON.stringify(key)}`);
  const option = node.options[index];
  const s = optionState(state, data, dialogId, nodeId, option, index);
  if (!s || s.disabled) throw new Error(`dialogue: opcja ${JSON.stringify(key)} niedostępna`);

  let target = option.goto;
  let checkResult;
  if (option.check) {
    const chance = checkChance(state, data, option.check);
    const roll = rng.int(1, 100);
    const success = roll <= chance;
    checkResult = { success, chance, roll };
    target = success ? option.success : option.failure;
    if (!success && !option.retry) state.world.failedChecks.push(failedKey(dialogId, nodeId, key)); // `retry`: a check that comes back (a control, a roundup) may be tried again
  }
  const { events, combat } = runActions(state, data, option.actions ?? [], rng);
  const result = { events };
  if (checkResult) result.check = checkResult;
  if (combat) return { ...result, end: "walka", combat };
  if (target === "end" || target.startsWith("end:")) result.end = target === "end" ? "end" : target.slice(4);
  else result.next = target;
  return result;
}

/** Marks the talk finished with `result` (flag) and spends its time. */
export function finishDialogue(state, data, dialogId, result, rng) {
  state.flags[`dialog_${dialogId}_${result}`] = true;
  const minutes = dialogueById(data, dialogId).minutes ?? data.rules.dialogue.minutes;
  return { events: minutes > 0 ? advanceTime(state, minutes, data, rng) : [] };
}
