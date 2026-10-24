import { showScreen } from "../ui/screen.js";
import { campMenu } from "../ui/camp.js";
import { select } from "../ui/menu.js";
import { showInventory } from "../ui/inventory_screen.js";
import { paint } from "../ui/colors.js";
import { t } from "../ui/strings.js";
import { addXp } from "../systems/character.js";
import { addItem, canAdd, countOf } from "../systems/inventory.js";
import { itemById } from "../systems/items.js";
import { MissingCharacterError } from "./errors.js";

/**
 * Grants experience, money and items once per scene and shows the result (the level-up screen
 * itself is handled after the scene). A too-heavy item can be made room for or left behind.
 */
export async function reward(ctx, scene) {
  const { state, data, io } = ctx;
  const { ui } = data;
  if (!state.character) throw new MissingCharacterError();
  const claimed = state.world.claimedRewards;
  const lines = [];
  const render = () => showScreen(ctx, { lines: lines.map(([style, text]) => paint(style, text)), art: scene.art });

  if (claimed.includes(scene.id)) {
    lines.push(["dim", t(ui, "reward.claimed")]);
    await render();
    await campMenu(ctx, render);
    return;
  }

  const xp = scene.xp ?? 0;
  const money = scene.money ?? 0;
  const entries = (scene.items ?? []).map((e) => (typeof e === "string" ? { id: e, qty: 1 } : { id: e.id, qty: e.qty ?? 1 }));
  const { levelsGained } = addXp(state.character, xp, data);
  state.character.money += money;
  // Marked before the first prompt: an interrupted run (auto/crash save) must not grant XP and money again.
  // Items still pending at that point are forfeited, like "Zostaw".
  claimed.push(scene.id);

  const got = [];
  for (const { id, qty } of entries) {
    const item = itemById(data, id);
    if (item.type === "artifact" && countOf(state, id) > 0) continue; // unique: a second copy is never given
    let taken = true;
    while (!canAdd(state, data, id, qty)) {
      lines.push(["warn", t(ui, "reward.tooHeavy", { item: item.name })]);
      await render();
      lines.pop();
      const pick = await select(io, ui, { items: [{ label: t(ui, "reward.makeRoom") }, { label: t(ui, "reward.leave") }] });
      if (pick === 1) { taken = false; break; }
      await showInventory(ctx);
    }
    if (!taken) continue;
    addItem(state, data, id, qty);
    got.push(t(ui, "reward.partItem", { item: item.name, qty }));
  }
  if (money > 0 || got.length > 0) {
    const parts = [];
    if (xp > 0) parts.push(t(ui, "reward.partXp", { xp }));
    if (money > 0) parts.push(t(ui, "reward.partMoney", { money, currency: t(ui, "currency.short") }));
    parts.push(...got);
    lines.push(["heal", t(ui, "reward.summary", { parts: parts.join(" · ") })]);
  } else if (xp > 0) {
    lines.push(["heal", t(ui, "reward.xp", { xp })]);
  }
  if (levelsGained > 0) lines.push(["mystic", t(ui, "reward.levelUp", { level: state.character.level })]);
  await render();
  await campMenu(ctx, render);
}
