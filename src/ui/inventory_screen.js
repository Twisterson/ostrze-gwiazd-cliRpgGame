import { select, sliders } from "./menu.js";
import { confirm, pressEnter } from "./prompt.js";
import { clear, pushNotice, flushNotices, framesOn, showScreen } from "./screen.js";
import { pushEventNotices } from "./events.js";
import { paint } from "./colors.js";
import { compareLines } from "./item_compare.js";
import { sceneWidth, cell, fitWidth } from "./frame.js";
import { t } from "./strings.js";
import { itemById, isWeapon, SLOTS } from "../systems/items.js";
import { artifactState } from "../systems/artifacts.js";
import { phenomenonById } from "../systems/phenomena.js";
import { getStats } from "../systems/stats.js";
import { DAMAGE_TYPES } from "../systems/modifiers.js";
import {
  equip, unequip, swapWeapons, assignQuick, unassignQuick, removeItem, useConsumable,
  carriedWeight, isOverloaded, freeCount, quickCapacity,
} from "../systems/inventory.js";

const round1 = (n) => Math.round(n * 10) / 10;
const signed = (n) => (n > 0 ? `+${n}` : `-${Math.abs(n)}`);

function modifierName(key, data) {
  const named = [...data.attributes, ...data.skills].find((e) => e.id === key);
  if (named) return named.name;
  const effectName = (id) => (data.effects ?? []).find((e) => e.id === id)?.name ?? id;
  const resist = /^resist_(.+)$/.exec(key);
  if (resist) return t(data.ui, "modifier.resist", { name: effectName(resist[1]) });
  const duration = /^effectDuration_(.+)$/.exec(key);
  if (duration) return t(data.ui, "modifier.duration", { name: effectName(duration[1]) });
  return data.ui[`derived.${key}`] ?? key;
}

/** Name of an artifact regeneration condition ("noc", "w pobliżu upiora", "podczas: Iskrząca Burza"). */
function conditionName(when, data) {
  const { ui } = data;
  if (when.startsWith("phenomenon:")) {
    const id = when.slice("phenomenon:".length);
    return t(ui, "artifact.when.phenomenon", { name: phenomenonById(data, id)?.name ?? id });
  }
  if (when.startsWith("near:")) {
    const tag = when.slice("near:".length);
    return ui[`artifact.when.near.${tag}`] ?? t(ui, "artifact.when.near", { tag });
  }
  return t(ui, `artifact.when.${when}`);
}

/** Artifact lines of the item card: charge, regeneration with its conditions, passives (met ones marked), abilities with costs. */
function artifactLines(item, state, data) {
  const { ui } = data;
  const max = item.charge.max;
  const charge = Math.floor(artifactState(state, item.id)?.charge ?? item.charge.start);
  const pctOf = (n) => Math.floor((n / max) * 100);
  const conditions = (item.regen.conditions ?? []).map((c) => ` · ${conditionName(c.when, data)} ×${c.multiplier}`).join("");
  const lines = [
    paint("mystic", t(ui, "card.charge", { charge, max, pct: pctOf(charge) })),
    t(ui, "card.regen", { perHour: item.regen.perHour, conditions }) + (item.regen.requiresExposure ? t(ui, "card.regenExposure") : ""),
  ];
  for (const p of item.passive ?? []) {
    const list = Object.entries(p.modifiers).map(([key, value]) => (typeof value === "number" ? `${modifierName(key, data)} ${signed(value)}` : modifierName(key, data)));
    lines.push(t(ui, "card.passive", { mark: charge >= p.minCharge ? t(ui, "card.passiveMet") : "", pct: pctOf(p.minCharge), list: list.join(", ") }));
  }
  for (const a of item.abilities ?? []) {
    const cost = a.cost.type === "all" ? t(ui, "card.costAll") : t(ui, a.cost.type === "fixed" ? "card.costFixed" : "card.costPercent", { n: a.cost.value });
    lines.push(t(ui, "card.ability", { name: a.name, cost: cost + (a.requiresFull ? t(ui, "card.costFull") : ""), ap: a.apCost })
      + (a.effect.target === "enemy" ? t(ui, "card.abilityTarget") : ""));
    if (a.description) lines.push(`  ${a.description}`);
  }
  if (item.whenEmpty?.usable) lines.push(t(ui, "card.whenEmpty", { hp: item.whenEmpty.costHp }));
  return lines;
}

/** Pure: the item card (type, weight, value, combat/armor stats, artifact charge and powers, description) as text. */
export function renderItemCard(item, state, data) {
  const { ui } = data;
  const lines = [
    paint("title", item.name),
    t(ui, "card.type", { type: t(ui, `itemType.${item.type}`), weight: item.weight, value: item.value, currency: t(ui, "currency.short") }),
  ];
  if (isWeapon(item)) {
    const [min, max] = item.damage;
    lines.push(t(ui, "card.weapon", {
      min, max, damageType: t(ui, `damage.${item.damageType}`), ap: item.apCost, range: t(ui, `range.${item.range}`),
    }));
    if (item.minStrength > 0) lines.push(t(ui, "card.minStrength", { n: item.minStrength }));
  } else if (item.type === "armor") {
    if (item.armor) lines.push(t(ui, "card.armor", { armor: item.armor }));
    const reduction = DAMAGE_TYPES.filter((type) => item.reduction?.[type] > 0)
      .map((type) => `${t(ui, `damage.${type}`)} ${item.reduction[type]}%`);
    if (reduction.length) lines.push(t(ui, "card.reduction", { list: reduction.join(", ") }));
  } else if (item.type === "consumable") {
    if (item.heal) lines.push(t(ui, "card.heal", { min: item.heal[0], max: item.heal[1], ap: item.apCost }));
    if (item.food) lines.push(...foodLines(item, data));
  } else if (item.type === "throwable") {
    lines.push(t(ui, "card.throw", { ap: item.apCost }));
  }
  if (item.type === "artifact") lines.push(...artifactLines(item, state, data));
  const modifiers = Object.entries(item.modifiers ?? {})
    .map(([key, value]) => (typeof value === "number" ? `${modifierName(key, data)} ${signed(value)}` : modifierName(key, data)));
  if (modifiers.length) lines.push(t(ui, "card.modifiers", { list: modifiers.join(", ") }));
  lines.push(...compareLines(item, state, data));
  lines.push(item.description);
  return lines.join("\n");
}

/** Slots in which `itemId` is worn. */
const wornIn = (state, itemId) => SLOTS.filter((slot) => state.inventory.equipped[slot] === itemId);

/** Runs `fn` on a copy of the state to learn whether the action would fail, and why. */
function reasonFor(state, fn) {
  const r = fn(structuredClone(state));
  return r.ok ? undefined : r.reason;
}

/** The slots as they sit on the body, row by row: one side, the body's middle, the other side. */
const DOLL = [["talizman", "glowa", "plaszcz"], ["bron", "tulow", "bron_druga"], ["rece", "pas", "bron_zapas"], [null, "nogi", null]];
/** The schematic needs this many rows of the window; a smaller one keeps the slots in one line, so an item's card still fits. */
const DOLL_MIN_ROWS = 30;
const DOLL_MAX_CELL = 26;

/** What a slot's box says: the worn item in colour (an artifact with its charge, the belt with its places taken), or "pusto". */
function slotContent(slot, state, data, width) {
  const { ui } = data;
  const { equipped } = state.inventory;
  if (slot === "bron_druga" && equipped.bron && itemById(data, equipped.bron).pair) return paint("worn", fitWidth(t(ui, "inv.slotPairHands"), width));
  const id = equipped[slot];
  if (!id) return paint("dim", t(ui, "inv.slotEmpty"));
  const item = itemById(data, id);
  if (slot === "pas") {
    const places = ` ${state.inventory.quickSlots.length}/${quickCapacity(state, data)}`;
    return paint("worn", fitWidth(item.name, width - places.length) + places);
  }
  if (item.type !== "artifact") return paint("worn", fitWidth(item.name, width));
  const charge = artifactState(state, id)?.charge ?? item.charge.start;
  const percent = ` ${Math.floor((charge / item.charge.max) * 100)}%`;
  return paint("mystic", fitWidth(item.name, width - percent.length) + percent);
}

/** The hero's slots as a schematic: a table of boxes with the slot's name in the border and what it holds inside. */
function slotDoll(state, data, width) {
  const { ui } = data;
  const inner = Math.min(DOLL_MAX_CELL, Math.floor((width - 4) / 3)) - 2; // text columns of a box, without the spaces at its sides
  const rule = (text) => paint("frame", text);
  const plain = "─".repeat(inner + 2);
  const across = (slot) => {
    if (!slot) return plain;
    const label = `─ ${fitWidth(t(ui, `slot.${slot}`), inner - 1)} `;
    return label + "─".repeat(Math.max(0, inner + 2 - [...label].length));
  };
  const box = (slot) => ` ${cell(slot ? slotContent(slot, state, data, inner) : "", inner)} `;
  const margin = " ".repeat(inner + 3);
  const lines = [];
  DOLL.forEach((row, r) => {
    if (r === DOLL.length - 1) {
      lines.push(rule(`└${plain}┼${across(row[1])}┼${plain}┘`));
      lines.push(`${margin}${rule("│")}${box(row[1])}${rule("│")}`);
    } else {
      lines.push(rule(`${r ? "├" : "┌"}${row.map(across).join(r ? "┼" : "┬")}${r ? "┤" : "┐"}`));
      lines.push(`${rule("│")}${row.map(box).join(rule("│"))}${rule("│")}`);
    }
  });
  lines.push(`${margin}${rule(`└${plain}┘`)}`);
  return lines;
}

function headerLines(state, data, io) {
  const { ui } = data;
  const stats = getStats(state, data);
  let header = t(ui, "inv.header", {
    weight: round1(carriedWeight(state, data)), carry: stats.derived.carry, money: state.character.money, currency: t(ui, "currency.short"),
  });
  if (isOverloaded(state, data)) header += ` ${paint("warn", t(ui, "inv.overloaded"))}`;
  if (framesOn(io) && io.rows >= DOLL_MIN_ROWS) return [paint("title", header), ...slotDoll(state, data, sceneWidth(io.columns))];
  const eq = state.inventory.equipped;
  const slots = SLOTS.filter((slot) => eq[slot] || slot === "bron" || slot === "bron_zapas")
    .map((slot) => t(ui, "inv.slotEntry", {
      slot: t(ui, `slot.${slot}`),
      item: eq[slot] ? itemById(data, eq[slot]).name + (slot === "pas" ? ` (${state.inventory.quickSlots.length}/${quickCapacity(state, data)})` : "") : t(ui, "inv.none"),
    }));
  return [paint("title", header), slots.join("   ")];
}

/** One list row: name (×qty) with tags for worn slots, belt and strength. */
function listItem(stack, state, data, strength) {
  const { ui } = data;
  const item = itemById(data, stack.id);
  const tags = wornIn(state, stack.id).map((slot) => t(ui, `slot.${slot}`));
  if (state.inventory.quickSlots.includes(stack.id)) tags.push(t(ui, "inv.tagBelt"));
  const heavy = isWeapon(item) && item.minStrength > strength;
  const hint = [tags.length ? `[${tags.join(", ")}]` : "", heavy ? t(ui, "inv.tagHeavy") : ""].filter(Boolean).join(" ");
  return { label: stack.qty > 1 ? `${item.name} ×${stack.qty}` : item.name, ...(hint ? { hint } : {}), ...(wornIn(state, stack.id).length ? { role: "worn" } : {}) };
}

/** The stacks in list order: worn items first, by slot, then the rest as they lie in the bag. Only the view: the bag keeps its order. */
function listedStacks(state, data) {
  const stacks = state.inventory.items.filter((s) => !itemById(data, s.id).hidden);
  const slotOf = (s) => {
    const i = SLOTS.findIndex((slot) => state.inventory.equipped[slot] === s.id);
    return i < 0 ? SLOTS.length : i;
  };
  return stacks.map((s, i) => [slotOf(s), i, s]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , s]) => s);
}

/** Asks for a quantity (slider when more than one free copy) and a confirmation, then drops. */
async function drop(ctx, item) {
  const { io, state, data } = ctx;
  const { ui } = data;
  const free = freeCount(state, item.id);
  let qty = 1;
  if (free > 1) [qty] = await sliders(io, ui, { rows: [{ label: item.name, value: 1, min: 1, max: free }] });
  if (!(await confirm(io, ui, t(ui, "inv.dropConfirm", { item: item.name, qty })))) return;
  const result = removeItem(state, data, item.id, qty);
  pushNotice(ctx, result.ok
    ? t(ui, "inv.dropped", { item: item.name, qty })
    : paint("warn", t(ui, result.reason)));
}

/** Actions available for the item; unavailable ones are disabled with the reason as hint. */
export function actionsFor(item, ctx) {
  const { state, data } = ctx;
  const { ui } = data;
  const id = item.id;
  const acts = [];
  const add = (key, run, reason) => {
    const a = { label: t(ui, key), run };
    if (reason) Object.assign(a, { disabled: true, hint: t(ui, reason), description: t(ui, reason) });
    acts.push(a);
  };
  const apply = (result) => {
    if (!result.ok) { pushNotice(ctx, paint("warn", t(ui, result.reason))); return; }
    if (result.freed) pushNotice(ctx, paint("dim", t(ui, "inv.pairFreed", { item: itemById(data, result.freed).name })));
    if (result.trimmed?.length) {
      const items = result.trimmed.map((tid) => itemById(data, tid).name).join(", ");
      pushNotice(ctx, paint("dim", t(ui, "inv.trimmed", { items })));
    }
  };
  const equipTo = (slot) => () => apply(equip(state, data, id, slot));
  if (isWeapon(item)) {
    add("inv.equipHand", equipTo("bron"), reasonFor(state, (s) => equip(s, data, id, "bron")));
    add("inv.equipBack", equipTo("bron_zapas"), reasonFor(state, (s) => equip(s, data, id, "bron_zapas")));
    if (item.offhand) add("inv.equipOffhand", equipTo("bron_druga"), reasonFor(state, (s) => equip(s, data, id, "bron_druga")));
  } else if (item.type === "armor" || item.type === "artifact") {
    add("inv.equip", equipTo(item.slot), reasonFor(state, (s) => equip(s, data, id, item.slot)));
  }
  if (isWeapon(item) || item.type === "armor" || item.type === "artifact") {
    const worn = wornIn(state, id);
    add("inv.unequip", () => apply(unequip(state, data, worn[0])), worn.length ? undefined : "inv.emptySlot");
  }
  if (isWeapon(item)) {
    const eq = state.inventory.equipped;
    add("inv.swap", () => apply(swapWeapons(state, data)), eq.bron || eq.bron_zapas ? undefined : "inv.emptySlot");
  }
  // Food without healing is not for a fight, so it has no place on the belt.
  if ((item.type === "consumable" || item.type === "throwable") && !(item.food && !item.heal)) {
    add("inv.toBelt", () => apply(assignQuick(state, data, id)), reasonFor(state, (s) => assignQuick(s, data, id)));
    add("inv.fromBelt", () => apply(unassignQuick(state, id)), reasonFor(state, (s) => unassignQuick(s, id)));
  }
  if (item.type === "consumable") {
    add(item.food && !item.heal ? "inv.eat" : "inv.use", () => {
      const r = useConsumable(state, data, id, ctx.rng);
      if (!r.ok) { apply(r); return; }
      if (r.healed > 0 || item.heal) pushNotice(ctx, paint("heal", t(ui, "inv.used", { item: item.name, hp: r.healed })));
      pushEventNotices(ctx, [...r.effects, ...r.events]);
    });
  }
  add("inv.drop", () => drop(ctx, item), item.type === "misc" ? "inv.storyItem" : reasonFor(state, (s) => removeItem(s, data, id, 1))); // a quest item is never thrown away
  add("inv.describe", async () => {
    if (framesOn(ctx.io)) {
      await showScreen(ctx, { lines: renderItemCard(item, state, data).split("\n") });
    } else {
      ctx.io.write(renderItemCard(item, state, data));
      ctx.io.write("");
    }
    await pressEnter(ctx.io, ui); // the list redraw clears the screen
    return "stay";
  });
  return acts;
}

/** "Posiłek na drogę. Psuje się szybko." and the risk of bad food. */
function foodLines(item, data) {
  const { ui } = data;
  const spoils = item.food.order <= 1 ? "fast" : item.food.order === 2 ? "medium" : "slow";
  const lines = [`${t(ui, "card.food")} ${t(ui, `card.food.${spoils}`)}`];
  const risk = item.food.risk;
  if (risk) {
    const skill = data.skills.find((s) => s.id === risk.safeTagged)?.name;
    lines.push(t(ui, skill ? "card.foodRiskSafe" : "card.foodRisk", { chance: risk.chance, skill }));
  }
  return lines;
}

/** Item submenu; returns after one action or "Wróć" ("Opis" comes back to the submenu). */
async function itemMenu(ctx, item) {
  const { io, data } = ctx;
  const { ui } = data;
  let last = 0;
  for (;;) {
    const acts = actionsFor(item, ctx);
    const items = [...acts, { label: t(ui, "inv.back"), hotkey: "w" }];
    const preview = () => [...headerLines(ctx.state, data, io), "", ...renderItemCard(item, ctx.state, data).split("\n")];
    const pick = await select(io, ui, { title: item.name, items, initial: last, preview });
    if (pick === acts.length) return;
    if ((await acts[pick].run()) !== "stay") return;
    last = pick;
    await drawHeader(ctx, false);
  }
}

/** The inventory's header (weight, money, slots); in a frame it fills the scene panel, otherwise it starts a cleared screen. */
async function drawHeader(ctx, notices) {
  const { io, state, data } = ctx;
  if (framesOn(io)) return showScreen(ctx, { lines: headerLines(state, data, io) });
  clear(io);
  for (const line of headerLines(state, data, io)) io.write(line);
  if (notices) flushNotices(ctx);
  io.write("");
}

/** Inventory screen: item list with submenus; returns after "Wróć". */
export async function showInventory(ctx) {
  const { io, state, data } = ctx;
  const { ui } = data;
  let last = 0;
  let lastId = null; // the cursor follows the item: putting it on moves it up the list
  for (;;) {
    await drawHeader(ctx, true);
    const strength = getStats(state, data).attributes.sila;
    const stacks = listedStacks(state, data);
    const same = stacks.findIndex((s) => s.id === lastId);
    if (same >= 0) last = same;
    const items = [...stacks.map((s) => listItem(s, state, data, strength)), { label: t(ui, "inv.back"), hotkey: "w" }];
    // In a frame the card of the item under the cursor shows at once (stats, comparison with the worn item).
    const preview = (cursor) => (stacks[cursor]
      ? [...headerLines(state, data, io), "", ...renderItemCard(itemById(data, stacks[cursor].id), state, data).split("\n")]
      : headerLines(state, data, io));
    const pick = await select(io, ui, { items, initial: last, preview });
    if (pick === stacks.length) return;
    last = pick;
    lastId = stacks[pick].id;
    await itemMenu(ctx, itemById(data, lastId));
  }
}
