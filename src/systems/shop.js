/** Merchant: prices, stock (persisted lazily in world.shops), buying and selling. */
import { itemById } from "./items.js";
import { getStats } from "./stats.js";
import { evaluate } from "../engine/conditions.js";
import { addItem, removeItem, countOf, freeCount, canAdd, assertQty } from "./inventory.js";

const fail = (reason) => ({ ok: false, reason });
const known = (data, id) => {
  const item = itemById(data, id);
  if (!item) throw new Error(`Nieznany przedmiot: ${id}`);
  return item;
};
const shopDef = (data, shopId) => {
  const shop = (data.shops ?? []).find((s) => s.id === shopId);
  if (!shop) throw new Error(`Nieznany sklep: ${shopId}`);
  return shop;
};
const handelOf = (state, data) => getStats(state, data).skills.handel ?? 0;

const NO_ADJUST = { buyPercent: 0, sellPercent: 0 };

/** Sum of the merchant's `priceModifiers` whose condition holds (none → 0/0). */
export function priceAdjust(state, data, shopId) {
  const sum = { buyPercent: 0, sellPercent: 0 };
  for (const m of shopDef(data, shopId).priceModifiers ?? []) {
    if (!evaluate(m.if, state, data)) continue;
    sum.buyPercent += m.buyPercent ?? 0;
    sum.sellPercent += m.sellPercent ?? 0;
  }
  return sum;
}

/** Price (gr) the player pays for one `item` at the given haggling skill and discount. */
export function buyPrice(data, item, handel, adjust = NO_ADJUST) {
  const r = data.rules.shop;
  return Math.max(r.minPrice, Math.round(item.value * (r.buyBase - handel / r.buyHandelDiv) * (1 + adjust.buyPercent / 100)));
}

/** Price (gr) the merchant pays for one `item`; never above the buy price. */
export function sellPrice(data, item, handel, adjust = NO_ADJUST) {
  const r = data.rules.shop;
  const sell = Math.max(r.minPrice, Math.round(item.value * (r.sellBase + handel / r.sellHandelDiv) * (1 + adjust.sellPercent / 100)));
  return Math.min(sell, buyPrice(data, item, handel, adjust));
}

/** Merchant's goods: saved ones or a copy of the definition, without empty entries (never writes). */
export function shopStock(state, data, shopId) {
  const saved = state.world?.shops?.[shopId];
  const src = saved ?? shopDef(data, shopId).stock;
  return src.filter((e) => e.qty > 0).map((e) => ({ id: e.id, qty: e.qty }));
}

/** Persists `stock` as the merchant's current goods, dropping empty entries. */
function saveStock(state, shopId, stock) {
  state.world.shops ??= {};
  state.world.shops[shopId] = stock.filter((e) => e.qty > 0);
}

/** Buys `qty` of `itemId` from the merchant. */
export function buy(state, data, shopId, itemId, qty) {
  const item = known(data, itemId);
  assertQty(qty);
  const stock = shopStock(state, data, shopId);
  const entry = stock.find((e) => e.id === itemId);
  if (!entry || entry.qty < qty) return fail("shop.noStock");
  if (item.type === "artifact" && countOf(state, itemId) + qty > 1) return fail("inv.artifactUnique");
  const cost = buyPrice(data, item, handelOf(state, data), priceAdjust(state, data, shopId)) * qty;
  if (state.character.money < cost) return fail("shop.noMoney");
  if (!canAdd(state, data, itemId, qty)) return fail("inv.tooHeavy");
  entry.qty -= qty;
  state.character.money -= cost;
  addItem(state, data, itemId, qty);
  saveStock(state, shopId, stock);
  return { ok: true, cost };
}

const isBought = (data, shop, item) => shop.buys.includes(item.type) && !item.hidden && item.value > 0;

/** What the merchant would take from the bag: free copies of accepted types, with prices. */
export function sellable(state, data, shopId) {
  const shop = shopDef(data, shopId);
  const handel = handelOf(state, data);
  const adjust = priceAdjust(state, data, shopId);
  const out = [];
  for (const { id } of state.inventory.items) {
    const item = known(data, id);
    const qty = freeCount(state, id);
    if (qty > 0 && isBought(data, shop, item)) out.push({ id, qty, price: sellPrice(data, item, handel, adjust) });
  }
  return out;
}

/** Sells `qty` free copies of `itemId` to the merchant. */
export function sell(state, data, shopId, itemId, qty) {
  const item = known(data, itemId);
  assertQty(qty);
  const shop = shopDef(data, shopId);
  if (countOf(state, itemId) === 0) return fail("inv.notOwned");
  if (!isBought(data, shop, item)) return fail("shop.notBought");
  if (freeCount(state, itemId) < qty) return fail("inv.notFree");
  const gain = sellPrice(data, item, handelOf(state, data), priceAdjust(state, data, shopId)) * qty;
  const stock = shopStock(state, data, shopId);
  const entry = stock.find((e) => e.id === itemId);
  if (entry) entry.qty += qty;
  else stock.push({ id: itemId, qty });
  removeItem(state, data, itemId, qty);
  state.character.money += gain;
  saveStock(state, shopId, stock);
  return { ok: true, gain };
}
