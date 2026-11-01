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
import { wrap } from "./text.js";
import { framesOn, showScreen } from "./screen.js";
import { sceneWidth, visibleWidth, cell, PAGE_BREAK } from "./frame.js";

const DERIVED = ["hpMax", "ap", "defense", "initiative", "carry", "critChance"];
const COLUMN_GAP = 2;

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

/** `[name, value]` rows with the names in one column and the values right-aligned in another. */
function table(rows) {
  const nameWidth = Math.max(0, ...rows.map(([name]) => [...name].length));
  const valueWidth = Math.max(0, ...rows.map(([, value]) => String(value).length));
  return rows.map(([name, value]) => `${name.padEnd(nameWidth)}  ${String(value).padStart(valueWidth)}`);
}

/** A section's title with a rule under it, as wide as the widest of its `rows`. */
const heading = (title, rows) => [paint("heading", title), paint("frame_shade", "─".repeat(Math.max(title.length, ...rows.map(visibleWidth)))), ...rows];

const nameLine = (state, data, stats) => {
  const ch = state.character;
  const cls = data.classes.find((c) => c.id === ch.classId);
  return `${t(data.ui, "status.character", { name: ch.name, level: ch.level, hp: ch.hp, hpMax: stats.derived.hpMax })} (${cls?.name ?? ch.classId})`;
};

const attributesSection = (data, stats, why = () => "") => {
  const rows = table(data.attributes.map((a) => [a.name, stats.attributes[a.id]]));
  return heading(t(data.ui, "char.attributes"), rows.map((row, i) => `${row}${why(data.attributes[i].id)}`));
};

/** The skills, the leading ones marked and coloured whole, with the legend under them. */
const skillsSection = (state, data, stats, why = () => "") => {
  const { tagged } = state.character;
  const rows = table(data.skills.map((s) => [`${tagged.includes(s.id) ? "*" : " "}${s.name}`, stats.skills[s.id]]));
  const lines = rows.map((row, i) => `${tagged.includes(data.skills[i].id) ? paint("leading", row) : row}${why(data.skills[i].id)}`);
  return [...heading(t(data.ui, "char.skills"), lines), paint("leading", `* ${t(data.ui, "char.tagged")}`)];
};

const masterySection = (state, data) => {
  const mastery = state.character.mastery ?? {};
  const types = MASTERY_TYPES.filter((type) => (mastery[type] ?? 0) > 0);
  return types.length ? heading(t(data.ui, "char.mastery"), table(types.map((type) => [t(data.ui, `mastery.${type}`), mastery[type]]))) : [];
};

const effectsSection = (state, data) => {
  const effects = (state.character.effects ?? []).map((e) => ({ e, def: effectById(data, e.id) })).filter((x) => x.def);
  return effects.length ? heading(t(data.ui, "char.effects"), effects.map(({ e, def }) => effectLine(e, def, data.ui))) : [];
};

/** The perks, names in bold, wrapped to `width`. */
const perksSection = (state, data, width = Infinity) => {
  const perks = state.character.perks.map((id) => data.perks.find((p) => p.id === id)).filter(Boolean);
  const rows = perks.flatMap((p) => {
    const lines = Number.isFinite(width) ? wrap(`${p.name} – ${p.description}`, width).split("\n") : [`${p.name} – ${p.description}`];
    lines[0] = paint("title", p.name) + lines[0].slice(p.name.length);
    return lines;
  });
  return [...heading(t(data.ui, "char.perks"), []), ...(perks.length ? rows : [t(data.ui, "char.noPerks")])];
};

const xpLine = (state, data) => paint("xp", `${t(data.ui, "char.xp")}: ${state.character.xp}/${xpToReach(state.character.level + 1, data.rules)}`);

const reductionTypes = (stats) => DAMAGE_TYPES.filter((type) => stats.derived.reduction[type] > 0);

/** Pure: the character sheet as text, with where each value comes from (line mode, the frames have `characterPanels`). */
export function renderCharacter(state, data) {
  const { ui } = data;
  const stats = getStats(state, data);
  const why = (id) => explain(stats.breakdown[id], data);
  const lines = [paint("title", nameLine(state, data, stats)), ""];
  lines.push(...attributesSection(data, stats, why), "", ...skillsSection(state, data, stats, why));

  const reduction = reductionTypes(stats).map((type) => `${t(ui, `damage.${type}`)} ${stats.derived.reduction[type]}%`).join(", ") || t(ui, "char.noReduction");
  const derivedRows = table(DERIVED.map((key) => [t(ui, `derived.${key}`), stats.derived[key]]));
  lines.push("", ...heading(t(ui, "char.derived"), derivedRows.map((row, i) => `${row}${why(DERIVED[i])}`)));
  lines.push(t(ui, "char.armor", { armor: stats.derived.armor, reduction }));
  const weapon = itemById(data, state.inventory?.equipped?.bron ?? "piesci");
  lines.push(t(ui, "char.weapon", { name: weapon?.name ?? "" }));
  const artifact = artifactPercent(state, data);
  if (artifact) lines.push(paint("mystic", t(ui, "char.artifact", { name: artifact.item.name, pct: artifact.pct })));
  const weight = Math.round(carriedWeight(state, data) * 10) / 10;
  lines.push(t(ui, "char.weight", { weight, carry: stats.derived.carry }));

  const mastery = masterySection(state, data);
  if (mastery.length) lines.push("", ...mastery);
  lines.push("", xpLine(state, data));
  const effects = effectsSection(state, data);
  if (effects.length) lines.push("", ...effects);
  lines.push("", ...perksSection(state, data));
  return lines.join("\n");
}

/** Sections one under another, a blank line between them; empty ones are left out. */
const stacked = (sections) => sections.filter((s) => s.length).flatMap((s, i) => (i ? ["", ...s] : s));

/** Columns of lines side by side; only the last one is not padded. */
function besideEachOther(columns) {
  const widths = columns.map((column) => Math.max(0, ...column.map(visibleWidth)));
  const rows = Math.max(...columns.map((column) => column.length));
  return Array.from({ length: rows }, (_, i) => columns
    .map((column, c) => (c === columns.length - 1 ? column[i] ?? "" : cell(column[i] ?? "", widths[c])))
    .join(" ".repeat(COLUMN_GAP)));
}

/**
 * The sheet for a frame: `title` (the name line), `main` (the statistics in as many columns as `width` holds, then the worn artifact,
 * effects and perks – the scene panel, paged when long) and `side` (XP – the choice panel's static block). No source breakdowns
 * (those are in line mode).
 */
export function characterPanels(state, data, { width = Infinity } = {}) {
  const { ui } = data;
  const stats = getStats(state, data);
  const attributes = attributesSection(data, stats);
  const skills = skillsSection(state, data, stats);
  const derived = heading(t(ui, "char.derived"), table([...DERIVED.map((key) => [t(ui, `derived.${key}`), stats.derived[key]]), [t(ui, "char.armorRow"), stats.derived.armor]]));
  const types = reductionTypes(stats);
  const damageName = (type) => { const name = t(ui, `damage.${type}`); return name[0].toUpperCase() + name.slice(1); };
  const reduction = heading(t(ui, "char.reduction"), types.length ? table(types.map((type) => [damageName(type), `${stats.derived.reduction[type]}%`])) : [t(ui, "char.noReduction")]);
  const mastery = masterySection(state, data);

  // From the widest window to the narrowest: rows of columns of sections.
  const layouts = [
    [[[attributes, mastery], [derived, reduction], [skills]]],
    [[[attributes, skills], [derived, reduction, mastery]]],
    [[[attributes, mastery], [skills]], [[derived], [reduction]]],
    [[[attributes, skills, derived, reduction, mastery]]],
  ].map((grid) => grid.map((columns) => columns.map(stacked)));
  const needed = (columns) => columns.reduce((sum, column) => sum + Math.max(...column.map(visibleWidth)), COLUMN_GAP * (columns.length - 1));
  const grid = layouts.find((layout) => layout.every((columns) => needed(columns) <= width)) ?? layouts.at(-1);

  const artifact = artifactPercent(state, data);
  const worn = artifact ? [paint("mystic", t(ui, "char.artifact", { name: artifact.item.name, pct: artifact.pct }))] : [];
  return {
    title: nameLine(state, data, stats),
    main: stacked([grid.flatMap((columns, i) => (i ? ["", PAGE_BREAK, ...besideEachOther(columns)] : besideEachOther(columns))), worn, effectsSection(state, data), perksSection(state, data, width)]),
    side: [xpLine(state, data)],
  };
}

/** Shows the sheet and waits for Enter; in a frame the sheet fills the scene panel and the side block (the frame skips the hero panel). */
export async function showCharacter(ctx) {
  if (framesOn(ctx.io)) {
    const panels = () => characterPanels(ctx.state, ctx.data, { width: sceneWidth(ctx.io.columns) });
    const { title, side } = panels();
    await showScreen(ctx, { title, lines: () => panels().main, side, hero: false });
  } else {
    clear(ctx.io);
    ctx.io.write(renderCharacter(ctx.state, ctx.data));
  }
  await pressEnter(ctx.io, ctx.data.ui);
}
