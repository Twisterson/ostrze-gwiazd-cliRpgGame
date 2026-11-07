import { showScreen, clear, statusBar, flushNotices, pushNotice } from "../ui/screen.js";
import { select, sliders } from "../ui/menu.js";
import { confirm } from "../ui/prompt.js";
import { fittedCard } from "../ui/inventory_screen.js";
import { paint } from "../ui/colors.js";
import { t } from "../ui/strings.js";
import { itemById } from "../systems/items.js";
import { getStats } from "../systems/stats.js";
import { carriedWeight, canAdd } from "../systems/inventory.js";
import { buyPrice, priceAdjust, shopStock, buy, sellable, sell } from "../systems/shop.js";
import { MissingCharacterError } from "./errors.js";

const round1 = (n) => Math.round(n * 10) / 10;
const cur = (ui) => ({ currency: t(ui, "currency.short") });
/** The name in a list row: an upgraded item names its highest stage only ("Półpancerz (płyty)"); the card has the full name. */
export const rowName = (item) => item.listName ?? item.name;
/** The description box under the list: an item whose row is shortened gets its full name first ("Półpancerz (skóra, płyty)"). */
const boxText = (item) => (item.listName ? `${item.name}\n${item.description}` : item.description);
/** A stock or sale row: "Kastet · 28 gr", with " · ×N" only when there is more than one. */
const entryLabel = (ui, key, name, price, qty) => t(ui, qty > 1 ? key : `${key}One`, { name, price, qty, ...cur(ui) });

/** Asks for a quantity 1…max (a slider with a live sum when max > 1). */
async function askQty(io, ui, name, max, unit, sumKey = "shop.sum") {
  if (max <= 1) return 1;
  const [qty] = await sliders(io, ui, {
    rows: [{ label: name, value: 1, min: 1, max, note: (v) => t(ui, sumKey, { sum: v * unit, ...cur(ui) }) }],
  });
  return qty;
}

/** Merchant scene: buy / sell / leave. Stock changes persist in world.shops; no camp menu afterwards. */
export async function shop(ctx, scene) {
  const { state, data, io } = ctx;
  const { ui } = data;
  if (!state.character) throw new MissingCharacterError();
  const def = data.shops.find((s) => s.id === scene.shop);
  const handel = () => getStats(state, data).skills.handel ?? 0;

  const render = () => {
    const { buyPercent, sellPercent } = priceAdjust(state, data, def.id);
    const discount = buyPercent < 0 || sellPercent > 0 ? ` ${t(ui, "shop.discount")}` : "";
    const header = paint("title", t(ui, "shop.header", {
      name: def.name, money: state.character.money, ...cur(ui),
      weight: round1(carriedWeight(state, data)), carry: getStats(state, data).derived.carry,
    }) + discount);
    return showScreen(ctx, { lines: [header], blank: false, art: scene.art, wideList: true });
  };

  /** Largest affordable, carriable quantity of a stock entry (0 = none) and why not. */
  const buyLimit = (entry, price) => {
    let max = 0;
    while (max < entry.qty && state.character.money >= price * (max + 1) && canAdd(state, data, entry.id, max + 1)) max++;
    if (max > 0) return { max };
    return { max, reason: state.character.money < price ? "shop.noMoney" : "inv.tooHeavy" };
  };

  async function buyFlow() {
    const stock = shopStock(state, data, def.id);
    if (stock.length === 0) { pushNotice(ctx, t(ui, "shop.empty")); return; }
    const rows = stock.map((entry) => {
      const item = itemById(data, entry.id);
      const price = buyPrice(data, item, handel(), priceAdjust(state, data, def.id));
      const { max, reason } = buyLimit(entry, price);
      const row = { label: entryLabel(ui, "shop.buyEntry", rowName(item), price, entry.qty), description: boxText(item), entry, item, price, max };
      if (reason) Object.assign(row, { disabled: true, hint: t(ui, reason), description: t(ui, reason) });
      return row;
    });
    await render();
    const preview = (cursor) => (rows[cursor] ? fittedCard(rows[cursor].item, state, data, io) : []);
    const pick = await select(io, ui, { items: [...rows, { label: t(ui, "shop.back") }], preview });
    if (pick >= rows.length) return;
    const { item, price, max } = rows[pick];
    const qty = await askQty(io, ui, item.name, max, price);
    const cost = price * qty;
    if (!(await confirm(io, ui, t(ui, "shop.confirmBuy", { name: item.name, qty, cost, ...cur(ui) })))) return;
    const result = buy(state, data, def.id, item.id, qty);
    pushNotice(ctx, result.ok
      ? t(ui, "shop.bought", { name: item.name, qty, cost: result.cost, ...cur(ui) })
      : paint("warn", t(ui, result.reason)));
  }

  async function sellFlow() {
    const list = sellable(state, data, def.id);
    if (list.length === 0) { pushNotice(ctx, t(ui, "shop.empty")); return; }
    const rows = list.map((e) => ({ label: entryLabel(ui, "shop.sellEntry", rowName(itemById(data, e.id)), e.price, e.qty), description: boxText(itemById(data, e.id)) }));
    await render();
    const preview = (cursor) => (list[cursor] ? fittedCard(itemById(data, list[cursor].id), state, data, io) : []);
    const pick = await select(io, ui, { items: [...rows, { label: t(ui, "shop.back") }], preview });
    if (pick >= rows.length) return;
    const { id, qty: free, price } = list[pick];
    const item = itemById(data, id);
    const qty = await askQty(io, ui, item.name, free, price);
    const gain = price * qty;
    if (!(await confirm(io, ui, t(ui, "shop.confirmSell", { name: item.name, qty, gain, ...cur(ui) })))) return;
    const result = sell(state, data, def.id, id, qty);
    pushNotice(ctx, result.ok
      ? t(ui, "shop.sold", { name: item.name, qty, gain: result.gain, ...cur(ui) })
      : paint("warn", t(ui, result.reason)));
  }

  for (;;) {
    await render();
    const choice = await select(io, ui, { items: [{ label: t(ui, "shop.buy") }, { label: t(ui, "shop.sell") }, { label: t(ui, "shop.leave") }] });
    if (choice === 0) await buyFlow();
    else if (choice === 1) await sellFlow();
    else return;
  }
}
