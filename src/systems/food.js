/** Food: meals eaten from items with `food`, the stages of hunger that follow the appetite gauge and the risk of bad food. */
import { itemById } from "./items.js";
import { countOf } from "./inventory.js";
import { applyEffect, removeEffect, hasEffect } from "./effects.js";
import { getStats } from "./stats.js";
import { appetiteHour, appetitePercent, appetiteRules, feedAppetite } from "./appetite.js";

export const HUNGER = "glod";
export const HUNGER_LIGHT = "glod_lekki";
export const HUNGER_DYING = "glod_konanie";

const fail = (reason) => ({ ok: false, reason });
const foods = (state, data) => state.inventory.items.filter((s) => s.qty > 0 && itemById(data, s.id)?.food);

/** Number of meals in the bag (pieces of food). */
export function mealsLeft(state, data) {
  return foods(state, data).reduce((sum, s) => sum + s.qty, 0);
}

/** The effects of the gauge's level: light from `hintAt`, full from 100, full and dying from `starveAt`. */
function stageEffects(state, data) {
  const pct = appetitePercent(state, data);
  const { hintAt, starveAt } = appetiteRules(data);
  if (pct >= starveAt) return [HUNGER, HUNGER_DYING];
  if (pct >= 100) return [HUNGER];
  return pct >= hintAt ? [HUNGER_LIGHT] : [];
}

/** Puts the character's hunger effects in line with the gauge; returns `glod_etap` for each new one and `efekt_koniec` for those gone. */
export function syncHunger(state, data, rng) {
  const wanted = stageEffects(state, data);
  const events = [];
  for (const id of [HUNGER_LIGHT, HUNGER, HUNGER_DYING]) {
    const has = hasEffect(state, id);
    if (has && !wanted.includes(id)) {
      removeEffect(state, id);
      events.push({ type: "efekt_koniec", id });
    } else if (!has && wanted.includes(id)) {
      applyEffect(state, data, id, rng, { force: true });
      events.push({ type: "glod_etap", id });
    }
  }
  // Hunger can lower Krzepa and so the HP maximum: HP follows it down at once (as when armour comes off), never below 1.
  const ch = state.character;
  ch.hp = Math.max(1, Math.min(ch.hp, getStats(state, data).derived.hpMax));
  return events;
}

/**
 * Eats one piece of food (pinned or not): 100 points off the gauge and the hunger that follows from it, then the item's `risk` (no roll when the character has
 * `risk.safeTagged` as a tagged skill). Does not move the clock.
 * @returns {{ ok: true, events: object[] } | { ok: false, reason: string }}
 */
export function eatItem(state, data, itemId, rng) {
  const item = itemById(data, itemId);
  if (!item) throw new Error(`eatItem: nieznany przedmiot "${itemId}"`);
  if (countOf(state, itemId) === 0) return fail("inv.notOwned");
  if (!item.food) return fail("inv.notFood");
  const stack = state.inventory.items.find((s) => s.id === itemId);
  stack.qty -= 1;
  if (stack.qty <= 0) {
    state.inventory.items = state.inventory.items.filter((s) => s !== stack);
    state.inventory.quickSlots = state.inventory.quickSlots.filter((id) => id !== itemId);
  }
  feedAppetite(state, data);
  const events = [{ type: "posilek", id: itemId, left: mealsLeft(state, data) }];
  for (const id of item.applies ?? []) {
    const r = applyEffect(state, data, id, rng);
    events.push({ type: r.resisted ? "efekt_odparty" : "efekt_nalozony", id });
  }
  events.push(...syncHunger(state, data, rng));
  const risk = item.food.risk;
  if (risk && !(risk.safeTagged && (state.character.tagged ?? []).includes(risk.safeTagged)) && rng.int(1, 100) <= risk.chance) {
    applyEffect(state, data, risk.effect, rng);
    events.push({ type: "zatrucie_jedzeniem", id: itemId });
  }
  return { ok: true, events };
}

/** The meal eaten by itself: the food with the lowest `food.order` (ties: items.json order); nothing without food. */
export function eatMeal(state, data, rng) {
  const order = (id) => itemById(data, id).food.order;
  const index = (id) => data.items.findIndex((i) => i.id === id);
  const [first] = foods(state, data).map((s) => s.id).sort((a, b) => order(a) - order(b) || index(a) - index(b));
  return first ? eatItem(state, data, first, rng).events : [];
}

/** Hourly hook: the hint from the gauge, a meal eaten by itself once it is full, and the stage of hunger. */
export function hungerHour(state, data, rng) {
  if (!state.character) return [];
  const events = appetiteHour(state, data);
  if (state.inventory && appetitePercent(state, data) >= 100) events.push(...eatMeal(state, data, rng));
  return [...events, ...syncHunger(state, data, rng)];
}
