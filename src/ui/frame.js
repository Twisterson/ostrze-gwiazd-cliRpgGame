/**
 * Frame composer: one screen as a box split by lines into panels – the hero (top), the scene text (left) beside the choice
 * panel (right), the notices and the one-line command menu (bottom). Pure: it only builds lines.
 */
import { stripVTControlCharacters } from "node:util";
import { paint } from "./colors.js";
import { wrap } from "./text.js";
import { FRAME, repeatTo } from "./frame_style.js";
import { displayWidth } from "./screen.js";
import { t } from "./strings.js";
import defaultUi from "./default_ui.js";

const MAX_WIDTH = 200;
/** Art beside the text needs this many text columns left; above the text it needs this many text rows left. */
export const ART_SIDE_TEXT_MIN = 50;
export const ART_TOP_TEXT_MIN = 8;
export const ART_GAP = 2;
const INFO_ROWS = 4;
const MAX_NOTICES = 2;
const ANSI = /\x1b\[[0-9;]*m/y;

/** Terminal columns of a (possibly painted) line. */
export const visibleWidth = (text) => displayWidth(stripVTControlCharacters(text));

/** Cuts a (possibly painted) line to `width` columns, ending with "…" (and a colour reset) when something was dropped. */
export function fitWidth(text, width) {
  if (visibleWidth(text) <= width) return text;
  let out = "";
  let used = 0;
  let painted = false;
  for (let i = 0; i < text.length;) {
    ANSI.lastIndex = i;
    const code = ANSI.exec(text);
    if (code) {
      out += code[0];
      painted = true;
      i += code[0].length;
      continue;
    }
    const ch = String.fromCodePoint(text.codePointAt(i));
    const w = displayWidth(ch);
    if (used + w > width - 1) break;
    out += ch;
    used += w;
    i += ch.length;
  }
  return `${out}${painted ? "\x1b[0m" : ""}…`;
}

/** `text` cut and padded with spaces to exactly `width` columns. */
export const cell = (text, width) => {
  const fitted = fitWidth(text, width);
  return fitted + " ".repeat(Math.max(0, width - visibleWidth(fitted)));
};

/** Width of the frame: the terminal's, but at most 200 columns. */
export const frameWidth = (cols) => Math.min(cols, MAX_WIDTH);

/**
 * Columns of the choice panel of a screen whose list holds item rows: the shop, the inventory and a smith's exchange.
 * Guaranteed (test/i18n_ui_en.test.js): at 80 columns the name and price of every shop stock row fits, in Polish and in
 * English (the longest, "[10] Puszka z szerszeniami · 38 gr · ×2", takes 41 with the cursor). In the rows built from what the
 * player carries an upgraded item shows its highest stage only ("Półpancerz (płyty) · 146 gr"; the full name stands in the card
 * and in the box under the list) and an exchange the one stage bought ("Półpancerz: płyty (170 gr)"); the tests walk every
 * sale, inventory and exchange row with one- and two-digit numbers and fail on any row English cuts and Polish does not.
 * Rows cut in both languages (long names such as „Ostrze Gwiazd (kute przez Bogdana)”) are allowed.
 */
export const WIDE_LIST = 42;

/** Text columns of the right (choice) panel: 30% of the frame, 30 to 42; `wide`: at least WIDE_LIST (a list of items). */
export const choiceWidthOf = (cols, wide = false) => {
  const normal = Math.min(42, Math.max(30, Math.round(frameWidth(cols) * 0.3)));
  return wide ? Math.max(normal, WIDE_LIST) : normal;
};

/** Inner margin of the scene panel: none in a small window, growing with a big one so the text does not stick to the frame. */
export const scenePad = (cols) => { const w = frameWidth(cols); return w >= 160 ? 4 : w >= 130 ? 3 : w >= 100 ? 2 : 0; };
/** Text columns of the scene panel with no margins (what a full-panel picture may use). */
export const sceneFullWidth = (cols, wide = false) => frameWidth(cols) - 7 - choiceWidthOf(cols, wide);
/** Blank rows above the scene text: one in a tall window. */
export const sceneTopPad = (rows) => (rows >= 34 ? 1 : 0);

/** Width of the scene text: the frame takes 7 columns (edges, margins, the bar), the choice panel the rest, then the inner margins. */
export const sceneWidth = (cols, wide = false) => frameWidth(cols) - 7 - choiceWidthOf(cols, wide) - 2 * scenePad(cols);

// A line painted as a whole: colour codes, plain text, reset codes.
const WHOLE_PAINT = /^((?:\x1b\[[0-9;]*m)+)([^\x1b]*)((?:\x1b\[[0-9;]*m)+)$/;

/** A scene line: when the text takes more than one page, what follows starts a new page (so a table is not cut off from its heading). */
export const PAGE_BREAK = "\f";

/** `lines` with the PAGE_BREAK markers resolved: dropped when all fits in `first` rows, else blank rows up to the next page (`first - 1` rows, then `rows - 1` each, the last row saying "dalej"). */
function resolveBreaks(lines, first, rows) {
  const text = lines.filter((line) => line !== PAGE_BREAK);
  if (text.length === lines.length || text.length <= first) return text;
  const out = [];
  for (const line of lines) {
    if (line !== PAGE_BREAK) { out.push(line); continue; }
    const over = out.length - (first - 1);
    const left = over < 0 ? -over : (rows - 1 - (over % (rows - 1))) % (rows - 1);
    for (let i = 0; i < left; i++) out.push("");
  }
  return out;
}

/** Scene lines wrapped to `width`: plain lines and lines painted as a whole (each part keeps the colour); mixed ones are cut later. */
export function sceneLines(body, width) {
  return body.flatMap((line) => {
    if (visibleWidth(line) <= width) return [line];
    const whole = WHOLE_PAINT.exec(line);
    if (whole) return wrap(whole[2], width).split("\n").map((part) => `${whole[1]}${part}${whole[3]}`);
    if (line.includes("[")) return [line];
    return wrap(line, width).split("\n");
  });
}

/** Notice rows: up to two; with more, the latest one and "…i N więcej [L]". */
function noticeRows(notices, ui) {
  if (notices.length <= MAX_NOTICES) return notices;
  return [notices.at(-1), paint("dim", t(ui, "frame.noticesMore", { n: notices.length - 1 }))];
}

/** The command menu in one line: "[P] Postać  [E] Ekwipunek"; from the end the labels drop out ("[M]") until it fits. */
function menuLine(commands, width) {
  const part = (c, short) => paint(c.disabled ? "dim" : "check", `[${c.key}]`) + (short ? "" : ` ${c.disabled ? paint("dim", c.label) : c.label}`);
  const build = (shortFrom) => commands.map((c, i) => part(c, i >= shortFrom)).join("  ");
  for (let from = commands.length; from >= 0; from--) {
    const text = build(from);
    if (visibleWidth(text) <= width) return text;
  }
  return fitWidth(build(0), width);
}

const line = (char, n) => paint("frame", char.repeat(Math.max(0, n)));
const shade = (text) => paint("frame_shade", text);
/** `width` columns of the title band: one column of the pattern, the (painted) label, the pattern again up to the edge. */
const band = (width, label) => `${shade(repeatTo(FRAME.band, 1))}${paint("frame_title", label)}${shade(repeatTo(FRAME.band, Math.max(0, width - 1 - visibleWidth(label))))}`;
/** `n` columns of the zigzag divider. */
const zig = (n) => paint("frame", repeatTo(FRAME.zigzag, n));

/** `text` wrapped to `width`, at most `rows` rows; the last one ends with "…" when text was cut. */
function infoRows(text, width, rows) {
  const lines = text ? wrap(text, width).split("\n") : [];
  if (lines.length <= rows) return lines;
  return [...lines.slice(0, rows - 1), fitWidth(`${lines.slice(rows - 1).join(" ")}`, width)];
}

/**
 * One frame (exactly `rows − 1` lines of `frameWidth(cols)` columns; the last terminal row stays for the answer).
 * @param {{ cols: number, rows: number, hero: { left: string, right: string, lines: string[] } | null, title?: string | null,
 *   body: string[], commands: Array<{ key: string, label: string, disabled?: boolean }>, notices: string[], choices: string[],
 *   choiceTitle?: string | null, info?: string | null, page?: number, art?: { lines: string[], width: number } | null }} spec
 *   (`art`: an illustration drawn on page 0 – beside the text, above it, or not at all, see `artMode`; `info`: null – no description field; a string,
 *   even an empty one – a field of 4 rows under the list; `wideList`: the wide choice panel of an item list, see `WIDE_LIST`)
 * @returns {{ lines: string[], pages: number, sceneRows: number, choiceRows: number, choiceWidth: number, artMode: "side" | "top" | "none" }}
 */
export function composeFrame({ cols, rows, hero, title = null, body, commands = [], notices = [], choices = [], choiceTitle = null, info = null, page = 0, art = null, bare = false, wideList = false, ui = defaultUi }) {
  const W = frameWidth(cols);
  const R = choiceWidthOf(cols, wideList);
  const L = W - 7 - R;
  const split = L + 3; // column of the bar between the scene and the choice panel
  const notes = noticeRows(notices, ui);
  const hasMenu = true; // the menu row is always reserved (blank without commands), so the layout does not jump when commands appear
  const heroRows = hero ? hero.lines.length : 0;
  const M = Math.max(1, rows - 1 - 1 - heroRows - 1 - 1 - notes.length - (notes.length && hasMenu ? 1 : 0) - (hasMenu ? 1 : 0) - 1);
  const P = bare ? 0 : scenePad(cols); // `bare`: the picture fills the panel edge to edge (the title screen)
  const T = bare ? 0 : Math.min(sceneTopPad(rows), Math.max(0, M - 8)); // blank rows above the text (the text pages in the rest)
  const Mt = M - T;
  const choiceRows = Math.max(1, M - (info !== null ? INFO_ROWS + 1 : 0));

  // The illustration: beside the text when enough columns stay for it, above it when enough rows do, else left out.
  const image = art?.lines?.length ? art : null;
  let artMode = "none";
  const Lt = L - 2 * P; // text columns inside the margins
  if (image && Lt - image.width - ART_GAP >= ART_SIDE_TEXT_MIN) artMode = "side";
  else if (image && image.width <= Lt && Mt - image.lines.length >= ART_TOP_TEXT_MIN) artMode = "top";
  const textWidth = artMode === "side" ? Lt - image.width - ART_GAP : Lt;
  const first = artMode === "top" ? Mt - image.lines.length : Mt; // text rows on page 0
  const all = resolveBreaks(sceneLines(body, textWidth), first, Mt);
  const pages = all.length <= first ? 1 : 1 + Math.ceil((all.length - (first - 1)) / (Mt - 1));
  const shown = Math.min(Math.max(0, page), pages - 1);
  const textLines = pages === 1 ? all
    : shown === 0 ? all.slice(0, first - 1)
      : all.slice(first - 1 + (shown - 1) * (Mt - 1), first - 1 + shown * (Mt - 1));
  let pageLines = textLines;
  if (shown === 0 && artMode === "top") pageLines = [...image.lines, ...textLines];
  else if (shown === 0 && artMode === "side") {
    const blank = " ".repeat(image.width + ART_GAP);
    pageLines = Array.from({ length: Math.max(image.lines.length, textLines.length) }, (_, i) => `${i < image.lines.length ? image.lines[i] + " ".repeat(ART_GAP) : blank}${textLines[i] ?? ""}`);
  }
  if (pages > 1 && shown < pages - 1) {
    while (pageLines.length < Mt - 1) pageLines.push("");
    pageLines.push(paint("dim", t(ui, "frame.more")));
  }
  // the margins: blank rows above, spaces left of every line
  pageLines = [...Array(T).fill(""), ...pageLines.map((l) => (l === "" ? l : " ".repeat(P) + l))];

  const out = [];
  const C = FRAME.corner;
  const side = (text, width) => `${line(FRAME.left, 1)} ${cell(text, width)} ${line(FRAME.right, 1)}`;
  // Top border: the hero's name/level/class on the left, the clock on the right – or the game's title.
  if (hero) {
    const right = ` ${hero.right} `;
    const room = W - 6 - visibleWidth(right) - 1;
    const left = ` ${fitWidth(hero.left, Math.max(1, room - 1))} `;
    const fill = W - 2 - 1 - visibleWidth(left) - visibleWidth(right) - 1;
    out.push(`${line(C + FRAME.top, 1)}${paint("frame_title", left)}${line(FRAME.top, fill)}${paint("frame_title", right)}${line(FRAME.top + C, 1)}`);
    for (const l of hero.lines) out.push(side(l, W - 4));
  } else {
    const left = ` ${t(ui, "frame.title")} `;
    out.push(`${line(C + FRAME.top, 1)}${paint("frame_title", left)}${line(FRAME.top, W - 3 - visibleWidth(left))}${line(C, 1)}`);
  }
  // Title row: the scene's title and the choice panel's title on a shaded band, the junction between them.
  const sceneLabel = title ? ` ${fitWidth(title, L - 2)} ` : "";
  const choiceLabel = choiceTitle ? ` ${fitWidth(choiceTitle, R - 2)} ` : "";
  out.push(`${line(C, 1)}${band(split - 1, sceneLabel)}${line(FRAME.junction, 1)}${band(W - split - 2, choiceLabel)}${line(C, 1)}`);

  // The choice panel's rows: the list, then (with `info`) a divider and the description rows.
  const infoText = info !== null ? infoRows(info, R, INFO_ROWS) : [];
  for (let i = 0; i < M; i++) {
    const left = `${line(FRAME.left, 1)} ${cell(pageLines[i] ?? "", L)} `;
    if (info !== null && i === choiceRows) out.push(`${left}${shade(FRAME.bar)}${zig(R + 2)}${line(FRAME.right, 1)}`);
    else if (info !== null && i > choiceRows) out.push(`${left}${shade(FRAME.bar)} ${cell(paint("dim", infoText[i - choiceRows - 1] ?? ""), R)} ${line(FRAME.right, 1)}`);
    else out.push(`${left}${shade(FRAME.bar)} ${cell(choices[i] ?? "", R)} ${line(FRAME.right, 1)}`);
  }
  out.push(`${line(C, 1)}${zig(split - 1)}${line(FRAME.junction, 1)}${zig(W - split - 2)}${line(C, 1)}`);
  for (const n of notes) out.push(side(n, W - 4));
  if (notes.length && hasMenu) out.push(`${line(C, 1)}${zig(W - 2)}${line(C, 1)}`);
  if (hasMenu) out.push(side(menuLine(commands, W - 4), W - 4));
  out.push(`${line(C, 1)}${line(FRAME.bottom, W - 2)}${line(C, 1)}`);
  return { lines: out, pages, sceneRows: Mt, choiceRows, choiceWidth: R, artMode: shown === 0 ? artMode : "none" };
}
