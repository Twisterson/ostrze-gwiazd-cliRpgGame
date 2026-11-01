/** Hero panel: the frame's top lines – who, when, HP/XP/effects/place, weapons/belt/mystic (AP in a fight). */
import { paint } from "./colors.js";
import { t } from "./strings.js";
import { visibleWidth, fitWidth } from "./frame.js";
import { mysticTags, placeText } from "./screen.js";
import { formatRemaining } from "./events.js";
import { clockOf, timeOfDay } from "../engine/time.js";
import { getStats } from "../systems/stats.js";
import { effectById } from "../systems/effects.js";
import { itemById } from "../systems/items.js";
import { countOf } from "../systems/inventory.js";
import { xpToReach } from "../systems/character.js";
import { appetitePercent } from "../systems/appetite.js";
import { mealsLeft } from "../systems/food.js";

const BAR = 10;
const GAP = "   ";
const pad2 = (n) => String(n).padStart(2, "0");
/** Hunger and tiredness are a warning (yellow), the other effects are bad (red). */
const MILD = new Set(["glod", "zmeczenie"]);

/** `left` + `right` on one line of `width` columns; the right part is dropped when both do not fit; the left part is cut. */
function spread(left, right, width) {
  if (right && visibleWidth(left) + 3 + visibleWidth(right) <= width) {
    return left + " ".repeat(width - visibleWidth(left) - visibleWidth(right)) + right;
  }
  return fitWidth(left, width);
}

function hpText(ui, hp, max) {
  const filled = Math.max(0, Math.min(BAR, Math.round((BAR * hp) / max)));
  const role = hp * 2 > max ? "hp_ok" : hp * 4 > max ? "hp_mid" : "hp_low";
  return `HP ${paint(role, `${"█".repeat(filled)}${"░".repeat(BAR - filled)} ${hp}/${max}`)}`;
}

function effectsText(ui, state, data) {
  const effects = (state.character.effects ?? []).filter((e) => effectById(data, e.id)?.unit === "hour");
  const tags = effects.slice(0, 3).map((e) => {
    const def = effectById(data, e.id);
    const params = { name: def.name, remaining: formatRemaining(ui, e.remaining), stacks: e.stacks };
    const key = `${e.stacks > 1 ? "status.effectStacked" : "status.effect"}${def.noExpire ? "NoTimer" : ""}`;
    return paint(MILD.has(e.id) ? "hp_mid" : "bad", t(ui, key, params));
  });
  if (effects.length > 3) tags.push(t(ui, "status.effectsMore", { n: effects.length - 3 }));
  return tags.join(" ");
}

/** Purse, the appetite gauge (yellow from the hint level) and the meals in the bag. */
function suppliesText(ui, state, data) {
  const pct = appetitePercent(state, data);
  const hunger = t(ui, "hero.hunger", { pct });
  const mark = pct >= (data.rules.appetite?.hintAt ?? 85) ? paint("hp_mid", hunger) : paint("dim", hunger);
  return [t(ui, "hero.money", { n: state.character.money ?? 0, currency: t(ui, "currency.short") }), mark, t(ui, "hero.meals", { n: mealsLeft(state, data) })].join(GAP);
}

function weaponsText(ui, state, data) {
  const eq = state.inventory.equipped;
  const main = itemById(data, eq.bron ?? "piesci").name;
  const off = eq.bron_druga && !(eq.bron && itemById(data, eq.bron).pair) ? ` + ${itemById(data, eq.bron_druga).name}` : "";
  const belt = state.inventory.quickSlots.map((id) => {
    const qty = countOf(state, id);
    return `${itemById(data, id).name}${qty > 1 ? ` ×${qty}` : ""}`;
  });
  return `${t(ui, "hero.weapon", { weapon: main + off })}${GAP}${t(ui, "hero.belt", { belt: belt.length ? belt.join(" · ") : t(ui, "combat.beltEmpty") })}`;
}

/** Mystic tags for the right end of line 2: full, else short, else none. */
function mysticText(state, data, room) {
  for (const short of [false, true]) {
    const text = mysticTags(state, data, { short }).join(" · ");
    if (text && visibleWidth(text) + 3 <= room) return paint("mystic", text);
  }
  return "";
}

/**
 * The hero panel for a frame of `cols` columns: `{ left, right, lines: [l1, l2] }`, or null before the creator.
 * In a fight (`combat` with `playerAp`) line 2 starts with the AP dots.
 */
export function heroPanel(state, data, { cols, combat = null }) {
  const ch = state.character;
  if (!ch) return null;
  const { ui } = data;
  const width = cols - 4;
  const { derived } = getStats(state, data);
  const { day, hour, minute } = clockOf(state.time.minutes);
  const cls = data.classes.find((c) => c.id === ch.classId)?.name ?? ch.classId;
  const left = t(ui, "hero.top", { name: ch.name, level: ch.level, cls });
  const right = `${t(ui, "status.time", { day, hh: pad2(hour), mm: pad2(minute) })} · ${t(ui, `time.${timeOfDay(state.time.minutes, data.rules)}`)}`;

  const effects = effectsText(ui, state, data);
  const head = `${hpText(ui, ch.hp, derived.hpMax)}${GAP}${paint("xp", t(ui, "hero.xp", { xp: ch.xp, next: xpToReach(ch.level + 1, data.rules) }))}`;
  const place = placeText(state, data) ?? "";
  const l1left = effects ? `${head}${GAP}${effects}` : head;
  const withSupplies = `${suppliesText(ui, state, data)}${place ? ` · ${place}` : ""}`;
  // The supplies go before the place; when the line is too narrow for them the place alone stays.
  const l1 = spread(l1left, visibleWidth(l1left) + 3 + visibleWidth(withSupplies) <= width ? withSupplies : place, width);

  let l2left = weaponsText(ui, state, data);
  if (combat) {
    const ap = Math.max(0, Math.min(combat.playerAp, derived.ap));
    const dots = "●".repeat(ap) + "○".repeat(Math.max(derived.ap - ap, 0));
    l2left = `${paint("ap", t(ui, "hero.ap", { bar: dots, ap: combat.playerAp, apMax: derived.ap }))}${GAP}${l2left}`;
  }
  const l2 = spread(l2left, combat ? "" : mysticText(state, data, width - visibleWidth(l2left)), width);
  return { left, right, lines: [l1, l2] };
}
