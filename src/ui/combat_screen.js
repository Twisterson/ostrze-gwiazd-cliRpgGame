/** The combat screen: a pure renderer (top block, status lines) and the action list for the `select` widget. */
import { clockOf, timeOfDay } from "../engine/time.js";
import { getStats } from "../systems/stats.js";
import { itemById } from "../systems/items.js";
import { effectById } from "../systems/effects.js";
import { countOf } from "../systems/inventory.js";
import { enemyById } from "../systems/combat/data.js";
import { livingEnemies } from "../systems/combat/state.js";
import { paint, graphicsMode } from "./colors.js";
import { renderPixels, tintLines } from "./pixels.js";
import { t } from "./strings.js";
import { formatRemaining } from "./events.js";
import { mysticTags, fitPieces } from "./screen.js";
import { visibleWidth } from "./frame.js";

const BLOCK_ROWS = 7;
const INFO_MIN = 43; // columns the enemies' text needs beside the picture
const LOG_MIN = 8; // rows left for the log below a tall picture

/**
 * The target's picture beside the info, in 256-colour half blocks: `rows` padded to the picture's width plus one, and
 * `left` (that width). Empty without `color`, when there is no picture, when the text would not fit beside it in `width`
 * columns, or when a tall picture would leave fewer than LOG_MIN rows of `height` for the log.
 */
function artColumn(data, target, { color, width, height, minInfo = INFO_MIN }) {
  const image = target && data.art?.[enemyById(data, target.id)?.art];
  const none = { rows: [], left: 0 };
  if (!image || !color) return none;
  const rowCount = image.h / 2;
  if (width < image.w + 1 + minInfo) return none;
  if (rowCount > BLOCK_ROWS + 1 && height !== undefined && height - rowCount < LOG_MIN) return none;
  const left = image.w + 1; // the right column starts after the picture (column 42 for the 40-pixel ones)
  return { rows: tintLines(renderPixels(image, { color: true })).map((row) => row + " ".repeat(Math.max(0, left - visibleWidth(row)))), left };
}
const INFO_HEAD_ROWS = 2; // the target's name and its effects, above the enemy list
const BAR_MAX = 14;
const BAR_MIN = 4;
const LIST_ROWS = 2;
const MIN_LIST_ROWS = 4; // the enemies a frame's panel can always list
const ACTION_HOTKEYS = { attack: "a", reload: "p", use: "u", swap: "z", move: "b", defend: "o", flee: "c", end: "k", log: "l", techniques: "t" };
const NO_COST_HINT = new Set(["use", "end", "log", "techniques"]); // variable or free: the cost is not shown (defend takes all remaining AP, shown as that number)

const pad2 = (n) => String(n).padStart(2, "0");

/** Cuts `text` to `width` characters, ending with "…" when something was dropped. */
function fit(text, width) {
  const chars = [...text];
  return chars.length <= width ? text : `${chars.slice(0, Math.max(width - 1, 0)).join("")}…`;
}

const percent = (hp, hpMax) => (hp <= 0 ? 0 : Math.max(1, Math.round((hp / hpMax) * 100)));

/** "[Zamroczony 2]" / "[Krwawi ×2 3]" tags for effect entries (turn effects count turns, hour effects hours). */
function effectTags(ui, data, effects) {
  return effects.map((e) => {
    const def = effectById(data, e.id);
    const remaining = def?.unit === "hour" ? formatRemaining(ui, e.remaining) : e.remaining;
    return t(ui, e.stacks > 1 ? "combat.effectTagStacked" : "combat.effectTag", { name: def?.name ?? e.id, stacks: e.stacks, remaining });
  });
}

/**
 * The log rows: the last entries, or — when more than fit arrived since the last draw (`logSeen` entries were shown
 * then) — the "(+n wcześniej – [L])" marker followed by the newest entries.
 */
function logLines(data, combat, budget, logSeen) {
  const { log } = combat;
  const fresh = logSeen === undefined ? 0 : log.length - logSeen;
  const tail = (n) => log.map((text, i) => ({ text, role: combat.logRoles?.[i] ?? "dim" })).slice(log.length - n);
  if (fresh <= budget) return { marker: null, entries: tail(Math.min(budget, log.length)) };
  const shown = budget - 1;
  return { marker: t(data.ui, "combat.logMore", { n: fresh - shown }), entries: shown > 0 ? tail(shown) : [] };
}

/** The first `count` of the living enemies, in their order; the target is always among them. */
function listedEnemies(living, target, count) {
  const listed = living.slice(0, count);
  if (target && !listed.includes(target)) listed[count - 1] = target;
  return listed;
}

/** Right column of the top block: target name + HP bar, target effects, enemy list, last log entries. */
function rightColumn(state, data, combat, target, width, logSeen, { listRows = LIST_ROWS, log = true } = {}) {
  const { ui } = data;
  const rows = [];
  const pct = target ? percent(target.hp, target.hpMax) : 0;
  const suffix = ` ${pct}%`;
  const label = `  ${t(ui, "combat.hpBar")} `;
  const name = fit(target?.name.toUpperCase() ?? "", Math.max(width - [...label].length - BAR_MIN - suffix.length, 1));
  const prefix = target ? `${name}${label}` : "";
  const barWidth = Math.max(BAR_MIN, Math.min(BAR_MAX, width - [...prefix].length - suffix.length));
  const filled = target ? Math.ceil((pct / 100) * barWidth) : 0;
  rows.push({ role: "title", text: fit(`${prefix}${"█".repeat(filled)}${"░".repeat(barWidth - filled)}${suffix}`, width) });
  rows.push({ role: "warn", text: fit(target ? effectTags(ui, data, target.effects).join(" ") : "", width) });

  const living = livingEnemies(combat);
  const nameW = Math.max(0, ...living.map((e) => [...e.name].length));
  const entry = (e) => t(ui, "combat.enemyRow", {
    mark: e === target ? t(ui, "combat.targetMark") : " ", n: e.uid.split("#")[1], name: e.name.padEnd(nameW),
    pct: String(percent(e.hp, e.hpMax)).padStart(3), band: t(ui, `range.${e.band === "melee" ? "melee" : "far"}`),
  });
  const shown = living.length <= listRows ? living.map(entry) : [...listedEnemies(living, target, listRows - 1).map(entry), t(ui, "combat.enemiesMore", { n: living.length - (listRows - 1) })];
  for (let i = 0; i < (log ? listRows : Math.min(shown.length, listRows)); i++) rows.push({ role: null, text: fit(shown[i] ?? "", width) });
  if (!log) return rows;

  const logRows = BLOCK_ROWS - rows.length;
  const { marker, entries } = logLines(data, combat, Math.min(data.rules.combat.logSize, logRows), logSeen);
  for (let i = 0; i < logRows - entries.length - (marker ? 1 : 0); i++) rows.push({ role: null, text: "" });
  if (marker) rows.push({ role: "warn", text: fit(marker, width) });
  for (const { text, role } of entries) rows.push({ role, text: fit(`· ${text}`, width) });
  return rows;
}

/** "Dzień 1, 16:20 · dzień · ⚡ Iskrząca Burza · ◆ 64%" as painted pieces (time dim, mystic tags violet). */
function timeLine(state, data) {
  const { day, hour, minute } = clockOf(state.time.minutes);
  const pieces = [[`  ${t(data.ui, "status.time", { day, hh: pad2(hour), mm: pad2(minute) })} · ${t(data.ui, `time.${timeOfDay(state.time.minutes, data.rules)}`)}`, "dim"]];
  for (const tag of mysticTags(state, data, { short: true })) pieces.push([" · ", "dim"], [tag, "mystic"]);
  return pieces;
}

function playerLine(state, data, combat) {
  const { ui } = data;
  const { derived } = getStats(state, data);
  const ap = Math.max(0, Math.min(combat.playerAp, derived.ap));
  const bar = "●".repeat(ap) + "○".repeat(Math.max(derived.ap - ap, 0));
  let line = t(ui, "combat.playerLine", { hp: state.character.hp, hpMax: derived.hpMax, bar, ap: combat.playerAp, apMax: derived.ap });
  const effects = effectTags(ui, data, state.character.effects ?? []);
  if (effects.length) line += `   ${effects.slice(0, 3).join(" ")}${effects.length > 3 ? ` ${t(ui, "status.effectsMore", { n: effects.length - 3 })}` : ""}`;
  return line;
}

function weaponLine(state, data) {
  const { ui } = data;
  const weapon = itemById(data, state.inventory.equipped.bron ?? "piesci");
  const loaded = weapon.reload ? t(ui, (state.inventory.loaded?.[weapon.id] ?? 0) > 0 ? "combat.loaded" : "combat.unloaded") : "";
  const belt = state.inventory.quickSlots.map((id, i) => {
    const qty = countOf(state, id);
    return `${itemById(data, id).name}${qty > 1 ? ` ×${qty}` : ""}`;
  });
  return t(ui, "combat.weaponLine", { weapon: weapon.name, loaded, belt: belt.length ? belt.join(" · ") : t(ui, "combat.beltEmpty") });
}

/**
 * The combat screen above the action list; every line fits in `columns - 2` characters.
 * Only the frame's panel has a picture; without a frame there is just the text.
 * @param {{ columns: number, tty?: boolean, targetUid?: string, logSeen?: number, frame?: boolean }} view (`tty`:
 *   art only on a real terminal; `logSeen`: log length at the previous draw, enables the skipped-entries marker; `frame`:
 *   the scene panel of a frame – see `renderCombatPanel`: `width` and `height` of the panel; the time and the player are in the hero panel)
 * @returns {string[]}
 */
export function renderCombat(state, data, combat, { columns, tty, targetUid, logSeen, frame = false, width, height, color = graphicsMode() !== "none" }) {
  if (frame) return renderCombatPanel(state, data, combat, { tty, targetUid, logSeen, width, height, color });
  const maxWidth = columns - 2;
  const living = livingEnemies(combat);
  const target = living.find((e) => e.uid === targetUid) ?? living[0];
  const block = rightColumn(state, data, combat, target, maxWidth, logSeen).map(({ role, text }) => (role && text ? paint(role, text) : text));
  return [
    ...block, "",
    fitPieces(timeLine(state, data), maxWidth),
    fit(`  ${playerLine(state, data, combat)}`, maxWidth),
    fit(`  ${weaponLine(state, data)}`, maxWidth),
  ];
}

/**
 * The left panel of a combat frame, exactly `height` lines of at most `width` columns: the enemies' block (the target's
 * name and HP bar, effects, the living enemies, the art beside them from 84 columns), an empty line and the newest log entries
 * (with "(+n wcześniej – [L])" when more arrived since the last draw than fit).
 */
function renderCombatPanel(state, data, combat, { tty, targetUid, logSeen, width, height, color }) {
  const living = livingEnemies(combat);
  const target = living.find((e) => e.uid === targetUid) ?? living[0];
  const column = tty ? artColumn(data, target, { color, width, height }) : { rows: [], left: 0 };
  const art = column.rows;
  const left = column.left;
  const withArt = left > 0;
  // Beside the picture the list has the picture's height; without one it leaves rows for the log.
  const room = (withArt ? art.length : height - 1 - LOG_MIN) - INFO_HEAD_ROWS;
  const info = rightColumn(state, data, combat, target, width - left, logSeen, { listRows: Math.max(MIN_LIST_ROWS, room), log: false });
  const blockRows = withArt ? Math.max(BLOCK_ROWS, info.length, art.length) : info.length;
  const block = Array.from({ length: blockRows }, (_, i) => {
    const { role, text } = info[i] ?? { role: null, text: "" };
    const grid = withArt ? art[i] ?? " ".repeat(left) : "";
    return grid + (role && text ? paint(role, text) : text);
  });
  const budget = height - block.length - 1;
  const lines = [...block, ""];
  if (budget > 0) {
    const { marker, entries } = logLines(data, combat, budget, logSeen);
    if (marker) lines.push(paint("warn", fit(marker, width)));
    for (const { text, role } of entries) lines.push(paint(role, fit(`· ${text}`, width)));
  }
  return lines.slice(0, height);
}

/**
 * `select` items for `playerActions(...)`: "[A] Atak (4 PA)"; unavailable ones are greyed with the reason as the hint.
 * @param {Record<string,string>} ui
 * @param {Array<{ id: string, apCost: number, disabled: boolean, reason?: string }>} actions
 */
export function combatActionItems(ui, actions) {
  return actions.map((a) => {
    const item = { label: t(ui, `combat.action.${a.id}`), hotkey: ACTION_HOTKEYS[a.id], description: t(ui, `combat.desc.${a.id}`) };
    if (a.disabled) return { ...item, disabled: true, hint: `(${t(ui, a.reason)})` };
    if (a.id === "flee") return { ...item, hint: `(${a.apCost} PA · ${a.chance}%)` };
    if (a.apCost > 0 && !NO_COST_HINT.has(a.id)) return { ...item, hint: `(${a.apCost} PA)` };
    return item;
  });
}

/** "(4 PA)" for an available entry, "(reason)" and greyed for an unavailable one. */
const costOrReason = (ui, apCost, reason) => (reason ? { disabled: true, hint: `(${t(ui, reason)})` } : { hint: `(${apCost} PA)` });

/**
 * `select` items for `techniqueActions(...)`: "Atak celowany (4 PA)", "Rzuć: Sztylet (2 PA)"; unavailable ones greyed
 * with the reason as the hint. Every item has a description.
 * @param {object} data
 * @param {Array<{ id: string, apCost: number, disabled: boolean, reason?: string, label?: string }>} techniques
 */
export function techniqueItems(data, techniques) {
  const { ui } = data;
  const { dual } = data.rules.combat;
  return techniques.map((a) => {
    if (a.artifact) return artifactItem(data, a);
    const named = a.id === "throw" || a.id === "pickup";
    const key = named && !a.label ? `combat.tech.${a.id}Any` : `combat.tech.${a.id}`;
    return {
      label: t(ui, key, { weapon: a.label }),
      description: t(ui, `combat.techDesc.${a.id}`, { penalty: dual.secondHitPenalty, bonus: dual.guardBonus }),
      ...costOrReason(ui, a.apCost, a.disabled ? a.reason : undefined),
    };
  });
}

/** An artifact ability row: "Płonące ostrze (◆50 · 2 PA)" or "(−10 HP · 2 PA)" when paid with HP; greyed with the reason. */
function artifactItem(data, a) {
  const { ui } = data;
  const effect = effectById(data, a.effect);
  const label = a.viaHp !== undefined
    ? t(ui, "combat.tech.artifactHp", { name: a.label, hp: a.viaHp, ap: a.apCost })
    : t(ui, "combat.tech.artifact", { name: a.label, cost: Math.round(a.chargeCost), ap: a.apCost });
  const description = a.description ?? t(ui, "combat.techDesc.artifact", { effect: effect?.name ?? a.effect, description: effect?.description ?? "" });
  return { label, description, ...(a.disabled ? { disabled: true, hint: `(${t(ui, a.reason)})` } : {}) };
}

const ZONE_HOTKEYS = { glowa: "g", tulow: "r", nogi: "n", ogluszenie: "s" };
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0");

/**
 * Top-level `select` items for `zoneActions(...)` (aimed blows): "Cios w głowę (4 PA)" with the numbers of the zone
 * (hit modifier, damage, crit, effect) as the description; unavailable ones greyed with the reason as the hint.
 * @returns {Array<{ id: string, label: string, hotkey: string, description: string, disabled?: boolean, hint: string }>}
 */
export function zoneItems(data, zones) {
  const { ui } = data;
  return zones.map((a) => {
    const z = data.rules.combat.aimed[a.id];
    return {
      id: a.id,
      label: t(ui, `combat.zone.${a.id}`),
      hotkey: ZONE_HOTKEYS[a.id],
      description: t(ui, `combat.zoneDesc.${a.id}`, {
        hit: signed(-(a.penalty ?? z.penalty)), damage: signed(z.damagePercent ?? 0), crit: z.critBonus ?? 0, chance: z.chance ?? 0,
        bluntChance: (z.chance ?? 0) + (z.bluntBonus ?? 0), effect: z.effect ? effectById(data, z.effect)?.name ?? z.effect : "",
      }),
      ...costOrReason(ui, a.apCost, a.disabled ? a.reason : undefined),
    };
  });
}
