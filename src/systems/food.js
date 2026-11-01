/** Food: meals eaten from items with `food`, hunger (`glod`) and the risk of bad food. */
import { itemById } from "./items.js";
import { countOf } from "./inventory.js";
import { applyEffect, effectById } from "./effects.js";
import { getStats } from "./stats.js";
import { resetAppetite } from "./appetite.js";

export const HUNGER = "glod";

const fail = (reason) => ({ ok: false, reason });
const foods = (state, data) => state.inventory.items.filter((s) => s.qty > 0 && itemById(data, s.id)?.food);

/** Number of meals in the bag (pieces of food). */
export function mealsLeft(state, data) {
  return foods(state, data).reduce((sum, s) => sum + s.qty, 0);
}

/** Takes one hunger stack away; returns the event (`glod_mniej` or `efekt_koniec`), or null without hunger. */
function easeHunger(state) {
  const effects = state.character.effects ?? [];
  const entry = effects.find((e) => e.id === HUNGER);
  if (!entry) return null;
  entry.stacks -= 1;
  if (entry.stacks > 0) return { type: "glod_mniej", stacks: entry.stacks };
  effects.splice(effects.indexOf(entry), 1);
  return { type: "efekt_koniec", id: HUNGER };
}

/**
 * Eats one piece of food (pinned or not): one hunger stack less, then the item's `risk` (no roll when the character has
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
  resetAppetite(state);
  const events = [{ type: "posilek", id: itemId, left: mealsLeft(state, data) }];
  for (const id of item.applies ?? []) {
    const r = applyEffect(state, data, id, rng);
    events.push({ type: r.resisted ? "efekt_odparty" : "efekt_nalozony", id });
  }
  const eased = easeHunger(state);
  if (eased) events.push(eased);
  const risk = item.food.risk;
  if (risk && !(risk.safeTagged && (state.character.tagged ?? []).includes(risk.safeTagged)) && rng.int(1, 100) <= risk.chance) {
    applyEffect(state, data, risk.effect, rng);
    events.push({ type: "zatrucie_jedzeniem", id: itemId });
  }
  return { ok: true, events };
}

/** The camp meal: the food with the lowest `food.order` (ties: items.json order); none → one more hunger stack. */
export function eatMeal(state, data, rng) {
  const order = (id) => itemById(data, id).food.order;
  const index = (id) => data.items.findIndex((i) => i.id === id);
  const [first] = foods(state, data).map((s) => s.id).sort((a, b) => order(a) - order(b) || index(a) - index(b));
  if (first) return eatItem(state, data, first, rng).events;
  if (!effectById(data, HUNGER)) throw new Error(`eatMeal: brak efektu "${HUNGER}"`);
  const { stacks } = applyEffect(state, data, HUNGER, rng, { force: true });
  // Hunger lowers Krzepa and so the HP maximum: HP follows it down at once (as when armour comes off), never below 1.
  const ch = state.character;
  ch.hp = Math.max(1, Math.min(ch.hp, getStats(state, data).derived.hpMax));
  return [{ type: "glod", stacks }];
}
