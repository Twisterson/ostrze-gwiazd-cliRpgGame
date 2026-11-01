/** Random loot tables (`data/loot.json`): a weighted pick of an item and its quantity, handed out by the `giveRandom` action. */
import { itemById } from "./items.js";

const ID = /^[a-z0-9_]+$/;
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v) => Number.isInteger(v) && v >= 1;

/** Returns the table with `id`, or undefined. */
export function lootTableById(data, id) {
  return (Array.isArray(data.loot?.tables) ? data.loot.tables : []).find((t) => t?.id === id);
}

/**
 * One draw from the table: a weighted pick (one `rng.int(1, total)` roll), then the quantity (one more roll for a `[min, max]` range).
 * @returns {{ id: string, qty: number }}
 */
export function rollLootTable(data, tableId, rng) {
  const table = lootTableById(data, tableId);
  if (!table) throw new Error(`rollLootTable: nieznana tabela "${tableId}"`);
  let roll = rng.int(1, table.entries.reduce((sum, e) => sum + e.weight, 0));
  const entry = table.entries.find((e) => (roll -= e.weight) <= 0) ?? table.entries.at(-1);
  const qty = Array.isArray(entry.qty) ? rng.int(entry.qty[0], entry.qty[1]) : entry.qty;
  return { id: entry.item, qty };
}

/** Validates loot.json (`{ tables: [{ id, entries: [{ item, qty, weight }] }] }`); returns error messages under `loot.json › <table> › …`. */
export function validateLootTables(loot, data) {
  if (!isObject(loot) || !Array.isArray(loot.tables)) return ["loot.json › tables: oczekiwano tablicy"];
  const errors = [];
  const seen = new Set();
  loot.tables.forEach((table, index) => {
    const id = typeof table?.id === "string" ? table.id : `#${index}`;
    const at = (field) => `loot.json › ${id}${field ? ` › ${field}` : ""}`;
    if (!isObject(table)) return errors.push(`${at()}: oczekiwano obiektu`);
    if (typeof table.id !== "string" || !ID.test(table.id)) errors.push(`${at("id")}: oczekiwano identyfikatora`);
    if (seen.has(id)) errors.push(`${at("id")}: zduplikowane id`);
    seen.add(id);
    if (!Array.isArray(table.entries) || table.entries.length === 0) return errors.push(`${at("entries")}: pusta lista (wymagana co najmniej jedna pozycja)`);
    table.entries.forEach((entry, i) => {
      const here = (field) => at(`entries[${i}].${field}`);
      if (!isObject(entry)) return errors.push(`${at(`entries[${i}]`)}: oczekiwano obiektu`);
      const item = itemById(data, entry.item);
      if (!item) errors.push(`${here("item")}: nieznany przedmiot ${JSON.stringify(entry.item)}`);
      else if (item.hidden) errors.push(`${here("item")}: przedmiot ukryty`);
      if (!isCount(entry.weight)) errors.push(`${here("weight")}: oczekiwano liczby całkowitej ≥ 1`);
      const range = Array.isArray(entry.qty) && entry.qty.length === 2 && entry.qty.every(isCount) && entry.qty[0] <= entry.qty[1];
      if (!isCount(entry.qty) && !range) errors.push(`${here("qty")}: oczekiwano liczby ≥ 1 albo [min, max]`);
      if (item?.type === "artifact" && !(isCount(entry.qty) && entry.qty === 1)) errors.push(`${here("qty")}: artefakt może wypaść najwyżej raz`);
    });
  });
  return errors;
}
