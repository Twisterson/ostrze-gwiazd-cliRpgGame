import { t } from "./strings.js";
import { paint } from "./colors.js";
import { drawFrame, say, choiceCapacity } from "./screen.js";
import { choiceWidthOf, visibleWidth } from "./frame.js";

/** The widget's title: in a frame it heads the choice panel, otherwise it is written as a line. */
function writeTitle(io, title) {
  if (!title) return;
  if (io.frame) io.frame.choiceTitle = title;
  else io.write(paint("title", title));
}

const CURSOR = "▶ ";
const BLANK = "  ";

/** Cuts text to io.columns - 4 code points, ending with "…" when cut. */
function cut(text, columns) {
  const max = Math.max(1, columns - 4);
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

function labelOf(item) {
  const label = item.hotkey ? `[${item.hotkey.toUpperCase()}] ${item.label}` : item.label;
  return item.hint ? `${label} ${item.hint}` : label;
}

function sameLetter(a, b) {
  return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
}

function digitOf(key) {
  return key.name === "char" && /^[1-9]$/.test(key.char) ? Number(key.char) : null;
}

function nextIndex(from, dir, count) {
  return (from + dir + count) % count;
}

/** Redraws a block of lines in place (key mode); in a frame the whole frame is redrawn with the lines as its choices (and `info` in the description field). */
/**
 * The next key. With `animate: { ms, frame(tick) }` in a frame the scene panel is redrawn every `ms` milliseconds
 * while waiting (over the old picture, no clearing), so a title screen can move; a key ends the wait at once.
 */
let pendingKey = null;
async function nextKey(io, animate, frame) {
  if (!animate || !frame || !io.isTTY) return io.readKey();
  let tick = 0;
  pendingKey ??= io.readKey();
  for (;;) {
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), animate.ms); });
    let key;
    try { key = await Promise.race([pendingKey, timeout]); } catch (err) { pendingKey = null; clearTimeout(timer); throw err; }
    clearTimeout(timer);
    if (key !== null) { pendingKey = null; return key; }
    tick += 1;
    frame.body = animate.frame(tick);
    drawFrame(io, frame.lastChoices ?? [], { redraw: true });
  }
}

function makeScreen(io) {
  let previous = 0;
  return (lines, info) => {
    if (io.frame) return drawFrame(io, lines, { info: info ?? null });
    if (previous > 0) io.writeRaw(`\r\x1b[${previous}A\x1b[0J`);
    io.writeRaw(`${lines.join("\n")}\n`);
    previous = lines.length;
  };
}

/**
 * Scrolling window over list rows (key mode): at most max(3, io.rows - 4) lines including
 * the "↑ …"/"↓ …" markers, moved so the cursor row stays visible. Short lists pass through.
 */
function makeWindow(io, ui, extra = 0, { info = false } = {}) {
  let top = 0;
  return (rowLines, cursor) => {
    const n = rowLines.length;
    // In a frame the choice panel (less the description field, with `info`) holds the list.
    // `extra`: rows the widget adds above the list (counter, budget) – they share the panel
    const h = io.frame ? Math.max(3, choiceCapacity(io, { info }) - extra) : Math.max(3, io.rows - 4);
    if (n <= h) { top = 0; return rowLines; }
    const capacity = (from) => {
      const room = h - (from > 0 ? 1 : 0);
      return n - from <= room ? room : room - 1;
    };
    if (cursor < top) top = cursor;
    while (cursor >= top + capacity(top)) top++;
    const cap = capacity(top);
    const out = [];
    if (top > 0) out.push(BLANK + paint("dim", cut(t(ui, "menu.more.up"), io.columns)));
    out.push(...rowLines.slice(top, top + cap));
    if (top + cap < n) out.push(BLANK + paint("dim", cut(t(ui, "menu.more.down"), io.columns)));
    return out;
  };
}

/** [L] in a frame: every notice of the screen in the scene panel until Enter, then the screen comes back. */
export async function showAllNotices(io, ui) {
  const saved = io.frame;
  io.frame = { ...saved, title: t(ui, "frame.notices"), body: saved.notices, notices: [], page: 0, pageRows: null, choiceTitle: null };
  drawFrame(io, [t(ui, "prompt.enter")]);
  for (;;) {
    const key = await io.readKey();
    if (key.name === "enter") break;
  }
  io.frame = saved;
}

/** Prefix + text for a row; the cursor row is bold, a dim row stays dim. */
function row(isCursor, text, dim = false) {
  if (dim) return (isCursor ? CURSOR : BLANK) + paint("dim", text);
  return isCursor ? CURSOR + paint("title", text) : BLANK + text;
}

/**
 * @param {object} io
 * @param {Record<string,string>} ui
 * @param {{ title?: string, items: Array<{label:string, hint?:string, disabled?:boolean, description?:string, hotkey?:string}>, initial?: number, prompt?: string, emptyPicksInitial?: boolean, preview?: (cursor: number) => string[] }} opts (prompt: line-mode question, default prompt.choice; hotkey: one letter, shown as [X]; emptyPicksInitial: line-mode empty answer picks initial)
 * @returns {Promise<number>}
 */
export async function select(io, ui, { title, items, initial, prompt, emptyPicksInitial, preview, digits = true, animate }) {
  // `hidden` items (commands such as [P] Postać) stay out of a frame's choice panel: they go to its command column and
  // answer only to their hotkey. Without a frame they are listed as usual.
  const hidden = (i) => Boolean(io.frame && items[i].hidden);
  const enabled = (i) => !items[i].disabled && !hidden(i);
  const first = items.findIndex((it, i) => enabled(i));
  if (first < 0) throw new Error("select: brak aktywnych pozycji");
  let cursor = initial !== undefined && items[initial] && enabled(initial) ? initial : first;
  writeTitle(io, title);
  if (io.frame) {
    io.frame.commands = items.filter((it, i) => hidden(i)).map((it) => ({ key: it.hotkey.toUpperCase(), label: it.label, disabled: it.disabled }));
    if (io.frame.notices.length > 2 && !items.some((it) => sameLetter(it.hotkey, "l"))) io.frame.commands.push({ key: "L", label: t(ui, "frame.notices") });
  }

  if (!io.isTTY) {
    items.forEach((it, i) => io.write(`[${i + 1}] ${labelOf(it)}${it.disabled ? ` ${t(ui, "menu.unavailable")}` : ""}`));
    for (;;) {
      const answer = (await io.ask(prompt ?? t(ui, "prompt.choice"))).trim();
      if (answer === "" && emptyPicksInitial) return cursor;
      const hot = items.findIndex((it) => it.hotkey && sameLetter(it.hotkey, answer));
      if (hot >= 0) {
        if (enabled(hot)) return hot;
        io.write(t(ui, "menu.unavailable"));
        continue;
      }
      if (/^\d+$/.test(answer)) {
        const n = Number(answer);
        if (n >= 1 && n <= items.length) {
          if (enabled(n - 1)) return n - 1;
          io.write(t(ui, "menu.unavailable"));
          continue;
        }
      }
      io.write(t(ui, "prompt.invalid", { max: items.length }));
    }
  }

  const draw = makeScreen(io);
  const shown = items.map((it, i) => i).filter((i) => !hidden(i));
  // In a frame rows are numbered "[n] …", except those with their own hotkey ("[A] Atak").
  const numbered = (i) => (io.frame && !items[i].hotkey ? `[${i + 1}] ${labelOf(items[i])}` : labelOf(items[i]));
  // A row wider than the choice panel is cut with "…"; its full text goes to the description field under the list.
  const tooWide = (i) => Boolean(io.frame) && visibleWidth(numbered(i)) + 2 > choiceWidthOf(io.columns);
  const hasInfo = Boolean(io.frame) && (items.some((it) => it.description) || shown.some(tooWide));
  const view = makeWindow(io, ui, 0, { info: hasInfo });
  for (;;) {
    // In a frame the choice panel cuts the rows to its width itself
    const width = io.frame ? Infinity : io.columns;
    const rowsShown = shown.map((i) => row(i === cursor, cut(numbered(i), width), Boolean(items[i].disabled)));
    const lines = view(rowsShown, shown.indexOf(cursor));
    const description = items[cursor].description;
    if (description && !io.frame) lines.push(BLANK + paint("dim", cut(description, io.columns)));
    if (io.frame && preview) io.frame.body = preview(cursor);
    draw(lines, hasInfo ? [tooWide(cursor) ? labelOf(items[cursor]) : "", description ?? ""].filter(Boolean).join("\n") : null);
    const key = await nextKey(io, animate, io.frame);
    if (key.name === "enter") return cursor;
    if (key.name === "up" || key.name === "down") {
      const dir = key.name === "up" ? -1 : 1;
      do cursor = nextIndex(cursor, dir, items.length); while (!enabled(cursor));
      continue;
    }
    const d = digitOf(key);
    if (digits && d !== null && d <= items.length && enabled(d - 1)) return d - 1;
    if (key.name === "char") {
      const hot = items.findIndex((it) => it.hotkey && !it.disabled && sameLetter(it.hotkey, key.char));
      if (hot >= 0) return hot;
      if (io.frame && io.frame.notices.length > 2 && sameLetter(key.char, "l")) await showAllNotices(io, ui);
    }
  }
}

/**
 * @param {object} io
 * @param {Record<string,string>} ui
 * @param {{ title?: string, items: Array<{label:string, hint?:string, locked?:boolean, checked?:boolean}>, count: number }} opts
 * @returns {Promise<number[]>}
 */
export async function multiSelect(io, ui, { title, items, count, preview }) {
  const checked = new Set();
  items.forEach((it, i) => { if (it.checked || it.locked) checked.add(i); });
  const doneIndex = items.length;
  const doneEnabled = () => checked.size === count;
  const toggle = (i) => {
    if (items[i].locked) return;
    if (checked.has(i)) checked.delete(i); else checked.add(i);
  };
  const result = () => [...checked].sort((a, b) => a - b);
  const rowText = (i) => `[${checked.has(i) ? "x" : " "}] ${labelOf(items[i])}`;
  const doneLabel = t(ui, "menu.done");
  const counter = () => t(ui, "menu.selected", { n: checked.size, count });
  writeTitle(io, title);

  if (!io.isTTY) {
    for (;;) {
      io.write(counter());
      items.forEach((_, i) => io.write(`[${i + 1}] ${rowText(i)}`));
      io.write(`[${doneIndex + 1}] ${doneLabel}${doneEnabled() ? "" : ` ${t(ui, "menu.unavailable")}`}`);
      for (;;) {
        const answer = (await io.ask(t(ui, "prompt.choice"))).trim();
        const n = /^\d+$/.test(answer) ? Number(answer) : 0;
        if (n < 1 || n > doneIndex + 1) { io.write(t(ui, "prompt.invalid", { max: doneIndex + 1 })); continue; }
        if (n - 1 === doneIndex) {
          if (doneEnabled()) return result();
          continue;
        }
        toggle(n - 1);
        break;
      }
    }
  }

  const draw = makeScreen(io);
  const view = makeWindow(io, ui, 1); // the counter is a row above the list
  let cursor = 0;
  for (;;) {
    const list = items.map((_, i) => row(i === cursor, cut(rowText(i), io.columns)));
    list.push(row(cursor === doneIndex, cut(doneLabel, io.columns), !doneEnabled()));
    if (io.frame && preview) io.frame.body = preview([...checked].sort((a, b) => a - b), cursor);
    draw([cut(counter(), io.columns), ...view(list, cursor)]);
    const key = await io.readKey();
    if (key.name === "up" || key.name === "down") {
      cursor = nextIndex(cursor, key.name === "up" ? -1 : 1, items.length + 1);
    } else if (key.name === "enter") {
      if (cursor === doneIndex) { if (doneEnabled()) return result(); } else toggle(cursor);
    } else {
      const d = digitOf(key);
      if (d !== null && d <= doneIndex + 1) {
        if (d - 1 === doneIndex) { if (doneEnabled()) return result(); } else { cursor = d - 1; toggle(cursor); }
      }
    }
  }
}

/**
 * @param {object} io
 * @param {Record<string,string>} ui
 * @param {{ title?: string, rows: Array<{label:string, value:number, min:number, max:number, step?:number, note?:string|((value:number)=>string)}>, budget?: number }} opts
 * @returns {Promise<number[]>}
 */
export async function sliders(io, ui, { title, rows, budget, preview }) {
  const values = rows.map((r) => r.value);
  const stepOf = (i) => rows[i].step ?? 1;
  const hasBudget = budget !== undefined;
  let left = budget;
  const canInc = (i) => values[i] + stepOf(i) <= rows[i].max && (!hasBudget || left > 0);
  const canDec = (i) => values[i] - stepOf(i) >= rows[i].min;
  const inc = (i) => { if (!canInc(i)) return false; values[i] += stepOf(i); if (hasBudget) left -= 1; return true; };
  const dec = (i) => { if (!canDec(i)) return false; values[i] -= stepOf(i); if (hasBudget) left += 1; return true; };
  const doneAllowed = () => !hasBudget || left === 0 || !rows.some((_, i) => canInc(i));
  const doneIndex = rows.length;
  const noteOf = (i) => (typeof rows[i].note === "function" ? rows[i].note(values[i]) : rows[i].note);
  const rowText = (i) => `${rows[i].label} ${values[i]}${noteOf(i) ? ` ${noteOf(i)}` : ""}`;
  const budgetLine = () => t(ui, "menu.budget", { n: left });
  writeTitle(io, title);

  if (!io.isTTY) {
    for (;;) {
      rows.forEach((_, i) => io.write(`[${i + 1}] ${rowText(i)}`));
      io.write(`[${doneIndex + 1}] ${t(ui, "menu.done")}`);
      if (hasBudget) io.write(budgetLine());
      for (;;) {
        const answer = (await io.ask(t(ui, "prompt.choice"))).trim();
        const m = /^(\d+)(\++|[-−]+)?$/.exec(answer);
        const n = m ? Number(m[1]) : 0;
        if (m && !m[2] && n === doneIndex + 1 && doneAllowed()) return values;
        if (m && m[2] && n >= 1 && n <= rows.length) {
          const step = m[2][0] === "+" ? inc : dec;
          for (let k = 0; k < m[2].length; k++) if (!step(n - 1)) break;
          break;
        }
        io.write(t(ui, "menu.slidersHelp"));
      }
    }
  }

  const draw = makeScreen(io);
  const view = makeWindow(io, ui, hasBudget ? 1 : 0); // the budget is a row above the list
  let cursor = 0;
  for (;;) {
    const list = rows.map((_, i) => row(i === cursor, cut(rowText(i), io.columns)));
    list.push(row(cursor === doneIndex, cut(t(ui, "menu.done"), io.columns), !doneAllowed()));
    if (io.frame && preview) io.frame.body = preview(values, cursor);
    draw([...(hasBudget ? [cut(budgetLine(), io.columns)] : []), ...view(list, cursor)]);
    const key = await io.readKey();
    if (key.name === "up" || key.name === "down") cursor = nextIndex(cursor, key.name === "up" ? -1 : 1, rows.length + 1);
    else if (key.name === "right" && cursor < doneIndex) inc(cursor);
    else if (key.name === "left" && cursor < doneIndex) dec(cursor);
    else if (key.name === "enter" && cursor === doneIndex && doneAllowed()) return values;
  }
}

/**
 * @param {object} io
 * @param {Record<string,string>} ui
 * @param {{ prompt: string, min: number, max: number, pattern: RegExp, defaultValue?: string }} opts
 * @returns {Promise<string>}
 */
/** Text typed key by key into the choice panel ("Imię: Thorg▌"); Backspace erases, Enter confirms (empty = the default). */
async function framedTextInput(io, ui, { min, max, pattern, defaultValue, label }) {
  let text = "";
  for (;;) {
    drawFrame(io, [paint("title", label), `${text}▌`]);
    const key = await io.readKey();
    if (key.name === "backspace") text = [...text].slice(0, -1).join("");
    else if (key.name === "char" && [...text].length < max) text += key.char;
    else if (key.name === "enter") {
      const answer = text.trim() === "" && defaultValue !== undefined ? defaultValue : text.trim();
      const length = [...answer].length;
      if (length >= min && length <= max && pattern.test(answer)) return answer;
      say(io, t(ui, "input.invalid", { min, max }));
    }
  }
}

export async function textInput(io, ui, { prompt, min, max, pattern, defaultValue, label }) {
  if (io.frame && io.isTTY) return framedTextInput(io, ui, { min, max, pattern, defaultValue, label: label ?? prompt });
  for (;;) {
    let answer = (await io.ask(prompt)).trim();
    if (answer === "" && defaultValue !== undefined) answer = defaultValue;
    const length = [...answer].length;
    if (length >= min && length <= max && pattern.test(answer)) return answer;
    say(io, t(ui, "input.invalid", { min, max }));
  }
}
