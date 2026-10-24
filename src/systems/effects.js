/** Status effects: catalog lookup and validation of effects.json. */
import { check } from "../engine/schema.js";
import { DAMAGE_TYPES, validateModifiers } from "./modifiers.js";
import { getStats } from "./stats.js";

export const EFFECT_UNITS = ["turn", "hour"];
export const STACK_MODES = ["refresh", "extend", "stack"];

const ID = { type: "string", pattern: /^[a-z0-9_]+$/ };
const TEXT = { type: "string", nonEmpty: true };
const INT = { type: "integer" };
const INT_MIN1 = { type: "integer", min: 1 };

const EFFECT_SCHEMA = {
  type: "object",
  required: ["id", "name", "description", "unit", "duration"],
  fields: {
    id: ID, name: TEXT, description: TEXT, unit: { type: "string" }, duration: INT_MIN1,
    modifiers: { type: "object" }, // content checked by validateModifiers
    tick: {
      type: "object",
      fields: { damage: { type: "array" }, damageType: { type: "string", enum: DAMAGE_TYPES }, loseApChance: INT, loseAp: INT },
      additional: false,
    },
    resist: ID, stack: { type: "string" }, maxStacks: INT_MIN1,
    scope: { type: "string", enum: ["battlefield"] }, sleepClears: INT_MIN1,
    skipTurn: { type: "boolean" }, dazed: { type: "boolean" }, noMove: { type: "boolean" },
    noExpire: { type: "boolean" }, restHealMultiplier: { type: "number" },
  },
  additional: false,
};

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Returns the effect with `id`, or undefined. */
export function effectById(data, id) {
  return (data.effects ?? []).find((effect) => effect.id === id);
}

function validateEffect(effect, prefix, data) {
  if (!isObject(effect)) return [`${prefix}: oczekiwano obiektu`];
  const errors = check(effect, EFFECT_SCHEMA).map((m) => `${prefix} › ${m}`);
  const at = (field) => `${prefix} › ${field}`;
  if (typeof effect.unit === "string" && !EFFECT_UNITS.includes(effect.unit)) errors.push(`${at("unit")}: nieznana jednostka ${JSON.stringify(effect.unit)}`);
  if (typeof effect.stack === "string" && !STACK_MODES.includes(effect.stack)) errors.push(`${at("stack")}: nieznany tryb ${JSON.stringify(effect.stack)}`);
  if (effect.maxStacks !== undefined && effect.stack !== "stack") errors.push(`${at("maxStacks")}: dozwolone tylko przy stack`);
  if (effect.scope !== undefined && effect.unit !== "turn") errors.push(`${at("scope")}: dozwolone tylko dla unit turn`);
  for (const flag of ["skipTurn", "dazed", "noMove"]) {
    if (effect[flag] !== undefined && effect.unit !== "turn") errors.push(`${at(flag)}: dozwolone tylko dla unit turn`);
  }
  if (effect.sleepClears !== undefined && effect.unit !== "hour") errors.push(`${at("sleepClears")}: dozwolone tylko dla unit hour`);
  if (effect.noExpire !== undefined && effect.unit !== "hour") errors.push(`${at("noExpire")}: dozwolone tylko dla unit hour`);
  if (typeof effect.restHealMultiplier === "number" && !(effect.restHealMultiplier > 0)) errors.push(`${at("restHealMultiplier")}: oczekiwano liczby > 0`);
  if (typeof effect.resist === "string" && !(data.attributes ?? []).some((a) => a?.id === effect.resist)) {
    errors.push(`${at("resist")}: nieznany atrybut ${JSON.stringify(effect.resist)}`);
  }
  if (isObject(effect.modifiers)) errors.push(...validateModifiers(effect.modifiers, at("modifiers"), data));
  const damage = effect.tick?.damage;
  if (Array.isArray(damage)) {
    const ok = damage.length === 2 && Number.isInteger(damage[0]) && Number.isInteger(damage[1]) && damage[0] <= damage[1];
    if (!ok) errors.push(`${at("tick.damage")}: oczekiwano [min, max] liczb całkowitych, min ≤ max`);
  }
  return errors;
}

/** Validates the effects list (unique ids, fields, attribute and modifier references); returns error messages. */
export function validateEffects(effects, data) {
  if (!Array.isArray(effects)) return ["effects.json: oczekiwano tablicy"];
  const errors = [];
  const ids = new Set();
  effects.forEach((effect, index) => {
    const id = typeof effect?.id === "string" ? effect.id : null;
    const prefix = `effects.json › ${id ?? `#${index}`}`;
    if (id !== null) {
      if (ids.has(id)) errors.push(`${prefix}: zduplikowane id`);
      ids.add(id);
    }
    errors.push(...validateEffect(effect, prefix, data));
  });
  return errors;
}

const list = (state) => (state.character.effects ??= []);

/** True when the character currently has the effect. */
export function hasEffect(state, id) {
  return (state.character?.effects ?? []).some((e) => e.id === id);
}

/**
 * Applies a status effect to the character (hour effects; turn effects only with `inCombat`); `duration` overrides the effect's own.
 * Players with a `resist` attribute roll to resist unless `force` is set.
 * @returns {{ ok: true, resisted: boolean, stacks: number }}
 */
export function applyEffect(state, data, id, rng, { force = false, inCombat = false, duration: lasting } = {}) {
  const def = effectById(data, id);
  if (!def) throw new Error(`applyEffect: nieznany efekt "${id}"`);
  if (def.unit !== "hour" && !inCombat) throw new Error(`applyEffect: efekt "${id}" jest turowy (tylko w walce)`);
  const rules = data.rules.effects;
  const current = list(state).find((e) => e.id === id);
  let duration = lasting ?? def.duration;
  if (def.resist && !force) {
    const stats = getStats(state, data);
    const value = stats.attributes[def.resist] * rules.resistAttributeMult + (stats.other[`resist_${id}`] ?? 0);
    if (rng.int(1, 100) <= value) {
      if (rules.resistOutcome === "cancel") return { ok: true, resisted: true, stacks: current?.stacks ?? 0 };
      // Resisting an effect already active leaves it untouched (no half-length top-up).
      if (current) return { ok: true, resisted: true, stacks: current.stacks };
      duration = Math.max(1, Math.floor(duration / 2));
      return { ok: true, resisted: true, stacks: apply(state, def, current, duration, rules) };
    }
  }
  return { ok: true, resisted: false, stacks: apply(state, def, current, duration, rules) };
}

function apply(state, def, current, duration, rules) {
  return addToList(list(state), def, current, duration, rules);
}

/** Adds the effect to `entries` (new entry, or refresh/extend/stack of `current`); returns the stack count. */
export function addToList(entries, def, current, duration, rules) {
  if (!current) {
    entries.push({ id: def.id, remaining: duration, stacks: 1 });
    return 1;
  }
  if (def.stack === "extend") current.remaining += 1;
  else {
    current.remaining = duration;
    delete current.armed; // a refresh during the holder's own turn restarts the countdown from its next turn
    if (def.stack === "stack") current.stacks = Math.min(def.maxStacks ?? rules.maxStacksDefault, current.stacks + 1);
  }
  return current.stacks;
}

/** Removes the effect if present. */
export function removeEffect(state, id) {
  const effects = list(state);
  const index = effects.findIndex((e) => e.id === id);
  if (index >= 0) effects.splice(index, 1);
  return { ok: true, removed: index >= 0 };
}

/**
 * Hourly tick: damage of all hour effects first (HP never below 1), then countdown.
 * Without rng the damage is the range minimum × stacks.
 * @returns {object[]} `efekt_obrazenia` / `efekt_koniec` events
 */
export function tickHour(state, data, rng) {
  const ch = state.character;
  const events = [];
  const active = list(state).filter((e) => effectById(data, e.id)?.unit === "hour");
  for (const entry of active) {
    const range = effectById(data, entry.id).tick?.damage;
    if (!range) continue;
    const raw = (rng ? rng.int(range[0], range[1]) : range[0]) * entry.stacks;
    const damage = Math.max(0, Math.min(raw, ch.hp - 1));
    ch.hp -= damage;
    if (damage > 0) events.push({ type: "efekt_obrazenia", id: entry.id, damage });
  }
  for (const entry of active) {
    if (effectById(data, entry.id).noExpire) continue; // lasts until removed (e.g. hunger until a meal)
    entry.remaining -= 1;
    if (entry.remaining <= 0) {
      removeEffect(state, entry.id);
      events.push({ type: "efekt_koniec", id: entry.id });
    }
  }
  return events;
}

/** Sleep healing multiplier: the lowest `restHealMultiplier` of the active effects (stacks do not compound), 1 without any. */
export function restHealMultiplier(state, data) {
  return Math.min(1, ...list(state).map((e) => effectById(data, e.id)?.restHealMultiplier ?? 1));
}

/** Removes effects whose `sleepClears` ≤ slept hours; returns the removed ids. */
export function clearBySleep(state, data, hours) {
  const removed = list(state).filter((e) => {
    const limit = effectById(data, e.id)?.sleepClears;
    return limit !== undefined && limit <= hours;
  }).map((e) => e.id);
  for (const id of removed) removeEffect(state, id);
  return removed;
}
