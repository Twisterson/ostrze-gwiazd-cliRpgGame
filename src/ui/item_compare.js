import { paint } from "./colors.js";
import { t } from "./strings.js";
import { itemById, isWeapon } from "../systems/items.js";
import { equip } from "../systems/inventory.js";
import { getStats } from "../systems/stats.js";
import { DAMAGE_TYPES } from "../systems/modifiers.js";

const signed = (n) => (n > 0 ? `+${n}` : `-${Math.abs(n)}`);
const delta = (from, to) => paint(to > from ? "heal" : "warn", `${from}→${to} (${signed(Math.round((to - from) * 10) / 10)})`);

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

/** Pure: lines comparing the item with what is worn in its slot ("Po założeniu: …"); empty for items that are not worn. */
export function compareLines(item, state, data) {
  if (!state.character || !state.inventory) return [];
  const { ui } = data;
  const slot = wearSlot(item);
  if (!slot) return [];
  if (state.inventory.equipped[slot] === item.id) return [paint("dim", t(ui, "compare.worn"))];
  const changes = statChanges(item, state, data);
  if (!changes) return [];
  const lines = [];
  const replaced = changes.replaced ? itemById(data, changes.replaced) : null;
  if (isWeapon(item)) {
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
