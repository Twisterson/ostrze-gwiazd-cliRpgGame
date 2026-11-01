/** Item catalog: slots, item types, lookup and validation of items.json. */
import { check } from "../engine/schema.js";
import { effectById } from "./effects.js";
import { DAMAGE_TYPES, validateModifiers } from "./modifiers.js";

export const SLOTS = ["bron", "bron_zapas", "bron_druga", "glowa", "tulow", "rece", "nogi", "plaszcz", "talizman", "pas"];
export const ITEM_TYPES = ["weapon", "armor", "ammo", "throwable", "consumable", "artifact", "misc", "material"];

/** Artifact regeneration conditions without a parameter; `phenomenon:<id>` and `near:<tag>` take one. */
export const REGEN_CONDITIONS = ["night", "day", "in_combat"];
export const ARTIFACT_SLOTS = ["talizman", "bron"];
const COST_TYPES = ["fixed", "percent", "all"];

/** Weapon mastery categories (`masteryType` of weapons; throwables are implicitly `rzucana`). */
export const MASTERY_TYPES = ["miecz", "wlocznie", "luk", "kusza", "palna", "rzucana"];

const WEAPON_SLOTS = ["bron", "bron_zapas", "bron_druga"];
const MAX_REDUCTION = 75;

const ID = { type: "string", pattern: /^[a-z0-9_]+$/ };
const INT_MIN0 = { type: "integer", min: 0 };
const INT_MIN1 = { type: "integer", min: 1 };
const PAIR = { type: "array" }; // content checked by validatePair
const strict = (required, fields) => ({ type: "object", required, fields, additional: false });

const COMMON = {
  id: ID, name: { type: "string", nonEmpty: true }, type: { type: "string" },
  weight: { type: "number", min: 0 }, value: INT_MIN0,
  description: { type: "string", nonEmpty: true }, hidden: { type: "boolean" }, tier: INT_MIN1, unburdened: { type: "boolean" },
  // Food (consumables only; content checked by validateFood).
  food: {
    type: "object", required: ["order"], additional: false,
    fields: { order: { type: "integer" }, risk: strict(["effect", "chance"], { effect: ID, chance: { type: "integer" }, safeTagged: ID }) },
  },
};
const COMMON_REQUIRED = ["id", "name", "type", "weight", "value", "description"];

/** Per-type extra fields and required list. */
const TYPE_SCHEMAS = {
  // Story items: nothing to use, wear or sell.
  misc: { required: [], fields: {} },
  // Trade goods (hides, fangs, valuables): sold to merchants, no other use.
  material: { required: [], fields: {} },
  weapon: {
    required: ["skill", "damageType", "damage", "apCost", "range", "minStrength"],
    fields: {
      skill: ID, damageType: { type: "string", enum: DAMAGE_TYPES }, damage: PAIR, apCost: INT_MIN1,
      range: { type: "string", enum: ["melee", "far", "thrown"] }, minStrength: INT_MIN0,
      reload: strict(["apCost", "ammo", "capacity"], { apCost: INT_MIN1, ammo: ID, capacity: INT_MIN1 }),
      armorPierce: INT_MIN0, misfireChance: INT_MIN0, burstChance: INT_MIN0, burstDamage: PAIR, noise: INT_MIN0, fear: INT_MIN0,
      smoke: INT_MIN0, pair: { type: "boolean" }, offhand: { type: "boolean" }, reach: { type: "boolean" }, throwName: { type: "string" }, throwSkill: { type: "string" }, masteryType: { type: "string" },
      modifiers: { type: "object" },
      effects: { type: "array", items: strict(["id", "chance"], { id: ID, chance: INT_MIN1 }) },
    },
  },
  armor: {
    required: ["slot"],
    fields: {
      slot: { type: "string" }, armor: INT_MIN0, reduction: { type: "object", values: INT_MIN0 },
      modifiers: { type: "object" }, quickSlots: INT_MIN0,
    },
  },
  ammo: { required: [], fields: {} },
  throwable: {
    required: ["skill", "apCost", "target", "effects"],
    fields: {
      skill: ID, apCost: INT_MIN1,
      target: { type: "string", enum: ["single", "single_splash", "all_enemies", "battlefield"] },
      effects: { type: "array", items: strict(["id", "chance"], { id: ID, chance: INT_MIN1 }) },
    },
  },
  artifact: {
    required: ["slot", "charge", "regen"],
    fields: {
      slot: { type: "string" },
      charge: strict(["max", "start"], { max: { type: "number", min: 0 }, start: { type: "number", min: 0 } }),
      regen: strict(["perHour"], {
        perHour: { type: "number", min: 0 }, requiresExposure: { type: "boolean" },
        conditions: { type: "array", items: strict(["when", "multiplier"], { when: { type: "string" }, multiplier: { type: "number" } }) },
      }),
      passive: { type: "array", items: strict(["minCharge", "modifiers"], { minCharge: { type: "number" }, modifiers: { type: "object" } }) },
      abilities: {
        type: "array",
        items: strict(["id", "name", "cost", "apCost", "effect"], {
          id: ID, name: { type: "string", nonEmpty: true }, cost: { type: "object" }, requiresFull: { type: "boolean" }, apCost: INT_MIN1,
          description: { type: "string", nonEmpty: true }, recall: { type: "boolean" }, damage: PAIR, damageType: { type: "string", enum: DAMAGE_TYPES },
          effect: strict(["id", "target"], { id: ID, target: { type: "string", enum: ["self", "enemy"] }, duration: INT_MIN1, chance: INT_MIN1 }),
        }),
      },
      whenEmpty: strict(["usable", "costHp", "text"], { usable: { type: "boolean" }, costHp: INT_MIN1, text: { type: "string", nonEmpty: true } }),
    },
  },
  consumable: {
    required: ["target", "apCost"],
    fields: {
      target: { type: "string", enum: ["self"] }, apCost: INT_MIN1, heal: PAIR, healSkill: ID,
      removes: { type: "array", items: ID }, applies: { type: "array", items: ID },
    },
  },
};

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Returns the item with `id`, or undefined. */
export function itemById(data, id) {
  return (data.items ?? []).find((item) => item.id === id);
}

/** True for weapons and weapon artifacts (`artifact` with `slot: "bron"`): both fight like weapons. */
export function isWeapon(item) {
  return item?.type === "weapon" || (item?.type === "artifact" && item.slot === "bron");
}

/** True when `item` may be worn in `slot` (weapons and weapon artifacts: main/back-up slot, off-hand only for `offhand` weapons; armor: its own slot; talisman artifacts: `talizman`; the rest never). */
export function slotAccepts(item, slot) {
  if (item?.type === "artifact" && item.slot === "talizman") return slot === "talizman";
  if (isWeapon(item)) return slot === "bron_druga" ? item.offhand === true : WEAPON_SLOTS.includes(slot);
  if (item?.type === "armor") return item.slot === slot;
  return false;
}

/** `food: { order 1–9, risk?: { effect, chance 1–100, safeTagged? } }` (shape checked by the schema). */
function validateFood(food, at, skillIds, effectRef) {
  const errors = [];
  if (Number.isInteger(food.order) && (food.order < 1 || food.order > 9)) errors.push(`${at("food.order")}: wartość poza zakresem 1–9`);
  const risk = food.risk;
  if (isObject(risk)) {
    if (Number.isInteger(risk.chance) && (risk.chance < 1 || risk.chance > 100)) errors.push(`${at("food.risk.chance")}: wartość poza zakresem 1–100`);
    if (typeof risk.safeTagged === "string" && !skillIds.includes(risk.safeTagged)) errors.push(`${at("food.risk.safeTagged")}: nieznana umiejętność ${JSON.stringify(risk.safeTagged)}`);
    effectRef(risk.effect, "food.risk.effect", true);
  }
  return errors;
}

function validatePair(value, path) {
  const ok = Array.isArray(value) && value.length === 2 && Number.isInteger(value[0]) && Number.isInteger(value[1]) && value[0] <= value[1];
  return ok ? [] : [`${path}: oczekiwano [min, max] liczb całkowitych, min ≤ max`];
}

function validateItem(item, prefix, items, data) {
  const typeKey = isObject(item) && typeof item.type === "string" && Object.hasOwn(TYPE_SCHEMAS, item.type) ? item.type : null;
  if (!isObject(item)) return [`${prefix}: oczekiwano obiektu`];
  if (item.type !== undefined && typeof item.type === "string" && !typeKey) {
    return [`${prefix} › type: nieznany typ przedmiotu ${JSON.stringify(item.type)}`];
  }
  // A weapon artifact carries every weapon field too.
  const weaponLike = typeKey === "weapon" || (typeKey === "artifact" && item.slot === "bron");
  const extra = weaponLike && typeKey === "artifact" ? TYPE_SCHEMAS.weapon : { required: [], fields: {} };
  const schema = typeKey
    ? strict([...COMMON_REQUIRED, ...TYPE_SCHEMAS[typeKey].required, ...extra.required], { ...COMMON, ...extra.fields, ...TYPE_SCHEMAS[typeKey].fields })
    : strict(COMMON_REQUIRED, COMMON);
  // Only the schema errors are reported when the type is missing/invalid.
  const errors = check(item, schema).map((m) => `${prefix} › ${m}`);
  if (!typeKey) return errors;
  const skillIds = (data.skills ?? []).map((s) => s?.id);
  const at = (field) => `${prefix} › ${field}`;
  const skillRef = (field) => {
    if (typeof item[field] === "string" && !skillIds.includes(item[field])) {
      errors.push(`${at(field)}: nieznana umiejętność ${JSON.stringify(item[field])}`);
    }
  };
  if (Array.isArray(item.damage)) errors.push(...validatePair(item.damage, at("damage")));
  if (Array.isArray(item.heal)) errors.push(...validatePair(item.heal, at("heal")));
  if (weaponLike) {
    if (Array.isArray(item.burstDamage)) errors.push(...validatePair(item.burstDamage, at("burstDamage")));
    for (const field of ["misfireChance", "burstChance", "noise", "smoke"]) {
      if (Number.isInteger(item[field]) && item[field] > 100) errors.push(`${at(field)}: wartość poza zakresem 0–100`);
    }
    if (typeof item.masteryType === "string" && !MASTERY_TYPES.includes(item.masteryType)) errors.push(`${at("masteryType")}: nieznany rodzaj ${JSON.stringify(item.masteryType)}`);
    else if (item.masteryType === undefined && !item.hidden && item.skill !== "wrecz") errors.push(`${at("masteryType")}: brak wymaganego pola`);
    if (item.pair === true && item.range !== "melee") errors.push(`${at("pair")}: dozwolone tylko dla broni melee`);
    if (item.pair === true && item.offhand === true) errors.push(`${at("pair")}: wyklucza się z offhand`);
  }
  if (weaponLike || typeKey === "throwable") skillRef("skill");
  if (typeKey === "consumable") skillRef("healSkill");
  if (isObject(item.reload) && typeof item.reload.ammo === "string" && items.find((i) => i?.id === item.reload.ammo)?.type !== "ammo") {
    errors.push(`${at("reload.ammo")}: oczekiwano przedmiotu typu ammo`);
  }
  if (isObject(item.modifiers)) errors.push(...validateModifiers(item.modifiers, at("modifiers"), data));
  if ((typeKey === "throwable" || weaponLike) && Array.isArray(item.effects)) {
    item.effects.forEach((e, i) => {
      if (isObject(e) && Number.isInteger(e.chance) && e.chance > 100) errors.push(`${at(`effects[${i}].chance`)}: wartość poza zakresem 1–100`);
    });
  }
  const effectRef = (id, field, hourOnly, turnOnly = false) => {
    if (typeof id !== "string") return;
    const effect = effectById(data, id);
    if (!effect) errors.push(`${at(field)}: nieznany efekt ${JSON.stringify(id)}`);
    else if (hourOnly && effect.unit !== "hour") errors.push(`${at(field)}: efekt ${JSON.stringify(id)} nie jest godzinowy`);
    else if (turnOnly && effect.unit !== "turn") errors.push(`${at(field)}: efekt ${JSON.stringify(id)} nie jest turowy`);
  };
  if (typeKey === "throwable" && Array.isArray(item.effects)) item.effects.forEach((e, i) => effectRef(e?.id, `effects[${i}].id`, false));
  if (weaponLike && Array.isArray(item.effects)) item.effects.forEach((e, i) => effectRef(e?.id, `effects[${i}].id`, false, true));
  if (typeKey === "consumable") {
    if (Array.isArray(item.removes)) item.removes.forEach((id, i) => effectRef(id, `removes[${i}]`, false));
    if (Array.isArray(item.applies)) item.applies.forEach((id, i) => effectRef(id, `applies[${i}]`, true));
  }
  if (typeKey === "artifact") errors.push(...validateArtifact(item, at, data, effectRef));
  if (item.food !== undefined) {
    if (typeKey !== "consumable") errors.push(`${at("food")}: dozwolone tylko dla consumable`);
    else if (isObject(item.food)) errors.push(...validateFood(item.food, at, skillIds, effectRef));
  }
  if ((weaponLike || typeKey === "armor") && !item.hidden) {
    if (item.tier === undefined) errors.push(`${at("tier")}: brak wymaganego pola`);
    else if (Number.isInteger(item.tier) && item.tier > 4) errors.push(`${at("tier")}: wartość poza zakresem 1–4`);
  }
  if (typeKey === "armor") {
    if (typeof item.slot === "string" && (!SLOTS.includes(item.slot) || WEAPON_SLOTS.includes(item.slot))) {
      errors.push(`${at("slot")}: niedozwolony slot ${JSON.stringify(item.slot)}`);
    }
    if (isObject(item.reduction)) {
      for (const [type, v] of Object.entries(item.reduction)) {
        if (!DAMAGE_TYPES.includes(type)) errors.push(`${at(`reduction.${type}`)}: nieznany typ obrażeń ${JSON.stringify(type)}`);
        else if (Number.isInteger(v) && v > MAX_REDUCTION) errors.push(`${at(`reduction.${type}`)}: wartość poza zakresem 0–${MAX_REDUCTION}`);
      }
    }
    if (item.slot === "pas" && item.quickSlots === undefined) errors.push(`${at("quickSlots")}: wymagane dla slotu pas`);
    else if (item.slot !== "pas" && item.quickSlots !== undefined) errors.push(`${at("quickSlots")}: dozwolone tylko dla slotu pas`);
  }
  return errors;
}

/** Artifact content: slot, charge range, regeneration conditions, passive thresholds and modifiers, abilities (cost, effect, unique ids). */
function validateArtifact(item, at, data, effectRef) {
  const errors = [];
  if (typeof item.slot === "string" && !ARTIFACT_SLOTS.includes(item.slot)) errors.push(`${at("slot")}: artefakt może być tylko w talizman albo bron`);
  const max = isObject(item.charge) && typeof item.charge.max === "number" ? item.charge.max : null;
  if (max !== null && max <= 0) errors.push(`${at("charge.max")}: wartość musi być większa niż 0`);
  if (max !== null && typeof item.charge.start === "number" && item.charge.start > max) errors.push(`${at("charge.start")}: wartość poza zakresem 0–max`);
  const conditions = isObject(item.regen) && Array.isArray(item.regen.conditions) ? item.regen.conditions : [];
  conditions.forEach((c, i) => {
    if (!isObject(c) || typeof c.when !== "string") return;
    const field = at(`regen.conditions[${i}].when`);
    if (c.when.startsWith("phenomenon:")) {
      const id = c.when.slice("phenomenon:".length);
      if (!(data.phenomena ?? []).some((p) => p?.id === id)) errors.push(`${field}: nieznane zjawisko ${JSON.stringify(id)}`);
    } else if (c.when.startsWith("near:")) {
      if (!/^[a-z0-9_]+$/.test(c.when.slice("near:".length))) errors.push(`${field}: nieznany warunek ${JSON.stringify(c.when)}`);
    } else if (!REGEN_CONDITIONS.includes(c.when)) errors.push(`${field}: nieznany warunek ${JSON.stringify(c.when)}`);
  });
  (Array.isArray(item.passive) ? item.passive : []).forEach((p, i) => {
    if (!isObject(p)) return;
    if (typeof p.minCharge === "number" && max !== null && (p.minCharge < 0 || p.minCharge > max)) errors.push(`${at(`passive[${i}].minCharge`)}: wartość poza zakresem 0–max`);
    if (isObject(p.modifiers)) errors.push(...validateModifiers(p.modifiers, at(`passive[${i}].modifiers`), data));
  });
  const ids = new Set();
  (Array.isArray(item.abilities) ? item.abilities : []).forEach((a, i) => {
    if (!isObject(a)) return;
    const here = (field) => at(`abilities[${i}].${field}`);
    if (typeof a.id === "string") {
      if (ids.has(a.id)) errors.push(`${here("id")}: powtórzony identyfikator ${JSON.stringify(a.id)}`);
      ids.add(a.id);
    }
    if (isObject(a.cost)) {
      const { type, value } = a.cost;
      if (!COST_TYPES.includes(type)) errors.push(`${here("cost.type")}: nieznany typ ${JSON.stringify(type)}`);
      else if (type === "fixed" && !(typeof value === "number" && value > 0)) errors.push(`${here("cost.value")}: wartość musi być większa niż 0`);
      else if (type === "percent" && !(Number.isInteger(value) && value >= 1 && value <= 100)) errors.push(`${here("cost.value")}: wartość poza zakresem 1–100`);
      else if (type === "all" && value !== undefined) errors.push(`${here("cost.value")}: niedozwolone dla typu all`);
    }
    if (isObject(a.effect)) effectRef(a.effect.id, `abilities[${i}].effect.id`, false);
    if (a.damage !== undefined && (a.damageType === undefined || a.effect?.target !== "enemy")) errors.push(`${here("damage")}: wymaga damageType i efektu na wroga`);
  });
  return errors;
}

/** Validates the items list (unique ids, per-type fields, references, hidden `piesci`); returns error messages. */
export function validateItems(items, data) {
  if (!Array.isArray(items)) return ["items.json: oczekiwano tablicy"];
  const errors = [];
  const ids = new Set();
  items.forEach((item, index) => {
    const id = typeof item?.id === "string" ? item.id : null;
    const prefix = `items.json › ${id ?? `#${index}`}`;
    if (id !== null) {
      if (ids.has(id)) errors.push(`${prefix}: zduplikowane id`);
      ids.add(id);
    }
    errors.push(...validateItem(item, prefix, items, data));
  });
  const fists = items.find((i) => i?.id === "piesci");
  if (!(fists?.type === "weapon" && fists.hidden === true)) errors.push("items.json: brak przedmiotu piesci (weapon, hidden)");
  return errors;
}
