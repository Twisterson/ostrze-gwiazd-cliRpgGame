import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "../config.js";
import { check } from "./schema.js";
import { validateCondition, conditionOpts } from "./conditions.js";
import { SCENE_TYPES } from "../scenes/schemas.js";
import { validateModifiers } from "../systems/modifiers.js";
import { validateEffects } from "../systems/effects.js";
import { validateDialogues } from "../systems/dialogue.js";
import { validateItems, itemById, slotAccepts, SLOTS, ITEM_TYPES, MASTERY_TYPES } from "../systems/items.js";
import { parsePix, PixError, artRefErrors } from "./pix.js";
import { validateEnemies, validateArt, enemyById, validateLoot } from "../systems/combat/data.js";
import { validatePhenomena, phenomenonById } from "../systems/phenomena.js";
import { validateTravel, locationById, routeById, EVENT_END } from "../systems/travel.js";
import { validateQuests, questById } from "../systems/quests.js";
import { validateLootTables } from "../systems/loot.js";

export class DataLoadError extends Error {
  constructor(message) {
    super(message);
    this.name = "DataLoadError";
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

async function readJson(dir, file) {
  let text;
  try {
    text = await fs.readFile(path.join(dir, file), "utf8");
  } catch (e) {
    throw new DataLoadError(`${file}: ${e.code === "ENOENT" ? "brak pliku" : e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new DataLoadError(`${file}: niepoprawny JSON (${e.message})`);
  }
}

/** Reads every dialogues/*.json (sorted by file name); each record keeps its file name in `file`. */
async function readDialogues(dir) {
  let files;
  try {
    files = (await fs.readdir(path.join(dir, "dialogues"))).filter((f) => f.endsWith(".json")).sort();
  } catch (e) {
    throw new DataLoadError(`dialogues: ${e.code === "ENOENT" ? "brak katalogu" : e.message}`);
  }
  const dialogues = [];
  for (const file of files) {
    const dialogue = await readJson(path.join(dir, "dialogues"), file);
    dialogues.push(isPlainObject(dialogue) ? { ...dialogue, file } : dialogue);
  }
  return dialogues;
}

/** Reads every art/*.pix into `{ id: { w, h, palette, rows } }` (sorted by file name); all broken files are reported together. */
async function readArt(dir) {
  let files;
  try {
    files = (await fs.readdir(path.join(dir, "art"))).filter((f) => f.endsWith(".pix")).sort();
  } catch (e) {
    throw new DataLoadError(`art: ${e.code === "ENOENT" ? "brak katalogu" : e.message}`);
  }
  const art = {};
  const errors = [];
  for (const file of files) {
    let text;
    try {
      text = await fs.readFile(path.join(dir, "art", file), "utf8");
    } catch (e) {
      errors.push(`art/${file}: ${e.message}`);
      continue;
    }
    try {
      art[file.slice(0, -4)] = parsePix(text);
    } catch (e) {
      if (!(e instanceof PixError)) throw e;
      errors.push(`art/${file} › ${e.message}`);
    }
  }
  if (errors.length > 0) throw new DataLoadError(errors.join("\n"));
  return art;
}

/** Reads every maps/*.txt into `{ region: text }` (the region map of the map screen). */
async function readMaps(dir) {
  let files;
  try {
    files = (await fs.readdir(path.join(dir, "maps"))).filter((f) => f.endsWith(".txt")).sort();
  } catch (e) {
    throw new DataLoadError(`maps: ${e.code === "ENOENT" ? "brak katalogu" : e.message}`);
  }
  const maps = {};
  for (const file of files) maps[file.slice(0, -4)] = await fs.readFile(path.join(dir, "maps", file), "utf8");
  return maps;
}

/** Loads ui, rules, attributes, skills, classes, perks, effects, enemies, phenomena, art, maps, items, shops, dialogues, story, travel and quests (in that order) and deep-freezes the result. */
export async function loadData(dir = dataDir()) {
  const ui = await readJson(dir, "ui.json");
  const rules = await readJson(dir, "rules.json");
  const attributes = await readJson(dir, "attributes.json");
  const skills = await readJson(dir, "skills.json");
  const classes = await readJson(dir, "classes.json");
  const perks = await readJson(dir, "perks.json");
  const effects = await readJson(dir, "effects.json");
  const enemies = await readJson(dir, "enemies.json");
  const phenomena = await readJson(dir, "phenomena.json");
  const art = await readArt(dir);
  const maps = await readMaps(dir);
  const items = await readJson(dir, "items.json");
  const shops = await readJson(dir, "shops.json");
  const dialogues = await readDialogues(dir);
  const story = await readJson(dir, "story.json");
  const travel = await readJson(dir, "travel.json");
  const quests = await readJson(dir, "quests.json");
  const loot = await readJson(dir, "loot.json");
  return deepFreeze({ ui, rules, attributes, skills, classes, perks, effects, enemies, phenomena, art, maps, items, shops, dialogues, story, travel, quests, loot });
}

const ID = { type: "string", pattern: /^[a-z0-9_]+$/ };
const TEXT = { type: "string", nonEmpty: true };
const INT = { type: "integer" };
const INT_MIN0 = { type: "integer", min: 0 };
const INT_MIN1 = { type: "integer", min: 1 };
// Values are checked by validateModifiers (extraDamage / damageTaken are objects).
const MODIFIERS = { type: "object" };
const MIN_MAP = { type: "object", values: INT };

/** Object with all fields required and no extras. */
const strictObject = (fields) => ({ type: "object", required: Object.keys(fields), fields, additional: false });

/** An aimed blow's zone: `ap`/`penalty` required (a negative penalty is a hit bonus); the rest optional. */
const AIMED_ZONE = {
  type: "object",
  required: ["ap", "penalty"],
  fields: {
    ap: INT_MIN0, penalty: INT, critBonus: INT_MIN0, damagePercent: INT, effect: ID, chance: INT_MIN1, bluntBonus: INT_MIN0, noDamage: { type: "boolean" },
    masteryRelief: { type: "object", required: ["per", "amount"], fields: { per: INT_MIN1, amount: INT_MIN0 }, additional: false },
  },
  additional: false,
};

const RULES_SCHEMA = {
  type: "object",
  required: ["startHour", "creator", "skills", "derived", "leveling", "timeOfDay", "rest", "vars", "unlocks", "inventory", "shop", "effects", "dialogue", "combat", "artifacts", "exposure", "phenomena", "travel", "quests", "search"],
  fields: {
    startHour: INT_MIN0,
    creator: strictObject({
      attributeStart: INT_MIN0, attributeMin: INT_MIN0, attributeMax: INT_MIN1, points: INT_MIN0,
      gifts: MIN_MAP, taggedCount: INT_MIN0, taggedBonus: INT_MIN0, nameMin: INT_MIN1, nameMax: INT_MIN1,
    }),
    skills: strictObject({ primaryMult: INT_MIN0, secondaryMult: INT_MIN0, max: INT_MIN1, taggedPointValue: INT_MIN1 }),
    derived: strictObject({
      hpBase: INT_MIN0, hpPerKrzepa: INT_MIN0, hpPerLevelBase: INT_MIN0, hpPerLevelKrzepaDiv: INT_MIN1,
      apBase: INT_MIN0, apZrecznoscDiv: INT_MIN1, carryBase: INT_MIN0, carryPerSila: INT_MIN0,
      defensePerZrecznosc: INT_MIN0,
    }),
    leveling: strictObject({
      xpStep: INT_MIN1, skillPointsBase: INT_MIN0, skillPointsRozumDiv: INT_MIN1,
      perkEveryLevels: INT_MIN1, maxPerks: INT_MIN0, attributeEveryLevels: INT_MIN1,
    }),
    timeOfDay: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "from", "to", "modifiers"],
        fields: { id: ID, from: INT_MIN0, to: INT_MIN0, modifiers: { type: "object" }, bystroscSkillPenalty: INT },
        additional: false,
      },
    },
    rest: strictObject({ minHours: INT_MIN1, maxHours: INT_MIN1, healBase: INT_MIN0, healKrzepaDiv: INT_MIN1 }),
    vars: { type: "array", items: ID },
    unlocks: { type: "array", items: ID },
    inventory: strictObject({ hardLimitPercent: INT_MIN1, useMinutes: INT_MIN0, maxReductionPercent: INT_MIN0, softCap: { type: "object", fields: { armorFrom: INT_MIN0, reductionFrom: INT_MIN0, rate: { type: "number", min: 0 } } } }),
    shop: strictObject({
      buyBase: { type: "number" }, buyHandelDiv: INT_MIN1, sellBase: { type: "number" }, sellHandelDiv: INT_MIN1, minPrice: INT_MIN1,
    }),
    effects: strictObject({
      resistAttributeMult: INT_MIN0, resistOutcome: { type: "string", enum: ["cancel", "shorten"] }, maxStacksDefault: INT_MIN1,
    }),
    dialogue: strictObject({
      minutes: INT_MIN0, skillBase: INT, attributeMult: INT_MIN0, chanceMin: INT_MIN0, chanceMax: INT_MIN1,
    }),
    combat: strictObject({
      hitBase: INT, hitMin: INT_MIN0, hitMax: INT_MIN1, critMult: { type: "number", min: 1 }, meleeStrengthBase: INT_MIN0,
      rangedInMeleePenalty: INT_MIN0, smokeEnterPenalty: INT_MIN0, throwHitBonus: INT_MIN0, minStrengthPenalty: INT_MIN0,
      bluntCritStun: INT_MIN0, bluntDaze: INT_MIN0, dazedPenalty: INT_MIN0,
      defendPerAp: INT_MIN0, defendMinAp: INT_MIN1,
      fleeBase: INT, fleePerZrecznosc: INT_MIN0, fleePerMeleeEnemy: INT_MIN0, fleeAp: INT_MIN1,
      bagUseExtraAp: INT_MIN0, moveAp: INT_MIN1, swapAp: INT_MIN1, swapRangedAp: INT_MIN1, veteranFromLevel: INT_MIN1,
      moraleThreshold: INT_MIN0, lowHpPercent: { type: "integer", min: 1, max: 100 }, moraleOnAllyDeath: INT_MIN0, lowMoraleHitPenalty: INT_MIN0, cautiousHpPercent: INT_MIN0,
      missEffectMultiplier: { type: "number", min: 0 }, fumbleRoll: INT_MIN1, fumbleFart: INT_MIN0,
      defaultMinutes: INT_MIN0, logSize: INT_MIN1, reachReadyAp: INT_MIN1,
      dual: strictObject({
        extraAp: INT_MIN0, secondHitPenalty: INT_MIN0, guardExtraAp: INT_MIN0, guardBonus: INT_MIN0, oneLeftPenalty: INT_MIN0, pickUpAp: INT_MIN0,
      }),
      aimed: strictObject({
        glowa: AIMED_ZONE,
        tulow: AIMED_ZONE,
        nogi: AIMED_ZONE,
        ogluszenie: AIMED_ZONE,
      }),
      mastery: strictObject({
        xpDiv: INT_MIN1, max: INT_MIN1, hitAt100: INT_MIN0, damagePercentAt100: INT_MIN0, defenseAt100: INT_MIN0, classStart: INT_MIN0,
      }),
      firearm: strictObject({ misfirePerProch: INT_MIN0 }),
      explosive: strictObject({
        fragDamage: { type: "array", items: INT_MIN0 }, slowChance: { type: "integer", min: 0, max: 100 },
        missBurstChance: { type: "integer", min: 0, max: 100 }, selfDamage: { type: "array", items: INT_MIN0 },
      }),
      noise: strictObject({ fastRounds: INT_MIN1, chance: { type: "integer", min: 0, max: 100 }, tags: { type: "array", items: ID } }),
    }),
    artifacts: strictObject({ carriedRegenMultiplier: { type: "number", min: 0 } }),
    exposure: strictObject({
      riskPerHour: INT_MIN0, riskPerHourPhenomenon: INT_MIN0, catchAttribute: ID, catchBase: INT, catchPerPoint: INT_MIN0,
      thiefMoneyPercent: { type: "array", items: INT_MIN0 }, thiefArtifactChance: INT_MIN0,
    }),
    phenomena: strictObject({ maxPerDay: INT_MIN0 }),
    appetite: strictObject({ fullHours: INT_MIN1, hintAt: { type: "integer", min: 1, max: 100 }, starveAt: INT_MIN1 }),
    quests: strictObject({ maxActive: INT_MIN1, microXp: INT_MIN0 }),
    search: strictObject({ levels: strictObject({ czujnosc: INT_MIN1, poscig: INT_MIN1, oblawa: INT_MIN1 }), decayPerDay: INT_MIN0 }),
    travel: strictObject({
      startLocation: ID, maxRouteDays: INT_MIN1, departHour: INT_MIN0, marchHours: INT_MIN1, eventHourRange: { type: "array", items: INT_MIN0 },
      eventChance: INT_MIN0, dangerousEventChance: INT_MIN0, localEventChance: INT_MIN0, localDangerBonus: INT_MIN0, dangerousAttackWeight: INT_MIN1, slowMinHours: INT_MIN1,
      repeat: strictObject({ decay: { type: "number", min: 0.05, max: 0.99 }, floorWalk: INT_MIN1, floorStage: INT_MIN1 }),
      walkSegmentMinutes: { type: "integer", min: 30 }, walkMaxEvents: { type: "integer", min: 1, max: 5 }, huntCooldownDays: INT_MIN1, maxNearMinutes: { type: "integer", min: 60 },
      crowd: strictObject({ above: INT_MIN0, perPlace: INT_MIN0, max: INT_MIN0 }),
      night: strictObject({ periods: { type: "array", items: ID }, eventBonus: INT_MIN0, attackWeight: INT_MIN1 }),
      forage: strictObject({ minutes: INT_MIN1, base: INT_MIN0, perBystrosc: INT_MIN0, max: INT_MIN0, night: INT, slow: INT }),
    }),
  },
  additional: false,
};
const recordSchema = (fields, required) => ({ type: "object", required, fields, additional: false });
const ATTRIBUTE_SCHEMA = recordSchema({ id: ID, name: TEXT, description: TEXT }, ["id", "name", "description"]);
const SKILL_SCHEMA = recordSchema({ id: ID, name: TEXT, primary: ID, secondary: ID }, ["id", "name", "primary", "secondary"]);
const STOCK_ENTRY = strictObject({ id: ID, qty: INT_MIN1 });
const CLASS_SCHEMA = recordSchema(
  {
    id: ID, name: TEXT, description: TEXT, taggedSkill: ID, modifiers: MODIFIERS,
    startItems: { type: "array", items: STOCK_ENTRY }, startEquipped: { type: "object", values: ID }, startMoney: INT_MIN0,
    masteryStart: { type: "object", values: { type: "number", min: 0 } },
  },
  ["id", "name", "description", "taggedSkill", "startItems", "startEquipped", "startMoney"],
);
const SHOP_SCHEMA = recordSchema(
  {
    id: ID, name: TEXT, stock: { type: "array", items: STOCK_ENTRY }, buys: { type: "array", items: { type: "string" } },
    priceModifiers: {
      type: "array",
      items: {
        type: "object", required: ["if"], additional: false,
        fields: { if: { type: "object" }, buyPercent: { type: "integer" }, sellPercent: { type: "integer" } },
      },
    },
  },
  ["id", "name", "stock", "buys"],
);
const PERK_SCHEMA = recordSchema(
  {
    id: ID, name: TEXT, description: TEXT, modifiers: MODIFIERS, unlocks: { type: "array", items: ID },
    requires: {
      type: "object",
      fields: { level: { type: "integer", min: 2 }, attributes: MIN_MAP, skills: MIN_MAP },
      additional: false,
    },
  },
  ["id", "name", "description"],
);
const UI_SCHEMA = { type: "object", values: { type: "string" } };

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Shape-checks a list of records (unique ids); returns [errors, set of valid ids]. */
function validateRecords(file, list, schema) {
  const errors = [];
  const ids = new Set();
  if (!Array.isArray(list)) return [[`${file}: oczekiwano tablicy`], ids];
  list.forEach((item, index) => {
    const id = typeof item?.id === "string" ? item.id : null;
    const prefix = `${file} › ${id ?? `#${index}`}`;
    if (id !== null) {
      if (ids.has(id)) errors.push(`${prefix}: zduplikowane id`);
      ids.add(id);
    }
    errors.push(...check(item, schema).map((m) => (m.startsWith("oczekiwano") ? `${prefix}: ${m}` : `${prefix} › ${m}`)));
  });
  return [errors, ids];
}

/** Reward scene content: at least one part, items exist and are not hidden. */
function validateReward(scene, data) {
  const msgs = [];
  const list = Array.isArray(scene.items) ? scene.items : [];
  if (!(scene.xp > 0) && !(scene.money > 0) && list.length === 0) msgs.push("reward: pusta nagroda");
  list.forEach((entry, i) => {
    const at = `items[${i}]`;
    if (typeof entry !== "string" && !isPlainObject(entry)) {
      msgs.push(`${at}: oczekiwano tekstu lub obiektu`);
      return;
    }
    if (isPlainObject(entry)) {
      const shape = { type: "object", required: ["id"], fields: { id: { type: "string" }, qty: { type: "integer", min: 1 } }, additional: false };
      const shapeErrors = check(entry, shape);
      msgs.push(...shapeErrors.map((m) => `${at}: ${m}`));
      if (shapeErrors.length) return;
    }
    const id = typeof entry === "string" ? entry : entry.id;
    const item = itemById(data, id);
    if (!item) msgs.push(`${at}: nieznany przedmiot ${JSON.stringify(id)}`);
    else if (item.hidden) msgs.push(`${at}: przedmiot ukryty`);
    else if (item.type === "artifact" && isPlainObject(entry) && entry.qty > 1) msgs.push(`${at}.qty: artefakt może wystąpić najwyżej raz`);
  });
  return msgs;
}

/** Effect scene content: at least one part, effects exist, `add` only hour effects. */
function validateEffectScene(scene, data) {
  const msgs = [];
  const add = Array.isArray(scene.add) ? scene.add : [];
  const remove = Array.isArray(scene.remove) ? scene.remove : [];
  if (add.length === 0 && remove.length === 0) msgs.push("effect: pusta scena efektu");
  const known = (id) => (data?.effects ?? []).find((e) => e?.id === id);
  add.forEach((id, i) => {
    const def = known(id);
    if (!def) msgs.push(`add[${i}]: nieznany efekt ${JSON.stringify(id)}`);
    else if (def.unit !== "hour") msgs.push(`add[${i}]: efekt ${JSON.stringify(id)} nie jest godzinowy`);
  });
  remove.forEach((id, i) => {
    if (!known(id)) msgs.push(`remove[${i}]: nieznany efekt ${JSON.stringify(id)}`);
  });
  return msgs;
}

/** Fight content (`combat` scene or `dialogue.onCombat`): enemies exist, redirects name scenes, training implies a safe spar. */
function validateCombatDef(def, at, known, data) {
  const msgs = [];
  if (Array.isArray(def.enemies)) {
    if (def.enemies.length === 0) msgs.push(`${at}enemies: pusta lista wrogów`);
    def.enemies.forEach((entry, i) => {
      if (isPlainObject(entry) && typeof entry.id === "string" && !enemyById(data, entry.id)) msgs.push(`${at}enemies[${i}].id: nieznany wróg "${entry.id}"`);
    });
  }
  if (Array.isArray(def.reinforcements)) {
    def.reinforcements.forEach((entry, i) => {
      if (isPlainObject(entry) && typeof entry.id === "string" && !enemyById(data, entry.id)) msgs.push(`${at}reinforcements[${i}].id: nieznany wróg "${entry.id}"`);
    });
  }
  for (const field of ["onFlee", "onDefeat"]) {
    if (typeof def[field] === "string" && !known.has(def[field])) msgs.push(`${at}${field}: nieznana scena "${def[field]}"`);
  }
  if (def.training === true && !(def.nonLethal === true && def.canFlee === false)) msgs.push(`${at}training: wymaga nonLethal: true i canFlee: false`);
  if (Array.isArray(def.loot)) def.loot.forEach((entry, i) => msgs.push(...validateLoot(entry, `${at}loot[${i}]`, data)));
  return msgs;
}

/** Scene types an event's scene list may not use. */
const EVENT_FORBIDDEN = ["travel", "character_creation", "ending", "save_point", "map"];

/**
 * Validates a scene list: the story (default) or an event's scenes (`event: true`, `prefix` = `travel.json › events › <id>`).
 * In an event `goto: "koniec"` ends the event, some scene types are forbidden, the character always exists, and an id
 * already used in `taken` (story + earlier events) is an error.
 */
function validateScenes(scenes, vars, data, { prefix: listPrefix = "story.json", event = false, taken = new Set() } = {}) {
  const errors = [];
  const ids = new Set();
  const known = new Set(scenes.map((s) => s?.id).filter((id) => typeof id === "string"));
  if (event) known.add(EVENT_END);
  let creatorSeen = event;
  scenes.forEach((scene, index) => {
    const id = typeof scene?.id === "string" ? scene.id : null;
    const prefix = `${listPrefix} › ${id ?? `#${index}`}`;
    if (id !== null) {
      if (event && id === EVENT_END) errors.push(`${prefix}: id sceny „${EVENT_END}” jest zarezerwowane (kończy zdarzenie)`);
      if (ids.has(id)) errors.push(`${prefix}: zduplikowane id`);
      else if (taken.has(id)) errors.push(`${prefix}: id sceny ${JSON.stringify(id)} już zajęte`);
      ids.add(id);
      taken.add(id);
    }
    if (!isPlainObject(scene)) {
      errors.push(`${prefix}: oczekiwano obiektu`);
      return;
    }
    if (scene.type === undefined) {
      errors.push(`${prefix} › type: brak wymaganego pola`);
      return;
    }
    const schema = Object.hasOwn(SCENE_TYPES, scene.type) ? SCENE_TYPES[scene.type] : null;
    if (!schema) {
      errors.push(`${prefix} › type: nieznany typ sceny ${JSON.stringify(scene.type)}`);
      return;
    }
    // `if` shape errors come from the schema; the condition content only from validateCondition.
    const msgs = check(scene, schema);
    if (isPlainObject(scene.if)) msgs.push(...validateCondition(scene.if, "if", conditionOpts(data, vars)));
    if (vars && scene.type === "var" && isPlainObject(scene.add)) {
      for (const name of Object.keys(scene.add)) {
        if (!vars.includes(name)) msgs.push(`add.${name}: nieznana zmienna "${name}"`);
      }
    }
    msgs.push(...artRefErrors(data, scene.art, "scene"));
    if (Number.isInteger(scene.waitUntil) && scene.waitUntil > 23) msgs.push("waitUntil: wartość większa niż 23");
    if (scene.type === "reward") msgs.push(...validateReward(scene, data));
    if (scene.type === "effect") msgs.push(...validateEffectScene(scene, data));
    if (scene.type === "shop" && typeof scene.shop === "string" && !(data?.shops ?? []).some((x) => x?.id === scene.shop)) {
      msgs.push(`shop: nieznany sklep "${scene.shop}"`);
    }
    if (scene.type === "dialogue" && typeof scene.dialogue === "string" && !(data?.dialogues ?? []).some((x) => x?.id === scene.dialogue)) {
      msgs.push(`dialogue: nieznana rozmowa "${scene.dialogue}"`);
    }
    if (scene.type === "combat") msgs.push(...validateCombatDef(scene, "", known, data));
    if (scene.type === "travel" && typeof scene.route === "string" && !routeById(data, scene.route)) msgs.push(`route: nieznana trasa "${scene.route}"`);
    if (scene.type === "quest") msgs.push(...validateQuestScene(scene, data));
    if (scene.type === "map") {
      const hub = typeof scene.hub === "string" ? locationById(data, scene.hub) : null;
      if (typeof scene.hub === "string" && !hub) msgs.push(`hub: nieznana lokacja "${scene.hub}"`);
      if (typeof scene.arriveAt === "string" && !locationById(data, scene.arriveAt)) msgs.push(`arriveAt: nieznana lokacja "${scene.arriveAt}"`);
      if (typeof scene.leaves === "string" && !locationById(data, scene.leaves)) msgs.push(`leaves: nieznana lokacja "${scene.leaves}"`);
      for (const id of Array.isArray(scene.starts) ? scene.starts : []) if (!questById(data, id)) msgs.push(`starts: nieznane zadanie "${id}"`);
      if (hub?.temporary) msgs.push("hub: lokacja tymczasowa nie może być punktem postoju");
      if (isPlainObject(scene.exitWhen)) {
        if (typeof scene.exitWhen.goto === "string" && !known.has(scene.exitWhen.goto)) msgs.push(`exitWhen.goto: nieznana scena "${scene.exitWhen.goto}"`);
        if (isPlainObject(scene.exitWhen.if)) msgs.push(...validateCondition(scene.exitWhen.if, "exitWhen.if", conditionOpts(data, vars)));
      }
      if (isPlainObject(scene.main) && typeof scene.main.goto === "string" && !known.has(scene.main.goto)) msgs.push(`main.goto: nieznana scena "${scene.main.goto}"`);
    }
    if (scene.type === "phenomenon" && typeof scene.phenomenon === "string" && !phenomenonById(data, scene.phenomenon)) {
      msgs.push(`phenomenon: nieznane zjawisko "${scene.phenomenon}"`);
    }
    if (scene.type === "dialogue" && isPlainObject(scene.onCombat)) msgs.push(...validateCombatDef(scene.onCombat, "onCombat.", known, data));
    if (typeof scene.goto === "string") {
      if (!known.has(scene.goto)) msgs.push(`goto: nieznana scena "${scene.goto}"`);
      else if (scene.goto === scene.id) msgs.push("goto: scena wskazuje samą siebie");
    }
    if (event && EVENT_FORBIDDEN.includes(scene.type)) msgs.push("type: scena niedozwolona w zdarzeniu");
    if (scene.type === "character_creation") creatorSeen = true;
    else if ((scene.type === "reward" || scene.type === "effect" || scene.type === "rest" || scene.type === "shop" || scene.type === "dialogue" || scene.type === "combat") && !creatorSeen) {
      msgs.push("type: scena wymaga postaci – brak wcześniejszej sceny character_creation");
    }
    errors.push(...msgs.map((m) => `${prefix} › ${m}`));
  });
  return errors;
}

/** Class start kit: items exist, equipped entries fit their slot and come from startItems. */
function validateStartKit(c, data) {
  const errors = [];
  const at = (field) => `classes.json › ${c.id} › ${field}`;
  const owned = new Set();
  if (Array.isArray(c.startItems)) {
    c.startItems.forEach((entry, i) => {
      if (!isPlainObject(entry) || typeof entry.id !== "string") return;
      owned.add(entry.id);
      if (!itemById(data, entry.id)) errors.push(`${at(`startItems[${i}].id`)}: nieznany przedmiot ${JSON.stringify(entry.id)}`);
    });
  }
  if (isPlainObject(c.startEquipped)) {
    for (const [slot, id] of Object.entries(c.startEquipped)) {
      if (typeof id !== "string") continue;
      const field = at(`startEquipped.${slot}`);
      const item = itemById(data, id);
      if (!SLOTS.includes(slot)) errors.push(`${field}: nieznany slot ${JSON.stringify(slot)}`);
      else if (!item) errors.push(`${field}: nieznany przedmiot ${JSON.stringify(id)}`);
      else if (!slotAccepts(item, slot)) errors.push(`${field}: przedmiot nie pasuje do slotu`);
      else if (!owned.has(id)) errors.push(`${field}: przedmiot spoza startItems`);
    }
  }
  return errors;
}

/** Class `masteryStart`: known mastery types, values 0–`rules.combat.mastery.max` (the limit is skipped when the rules block is absent: the schema reports that). */
function validateMasteryStart(c, data) {
  const errors = [];
  if (!isPlainObject(c.masteryStart)) return errors;
  const max = data.rules?.combat?.mastery?.max;
  for (const [type, v] of Object.entries(c.masteryStart)) {
    const at = `classes.json › ${c.id} › masteryStart.${type}`;
    if (!MASTERY_TYPES.includes(type)) errors.push(`${at}: nieznany rodzaj ${JSON.stringify(type)}`);
    else if (typeof v === "number" && typeof max === "number" && v > max) errors.push(`${at}: wartość większa niż ${max}`);
  }
  return errors;
}

/** Shop stock: existing, visible, unique items; `buys` lists known item types. */
function validateShop(s, data) {
  const errors = [];
  const at = (field) => `shops.json › ${s.id} › ${field}`;
  const seen = new Set();
  if (Array.isArray(s.stock)) {
    s.stock.forEach((entry, i) => {
      if (!isPlainObject(entry) || typeof entry.id !== "string") return;
      const item = itemById(data, entry.id);
      if (!item) errors.push(`${at(`stock[${i}].id`)}: nieznany przedmiot ${JSON.stringify(entry.id)}`);
      else if (item.hidden) errors.push(`${at(`stock[${i}].id`)}: przedmiot ukryty`);
      else if (item.type === "artifact" && entry.qty > 1) errors.push(`${at(`stock[${i}].qty`)}: artefakt może wystąpić najwyżej raz`);
      if (seen.has(entry.id)) errors.push(`${at(`stock[${i}].id`)}: powtórzony przedmiot ${JSON.stringify(entry.id)}`);
      seen.add(entry.id);
    });
  }
  if (Array.isArray(s.buys)) {
    s.buys.forEach((type, i) => {
      if (typeof type === "string" && !ITEM_TYPES.includes(type)) errors.push(`${at(`buys[${i}]`)}: nieznany typ przedmiotu ${JSON.stringify(type)}`);
    });
  }
  if (Array.isArray(s.priceModifiers)) {
    s.priceModifiers.forEach((m, i) => {
      if (!isPlainObject(m)) return;
      const path = `priceModifiers[${i}]`;
      if (isPlainObject(m.if)) errors.push(...validateCondition(m.if, `${path}.if`, conditionOpts(data)).map((msg) => `shops.json › ${s.id} › ${msg}`));
      for (const key of ["buyPercent", "sellPercent"]) {
        if (Number.isInteger(m[key]) && Math.abs(m[key]) > 90) errors.push(`${at(`${path}.${key}`)}: wartość poza zakresem −90…90`);
      }
      if (m.buyPercent === undefined && m.sellPercent === undefined) errors.push(`${at(path)}: wymagane buyPercent lub sellPercent`);
    });
  }
  return errors;
}

function validateGameplayData(data) {
  const errors = [];
  const [attrErrors, attrIds] = validateRecords("attributes.json", data.attributes, ATTRIBUTE_SCHEMA);
  const [skillErrors, skillIds] = validateRecords("skills.json", data.skills, SKILL_SCHEMA);
  const [classErrors] = validateRecords("classes.json", data.classes, CLASS_SCHEMA);
  const [perkErrors] = validateRecords("perks.json", data.perks, PERK_SCHEMA);
  const [shopErrors] = validateRecords("shops.json", data.shops, SHOP_SCHEMA);
  errors.push(...attrErrors, ...skillErrors, ...classErrors, ...perkErrors, ...shopErrors);
  const each = (list, fn) => Array.isArray(list) && list.forEach((item) => isPlainObject(item) && typeof item.id === "string" && fn(item));
  each(data.skills, (s) => {
    for (const field of ["primary", "secondary"]) {
      if (typeof s[field] === "string" && !attrIds.has(s[field])) {
        errors.push(`skills.json › ${s.id} › ${field}: nieznany atrybut ${JSON.stringify(s[field])}`);
      }
    }
  });
  each(data.classes, (c) => {
    if (typeof c.taggedSkill === "string" && !skillIds.has(c.taggedSkill)) {
      errors.push(`classes.json › ${c.id} › taggedSkill: nieznana umiejętność ${JSON.stringify(c.taggedSkill)}`);
    }
  });
  each(data.classes, (c) => {
    if (isPlainObject(c.modifiers)) errors.push(...validateModifiers(c.modifiers, `classes.json › ${c.id} › modifiers`, data));
  });
  each(data.classes, (c) => errors.push(...validateMasteryStart(c, data)));
  each(data.classes, (c) => errors.push(...validateStartKit(c, data)));
  each(data.shops, (s) => errors.push(...validateShop(s, data)));
  each(data.perks, (p) => {
    if (isPlainObject(p.modifiers)) errors.push(...validateModifiers(p.modifiers, `perks.json › ${p.id} › modifiers`, data));
    if (Array.isArray(p.unlocks) && Array.isArray(data.rules?.unlocks)) {
      p.unlocks.forEach((u, i) => {
        if (typeof u === "string" && !data.rules.unlocks.includes(u)) {
          errors.push(`perks.json › ${p.id} › unlocks[${i}]: nieznane odblokowanie ${JSON.stringify(u)}`);
        }
      });
    }
    if (!isPlainObject(p.requires)) return;
    for (const key of Object.keys(isPlainObject(p.requires.attributes) ? p.requires.attributes : {})) {
      if (!attrIds.has(key)) errors.push(`perks.json › ${p.id} › requires.attributes.${key}: nieznany atrybut ${JSON.stringify(key)}`);
    }
    for (const key of Object.keys(isPlainObject(p.requires.skills) ? p.requires.skills : {})) {
      if (!skillIds.has(key)) errors.push(`perks.json › ${p.id} › requires.skills.${key}: nieznana umiejętność ${JSON.stringify(key)}`);
    }
  });
  if (Array.isArray(data.rules?.vars)) {
    const seen = new Set();
    for (const v of data.rules.vars) {
      if (seen.has(v)) errors.push(`rules.json › vars: zduplikowana zmienna ${JSON.stringify(v)}`);
      seen.add(v);
    }
  }
  errors.push(...validateEffects(data.effects, data));
  errors.push(...validateEnemies(data.enemies, data));
  errors.push(...validatePhenomena(data.phenomena, data));
  errors.push(...validateArt(data.art));
  errors.push(...validateItems(data.items, data));
  errors.push(...validateLootTables(data.loot, data));
  errors.push(...validateRules(data, attrIds));
  errors.push(...validateDialogues(data.dialogues ?? [], data));
  return errors;
}

function validateRules(data, attrIds) {
  const errors = [];
  const { creator, timeOfDay, shop, dialogue, exposure } = data.rules ?? {};
  if (isPlainObject(exposure)) {
    const pct = exposure.thiefMoneyPercent;
    if (Array.isArray(pct) && !(pct.length === 2 && pct.every(Number.isInteger) && pct[0] <= pct[1] && pct[1] <= 100)) {
      errors.push("rules.json › exposure.thiefMoneyPercent: oczekiwano [min, max] 0–100");
    }
    if (typeof exposure.catchAttribute === "string" && !attrIds.has(exposure.catchAttribute)) {
      errors.push(`rules.json › exposure.catchAttribute: nieznany atrybut ${JSON.stringify(exposure.catchAttribute)}`);
    }
  }
  for (const key of ["buyBase", "sellBase"]) {
    if (isPlainObject(shop) && typeof shop[key] === "number" && shop[key] <= 0) {
      errors.push(`rules.json › shop.${key}: wartość musi być większa niż 0`);
    }
  }
  if (isPlainObject(dialogue) && Number.isInteger(dialogue.chanceMin) && Number.isInteger(dialogue.chanceMax) && dialogue.chanceMin > dialogue.chanceMax) {
    errors.push("rules.json › dialogue: chanceMin większe niż chanceMax");
  }
  if (isPlainObject(dialogue) && Number.isInteger(dialogue.chanceMax) && dialogue.chanceMax > 100) {
    errors.push("rules.json › dialogue: chanceMax większe niż 100");
  }
  if (isPlainObject(creator)) {
    for (const key of Object.keys(isPlainObject(creator.gifts) ? creator.gifts : {})) {
      if (!attrIds.has(key)) errors.push(`rules.json › creator.gifts.${key}: nieznany atrybut ${JSON.stringify(key)}`);
    }
    if (Number.isInteger(creator.attributeMin) && Number.isInteger(creator.attributeMax) && creator.attributeMin > creator.attributeMax) {
      errors.push("rules.json › creator: attributeMin większe niż attributeMax");
    }
  }
  if (Array.isArray(timeOfDay)) {
    const covered = new Array(24).fill(0);
    let coverable = true;
    timeOfDay.forEach((entry, i) => {
      if (!isPlainObject(entry)) {
        coverable = false;
        return;
      }
      if (isPlainObject(entry.modifiers)) {
        errors.push(...validateModifiers(entry.modifiers, `rules.json › timeOfDay[${i}].modifiers`, data));
      }
      const { from, to } = entry;
      if (!Number.isInteger(from) || !Number.isInteger(to)) {
        coverable = false;
        return;
      }
      let inRange = true;
      for (const [key, value] of [["from", from], ["to", to]]) {
        if (value > 23) {
          errors.push(`rules.json › timeOfDay[${i}].${key}: wartość poza zakresem 0–23`);
          inRange = false;
        }
      }
      if (!inRange) {
        coverable = false;
        return;
      }
      if (from === to) {
        errors.push(`rules.json › timeOfDay[${i}]: from i to nie mogą być równe`);
        coverable = false;
        return;
      }
      for (let h = 0; h < 24; h++) if (from < to ? h >= from && h < to : h >= from || h < to) covered[h]++;
    });
    if (coverable) {
      covered.forEach((n, h) => {
        if (n === 0) errors.push(`rules.json › timeOfDay: godzina ${h} nie jest pokryta`);
        else if (n > 1) errors.push(`rules.json › timeOfDay: godzina ${h} pokryta wielokrotnie`);
      });
    }
  }
  return errors;
}

const vars = (data) => (Array.isArray(data.rules?.vars) ? data.rules.vars : undefined);

/** `quest` scene: exactly one of start / complete / fail, naming a known quest. */
function validateQuestScene(scene, data) {
  const keys = ["start", "complete", "fail", "report"].filter((k) => scene[k] !== undefined);
  if (keys.length !== 1) return ["quest: wymagane dokładnie jedno z start / complete / fail / report"];
  const id = scene[keys[0]];
  return typeof id === "string" && !questById(data, id) ? [`${keys[0]}: nieznane zadanie "${id}"`] : [];
}

/** Region maps: every `{id}` token names a location; every near location appears in its region's map. */
function validateMaps(data) {
  if (!isPlainObject(data.maps)) return [];
  const errors = [];
  const locations = Array.isArray(data.travel?.locations) ? data.travel.locations : [];
  const tokens = {};
  for (const [region, text] of Object.entries(data.maps)) {
    tokens[region] = new Set([...String(text).matchAll(/\{([a-z0-9_]+)\}/g)].map((m) => m[1]));
    for (const id of tokens[region]) if (!locations.some((l) => l?.id === id)) errors.push(`maps/${region}.txt: token {${id}} – nieznana lokacja`);
  }
  for (const l of locations) {
    if (l?.near && !tokens[l.region]?.has(l.id)) errors.push(`maps/${l.region}.txt: brak lokacji ${l.id} na mapie`);
  }
  return errors;
}

/**
 * travel.json and quests.json (map, events, event and quest scenes – scene ids unique across story, events and quests;
 * event ids unique across travel.json and the quests) and the `rules.travel` values.
 */
function validateTravelData(data) {
  const errors = [...validateTravel(data.travel, data), ...validateQuests(data.quests, data)];
  const taken = new Set((Array.isArray(data.story?.scenes) ? data.story.scenes : []).map((s) => s?.id));
  const eventIds = new Set();
  const sceneList = (scenes, prefix) => {
    if (Array.isArray(scenes) && scenes.length > 0) errors.push(...validateScenes(scenes, vars(data), data, { prefix, event: true, taken }));
  };
  const events = (list, prefix) => {
    for (const e of Array.isArray(list) ? list : []) {
      if (typeof e?.id !== "string") continue;
      if (eventIds.has(e.id)) errors.push(`${prefix} › ${e.id}: id zdarzenia już zajęte`);
      eventIds.add(e.id);
      sceneList(e.scenes, `${prefix} › ${e.id}`);
    }
  };
  events(data.travel?.events, "travel.json › events");
  for (const l of Array.isArray(data.travel?.locations) ? data.travel.locations : []) {
    for (const v of Array.isArray(l?.visitors) ? l.visitors : []) sceneList(v?.scenes, `travel.json › locations › ${l.id} › visitors › ${v?.id}`);
    for (const s of Array.isArray(l?.spots) ? l.spots : []) {
      if (s?.type === "scene" || s?.type === "hunt") sceneList(s.scenes, `travel.json › locations › ${l.id} › spots › ${s.id}`);
      if (s?.ambush && typeof s.ambush === "object") sceneList(s.ambush.scenes, `travel.json › locations › ${l.id} › spots › ${s.id} › ambush`);
    }
  }
  errors.push(...validateMaps(data));
  for (const q of Array.isArray(data.quests) ? data.quests : []) {
    if (typeof q?.id !== "string") continue;
    events(q.events, `quests.json › ${q.id} › events`);
    sceneList(q.scenes, `quests.json › ${q.id}`);
  }
  const t = data.rules?.travel;
  if (isPlainObject(t)) {
    const at = (field) => `rules.json › travel.${field}`;
    for (const field of ["eventChance", "dangerousEventChance", "localEventChance", "localDangerBonus"]) {
      if (Number.isInteger(t[field]) && t[field] > 100) errors.push(`${at(field)}: wartość poza zakresem 0–100`);
    }
    if (Number.isInteger(t.walkMaxEvents) && t.walkMaxEvents > 5) errors.push(`${at("walkMaxEvents")}: wartość poza zakresem 1–5`);
    if (isPlainObject(t.repeat)) {
      if (typeof t.repeat.decay === "number" && t.repeat.decay >= 1) errors.push(`${at("repeat.decay")}: wartość poza zakresem (0, 1)`);
      for (const field of ["floorWalk", "floorStage"]) {
        if (Number.isInteger(t.repeat[field]) && t.repeat[field] > 100) errors.push(`${at(`repeat.${field}`)}: wartość poza zakresem 1–100`);
      }
    }
    if (isPlainObject(t.forage) && Number.isInteger(t.forage.max) && t.forage.max > 100) errors.push(`${at("forage.max")}: wartość poza zakresem 0–100`);
    if (Number.isInteger(t.departHour) && t.departHour > 23) errors.push(`${at("departHour")}: wartość większa niż 23`);
    const r = t.eventHourRange;
    if (Array.isArray(r) && Number.isInteger(t.marchHours) && !(r.length === 2 && r.every(Number.isInteger) && r[0] >= 0 && r[0] <= r[1] && r[1] < t.marchHours)) {
      errors.push(`${at("eventHourRange")}: oczekiwano [a, b], 0 ≤ a ≤ b < marchHours`);
    }
    // Weather delays come on top: the limit is on the route as written.
    const max = t.maxRouteDays;
    for (const r of Array.isArray(data.travel?.routes) && Number.isInteger(max) ? data.travel.routes : []) {
      if (Number.isInteger(r?.days) && r.days > max) errors.push(`travel.json › routes › ${r.id} › days: więcej niż ${max} dni (rules.travel.maxRouteDays)`);
    }
    if (typeof t.startLocation === "string" && !locationById(data, t.startLocation)) errors.push(`${at("startLocation")}: nieznana lokacja ${JSON.stringify(t.startLocation)}`);
  }
  return errors;
}

/** Validates loaded data; returns a list of error messages (empty = valid). */
export function validateData(data) {
  const errors = [];
  errors.push(...check(data.ui, UI_SCHEMA).map((m) => `ui.json › ${m}`));
  errors.push(...check(data.rules, RULES_SCHEMA).map((m) => `rules.json › ${m}`));
  for (const [part, entry] of Object.entries(isPlainObject(data.rules?.combat?.aimed) ? data.rules.combat.aimed : {})) {
    if (isPlainObject(entry) && typeof entry.effect === "string" && !(data.effects ?? []).some((e) => e?.id === entry.effect)) {
      errors.push(`rules.json › combat.aimed.${part}.effect: nieznany efekt ${JSON.stringify(entry.effect)}`);
    }
  }
  if (Number.isInteger(data.rules?.startHour) && data.rules.startHour > 23) {
    errors.push("rules.json › startHour: wartość większa niż 23");
  }
  errors.push(...validateGameplayData(data));
  const { story } = data;
  const storyShape = {
    type: "object",
    required: ["start", "scenes"],
    fields: { start: { type: "string" }, scenes: { type: "array" } },
    additional: false,
  };
  errors.push(...check(story, storyShape).map((m) => `story.json › ${m}`));
  if (Array.isArray(story?.scenes)) {
    if (story.scenes.length === 0) {
      errors.push("story.json › scenes: pusta lista scen");
    } else {
      errors.push(...validateScenes(story.scenes, vars(data), data));
      const ids = story.scenes.map((s) => s?.id);
      if (typeof story.start === "string" && !ids.includes(story.start)) {
        errors.push(`story.json › start: nieznana scena "${story.start}"`);
      }
    }
  }
  errors.push(...validateTravelData(data));
  return errors;
}
