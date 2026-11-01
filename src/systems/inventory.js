/** Inventory: bag stacks, equipment slots, quick belt, carried weight and the starting kit. */
import { itemById, slotAccepts, SLOTS } from "./items.js";
import { getStats } from "./stats.js";
import { advanceTime } from "../engine/time.js";
import { applyEffect, removeEffect } from "./effects.js";
import { registerArtifact } from "./artifacts.js";
import { eatItem } from "./food.js";

const QUICK_TYPES = ["consumable", "throwable"];

const known = (data, id) => {
  const item = itemById(data, id);
  if (!item) throw new Error(`Nieznany przedmiot: ${id}`);
  return item;
};
/** Programmer error guard: quantities are positive integers. */
export function assertQty(qty) {
  if (!Number.isInteger(qty) || qty < 1) throw new Error(`Nieprawidłowa ilość: ${qty}`);
}
const fail = (reason) => ({ ok: false, reason });

/** Number of items `itemId` in the bag (equipped ones included). */
export function countOf(state, itemId) {
  return state.inventory.items.find((s) => s.id === itemId)?.qty ?? 0;
}

/** Number of slots in which `itemId` is currently worn. */
export function equippedCount(state, itemId) {
  return Object.values(state.inventory.equipped).filter((id) => id === itemId).length;
}

/** Copies of `itemId` that are in the bag but not worn. */
export function freeCount(state, itemId) {
  return countOf(state, itemId) - equippedCount(state, itemId);
}

/** Adds `qty` to the bag, merging stacks; does not check weight. An artifact is unique: a second copy is refused, the first creates its charge entry. */
export function addItem(state, data, itemId, qty) {
  const item = known(data, itemId);
  assertQty(qty);
  if (item.type === "artifact") {
    if (countOf(state, itemId) + qty > 1) return fail("inv.artifactUnique");
    registerArtifact(state, item);
  }
  const stack = state.inventory.items.find((s) => s.id === itemId);
  if (stack) stack.qty += qty;
  else state.inventory.items.push({ id: itemId, qty });
  return { ok: true };
}

/** Removes `qty` free copies; drops the empty stack and its quick-belt entry. */
export function removeItem(state, data, itemId, qty) {
  known(data, itemId);
  assertQty(qty);
  if (freeCount(state, itemId) < qty) return fail("inv.notFree");
  const inv = state.inventory;
  const stack = inv.items.find((s) => s.id === itemId);
  stack.qty -= qty;
  if (stack.qty <= 0) {
    inv.items = inv.items.filter((s) => s !== stack);
    inv.quickSlots = inv.quickSlots.filter((id) => id !== itemId);
  }
  return { ok: true };
}

/** Belt capacity of the worn belt (0 without a belt). */
export function quickCapacity(state, data) {
  const belt = state.inventory.equipped.pas;
  return belt ? itemById(data, belt)?.quickSlots ?? 0 : 0;
}

/** Cuts the quick belt to its capacity; returns the ids moved back to the bag. */
function trimQuick(state, data) {
  const inv = state.inventory;
  const cap = quickCapacity(state, data);
  const trimmed = inv.quickSlots.slice(cap);
  inv.quickSlots = inv.quickSlots.slice(0, cap);
  return trimmed;
}

/** Keeps hp within the (possibly lowered) maximum, at least 1. */
function clampHp(state, data) {
  const ch = state.character;
  if (!ch) return;
  ch.hp = Math.max(1, Math.min(ch.hp, getStats(state, data).derived.hpMax));
}

/** Wears a free copy of `itemId` in `slot`, replacing what was there. */
export function equip(state, data, itemId, slot) {
  const item = known(data, itemId);
  if (!SLOTS.includes(slot)) throw new Error(`Nieznany slot: ${slot}`);
  if (countOf(state, itemId) === 0) return fail("inv.notOwned");
  if (!slotAccepts(item, slot)) return fail("inv.wrongSlot");
  // A spare of the same kind as the weapon in hand (sword and sword, spears and spears) would be no choice at all.
  const inHand = state.inventory.equipped.bron ? known(data, state.inventory.equipped.bron) : null;
  if (slot === "bron_zapas" && item.masteryType && inHand?.masteryType === item.masteryType) return fail("inv.sameKind");
  if (slot === "bron_druga" && inHand?.pair) return fail("inv.pairHands");
  // The copy already in this slot does not count against availability.
  const current = state.inventory.equipped[slot] === itemId ? 1 : 0;
  if (freeCount(state, itemId) + current < 1) return fail("inv.noFreeCopy");
  state.inventory.equipped[slot] = itemId;
  const freed = freeOffhand(state, data);
  const trimmed = trimQuick(state, data);
  clampHp(state, data);
  return { ok: true, trimmed, ...(freed && { freed }) };
}

/** A pair of weapons takes both hands: with one in hand the off-hand weapon goes back to the bag. Returns its id, if there was one. */
function freeOffhand(state, data) {
  const eq = state.inventory.equipped;
  if (!eq.bron_druga || !eq.bron || !known(data, eq.bron).pair) return null;
  const id = eq.bron_druga;
  delete eq.bron_druga;
  return id;
}

/** Takes off whatever is in `slot`. */
export function unequip(state, data, slot) {
  if (!state.inventory.equipped[slot]) return fail("inv.emptySlot");
  delete state.inventory.equipped[slot];
  const trimmed = trimQuick(state, data);
  clampHp(state, data);
  return { ok: true, trimmed };
}

/** Destroys what is worn in `slot`: takes it off and removes exactly one copy from the bag (the rest stay). */
export function destroyEquipped(state, data, slot) {
  const id = state.inventory.equipped[slot];
  if (!id) return fail("inv.emptySlot");
  unequip(state, data, slot);
  removeItem(state, data, id, 1);
  return { ok: true, id };
}

/** Swaps the main and spare weapon slots (either may be empty). */
export function swapWeapons(state, data) {
  const eq = state.inventory.equipped;
  const [a, b] = [eq.bron, eq.bron_zapas];
  delete eq.bron;
  delete eq.bron_zapas;
  if (b) eq.bron = b;
  if (a) eq.bron_zapas = a;
  const freed = freeOffhand(state, data);
  return { ok: true, ...(freed && { freed }) };
}

/** Puts a throwable/consumable on the quick belt. */
export function assignQuick(state, data, itemId) {
  const item = known(data, itemId);
  const inv = state.inventory;
  if (countOf(state, itemId) === 0) return fail("inv.notOwned");
  if (!QUICK_TYPES.includes(item.type)) return fail("inv.notQuickType");
  if (inv.quickSlots.includes(itemId)) return fail("inv.alreadyQuick");
  if (inv.quickSlots.length >= quickCapacity(state, data)) return fail("inv.beltFull");
  inv.quickSlots.push(itemId);
  return { ok: true };
}

/** Takes an item off the quick belt (it stays in the bag). */
export function unassignQuick(state, itemId) {
  const inv = state.inventory;
  if (!inv.quickSlots.includes(itemId)) return fail("inv.notQuick");
  inv.quickSlots = inv.quickSlots.filter((id) => id !== itemId);
  return { ok: true };
}

/** Total weight (kg) of everything in the bag. */
export function carriedWeight(state, data) {
  return (state.inventory?.items ?? []).reduce((sum, s) => sum + known(data, s.id).weight * s.qty, 0);
}

/** True when carried weight exceeds the carry capacity. */
export function isOverloaded(state, data) {
  return carriedWeight(state, data) > getStats(state, data).derived.carry;
}

/** True when `qty` of `itemId` still fits under the hard weight limit. */
export function canAdd(state, data, itemId, qty) {
  if (known(data, itemId).unburdened) return true; // a story item (a shard, a Blade from the sky) always fits
  const hardLimit = (getStats(state, data).derived.carry * data.rules.inventory.hardLimitPercent) / 100;
  return carriedWeight(state, data) + known(data, itemId).weight * qty <= hardLimit;
}

/** Uses one consumable outside combat: heals, removes/applies effects (`effects` events), spends one copy (pinned or not), advances the clock unless `advance` is false (combat). */
export function useConsumable(state, data, itemId, rng, { advance = true } = {}) {
  const item = known(data, itemId);
  if (countOf(state, itemId) === 0) return fail("inv.notOwned");
  if (item.type !== "consumable") return fail("inv.notUsable");
  if (item.food && !item.heal) {
    const { events: effects } = eatItem(state, data, itemId, rng);
    const events = advance ? advanceTime(state, data.rules.inventory.useMinutes, data, rng) : [];
    return { ok: true, healed: 0, events, effects };
  }
  const stats = getStats(state, data);
  const skill = item.healSkill ? stats.skills[item.healSkill] ?? 0 : 0;
  const [lo, hi] = item.heal ?? [0, 0];
  const ch = state.character;
  const healed = Math.max(0, Math.min(Math.floor(rng.int(lo, hi) * (1 + skill / 100)), stats.derived.hpMax - ch.hp));
  // The copy goes even when pinned on the belt; removeItem only takes free ones.
  const stack = state.inventory.items.find((s) => s.id === itemId);
  stack.qty -= 1;
  if (stack.qty <= 0) {
    state.inventory.items = state.inventory.items.filter((s) => s !== stack);
    state.inventory.quickSlots = state.inventory.quickSlots.filter((id) => id !== itemId);
  }
  ch.hp += healed;
  const effects = [];
  for (const id of item.removes ?? []) {
    if (removeEffect(state, id).removed) effects.push({ type: "efekt_koniec", id });
  }
  for (const id of item.applies ?? []) {
    const r = applyEffect(state, data, id, rng);
    effects.push({ type: r.resisted ? "efekt_odparty" : "efekt_nalozony", id });
  }
  const events = advance ? advanceTime(state, data.rules.inventory.useMinutes, data, rng) : [];
  return { ok: true, healed, events, effects };
}

/** Gives the class its starting items, equipment, money and quick belt. */
export function grantStartKit(state, data, classId) {
  const cls = data.classes.find((c) => c.id === classId);
  if (!cls) throw new Error(`Nieznana klasa: ${classId}`);
  state.inventory ??= { items: [], equipped: {}, quickSlots: [] };
  for (const { id, qty } of cls.startItems) addItem(state, data, id, qty);
  for (const [slot, id] of Object.entries(cls.startEquipped)) {
    const r = equip(state, data, id, slot);
    if (!r.ok) throw new Error(`Klasa ${classId}: nie da się założyć ${id} w slocie ${slot} (${r.reason})`);
  }
  state.character.money = cls.startMoney;
  // Food stays in the bag: the belt is for combat consumables.
  for (const { id } of cls.startItems) {
    const item = known(data, id);
    if (QUICK_TYPES.includes(item.type) && !item.food) assignQuick(state, data, id);
  }
}
