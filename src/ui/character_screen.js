import { getStats } from "../systems/stats.js";
import { carriedWeight } from "../systems/inventory.js";
import { itemById, MASTERY_TYPES } from "../systems/items.js";
import { effectById } from "../systems/effects.js";
import { phenomenonById } from "../systems/phenomena.js";
import { formatRemaining } from "./events.js";
import { DAMAGE_TYPES } from "../systems/modifiers.js";
import { xpToReach } from "../systems/character.js";
import { clear, artifactPercent } from "./screen.js";
import { pressEnter } from "./prompt.js";
import { paint } from "./colors.js";
import { t } from "./strings.js";
import { stripVTControlCharacters } from "node:util";
import { framesOn, showScreen } from "./screen.js";

const DERIVED = ["hpMax", "ap", "defense", "initiative", "carry", "critChance"];

const signed = (n) => (n > 0 ? `+${n}` : `-${Math.abs(n)}`);

function sourceLabel(source, data) {
  const { ui } = data;
  if (source.kind === "base") return t(ui, "char.base");
  if (source.kind === "timeOfDay") return t(ui, `time.${source.id}`);
  if (source.kind === "item") return itemById(data, source.id)?.name ?? source.id;
  if (source.kind === "effect") return effectById(data, source.id)?.name ?? source.id;
  if (source.kind === "artifact") return itemById(data, source.id)?.name ?? source.id;
  if (source.kind === "phenomenon") return phenomenonById(data, source.id)?.name ?? source.id;
  const list = source.kind === "class" ? data.classes : data.perks;
  return list.find((e) => e.id === source.id)?.name ?? source.id;
}

/** "Zatruty · zostało 4 h ×2"; from a day up the remaining time is "1d 5h" without a unit; no time for effects that do not expire. */
function effectLine(entry, def, ui) {
  if (def.noExpire) return entry.stacks > 1 ? `${def.name} ×${entry.stacks}` : def.name;
  const long = def.unit === "hour" && entry.remaining >= 24;
  const line = long
    ? t(ui, "char.effectLong", { name: def.name, remaining: formatRemaining(ui, entry.remaining) })
    : t(ui, "char.effect", { name: def.name, remaining: entry.remaining, unit: t(ui, `effect.unit.${def.unit}`) });
  return entry.stacks > 1 ? `${line} ×${entry.stacks}` : line;
}

/** "  (baza 5; +1 Szczęściarz; -15 noc)" when something besides the base contributes. */
function explain(entries, data) {
  if (entries.length < 2) return "";
  const [base, ...rest] = entries;
  const parts = [`${t(data.ui, "char.base")} ${base.value}`, ...rest.map((e) => `${signed(e.value)} ${sourceLabel(e.source, data)}`)];
  return `  (${parts.join("; ")})`;
}

/** Pure: the character sheet as text. */
export function renderCharacter(state, data, { brief = false } = {}) {
  const { ui } = data;
  const ch = state.character;
  const stats = getStats(state, data);
  const cls = data.classes.find((c) => c.id === ch.classId);
  const header = t(ui, "status.character", { name: ch.name, level: ch.level, hp: ch.hp, hpMax: stats.derived.hpMax });
  const lines = [paint("title", `${header} (${cls?.name ?? ch.classId})`), ""];

  lines.push(paint("title", t(ui, "char.attributes")));
  for (const a of data.attributes) lines.push(`  ${a.name}  ${stats.attributes[a.id]}${brief ? "" : explain(stats.breakdown[a.id], data)}`);

  lines.push("", paint("title", t(ui, "char.skills")));
  for (const s of data.skills) {
    const mark = ch.tagged.includes(s.id) ? "*" : " ";
    lines.push(` ${mark}${s.name}  ${stats.skills[s.id]}${brief ? "" : explain(stats.breakdown[s.id], data)}`);
  }
  lines.push(paint("dim", `  * ${t(ui, "char.tagged")}`));

  lines.push("", paint("title", t(ui, "char.derived")));
  for (const key of DERIVED) lines.push(`  ${t(ui, `derived.${key}`)}  ${stats.derived[key]}${brief ? "" : explain(stats.breakdown[key], data)}`);

  const reduction = DAMAGE_TYPES.filter((type) => stats.derived.reduction[type] > 0)
    .map((type) => `${t(ui, `damage.${type}`)} ${stats.derived.reduction[type]}%`);
  lines.push(t(ui, "char.armor", { armor: stats.derived.armor, reduction: reduction.length ? reduction.join(", ") : t(ui, "char.noReduction") }));
  const weapon = itemById(data, state.inventory?.equipped?.bron ?? "piesci");
  if (!brief) lines.push(t(ui, "char.weapon", { name: weapon?.name ?? "" }));
  const artifact = artifactPercent(state, data);
  if (artifact) lines.push(paint("mystic", t(ui, "char.artifact", { name: artifact.item.name, pct: artifact.pct })));
  const weight = Math.round(carriedWeight(state, data) * 10) / 10;
  if (!brief) lines.push(t(ui, "char.weight", { weight, carry: stats.derived.carry }));

  const mastery = MASTERY_TYPES.filter((type) => (ch.mastery?.[type] ?? 0) > 0);
  if (mastery.length) {
    lines.push("", paint("title", t(ui, "char.mastery")));
    for (const type of mastery) lines.push(`  ${t(ui, "char.masteryEntry", { name: t(ui, `mastery.${type}`), value: ch.mastery[type] })}`);
  }

  lines.push("", `${t(ui, "char.xp")}: ${ch.xp}/${xpToReach(ch.level + 1, data.rules)}`);

  const effects = (ch.effects ?? []).map((e) => ({ e, def: effectById(data, e.id) })).filter((x) => x.def);
  if (effects.length) {
    lines.push("", paint("title", t(ui, "char.effects")));
    for (const { e, def } of effects) lines.push(`  ${effectLine(e, def, ui)}`);
  }

  lines.push("", paint("title", t(ui, "char.perks")));
  const perks = ch.perks.map((id) => data.perks.find((p) => p.id === id)).filter(Boolean);
  if (perks.length === 0) lines.push(`  ${t(ui, "char.noPerks")}`);
  for (const p of perks) lines.push(`  ${p.name} – ${p.description}`);
  return lines.join("\n");
}

/**
 * The sheet for a frame: `title` (the name line), `main` (attributes, derived values, mastery, effects, perks – the scene panel,
 * paged when long) and `side` (skills and XP – the choice panel's static block). No source breakdowns (those are in line mode).
 */
export function characterPanels(state, data) {
  const { ui } = data;
  const [header, ...sections] = renderCharacter(state, data, { brief: true }).split("\n\n").map((s) => s.split("\n"));
  const sideTitles = new Set([t(ui, "char.skills")]);
  const isSide = (section) => sideTitles.has(stripVTControlCharacters(section[0])) || stripVTControlCharacters(section[0]).startsWith(t(ui, "char.xp"));
  const join = (list) => list.flatMap((s, i) => (i ? ["", ...s] : s));
  return {
    title: stripVTControlCharacters(header[0]),
    main: join(sections.filter((s) => !isSide(s))),
    side: join(sections.filter(isSide)),
  };
}

/** Shows the sheet and waits for Enter; in a frame the sheet fills the scene panel and the side block (the frame skips the hero panel). */
export async function showCharacter(ctx) {
  if (framesOn(ctx.io)) {
    const { title, main, side } = characterPanels(ctx.state, ctx.data);
    await showScreen(ctx, { title, lines: main, side, hero: false });
  } else {
    clear(ctx.io);
    ctx.io.write(renderCharacter(ctx.state, ctx.data));
  }
  await pressEnter(ctx.io, ctx.data.ui);
}
