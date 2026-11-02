/** Shared actions of dialogues and events: validation and execution. */
import { addItem, removeItem, freeCount, canAdd } from "./inventory.js";
import { addXp } from "./character.js";
import { addVar } from "./vars.js";
import { applyEffect, removeEffect, effectById } from "./effects.js";
import { itemById } from "./items.js";
import { advanceTime } from "../engine/time.js";
import { getStats } from "./stats.js";
import { placeIds, revealPlace, hintPlace } from "./places.js";
import { addSearch } from "./search.js";
import { questById, startQuest, finishQuest, advanceErrands } from "./quests.js";
import { lootTableById, rollLootTable } from "./loot.js";

import { syncHunger } from "./food.js";
import { resetAppetite } from "./appetite.js";

export const ACTION_KEYS = ["giveItem", "giveRandom", "takeItem", "giveMoney", "takeMoney", "setFlag", "clearFlag", "addVar", "xp", "time", "addEffect", "removeEffect", "healFull", "meal", "reveal", "hint", "startQuest", "completeQuest", "search", "startCombat"];

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v) => Number.isInteger(v) && v >= 1;
const itemRef = (v) => (typeof v === "string" ? { id: v, qty: 1 } : v);

function validateItemRef(value, at, data) {
  const shapeOk = typeof value === "string" || (isObject(value) && typeof value.id === "string" && Object.keys(value).every((k) => k === "id" || k === "qty"));
  if (!shapeOk) return [`${at}: oczekiwano id lub { id, qty }`];
  const { id, qty } = itemRef(value);
  if (qty === undefined) return [`${at}.qty: brak wymaganego pola`];
  if (!isCount(qty)) return [`${at}.qty: oczekiwano liczby całkowitej ≥ 1`];
  const item = itemById(data, id);
  if (!item) return [`${at}: nieznany przedmiot ${JSON.stringify(id)}`];
  if (item.hidden) return [`${at}: przedmiot ukryty`];
  return [];
}

function validateAction(action, at, data) {
  const keys = isObject(action) ? Object.keys(action) : [];
  if (keys.length !== 1) return [`${at}: oczekiwano jednej akcji`];
  const [key] = keys;
  if (!ACTION_KEYS.includes(key)) return [`${at}.${key}: nieznana akcja`];
  const value = action[key];
  const here = `${at}.${key}`;
  switch (key) {
    case "giveItem":
    case "takeItem": return validateItemRef(value, here, data);
    case "giveRandom": return typeof value === "string" && lootTableById(data, value) ? [] : [`${here}: nieznana tabela łupów ${JSON.stringify(value)}`];
    case "giveMoney":
    case "takeMoney":
    case "meal":
    case "xp":
    case "time": return isCount(value) ? [] : [`${here}: oczekiwano liczby całkowitej ≥ 1`];
    case "setFlag":
    case "clearFlag": return typeof value === "string" && value ? [] : [`${here}: oczekiwano tekstu`];
    case "addVar": {
      if (!isObject(value)) return [`${here}: oczekiwano obiektu zmiennych`];
      const errors = [];
      for (const [name, delta] of Object.entries(value)) {
        if (!(data.rules?.vars ?? []).includes(name)) errors.push(`${here}.${name}: nieznana zmienna`);
        else if (!Number.isInteger(delta)) errors.push(`${here}.${name}: oczekiwano liczby całkowitej`);
      }
      return errors;
    }
    case "addEffect":
    case "removeEffect": {
      const def = typeof value === "string" ? effectById(data, value) : undefined;
      if (!def) return [`${here}: nieznany efekt ${JSON.stringify(value)}`];
      if (key === "addEffect" && def.unit !== "hour") return [`${here}: dozwolone tylko efekty godzinowe`];
      return [];
    }
    case "healFull": return value === true ? [] : [`${here}: oczekiwano true`];
    case "reveal":
    case "hint": return placeIds(data).includes(value) ? [] : [`${here}: nieznane miejsce ${JSON.stringify(value)}`];
    case "search": return Number.isInteger(value) && value !== 0 && Math.abs(value) <= 100 ? [] : [`${here}: oczekiwano liczby całkowitej ≠ 0 (−100…100)`];
    case "completeQuest":
    case "startQuest": return typeof value === "string" && questById(data, value) ? [] : [`${here}: nieznane zadanie ${JSON.stringify(value)}`];
    default: return isObject(value) ? [] : [`${here}: oczekiwano obiektu`];
  }
}

/** Validates an actions array; `path` prefixes the messages. Returns error messages. */
export function validateActions(actions, path, data) {
  if (!Array.isArray(actions)) return [`${path}: oczekiwano tablicy`];
  return actions.flatMap((action, i) => validateAction(action, `${path}[${i}]`, data));
}

/**
 * Executes validated actions in order. Items that do not fit are lost (`za_ciezko`);
 * `startCombat` stops the run and hands its object back as `combat`.
 * Level-ups stay in `character.pendingLevelUp` for the after-scene hook.
 * @returns {{ events: object[], combat?: object }}
 */
export function runActions(state, data, actions, rng) {
  const events = [];
  const ch = state.character;
  for (const action of actions) {
    const [key] = Object.keys(action);
    const value = action[key];
    switch (key) {
      case "giveItem": {
        const { id, qty } = itemRef(value);
        // A second copy of an artifact is silently skipped (addItem refuses it; the charge stays).
        if (!canAdd(state, data, id, qty)) { events.push({ type: "za_ciezko", id, qty }); return { events }; } // too heavy: the rest of the node (flags that say "taken") is not run either
        if (addItem(state, data, id, qty).ok) events.push({ type: "otrzymano", id, qty });
        break;
      }
      case "giveRandom": {
        const drawn = runActions(state, data, [{ giveItem: rollLootTable(data, value, rng) }], rng);
        events.push(...drawn.events);
        if (drawn.events.some((e) => e.type === "za_ciezko")) { state.world.heavyLoot = true; return { events }; }
        break;
      }
      case "takeItem": {
        const { id, qty } = itemRef(value);
        const taken = Math.min(qty, freeCount(state, id));
        if (taken > 0) removeItem(state, data, id, taken);
        if (taken > 0) events.push({ type: "oddano", id, qty: taken });
        break;
      }
      case "giveMoney":
        ch.money += value;
        events.push({ type: "pieniadze", delta: value });
        break;
      case "takeMoney": {
        const taken = Math.min(value, ch.money);
        ch.money -= taken;
        if (taken > 0) events.push({ type: "pieniadze", delta: -taken });
        break;
      }
      case "setFlag":
      case "clearFlag":
        state.flags[value] = key === "setFlag";
        events.push({ type: "flaga", id: value, value: key === "setFlag" });
        break;
      case "addVar":
        addVar(state, value);
        events.push({ type: "zmienna", changes: value });
        break;
      case "xp":
        addXp(ch, value, data);
        events.push({ type: "xp", amount: value });
        break;
      case "time":
        events.push(...advanceTime(state, value, data, rng));
        break;
      case "addEffect": {
        const r = applyEffect(state, data, value, rng);
        events.push({ type: r.resisted ? "efekt_odparty" : "efekt_nalozony", id: value });
        break;
      }
      case "removeEffect":
        if (removeEffect(state, value).removed) events.push({ type: "efekt_koniec", id: value });
        break;
      case "healFull": {
        // Full HP and no effects at all (hourly and turn-based): the Entity mends the body.
        ch.effects = []; // first: effects can lower the maximum
        const hpMax = getStats(state, data).derived.hpMax;
        const gained = hpMax - ch.hp;
        ch.hp = hpMax;
        if (gained > 0) events.push({ type: "leczenie", amount: gained });
        break;
      }
      case "meal": {
        // A hot meal at a table: all the hunger gone, the appetite gauge back to zero and `value` HP.
        resetAppetite(state);
        events.push(...syncHunger(state, data, rng));
        const hp = Math.min(value, getStats(state, data).derived.hpMax - ch.hp);
        ch.hp += hp;
        events.push({ type: "goraca_strawa", hp });
        break;
      }
      case "search": addSearch(state, data, value); break;
      case "completeQuest": events.push(...finishQuest(state, data, value, rng)); break;
      case "reveal": events.push(...revealPlace(state, data, value)); break;
      case "hint": events.push(...hintPlace(state, data, value)); break;
      case "startQuest": {
        const started = startQuest(state, data, value);
        events.push(...started, ...advanceErrands(state, data, rng));
        // Refused for lack of room: what the node would hand over with the quest (items, flags) is not given either.
        if (started.some((e) => e.type === "zadanie_limit")) return { events };
        break;
      }
      case "startCombat":
        return { events, combat: value };
    }
  }
  return { events };
}
