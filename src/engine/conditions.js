import { getStats } from "../systems/stats.js";
import { countOf } from "../systems/inventory.js";
import { hasEffect } from "../systems/effects.js";
import { timeOfDay } from "./time.js";
import { currentRegion } from "../systems/travel.js";
import { placeIds, isKnown } from "../systems/places.js";

const withPath = (path, text) => (path ? `${path}: ${text}` : text);

/**
 * Evaluates a condition against the game state. Assumes `cond` already passed validateCondition.
 * Character-dependent keys (item/money/attribute/skill/effect/effectStacks) are false without a character.
 */
export function evaluate(cond, state, data) {
  if (Object.hasOwn(cond, "var")) return evaluateVar(cond, state);
  return Object.entries(cond).every(([key, value]) => {
    switch (key) {
      case "flag": return state.flags[value] === true;
      case "notFlag": return state.flags[value] !== true;
      case "all": return value.every((sub) => evaluate(sub, state, data));
      case "any": return value.some((sub) => evaluate(sub, state, data));
      case "timeOfDay": {
        const now = timeOfDay(state.time.minutes, data.rules);
        return (Array.isArray(value) ? value : [value]).includes(now);
      }
      case "known": return isKnown(state, data, value);
      case "search": {
        const level = state.world?.search ?? 0;
        return (value.min === undefined || level >= value.min) && (value.max === undefined || level <= value.max);
      }
      case "questStatus": return (state.quests?.[value.id]?.status ?? "none") === value.is;
      case "region": return currentRegion(state, data) === value;
      case "location": return !state.world?.travel && state.world?.location === value;
      case "travelDay": {
        const day = state.world?.travel?.day;
        return day !== undefined && (value.gte === undefined || day >= value.gte) && (value.lte === undefined || day <= value.lte);
      }
      default: return state.character ? evaluateCharacter(key, value, state, data) : false;
    }
  });
}

function evaluateCharacter(key, value, state, data) {
  switch (key) {
    case "item": {
      const { id, qty } = typeof value === "string" ? { id: value, qty: 1 } : value;
      return countOf(state, id) >= qty;
    }
    case "money": return state.character.money >= value;
    case "attribute": return getStats(state, data).attributes[value.id] >= value.gte;
    case "skill": return getStats(state, data).skills[value.id] >= value.gte;
    case "effect": return hasEffect(state, value);
    case "effectStacks": {
      const stacks = state.character.effects?.find((e) => e.id === value.id)?.stacks ?? 0;
      return value.gte !== undefined ? stacks >= value.gte : stacks <= value.lte;
    }
    default: return false;
  }
}

const VAR_OPERATORS = ["gte", "lte", "eq"];

function evaluateVar(cond, state) {
  const value = state.vars?.[cond.var] ?? 0;
  if (cond.gte !== undefined) return value >= cond.gte;
  if (cond.lte !== undefined) return value <= cond.lte;
  return value === cond.eq;
}

/** Validates a `{ var, gte|lte|eq }` condition (the caller checked that it has a `var` key). */
function validateVarCondition(cond, path, opts) {
  const errors = [];
  if (typeof cond.var !== "string") {
    errors.push(`${path}.var: oczekiwano tekstu`);
  } else if (opts.vars && !opts.vars.includes(cond.var)) {
    errors.push(`${path}.var: nieznana zmienna "${cond.var}"`);
  }
  const ops = Object.keys(cond).filter((k) => VAR_OPERATORS.includes(k));
  if (ops.length !== 1) {
    errors.push(`${path}: warunek var wymaga dokładnie jednego z gte/lte/eq`);
  } else if (!Number.isInteger(cond[ops[0]])) {
    errors.push(`${path}.${ops[0]}: oczekiwano liczby całkowitej`);
  }
  return errors;
}

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Validates `{ id, gte|lte }` for the effectStacks condition (absent effect = 0 stacks). */
function validateEffectStacks(value, path, opts) {
  if (!isObj(value)) return [`${path}: oczekiwano obiektu { id, gte|lte }`];
  const errors = checkRef(value.id, opts.effects, `${path}.id`, "nieznany efekt");
  const ops = ["gte", "lte"].filter((k) => value[k] !== undefined);
  if (ops.length !== 1) errors.push(`${path}: wymagane dokładnie jedno z gte/lte`);
  else if (!Number.isInteger(value[ops[0]])) errors.push(`${path}.${ops[0]}: oczekiwano liczby całkowitej`);
  return errors;
}

/** Checks a referenced id: text, and (when the list is given) a known one. */
function checkRef(id, list, path, unknown) {
  if (typeof id !== "string") return [`${path}: oczekiwano tekstu`];
  return list && !list.includes(id) ? [`${path}: ${unknown} "${id}"`] : [];
}

/** Validates `{ id, gte }` for attribute/skill conditions. */
function validateGte(value, path, [list, unknown]) {
  if (!isObj(value)) return [`${path}: oczekiwano obiektu { id, gte }`];
  const errors = checkRef(value.id, list, `${path}.id`, unknown);
  if (!Number.isInteger(value.gte)) errors.push(`${path}.gte: oczekiwano liczby całkowitej`);
  return errors;
}

/** Validates a condition; returns a list of error messages (empty = valid). */
export function validateCondition(cond, path, opts = {}) {
  if (typeof cond !== "object" || cond === null || Array.isArray(cond)) {
    return [withPath(path, "oczekiwano obiektu")];
  }
  const keys = Object.keys(cond);
  if (keys.length === 0) return [withPath(path, "pusty warunek")];
  if (Object.hasOwn(cond, "var") && keys.every((k) => k === "var" || VAR_OPERATORS.includes(k))) {
    return validateVarCondition(cond, path, opts);
  }
  const errors = [];
  for (const key of keys) {
    const value = cond[key];
    const keyPath = `${path}.${key}`;
    switch (key) {
      case "flag":
      case "notFlag":
        if (typeof value !== "string") errors.push(`${keyPath}: oczekiwano tekstu`);
        break;
      case "all":
      case "any":
        if (!Array.isArray(value) || value.length === 0) {
          errors.push(`${keyPath}: oczekiwano niepustej tablicy warunków`);
        } else {
          value.forEach((sub, i) => errors.push(...validateCondition(sub, `${keyPath}[${i}]`, opts)));
        }
        break;
      case "item": {
        const id = isObj(value) ? value.id : value;
        if (isObj(value) && !(Number.isInteger(value.qty) && value.qty >= 1)) {
          errors.push(`${keyPath}.qty: oczekiwano liczby całkowitej ≥ 1`);
        }
        errors.push(...checkRef(id, opts.items, keyPath, "nieznany przedmiot"));
        break;
      }
      case "money":
        if (!Number.isInteger(value) || value < 0) errors.push(`${keyPath}: oczekiwano liczby całkowitej ≥ 0`);
        break;
      case "attribute":
      case "skill":
        errors.push(...validateGte(value, keyPath, key === "skill"
          ? [opts.skills, "nieznana umiejętność"] : [opts.attributes, "nieznany atrybut"]));
        break;
      case "timeOfDay": {
        const ids = Array.isArray(value) ? value : [value];
        if (ids.length === 0) errors.push(`${keyPath}: oczekiwano id pory lub niepustej listy`);
        for (const id of ids) errors.push(...checkRef(id, opts.timesOfDay, keyPath, "nieznana pora"));
        break;
      }
      case "effect":
        errors.push(...checkRef(value, opts.effects, keyPath, "nieznany efekt"));
        break;
      case "effectStacks":
        errors.push(...validateEffectStacks(value, keyPath, opts));
        break;
      case "questStatus": {
        if (!isObj(value)) { errors.push(`${keyPath}: oczekiwano obiektu { id, is }`); break; }
        errors.push(...checkRef(value.id, opts.quests, `${keyPath}.id`, "nieznane zadanie"));
        if (!["none", "active", "done", "failed"].includes(value.is)) errors.push(`${keyPath}.is: oczekiwano none / active / done / failed`);
        break;
      }
      case "search":
        errors.push(...validateSearch(value, keyPath));
        break;
      case "known":
        errors.push(...checkRef(value, opts.places, keyPath, "nieznane miejsce"));
        break;
      case "region":
        errors.push(...checkRef(value, opts.regions, keyPath, "nieznany region"));
        break;
      case "location":
        errors.push(...checkRef(value, opts.locations, keyPath, "nieznana lokacja"));
        break;
      case "travelDay":
        errors.push(...validateTravelDay(value, keyPath));
        break;
      default:
        errors.push(`${keyPath}: nieznany warunek`);
    }
  }
  return errors;
}

/** `travelDay: { gte?, lte? }` – at least one bound, integers ≥ 1. */
function validateSearch(value, path) {
  if (!isObj(value)) return [`${path}: oczekiwano obiektu { min?, max? }`];
  const keys = Object.keys(value);
  if (keys.length === 0) return [`${path}: oczekiwano min lub max`];
  const errors = [];
  for (const k of keys) {
    if (k !== "min" && k !== "max") errors.push(`${path}.${k}: nieznane pole`);
    else if (!Number.isInteger(value[k]) || value[k] < 0 || value[k] > 100) errors.push(`${path}.${k}: oczekiwano liczby całkowitej 0–100`);
  }
  return errors;
}

function validateTravelDay(value, path) {
  if (!isObj(value)) return [`${path}: oczekiwano obiektu { gte?, lte? }`];
  const keys = Object.keys(value);
  if (keys.length === 0) return [`${path}: oczekiwano gte lub lte`];
  const errors = [];
  for (const k of keys) {
    if (k !== "gte" && k !== "lte") errors.push(`${path}.${k}: nieznane pole`);
    else if (!Number.isInteger(value[k]) || value[k] < 1) errors.push(`${path}.${k}: oczekiwano liczby całkowitej ≥ 1`);
  }
  return errors;
}

/** Reference lists for validateCondition; a list missing from `data` is left out (not checked). */
export function conditionOpts(data, vars = data?.rules?.vars) {
  const ids = (list) => (Array.isArray(list) ? list.map((x) => x?.id) : undefined);
  return {
    vars,
    attributes: ids(data?.attributes),
    skills: ids(data?.skills),
    items: ids(data?.items),
    timesOfDay: ids(data?.rules?.timeOfDay),
    effects: ids(data?.effects),
    locations: ids(data?.travel?.locations),
    quests: Array.isArray(data?.quests) ? ids(data.quests) : undefined,
    places: Array.isArray(data?.travel?.locations) ? placeIds(data) : undefined,
    regions: data?.travel?.regions && typeof data.travel.regions === "object" ? Object.keys(data.travel.regions) : undefined,
  };
}
