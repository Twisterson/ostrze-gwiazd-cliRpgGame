/** Modifier catalog: which keys a modifier object may contain, validation and summing. */

export const DAMAGE_TYPES = ["sieczne", "klute", "obuchowe", "ogien", "palne", "gwiezdne"];
export const NUMERIC_KEYS = [
  "hpMax", "ap", "defense", "initiative", "carry", "hitChance", "meleeHitChance", "rangedHitChance",
  "damage", "critChance", "fleeChance",
];

const ID_PATTERN = /^[a-z0-9_]+$/;
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
const hasId = (list, id) => Array.isArray(list) && list.some((item) => item?.id === id);

/** True when `key` is a known modifier key (attribute, skill, numeric stat, resist_/effectDuration_, extraDamage, damageTaken). */
export function isModifierKey(key, data) {
  if (hasId(data.attributes, key) || hasId(data.skills, key) || NUMERIC_KEYS.includes(key)) return true;
  if (key === "extraDamage" || key === "damageTaken") return true;
  for (const prefix of ["resist_", "effectDuration_"]) {
    if (key.startsWith(prefix) && ID_PATTERN.test(key.slice(prefix.length))) return true;
  }
  return false;
}

function validateExtraDamage(value, path) {
  if (!isObject(value)) return [`${path}: oczekiwano obiektu`];
  const errors = [];
  if (!DAMAGE_TYPES.includes(value.type)) errors.push(`${path}.type: nieznany typ obrażeń ${JSON.stringify(value.type)}`);
  const a = value.amount;
  if (!(Array.isArray(a) && a.length === 2 && Number.isInteger(a[0]) && Number.isInteger(a[1]) && a[0] <= a[1])) {
    errors.push(`${path}.amount: oczekiwano [min, max] liczb całkowitych`);
  }
  return errors;
}

function validateDamageTaken(value, path) {
  if (!isObject(value)) return [`${path}: oczekiwano obiektu`];
  const errors = [];
  for (const [type, factor] of Object.entries(value)) {
    if (!DAMAGE_TYPES.includes(type)) errors.push(`${path}.${type}: nieznany typ obrażeń ${JSON.stringify(type)}`);
    else if (!isNumber(factor)) errors.push(`${path}.${type}: oczekiwano liczby`);
    else if (factor < 0) errors.push(`${path}.${type}: wartość mniejsza niż 0`);
  }
  return errors;
}

/** Validates a modifiers object; `path` prefixes every message. Returns a list of errors. */
export function validateModifiers(mods, path, data) {
  if (!isObject(mods)) return [`${path}: oczekiwano obiektu`];
  const errors = [];
  for (const [key, value] of Object.entries(mods)) {
    const at = `${path}.${key}`;
    if (!isModifierKey(key, data)) errors.push(`${at}: nieznany modyfikator`);
    else if (key === "extraDamage") errors.push(...validateExtraDamage(value, at));
    else if (key === "damageTaken") errors.push(...validateDamageTaken(value, at));
    else if (!isNumber(value)) errors.push(`${at}: oczekiwano liczby`);
  }
  return errors;
}

/** @typedef {{ numbers: Record<string, number>, damageTaken: Record<string, number>, extraDamage: Array<{type: string, amount: number[]}> }} Totals */

/** @returns {Totals} */
export function emptyTotals() {
  return { numbers: {}, damageTaken: {}, extraDamage: [] };
}

/** Adds `mods` into `totals` (mutated and returned): numbers summed, damageTaken multiplied per type, extraDamage collected. */
export function addModifiers(totals, mods) {
  for (const [key, value] of Object.entries(mods ?? {})) {
    if (key === "damageTaken") {
      for (const [type, factor] of Object.entries(value)) totals.damageTaken[type] = (totals.damageTaken[type] ?? 1) * factor;
    } else if (key === "extraDamage") {
      totals.extraDamage.push(value);
    } else {
      totals.numbers[key] = (totals.numbers[key] ?? 0) + value;
    }
  }
  return totals;
}
