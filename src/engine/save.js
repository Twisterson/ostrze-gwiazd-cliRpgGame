import fs from "node:fs/promises";
import path from "node:path";
import { savesDir, SAVE_FORMAT_VERSION } from "../config.js";
import { check } from "./schema.js";
import { clockOf } from "./time.js";
import { effectById } from "../systems/effects.js";
import { itemById, slotAccepts } from "../systems/items.js";
import { countOf, equippedCount, quickCapacity } from "../systems/inventory.js";
import { emptyMastery, startMastery } from "../systems/combat/mastery.js";
import { phenomenonById } from "../systems/phenomena.js";
import { repairTravelState } from "../systems/travel.js";
import { repairQuestState } from "../systems/quests.js";
import { repairPlaces as repairPlaceIds } from "../systems/places.js";
import { spotSceneById } from "../systems/spots.js";

export const SLOTS = ["auto", "1", "2", "3", "crash"];

export class SaveError extends Error {
  constructor(message) {
    super(message);
    this.name = "SaveError";
  }
}

export class LoadError extends Error {
  constructor(message) {
    super(message);
    this.name = "LoadError";
  }
}

/** Migrations from format version v to v + 1 (`data` is optional; v5 → v6 needs the classes for the starting mastery, v6 → v7 the artifacts). */
export const migrations = {
  1: (state) => ({ ...state, version: 2, vars: {} }),
  2: (state) => ({
    ...state,
    version: 3,
    character: state.character ? { ...state.character, money: state.character.money ?? 0 } : state.character,
    inventory: state.inventory ?? { items: [], equipped: {}, quickSlots: [] },
    world: { ...state.world, shops: state.world?.shops ?? {}, claimedRewards: state.world?.claimedRewards ?? [] },
  }),
  3: (state) => ({
    ...state,
    version: 4,
    character: state.character ? { ...state.character, effects: state.character.effects ?? [] } : state.character,
    world: { ...state.world, failedChecks: state.world?.failedChecks ?? [], finishedDialogues: state.world?.finishedDialogues ?? [], dialogueProgress: state.world?.dialogueProgress ?? {} },
  }),
  4: (state) => ({
    ...state,
    version: 5,
    inventory: state.inventory ? { ...state.inventory, loaded: state.inventory.loaded ?? {} } : state.inventory,
  }),
  5: (state, data) => ({
    ...state,
    version: 6,
    character: state.character
      ? { ...state.character, mastery: state.character.mastery ?? startMastery(data?.classes?.find((c) => c.id === state.character.classId)) }
      : state.character,
  }),
  6: (state, data) => ({
    ...state,
    version: 7,
    artifacts: Object.fromEntries((state.inventory?.items ?? [])
      .map((s) => itemById(data ?? {}, s.id))
      .filter((item) => item?.type === "artifact")
      .map((item) => [item.id, { charge: item.charge.start, exposed: false }])),
    world: { ...state.world, phenomenon: null, phenomenonRolledDay: clockOf(state.time?.minutes ?? 0).day },
  }),
  7: (state, data) => ({
    ...state,
    version: 8,
    world: { ...state.world, location: state.world?.location ?? data?.rules?.travel?.startLocation ?? null, travel: null, eventsSeen: [] },
  }),
  // v11: the search level; the miller's errand carries grain, not flour (ids renamed with their progress, flag and item).
  10: (state) => {
    const quests = { ...(state.quests ?? {}) };
    if (quests.maka_dla_mlyna) {
      const old = quests.maka_dla_mlyna;
      quests.zboze_dla_mlyna = { ...old, ...(Array.isArray(old.done) ? { done: old.done.map((o) => (o === "maka" ? "zboze" : o)) } : {}) };
      delete quests.maka_dla_mlyna;
    }
    const flags = { ...(state.flags ?? {}) };
    if (flags.ostap_maka !== undefined) { flags.ostap_zboze = flags.ostap_maka; delete flags.ostap_maka; }
    const items = state.inventory?.items?.map((i) => (i.id === "worek_maki" ? { ...i, id: "worek_zboza" } : i));
    return {
      ...state, version: 11, quests, flags, ...(state.inventory ? { inventory: { ...state.inventory, items } } : {}),
      world: { ...state.world, search: state.world?.search ?? 0 },
    };
  },
  // v12: repeat-pass counters, hunt cooldowns and a walk that can meet several events (`legs` / `events` / `step`).
  11: (state) => {
    const old = state.world?.map?.walk ?? null;
    let walk = null;
    if (old && Array.isArray(old.legs)) walk = old;
    else if (old && old.step >= 1 && old.event) walk = { to: old.to, legs: [0, old.left ?? 0], events: [old.event], step: old.step, eventScene: old.step === 1 ? old.eventScene ?? null : null };
    return {
      ...state, version: 12,
      world: { ...state.world, passes: state.world?.passes ?? {}, hunts: state.world?.hunts ?? {}, ...(state.world?.map ? { map: { ...state.world.map, walk } } : {}) },
    };
  },
  9: (state) => ({
    ...state,
    version: 10,
    world: { ...state.world, discovered: state.world?.discovered ?? [], hinted: state.world?.hinted ?? [] },
  }),
  8: (state) => ({
    ...state,
    version: 9,
    quests: state.quests ?? {},
    world: {
      ...state.world,
      map: null,
      travel: state.world?.travel ? { reverse: false, quest: null, turnBack: false, ...state.world.travel } : state.world?.travel ?? null,
    },
  }),
};

const STATE_SCHEMA = {
  type: "object",
  required: ["version", "seed", "rngState", "time", "scene", "context", "flags", "vars", "world", "quests", "artifacts"],
  fields: {
    artifacts: {
      type: "object",
      values: { type: "object", required: ["charge", "exposed"], fields: { charge: { type: "number" }, exposed: { type: "boolean" } } },
    },
    version: { type: "integer" },
    seed: { type: "integer" },
    rngState: { type: "integer" },
    time: { type: "object", required: ["minutes"], fields: { minutes: { type: "integer", min: 0 } } },
    scene: { type: "object", required: ["id"], fields: { id: { type: "string" } } },
    context: { type: "string" },
    flags: { type: "object", values: { type: "boolean" } },
    vars: { type: "object", values: { type: "integer" } },
    world: { type: "object" },
    quests: { type: "object" },
  },
};

/** Schema of a non-null state.character (null is allowed too). */
const CHARACTER_SCHEMA = {
  type: "object",
  required: ["name", "classId", "level", "xp", "attributes", "skillPoints", "tagged", "perks", "pendingLevelUp", "hp", "money", "effects"],
  fields: {
    name: { type: "string" },
    classId: { type: "string" },
    level: { type: "integer", min: 1 },
    xp: { type: "integer", min: 0 },
    attributes: { type: "object", values: { type: "integer" } },
    skillPoints: { type: "object", values: { type: "integer" } },
    tagged: { type: "array", items: { type: "string" } },
    perks: { type: "array", items: { type: "string" } },
    hp: { type: "integer", min: 0 },
    mastery: { type: "object", values: { type: "number" } },
    money: { type: "integer", min: 0 },
    effects: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "remaining", "stacks"],
        fields: { id: { type: "string" }, remaining: { type: "integer", min: 1 }, stacks: { type: "integer", min: 1 } },
      },
    },
  },
};
const INVENTORY_SCHEMA = {
  type: "object",
  required: ["items", "equipped", "quickSlots", "loaded"],
  fields: {
    items: {
      type: "array",
      items: { type: "object", required: ["id", "qty"], fields: { id: { type: "string" }, qty: { type: "integer", min: 1 } } },
    },
    equipped: { type: "object", values: { type: "string" } },
    quickSlots: { type: "array", items: { type: "string" } },
    loaded: { type: "object", values: { type: "integer", min: 0 } },
  },
};
const WORLD_SCHEMA = {
  type: "object",
  required: ["shops", "claimedRewards", "failedChecks", "finishedDialogues", "dialogueProgress", "finishedCombats", "phenomenonRolledDay", "eventsSeen", "discovered", "hinted"],
  fields: {
    eventsSeen: { type: "array", items: { type: "string" } },
    passes: { type: "object", values: { type: "integer", min: 0 } },
    hunts: { type: "object", values: { type: "integer", min: 0 } },
    ambushes: { type: "object", values: { type: "integer", min: 0 } },
    discovered: { type: "array", items: { type: "string" } },
    hinted: { type: "array", items: { type: "string" } },
    search: { type: "integer", min: 0, max: 100 },
    phenomenonRolledDay: { type: "integer", min: 0 },
    shops: {
      type: "object",
      values: {
        type: "array",
        items: { type: "object", required: ["id", "qty"], fields: { id: { type: "string" }, qty: { type: "integer", min: 0 } } },
      },
    },
    claimedRewards: { type: "array", items: { type: "string" } },
    failedChecks: { type: "array", items: { type: "string" } },
    finishedDialogues: { type: "array", items: { type: "string" } },
    dialogueProgress: { type: "object", values: { type: "string" } },
    finishedCombats: { type: "object", values: { type: "string" } },
  },
};
const PENDING_SCHEMA = {
  type: "object",
  required: ["skillPoints", "perks"],
  fields: { skillPoints: { type: "integer", min: 0 }, perks: { type: "integer", min: 0 }, attributePoints: { type: "integer", min: 0 } },
};

const slotFile = (slot) => path.join(savesDir(), `${slot}.json`);

export async function saveGame(slot, state, rng) {
  if (!SLOTS.includes(slot)) throw new SaveError(`nieznany slot "${slot}"`);
  const file = slotFile(slot);
  const tmp = `${file}.tmp`;
  try {
    const copy = structuredClone(state);
    copy.savedAt = new Date().toISOString();
    copy.rngState = rng.getState();
    await fs.mkdir(savesDir(), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(copy, null, 2));
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw new SaveError(err.message);
  }
}

const fill = (template, vars) => String(template).replace(/\{(\w+)\}/g, (whole, k) => (k in vars ? vars[k] : whole));
const unique = (ids) => [...new Set(ids)];

/**
 * Repairs the inventory and shop stock against the loaded data (unknown items and shops, worn
 * items without a copy or in a wrong slot, a broken quick belt). Mutates `state`; returns Polish
 * warnings, one per repaired category.
 */
export function repairInventory(state, data) {
  const warnings = [];
  const report = (key, ids) => {
    if (ids.length === 0) return;
    const what = fill(data.ui[key], { ids: unique(ids).join(", ") });
    warnings.push(fill(data.ui["load.repaired"], { what }));
  };
  const inv = state.inventory;
  const known = (id) => Boolean(itemById(data, id));

  // 1. unknown items (bag, worn, belt, shop stock) and unknown shops
  const unknownItems = [];
  inv.items = inv.items.filter((s) => known(s.id) || (unknownItems.push(s.id), false));
  for (const [slot, id] of Object.entries(inv.equipped)) {
    if (!known(id)) { unknownItems.push(id); delete inv.equipped[slot]; }
  }
  inv.quickSlots = inv.quickSlots.filter((id) => known(id) || (unknownItems.push(id), false));
  const unknownShops = [];
  const shops = state.world.shops;
  for (const shopId of Object.keys(shops)) {
    if (!(data.shops ?? []).some((s) => s.id === shopId)) {
      unknownShops.push(shopId);
      delete shops[shopId];
      continue;
    }
    shops[shopId] = shops[shopId].filter((e) => known(e.id) || (unknownItems.push(e.id), false));
  }
  report("load.repair.unknownItems", unknownItems);
  report("load.repair.unknownShops", unknownShops);

  // 2. worn in a wrong slot or without a copy in the bag
  const unequipped = [];
  for (const [slot, id] of Object.entries(inv.equipped)) {
    if (!slotAccepts(itemById(data, id), slot)) { unequipped.push(id); delete inv.equipped[slot]; }
  }
  for (const id of unique(Object.values(inv.equipped))) {
    for (const [slot, worn] of Object.entries(inv.equipped)) {
      if (worn === id && equippedCount(state, id) > countOf(state, id)) { unequipped.push(id); delete inv.equipped[slot]; }
    }
  }
  report("load.repair.unequipped", unequipped);

  // 3. quick belt: copies in the bag, no duplicates, within the belt capacity
  const dropped = [];
  const seen = new Set();
  const kept = inv.quickSlots.filter((id) => {
    if (countOf(state, id) === 0 || seen.has(id)) { dropped.push(id); return false; }
    seen.add(id);
    return true;
  });
  const cap = quickCapacity(state, data);
  dropped.push(...kept.slice(cap));
  inv.quickSlots = kept.slice(0, cap);
  report("load.repair.quick", dropped);

  // 4. loaded weapons: only known items with a `reload`, rounds within the capacity
  const badLoaded = [];
  for (const [id, rounds] of Object.entries(inv.loaded)) {
    const capacity = itemById(data, id)?.reload?.capacity;
    if (capacity === undefined) { badLoaded.push(id); delete inv.loaded[id]; }
    else if (rounds > capacity) { badLoaded.push(id); inv.loaded[id] = capacity; }
  }
  report("load.repair.loaded", badLoaded);
  return warnings;
}

/**
 * Repairs the weapon mastery: missing object or kinds become 0, unknown kinds are dropped, values are clamped to 0–`rules.combat.mastery.max`.
 * Mutates `state`; returns Polish warnings (only for dropped or clamped entries).
 */
export function repairMastery(state, data) {
  const char = state.character;
  if (!char) return [];
  const max = data.rules.combat.mastery.max;
  const old = char.mastery ?? {};
  const fixed = emptyMastery();
  const bad = [];
  for (const [type, v] of Object.entries(old)) {
    if (!(type in fixed)) { bad.push(type); continue; }
    fixed[type] = Math.min(max, Math.max(0, v));
    if (fixed[type] !== v) bad.push(type);
  }
  char.mastery = fixed;
  if (bad.length === 0) return [];
  const what = fill(data.ui["load.repair.mastery"], { ids: unique(bad).join(", ") });
  return [fill(data.ui["load.repaired"], { what })];
}

/**
 * Repairs the character's status effects against the loaded data: unknown effects and turn
 * effects (battle-only) are dropped, stacks are capped. Mutates `state`; returns Polish warnings.
 */
export function repairEffects(state, data) {
  const warnings = [];
  const char = state.character;
  if (!char) return warnings;
  const report = (key, ids) => {
    if (ids.length === 0) return;
    const what = fill(data.ui[key], { ids: unique(ids).join(", ") });
    warnings.push(fill(data.ui["load.repaired"], { what }));
  };
  const unknown = [];
  const turn = [];
  const capped = [];
  char.effects = char.effects.filter((e) => {
    const def = effectById(data, e.id);
    if (!def) { unknown.push(e.id); return false; }
    if (def.unit === "turn") { turn.push(e.id); return false; }
    const max = def.stack === "stack" ? (def.maxStacks ?? data.rules.effects.maxStacksDefault) : 1;
    if (e.stacks > max) { e.stacks = max; capped.push(e.id); }
    return true;
  });
  report("load.repair.effectsUnknown", unknown);
  report("load.repair.effectsTurn", turn);
  report("load.repair.effectsStacks", capped);
  return warnings;
}

/**
 * Repairs artifacts and the phenomenon: unknown artifact ids are dropped, charge is clamped to 0…max, `exposed` is reset (saves never happen
 * mid-sleep), an unknown or malformed phenomenon becomes null. Mutates `state`; returns Polish warnings.
 */
export function repairMystic(state, data) {
  const bad = [];
  for (const [id, entry] of Object.entries(state.artifacts)) {
    const item = itemById(data, id);
    if (item?.type !== "artifact") { bad.push(id); delete state.artifacts[id]; continue; }
    const charge = Math.min(item.charge.max, Math.max(0, entry.charge));
    if (charge !== entry.charge) bad.push(id);
    state.artifacts[id] = { charge, exposed: false };
  }
  const p = state.world.phenomenon;
  const valid = p === null || (typeof p === "object" && phenomenonById(data, p.id)
    && ["startsAt", "endsAt", "omenAt"].every((k) => Number.isInteger(p[k])) && ["omenShown", "started"].every((k) => typeof p[k] === "boolean"));
  if (!valid) {
    bad.push(String(p?.id ?? "?"));
    state.world.phenomenon = null;
  }
  if (bad.length === 0) return [];
  const what = fill(data.ui["load.repair.mystic"], { ids: unique(bad).join(", ") });
  return [fill(data.ui["load.repaired"], { what })];
}

/** Repairs the quest log and the map state. Mutates `state`; returns Polish warnings. */
export function repairQuests(state, data) {
  const bad = repairQuestState(state, data);
  if (bad.length === 0) return [];
  const what = fill(data.ui["load.repair.quests"], { ids: unique(bad).join(", ") });
  return [fill(data.ui["load.repaired"], { what })];
}

/** Drops unknown place ids from what the player has discovered or heard of. Mutates `state`; returns Polish warnings. */
export function repairPlaces(state, data) {
  const bad = repairPlaceIds(state, data);
  if (bad.length === 0) return [];
  const what = fill(data.ui["load.repair.places"], { ids: unique(bad).join(", ") });
  return [fill(data.ui["load.repaired"], { what })];
}

/** Repairs the travel part of the world (location, trip, seen events). Mutates `state`; returns Polish warnings. */
export function repairTravel(state, data) {
  const bad = repairTravelState(state, data);
  if (bad.length === 0) return [];
  const what = fill(data.ui["load.repair.travel"], { ids: unique(bad).join(", ") });
  return [fill(data.ui["load.repaired"], { what })];
}

/** A scene by id from the story, the road events, the quests (and their events) or the spots of the locations. */
function sceneAnywhere(data, id) {
  const events = [...(data.travel?.events ?? []), ...(data.quests ?? []).flatMap((q) => q.events ?? [])];
  const lists = [
    data.story.scenes, ...events.map((e) => e.scenes ?? []), ...(data.quests ?? []).map((q) => q.scenes ?? []),
    ...(data.travel?.locations ?? []).flatMap((l) => [...(l.spots ?? []).flatMap((s) => [s.scenes ?? [], s.ambush?.scenes ?? []]), ...(l.visitors ?? []).map((v) => v.scenes ?? [])]),
  ];
  return lists.flat().find((s) => s?.id === id) ?? spotSceneById(data, id);
}

/**
 * Drops saved talk positions that no longer point at a node of a known dialogue scene.
 * Mutates `state`; returns Polish warnings.
 */
export function repairDialogues(state, data) {
  const progress = state.world.dialogueProgress;
  const bad = Object.keys(progress).filter((sceneId) => {
    const scene = sceneAnywhere(data, sceneId);
    const dialogue = scene?.type === "dialogue" ? (data.dialogues ?? []).find((d) => d.id === scene.dialogue) : undefined;
    return !dialogue || !Object.hasOwn(dialogue.nodes, progress[sceneId]);
  });
  for (const id of bad) delete progress[id];
  if (bad.length === 0) return [];
  const what = fill(data.ui["load.repair.dialogueProgress"], { ids: bad.join(", ") });
  return [fill(data.ui["load.repaired"], { what })];
}

export async function loadGame(slot, data, { warnings } = {}) {
  let text;
  try {
    text = await fs.readFile(slotFile(slot), "utf8");
  } catch (err) {
    throw new LoadError(err.code === "ENOENT" ? "brak zapisu" : err.message);
  }
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    throw new LoadError("uszkodzony plik");
  }
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    throw new LoadError("niepoprawna struktura (oczekiwano obiektu)");
  }
  if (Number.isInteger(state.version)) {
    if (state.version > SAVE_FORMAT_VERSION) throw new LoadError("zapis z nowszej wersji gry");
    while (state.version < SAVE_FORMAT_VERSION && migrations[state.version]) {
      const from = state.version;
      state = migrations[from](state, data);
      state.version = from + 1;
    }
  }
  if (Number.isInteger(state.version) && state.version !== SAVE_FORMAT_VERSION) {
    throw new LoadError("niepoprawna struktura (nieobsługiwana wersja zapisu)");
  }
  const errors = check(state, STATE_SCHEMA);
  if (errors.length > 0) throw new LoadError(`niepoprawna struktura (${errors[0]})`);
  if (state.character !== null && state.character !== undefined) {
    const charErrors = check(state.character, CHARACTER_SCHEMA, "character");
    if (charErrors.length === 0 && state.character.pendingLevelUp !== null) {
      charErrors.push(...check(state.character.pendingLevelUp, PENDING_SCHEMA, "character.pendingLevelUp"));
    }
    if (charErrors.length > 0) throw new LoadError(`niepoprawna struktura (${charErrors[0]})`);
    if (!data.classes.some((c) => c.id === state.character.classId)) {
      throw new LoadError(`nieznana klasa "${state.character.classId}"`);
    }
    for (const id of state.character.perks) {
      if (!data.perks.some((p) => p.id === id)) throw new LoadError(`nieznany perk "${id}"`);
    }
  }
  // Saves written before dialogueProgress / finishedCombats existed get the empty default.
  if (typeof state.world === "object" && state.world !== null) {
    state.world.dialogueProgress ??= {};
    state.world.finishedCombats ??= {};
    if (state.world.phenomenon === undefined) state.world.phenomenon = null;
  }
  const invErrors = check(state.inventory, INVENTORY_SCHEMA, "inventory");
  if (invErrors.length === 0) invErrors.push(...check(state.world, WORLD_SCHEMA, "world"));
  if (invErrors.length > 0) throw new LoadError(`niepoprawna struktura (${invErrors[0]})`);
  const repairs = [...repairInventory(state, data), ...repairEffects(state, data), ...repairMastery(state, data), ...repairDialogues(state, data), ...repairMystic(state, data), ...repairTravel(state, data), ...repairQuests(state, data), ...repairPlaces(state, data)];
  if (warnings) warnings.push(...repairs);
  // A save from before the end of act III was rewritten (E2f): the old finale scenes are gone, and the glass scene stands under the
  // old id `akt3b_final`, so a finished talk of the old version must not hide the new one.
  if (state.flags.akt3b_koniec && !state.flags.szklo_wziete && data.story.scenes.some((s) => s.id === "akt3b_final")) {
    if (!data.story.scenes.some((s) => s.id === state.scene.id) && /^koniec_/.test(state.scene.id)) {
      if (warnings) warnings.push(fill(data.ui["load.repaired"], { what: fill(data.ui["load.repair.scene"], { id: state.scene.id }) }));
      state.scene.id = "akt3b_final";
    }
    state.world.finishedDialogues = state.world.finishedDialogues.filter((id) => id !== "akt3b_final");
    delete state.world.dialogueProgress.akt3b_final;
  }
  if (!data.story.scenes.some((s) => s.id === state.scene.id)) {
    // A save from before the story was rewritten: the map scene is where the hub's life goes on.
    if (!data.story.scenes.some((s) => s.id === "demo_mapa")) throw new LoadError(`nieznana scena "${state.scene.id}"`);
    if (warnings) warnings.push(fill(data.ui["load.repaired"], { what: fill(data.ui["load.repair.scene"], { id: state.scene.id }) }));
    state.scene.id = "demo_mapa";
  }
  return state;
}

export async function listSaves(data) {
  const result = [];
  for (const slot of SLOTS) {
    try {
      await fs.access(slotFile(slot));
    } catch {
      continue;
    }
    try {
      const state = await loadGame(slot, data);
      const scene = data.story.scenes.find((s) => s.id === state.scene.id);
      result.push({
        slot,
        ok: true,
        summary: {
          sceneId: state.scene.id,
          sceneTitle: scene.title ?? null,
          day: clockOf(state.time.minutes).day,
          savedAt: state.savedAt,
        },
      });
    } catch (err) {
      if (!(err instanceof LoadError)) throw err;
      result.push({ slot, ok: false, error: err.message });
    }
  }
  return result;
}
