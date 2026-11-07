import { paint } from "./colors.js";
import { t } from "./strings.js";
import { itemById, isWeapon } from "../systems/items.js";
import { equip } from "../systems/inventory.js";
import { getStats } from "../systems/stats.js";
import { DAMAGE_TYPES } from "../systems/modifiers.js";

const signed = (n) => (n > 0 ? `+${n}` : `-${Math.abs(n)}`);
const delta = (from, to) => paint(to > from ? "heal" : "warn", `${from}→${to} (${signed(Math.round((to - from) * 10) / 10)})`);

/** Slots the item can be worn in, first the one it is compared in; empty for things that are not worn. */
export function wearSlots(item) {
  if (isWeapon(item)) return item.offhand ? ["bron", "bron_druga"] : ["bron"];
  return (item.type === "armor" || item.type === "artifact") && item.slot ? [item.slot] : [];
}

/** "Zakłada się na: Tułów"; empty for things that are not worn. */
export function wearLines(item, ui) {
  const slots = wearSlots(item).map((slot) => t(ui, `slot.${slot}`));
  return slots.length ? [t(ui, "card.wearsOn", { slots: slots.join(` ${t(ui, "card.slotOr")} `) })] : [];
}

/** Display name of a modifier key: an attribute, a skill, a resistance, an effect's duration or a derived value. */
export function modifierName(key, data) {
  const named = [...data.attributes, ...data.skills].find((e) => e.id === key);
  if (named) return named.name;
  const effectName = (id) => (data.effects ?? []).find((e) => e.id === id)?.name ?? id;
  const resist = /^resist_(.+)$/.exec(key);
  if (resist) return t(data.ui, "modifier.resist", { name: effectName(resist[1]) });
  const duration = /^effectDuration_(.+)$/.exec(key);
  if (duration) return t(data.ui, "modifier.duration", { name: effectName(duration[1]) });
  return data.ui[`derived.${key}`] ?? key;
}

const LABEL_WIDTH = 19; // "Redukcja (obuchowe)"
const VALUE_WIDTH = 10; // label + two values fit the scene panel of an 80×24 frame (43 columns)
/** Columns of the table; a narrower panel (beside the wide list of the shop and the inventory) gets one row per value instead. */
export const TABLE_WIDTH = LABEL_WIDTH + 2 * (VALUE_WIDTH + 1);
const fitLabel = (text) => {
  const chars = [...text];
  return (chars.length <= LABEL_WIDTH ? text : `${chars.slice(0, LABEL_WIDTH - 1).join("")}…`).padEnd(LABEL_WIDTH);
};
const signedOrZero = (n) => (n ? signed(n) : "0");

/** Rows of the table as { label, worn, next, score }: `score` > 0 means the new item is better on this row, 0 equal, null not comparable. */
function tableRows(item, worn, data) {
  const { ui } = data;
  const rows = [];
  const number = (label, a, b, format, lowerIsBetter = false) => rows.push({ label, worn: format(a), next: format(b), score: (lowerIsBetter ? a - b : b - a) });
  const kg = (n) => `${n} kg`;
  if (isWeapon(item) && isWeapon(worn)) {
    const span = (w) => `${w.damage[0]}–${w.damage[1]}`;
    const mean = (w) => w.damage[0] + w.damage[1];
    rows.push({ label: t(ui, "compare.damage"), worn: span(worn), next: span(item), score: mean(item) - mean(worn) });
    rows.push({ label: t(ui, "compare.damageType"), worn: t(ui, `damage.${worn.damageType}`), next: t(ui, `damage.${item.damageType}`), score: null });
    number(t(ui, "compare.ap"), worn.apCost, item.apCost, String, true);
    rows.push({ label: t(ui, "compare.range"), worn: t(ui, `range.${worn.range}`), next: t(ui, `range.${item.range}`), score: null });
    if (worn.minStrength || item.minStrength) number(t(ui, "compare.minStrength"), worn.minStrength ?? 0, item.minStrength ?? 0, String, true);
  } else {
    if (worn.armor || item.armor) number(t(ui, "compare.armor"), worn.armor ?? 0, item.armor ?? 0, String);
    for (const type of DAMAGE_TYPES) {
      const [a, b] = [worn.reduction?.[type] ?? 0, item.reduction?.[type] ?? 0];
      if (a || b) number(t(ui, "compare.reduction", { type: t(ui, `damage.${type}`) }), a, b, (n) => `${n}%`);
    }
  }
  const numeric = (it) => Object.entries(it.modifiers ?? {}).filter(([, v]) => typeof v === "number");
  for (const key of new Set([...numeric(worn), ...numeric(item)].map(([k]) => k))) {
    number(modifierName(key, data), worn.modifiers?.[key] ?? 0, item.modifiers?.[key] ?? 0, signedOrZero);
  }
  number(t(ui, "compare.weight"), worn.weight, item.weight, kg, true);
  return rows;
}

/**
 * The table of the item against what is worn in its slot; empty when the slot is empty (bare hands too) or the item is what is worn.
 * Narrower than TABLE_WIDTH it is a list instead: "Obrażenia: 4–8 → 5–10", the values under the label when the row is too long.
 */
function compareTable(item, state, data, width = Infinity) {
  const { ui } = data;
  const wornId = state.inventory.equipped[wearSlot(item)];
  if (!wornId || wornId === item.id) return [];
  const worn = itemById(data, wornId);
  const mark = (row, text) => (row.score === null || row.score === 0 ? text : paint(row.score > 0 ? "heal" : "warn", text));
  if (width < TABLE_WIDTH) {
    const lines = [t(ui, "compare.tableWorn", { item: worn.name })];
    // the narrow form shows what differs (and the weight, always): a row with the same value twice is left out
    const weight = t(ui, "compare.weight");
    for (const row of tableRows(item, worn, data).filter((r) => r.worn !== r.next || r.label === weight)) {
      const values = `${row.worn} → ${mark(row, row.next)}`;
      const one = `${row.label}: ${row.worn} → ${row.next}`;
      if ([...one].length <= width) lines.push(`${row.label}: ${values}`);
      else lines.push(`${row.label}:`, `  ${values}`);
    }
    return lines;
  }
  const cell = (text) => text.padStart(VALUE_WIDTH);
  const lines = [
    t(ui, "compare.tableWorn", { item: worn.name }),
    paint("dim", `${" ".repeat(LABEL_WIDTH)} ${cell(t(ui, "compare.colWorn"))} ${cell(t(ui, "compare.colNew"))}`),
  ];
  for (const row of tableRows(item, worn, data)) {
    const next = mark(row, cell(row.next));
    lines.push(`${fitLabel(row.label)} ${cell(row.worn)} ${next}`);
  }
  return lines;
}

/** Slot the item would be worn in (weapons: the main hand), or null for things that are not worn. */
export function wearSlot(item) {
  if (isWeapon(item)) return "bron";
  return item.type === "armor" || item.type === "artifact" ? item.slot : null;
}

/** Stat changes caused by wearing `itemId` in its slot, as { name, from, to } rows (the item need not be owned yet). */
function statChanges(item, state, data) {
  const slot = wearSlot(item);
  if (!slot) return null;
  const sim = structuredClone(state);
  if (!sim.inventory.items.some((s) => s.id === item.id)) sim.inventory.items.push({ id: item.id, qty: 1 });
  if (sim.inventory.equipped[slot] === item.id) return null; // already worn
  if (!equip(sim, data, item.id, slot).ok) return null;
  const before = getStats(state, data);
  const after = getStats(sim, data);
  const { ui } = data;
  const rows = [];
  const push = (name, from, to) => { if (from !== to) rows.push({ name, from, to }); };
  for (const a of data.attributes) push(a.name, before.attributes[a.id], after.attributes[a.id]);
  for (const s of data.skills) push(s.name, Math.round(before.skills[s.id]), Math.round(after.skills[s.id]));
  for (const key of Object.keys(before.derived)) {
    if (typeof before.derived[key] !== "number") continue;
    push(key === "armor" ? t(ui, "compare.armor") : ui[`derived.${key}`] ?? key, before.derived[key], after.derived[key]);
  }
  for (const type of DAMAGE_TYPES) {
    push(t(ui, "compare.reduction", { type: t(ui, `damage.${type}`) }), before.derived.reduction[type], after.derived.reduction[type]);
  }
  return { rows, replaced: state.inventory.equipped[slot] };
}

/**
 * Pure: lines comparing the item with what is worn in its slot: the table, then "Po założeniu: …" (`diff: false` leaves that out); empty
 * for items that are not worn. `width`: the columns the lines are shown in (see `compareTable`).
 */
export function compareLines(item, state, data, { diff = true, width = Infinity } = {}) {
  if (!state.character || !state.inventory) return [];
  const { ui } = data;
  const slot = wearSlot(item);
  if (!slot) return [];
  if (state.inventory.equipped[slot] === item.id) return [paint("dim", t(ui, "compare.worn"))];
  const table = compareTable(item, state, data, width);
  const changes = statChanges(item, state, data);
  if (!changes || !diff) return table;
  const lines = [...table];
  const replaced = changes.replaced ? itemById(data, changes.replaced) : null;
  if (isWeapon(item) && table.length === 0) { // beside a table the damage is already in it
    const old = replaced && isWeapon(replaced) ? replaced.damage : null;
    lines.push(t(ui, "compare.weapon", {
      damage: `${item.damage[0]}–${item.damage[1]}`,
      old: old ? `${old[0]}–${old[1]} (${replaced.name})` : t(ui, "compare.fists"),
    }));
  }
  const list = changes.rows.map((r) => `${r.name} ${delta(r.from, r.to)}`);
  const head = replaced ? t(ui, "compare.headReplace", { item: replaced.name }) : t(ui, "compare.head");
  lines.push(list.length ? `${head} ${list.join(", ")}` : `${head} ${paint("dim", t(ui, "compare.none"))}`);
  return lines;
}
