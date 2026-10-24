/** Combat data: lookup and validation of enemies.json and art/*.pix. */
import { check } from "../../engine/schema.js";
import { effectById } from "../effects.js";
import { DAMAGE_TYPES } from "../modifiers.js";
import { validateActions } from "../actions.js";
import { itemById } from "../items.js";
import { ART_LIMITS } from "../../engine/pix.js";

export const AI_TYPES = ["aggressive", "cautious", "ranged"];
const LOOT_ACTIONS = ["giveItem", "giveMoney", "setFlag"];

const ID = { type: "string", pattern: /^[a-z0-9_]+$/ };
const TEXT = { type: "string", nonEmpty: true };
const INT_MIN0 = { type: "integer", min: 0 };
const INT_MIN1 = { type: "integer", min: 1 };
const EFFECT_ROLL = { type: "object", required: ["id", "chance"], fields: { id: ID, chance: { type: "integer" } }, additional: false };

const ATTACK_SCHEMA = {
  type: "object",
  required: ["name", "apCost"],
  fields: {
    name: TEXT, apCost: INT_MIN1, damage: { type: "array" }, damageType: { type: "string", enum: DAMAGE_TYPES },
    hit: { type: "integer" }, range: { type: "string", enum: ["melee", "far"] },
    target: { type: "string", enum: ["single", "all_enemies"] }, effects: { type: "array", items: EFFECT_ROLL }, weight: INT_MIN1,
  },
  additional: false,
};

// `morale` may be null, so it is checked by hand (schema.js has no null type).
const ENEMY_SCHEMA = {
  type: "object",
  required: ["id", "name", "art", "hp", "ap", "initiative", "defense", "attacks", "ai", "xp"],
  fields: {
    id: ID, name: TEXT, nameAcc: TEXT, art: ID, hp: INT_MIN1, ap: INT_MIN1, initiative: { type: "integer" }, defense: INT_MIN0,
    armor: INT_MIN0, reduction: { type: "object", values: INT_MIN0 }, damageTaken: { type: "object", values: { type: "number", min: 0 } },
    immune: { type: "array", items: ID }, effectResist: { type: "object", values: INT_MIN0 }, tags: { type: "array", items: ID },
    attacks: { type: "array", items: ATTACK_SCHEMA }, ai: { type: "string" }, xp: INT_MIN0, loot: { type: "array" }, leap: { type: "boolean" },
  },
  additional: false,
};

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Returns the enemy with `id`, or undefined. */
export function enemyById(data, id) {
  return (data.enemies ?? []).find((enemy) => enemy.id === id);
}

function validateAttack(attack, at, data) {
  const errors = [];
  if (!isObject(attack)) return errors;
  const hasDamage = attack.damage !== undefined;
  if (hasDamage) {
    const d = attack.damage;
    const ok = Array.isArray(d) && d.length === 2 && Number.isInteger(d[0]) && Number.isInteger(d[1]) && d[0] >= 0 && d[0] <= d[1];
    if (Array.isArray(d) && !ok) errors.push(`${at}.damage: oczekiwano [min, max] liczb całkowitych, 0 ≤ min ≤ max`);
    if (attack.damageType === undefined) errors.push(`${at}.damageType: wymagane razem z damage`);
  } else if (attack.damageType !== undefined) {
    errors.push(`${at}.damage: wymagane razem z damageType`);
  }
  if (!hasDamage && !(Array.isArray(attack.effects) && attack.effects.length > 0)) errors.push(`${at}: atak bez obrażeń wymaga effects`);
  if (attack.hit === undefined) {
    if (hasDamage || (attack.target ?? "single") === "single") errors.push(`${at}.hit: brak wymaganego pola`);
  } else if (Number.isInteger(attack.hit) && (attack.hit < 5 || attack.hit > 95)) {
    errors.push(`${at}.hit: wartość poza zakresem 5–95`);
  }
  if (Array.isArray(attack.effects)) {
    attack.effects.forEach((e, i) => {
      if (!isObject(e)) return;
      if (typeof e.id === "string" && !effectById(data, e.id)) errors.push(`${at}.effects[${i}].id: nieznany efekt ${JSON.stringify(e.id)}`);
      if (Number.isInteger(e.chance) && (e.chance < 1 || e.chance > 100)) errors.push(`${at}.effects[${i}].chance: wartość poza zakresem 1–100`);
    });
  }
  return errors;
}

/** Loot entry: `{ chance, <one action> }`, only giveItem / giveMoney / setFlag; an artifact at most once. */
export function validateLoot(entry, at, data) {
  if (!isObject(entry)) return [`${at}: oczekiwano obiektu`];
  const { chance, ...rest } = entry;
  const errors = [];
  if (!Number.isInteger(chance)) errors.push(`${at}.chance: ${chance === undefined ? "brak wymaganego pola" : "oczekiwano liczby całkowitej"}`);
  else if (chance < 1 || chance > 100) errors.push(`${at}.chance: wartość poza zakresem 1–100`);
  const keys = Object.keys(rest);
  if (keys.length !== 1) errors.push(`${at}: oczekiwano jednej akcji obok chance`);
  else if (!LOOT_ACTIONS.includes(keys[0])) errors.push(`${at}: dozwolone akcje ${LOOT_ACTIONS.join(", ")}`);
  else errors.push(...validateActions([rest], at, data).map((m) => m.replace(`${at}[0].`, `${at}.`)));
  const given = rest.giveItem;
  if (isObject(given) && given.qty > 1 && itemById(data, given.id)?.type === "artifact") errors.push(`${at}: artefakt może wystąpić najwyżej raz`);
  return errors;
}

function validateEnemy(enemy, prefix, data) {
  if (!isObject(enemy)) return [`${prefix}: oczekiwano obiektu`];
  const at = (field) => `${prefix} › ${field}`;
  const { morale, ...rest } = enemy;
  const errors = check(rest, ENEMY_SCHEMA).map((m) => `${prefix} › ${m}`);
  if (morale !== undefined && morale !== null && !(Number.isInteger(morale) && morale >= 0 && morale <= 100)) {
    errors.push(`${at("morale")}: oczekiwano liczby całkowitej 0–100 lub null`);
  }
  if (typeof enemy.ai === "string" && !AI_TYPES.includes(enemy.ai)) errors.push(`${at("ai")}: nieznany typ AI ${JSON.stringify(enemy.ai)}`);
  if (Array.isArray(enemy.attacks)) {
    if (enemy.attacks.length === 0) errors.push(`${at("attacks")}: wymagany co najmniej jeden atak`);
    enemy.attacks.forEach((a, i) => errors.push(...validateAttack(a, at(`attacks[${i}]`), data)));
  }
  if (isObject(enemy.reduction)) {
    for (const [type, v] of Object.entries(enemy.reduction)) {
      if (!DAMAGE_TYPES.includes(type)) errors.push(`${at(`reduction.${type}`)}: nieznany typ obrażeń ${JSON.stringify(type)}`);
      else if (Number.isInteger(v) && v > 75) errors.push(`${at(`reduction.${type}`)}: wartość poza zakresem 0–75`);
    }
  }
  if (isObject(enemy.damageTaken)) {
    for (const type of Object.keys(enemy.damageTaken)) {
      if (!DAMAGE_TYPES.includes(type)) errors.push(`${at(`damageTaken.${type}`)}: nieznany typ obrażeń ${JSON.stringify(type)}`);
    }
  }
  if (Array.isArray(enemy.immune)) {
    enemy.immune.forEach((id, i) => {
      if (typeof id === "string" && !effectById(data, id)) errors.push(`${at(`immune[${i}]`)}: nieznany efekt ${JSON.stringify(id)}`);
    });
  }
  if (isObject(enemy.effectResist)) {
    for (const [id, v] of Object.entries(enemy.effectResist)) {
      if (!effectById(data, id)) errors.push(`${at(`effectResist.${id}`)}: nieznany efekt ${JSON.stringify(id)}`);
      else if (Number.isInteger(v) && v > 100) errors.push(`${at(`effectResist.${id}`)}: wartość poza zakresem 0–100`);
    }
  }
  if (Array.isArray(enemy.loot)) enemy.loot.forEach((entry, i) => errors.push(...validateLoot(entry, at(`loot[${i}]`), data)));
  if (typeof enemy.art === "string") {
    const image = data.art?.[enemy.art];
    if (!image) errors.push(`${at("art")}: brak pliku art/${enemy.art}.pix`);
    else if (image.w > ART_LIMITS.enemy.w || image.h > ART_LIMITS.enemy.h) errors.push(`${at("art")}: grafika ${image.w}×${image.h} przekracza limit ${ART_LIMITS.enemy.w}×${ART_LIMITS.enemy.h}`);
  }
  return errors;
}

/** Validates the enemies list (unique ids, fields, effect/item/art references); returns error messages. */
export function validateEnemies(enemies, data) {
  if (!Array.isArray(enemies)) return ["enemies.json: oczekiwano tablicy"];
  const errors = [];
  const ids = new Set();
  enemies.forEach((enemy, index) => {
    const id = typeof enemy?.id === "string" ? enemy.id : null;
    const prefix = `enemies.json › ${id ?? `#${index}`}`;
    if (id !== null) {
      if (ids.has(id)) errors.push(`${prefix}: zduplikowane id`);
      ids.add(id);
    }
    errors.push(...validateEnemy(enemy, prefix, data));
  });
  return errors;
}

/** Validates the loaded art `{ id: { w, h, palette, rows } }` (the parser already checked the files; sizes are checked per use). */
export function validateArt(art) {
  if (!isObject(art)) return ["art: oczekiwano obiektu"];
  return Object.entries(art).filter(([, image]) => !isObject(image) || !Array.isArray(image.rows)).map(([id]) => `art/${id}.pix: oczekiwano obrazu`);
}
