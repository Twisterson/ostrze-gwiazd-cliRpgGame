import { clockOf, timeOfDay } from "../engine/time.js";
import { getStats } from "../systems/stats.js";
import { paint, useColor } from "./colors.js";
import { renderPixels } from "./pixels.js";
import { t } from "./strings.js";
import { formatRemaining } from "./events.js";
import { effectById } from "../systems/effects.js";
import { activePhenomenon, announcedPhenomenon } from "../systems/phenomena.js";
import { equippedArtifact, artifactState } from "../systems/artifacts.js";
import { locationById, tripEnds } from "../systems/travel.js";
import { composeFrame, sceneWidth, frameWidth, sceneLines, fitWidth, ART_GAP } from "./frame.js";
import { heroPanel } from "./hero_panel.js";
import { wrap } from "./text.js";

const pad2 = (n) => String(n).padStart(2, "0");

/** Terminal columns of `text` (the ⚡ glyph is drawn two columns wide). */
export const displayWidth = (text) => [...text].length + (text.match(/⚡/g) ?? []).length;

/** Charge of the worn artifact in whole percent (floored: 100% only when full), or null without one. */
export function artifactPercent(state, data) {
  const item = state.inventory ? equippedArtifact(state, data) : null;
  if (!item) return null;
  return { item, pct: Math.floor(((artifactState(state, item.id)?.charge ?? 0) / item.charge.max) * 100) };
}

/**
 * The mystic tags of the status lines: the announced ("⚡ Burza za ~2 h") or running phenomenon, then the worn artifact's
 * charge ("◆ Kamień 64%"; `short`: "⚡ Burza ~2h", "◆ 64%").
 */
export function mysticTags(state, data, { short = false } = {}) {
  const { ui } = data;
  const tags = [];
  const running = activePhenomenon(state, data);
  const announced = running ? null : announcedPhenomenon(state, data);
  if (running) tags.push(t(ui, "status.phenomenon", { name: running.name }));
  else if (announced?.def) {
    const h = Math.max(1, Math.ceil((announced.startsAt - state.time.minutes) / 60));
    tags.push(t(ui, short ? "status.omenShort" : "status.omen", { name: announced.def.name, h }));
  }
  const charge = artifactPercent(state, data);
  if (charge) tags.push(t(ui, short ? "combat.artifactShort" : "status.artifact", { name: charge.item.name, pct: charge.pct }));
  return tags;
}

/** Cuts painted `[text, role]` pieces to `width` columns, ending with "…" when something was dropped; returns the painted line. */
export function fitPieces(pieces, width) {
  let left = width;
  let out = "";
  for (const [text, role] of pieces) {
    const w = displayWidth(text);
    if (w <= left) {
      out += role ? paint(role, text) : text;
      left -= w;
      continue;
    }
    let cut = "";
    for (const ch of text) {
      if (displayWidth(cut + ch) > left - 1) break;
      cut += ch;
    }
    out += (role ? paint(role, cut) : cut) + "…";
    break;
  }
  return out;
}

/**
 * Clears the screen, then the scrollback (ESC[3J), then goes home, so nothing of the previous screens stays above the window.
 * The order matters: Windows Terminal pushes the cleared screen into the scrollback on ESC[2J, so ESC[3J has to come after it;
 * the other way round the previous frame stayed above the new one (two game windows one above the other).
 */
const NL = String.fromCharCode(10);
const ESC_HOME = String.fromCharCode(27) + "[H";
const CLEAR_SCREEN = "\x1b[2J\x1b[3J\x1b[H";

/** Clears the terminal (a no-op when the output is not a TTY) and forgets the current frame. */
export function clear(io) {
  if (io.isTTY) io.writeRaw(CLEAR_SCREEN);
  io.frame = null;
  io.shown = null;
  io.written = [];
  io.reopen = null;
}

/** True when screens are drawn as frames: a terminal of at least 80×24. */
export const framesOn = (io) => Boolean(io.isTTY) && io.columns >= 80 && io.rows >= 24;

/** Composes the current frame (`io.frame`) with `choices` in the choice panel. `info`: the description field (null – none). */
function compose(io, choices, { page, info } = {}) {
  const f = io.frame;
  return composeFrame({
    cols: io.columns, rows: io.rows, hero: f.hero, title: f.title, body: f.body, commands: f.commands, notices: f.notices,
    choices: f.side?.length ? [...f.side, "", ...choices] : choices, choiceTitle: f.choiceTitle, info: info === undefined ? (f.choiceInfo ?? null) : info, page: page ?? f.page, art: f.art ?? null, bare: Boolean(f.bare),
  });
}

/** Draws the current frame (`io.frame`) with `choices` in the choice panel; `info` is the description field's text (null – no field). */
export function drawFrame(io, choices = [], { page, info, redraw = false } = {}) {
  const f = io.frame;
  f.lastChoices = choices;
  f.choiceInfo = info === undefined ? (f.choiceInfo ?? null) : info;
  const small = io.isTTY && !framesOn(io);
  if (!small) refit(io);
  const lines = small ? smallWindowLines(io, choices) : compose(io, choices, { page, info: f.choiceInfo }).lines;
  const shown = io.shown;
  const sameSize = shown && shown.columns === io.columns && shown.rows === io.rows;
  if (io.diffFrames && sameSize && shown.lines.length === lines.length && lines.length < io.rows) {
    // The same screen with something changed (a cursor move): only the changed rows are rewritten, so a big picture does not flicker.
    const changed = lines.flatMap((line, i) => (line === shown.lines[i] ? [] : `\x1b[${i + 1};1H\x1b[2K${line}`));
    if (changed.length) io.writeRaw(`${changed.join("")}\x1b[${lines.length + 1};1H`);
  } else {
    // `redraw`: paint over the previous frame from the top (no clearing), for animations without flicker
    io.writeRaw(`${redraw && (!shown || sameSize) ? ESC_HOME : CLEAR_SCREEN}${lines.join(NL)}${NL}`);
  }
  if (io.diffFrames) io.shown = { lines, columns: io.columns, rows: io.rows };
}

/** Brings what was laid out for the old size (the hero panel, the wrapped text) to the current one; `f.fit` is set by whoever made the frame. */
function refit(io) {
  const f = io.frame;
  if (!f.fit || (f.fitted?.columns === io.columns && f.fitted?.rows === io.rows)) return;
  f.fitted = { columns: io.columns, rows: io.rows };
  f.fit();
}

/** A frame whose window was made too small for the panels: the hint, as much of the text as fits, and always the choices. */
function smallWindowLines(io, choices) {
  const f = io.frame;
  const width = Math.max(1, io.columns - 1);
  const hint = f.tooSmall ? [paint("dim", f.tooSmall)] : [];
  const room = Math.max(0, io.rows - 1 - hint.length - choices.length);
  const text = f.bare ? [] : sceneLines(f.body, width).slice(0, room);
  return [...hint, ...text, ...choices].map((l) => fitWidth(l, width)).slice(-Math.max(1, io.rows - 1));
}

/** Draws the current screen again after the window changed size: the frame, or the text written since the last clear. */
export function redrawScreen(io) {
  if (io.frame) drawFrame(io, io.frame.lastChoices ?? []);
  else if (io.isTTY) io.writeRaw(`${CLEAR_SCREEN}${(io.written ?? []).map((l) => `${l}${NL}`).join("")}`);
}

/** A screen opened without frames in a window now big enough for them gets its frame; false when there is nothing to do. */
export function reopenFrame(io) {
  if (io.frame || !io.reopen || !framesOn(io)) return false;
  io.reopen();
  return true;
}

/** Rows of the scene panel for the current frame (what a text must fit in to stay on one page). */
export function sceneCapacity(io) {
  return compose(io, []).sceneRows;
}

/** Rows of the choice panel's list for the current frame (`info`: with the description field). */
export function choiceCapacity(io, { info = false } = {}) {
  return compose(io, [], { info: info ? "" : null }).choiceRows;
}

/** Sets `io.frame` for a scene screen (see `showScreen`), with its text and hero panel laid out for the current window size. */
function openFrame(ctx, { title, text, lines = [], side = [], hero: withHero = true, art: artId, bare = false }, notices) {
  const { state, data, io } = ctx;
  const image = artId ? data.art?.[artId] : null;
  const art = image ? { lines: renderPixels(image, { color: useColor() }), width: image.w } : null;
  const f = { hero: null, title, body: [], commands: [], notices, page: 0, choiceTitle: null, choiceInfo: null, side, art, bare, tooSmall: data?.ui["frame.tooSmall"] };
  io.frame = f;
  let laidOut = f.body;
  f.fit = () => {
    f.hero = state && withHero ? heroPanel(state, data, { cols: frameWidth(io.columns) }) : null;
    // beside an illustration the text is wrapped narrower
    const wrapWidth = sceneWidth(io.columns) - (compose(io, []).artMode === "side" ? art.width + ART_GAP : 0);
    const body = [...(text ? wrap(text, wrapWidth).split("\n") : []), ...(typeof lines === "function" ? lines() : lines)];
    if (f.body === laidOut) f.body = body; // a body put in by someone else (a preview, a question) is theirs
    laidOut = body;
  };
  refit(io);
}

/**
 * Shows a scene screen: `title`, prose `text` (wrapped) and preformatted `lines` in the left panel. In a frame (see `framesOn`)
 * the pending notices go to the notice zone and a long text is paged (Enter between pages); widgets drawn next fill the
 * choice panel. Otherwise it writes the status line, the notices, the title and the text as before.
 * @param {{ title?: string, text?: string, lines?: string[], side?: string[], blank?: boolean, hero?: boolean, art?: string }} spec (`art`: id of an
 *   illustration (data.art), drawn in a frame only and on the first page, see `composeFrame`; `side`: static
 *   lines at the top of the choice panel, above the choices – the character sheet's skills; `blank: false`: no
 *   empty line after the notices in line mode; `hero: false`: a frame without the hero panel, for screens that show the hero themselves)
 */
export async function showScreen(ctx, spec) {
  const { title, text, lines = [], blank = true } = spec;
  const { state, data, io } = ctx;
  clear(io);
  io.discardInput?.();
  if (!framesOn(io)) {
    if (io.isTTY) {
      const notices = [...(ctx.notices ?? [])];
      io.reopen = () => {
        clear(io);
        openFrame(ctx, spec, notices);
        io.frame.page = Number.MAX_SAFE_INTEGER;
      };
    }
    // A terminal that is too small for the frames says so once per screen, ahead of the status line.
    if (io.isTTY) io.write(paint("dim", data.ui["frame.tooSmall"]));
    io.write(statusBar(state, data, { debug: ctx.debug, width: io.columns }));
    flushNotices(ctx);
    if (blank) io.write("");
    if (title) io.write(sceneHeader(title));
    if (text) io.write(wrap(text, textWidth(io)));
    for (const line of lines) io.write(line);
    return;
  }
  openFrame(ctx, spec, (ctx.notices ?? []).splice(0));
  for (let page = 0; page < compose(io, []).pages - 1; page++) {
    const next = [paint("title", `▶ ${t(data.ui, "frame.next")}`)];
    drawFrame(io, next, { page });
    for (;;) {
      const key = await io.readKey();
      if (key.name === "resize") drawFrame(io, next, { page });
      if (key.name === "enter" || (key.name === "char" && key.char === "1")) break;
    }
  }
  io.frame.page = Number.MAX_SAFE_INTEGER; // the last page
  drawFrame(io, []);
}

/**
 * Says `message` now: in a frame as a notice (the frame is redrawn with the same choices – text written below a frame would
 * scroll it), otherwise as a line.
 */
export function say(io, message) {
  if (!io.frame) {
    io.write(message);
    return;
  }
  io.frame.notices = [...io.frame.notices.filter((n) => n !== message), message];
  drawFrame(io, io.frame.lastChoices ?? []);
}

/** Queues an already painted message to be shown on the next screen that clears. */
export function pushNotice(ctx, message) {
  (ctx.notices ??= []).push(message);
}

/** Prints and empties the pending notices. */
export function flushNotices(ctx) {
  for (const message of ctx.notices ?? []) ctx.io.write(message);
  if (ctx.notices) ctx.notices.length = 0;
}

/**
 * The mystic tags as painted pieces fitting `room` columns, so the character part (HP) never gives way to them: full forms,
 * else short forms, else the phenomenon tag cut with "…", else none.
 */
function mysticPieces(state, data, room) {
  const piecesOf = (tags) => tags.flatMap((tag) => [[" · ", null], [tag, "mystic"]]);
  const widthOf = (tags) => tags.reduce((sum, tag) => sum + 3 + displayWidth(tag), 0);
  const full = mysticTags(state, data);
  if (widthOf(full) <= room) return piecesOf(full);
  const short = mysticTags(state, data, { short: true });
  if (widthOf(short) <= room) return piecesOf(short);
  if (short.length === 2 && short[0].startsWith("⚡")) {
    const left = room - widthOf([short[1]]) - 3;
    let cut = "";
    for (const ch of short[0]) {
      if (displayWidth(cut + ch) > left - 1) break;
      cut += ch;
    }
    if (cut.length > 2) return piecesOf([`${cut}…`, short[1]]);
  }
  return [];
}

/** "Brzezina" in a location, "W drodze 1/2" on the road; null when neither is known. */
export function placeText(state, data) {
  const travel = state.world?.travel;
  // After the last camp `day` is already past the end until the arrival at dawn.
  if (travel) {
    const params = { day: Math.min(travel.day, travel.daysTotal), days: travel.daysTotal };
    if (travel.quest && travel.reverse) return t(data.ui, "status.returning", params);
    if (travel.quest) return t(data.ui, "status.toQuest", { ...params, place: locationById(data, tripEnds(data, travel.route, false).to)?.short });
    return t(data.ui, "status.travel", params);
  }
  return locationById(data, state.world?.location)?.short ?? null;
}

/**
 * Time, time of day, place, phenomenon and artifact tags, character summary and (with debug) the hidden story variables; cut to
 * `width` columns. When space runs out the mystic tags shorten first, then the place goes, then the mystic tags are cut;
 * the character part (HP) never gives way.
 */
export function statusBar(state, data, { debug = false, width } = {}) {
  const { ui } = data;
  const { day, hour, minute } = clockOf(state.time.minutes);
  const pieces = [[`${t(ui, "status.time", { day, hh: pad2(hour), mm: pad2(minute) })} · ${t(ui, `time.${timeOfDay(state.time.minutes, data.rules)}`)}`, null]];
  let bar = "";
  if (state.character) {
    const { hpMax } = getStats(state, data).derived;
    bar += ` · ${t(ui, "status.character", { name: state.character.name, level: state.character.level, hp: state.character.hp, hpMax })}`;
    const effects = (state.character.effects ?? []).filter((e) => effectById(data, e.id)?.unit === "hour");
    for (const e of effects.slice(0, 3)) {
      const def = effectById(data, e.id);
      const params = { name: def.name, remaining: formatRemaining(ui, e.remaining), stacks: e.stacks };
      const key = `${e.stacks > 1 ? "status.effectStacked" : "status.effect"}${def.noExpire ? "NoTimer" : ""}`;
      bar += ` ${t(ui, key, params)}`;
    }
    if (effects.length > 3) bar += ` ${t(ui, "status.effectsMore", { n: effects.length - 3 })}`;
  }
  if (debug) bar += t(ui, "status.debugVars", { wola: state.vars?.wola ?? 0, dlug: state.vars?.dlug ?? 0 });
  let room = (width ?? Infinity) - displayWidth(pieces[0][0]) - displayWidth(bar);
  // The place stays only when the mystic tags still fit at least in their short form next to it.
  const place = placeText(state, data);
  const mysticShort = mysticTags(state, data, { short: true }).reduce((sum, tag) => sum + 3 + displayWidth(tag), 0);
  if (place && 3 + displayWidth(place) + mysticShort <= room) {
    pieces.push([` · ${place}`, null]);
    room -= 3 + displayWidth(place);
  }
  pieces.push(...mysticPieces(state, data, room), [bar, null]);
  return fitPieces(pieces, width ?? Infinity);
}

export function sceneHeader(title) { return paint("title", title); }

export function textWidth(io) { return Math.min(io.columns, 100); }
