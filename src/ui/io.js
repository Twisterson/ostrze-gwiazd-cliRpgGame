import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { stripVTControlCharacters } from "node:util";

export class InputClosedError extends Error {
  constructor(message = "Wejście zostało zamknięte.") { super(message); this.name = "InputClosedError"; }
}
export class InterruptError extends Error {
  constructor(message = "Przerwano (Ctrl+C).") { super(message); this.name = "InterruptError"; }
}
export class InputExhaustedError extends Error {
  constructor(message = "Skończyły się zaplanowane odpowiedzi.") { super(message); this.name = "InputExhaustedError"; }
}

/**
 * `resize` is not a real key: the window changed size and whoever waits for a key should draw the screen again.
 * @typedef {{ name: "up"|"down"|"left"|"right"|"enter"|"escape"|"backspace"|"char"|"resize", char?: string }} Key
 */

/** A window being dragged sends a burst of size changes: the screen is drawn once they stop for this long. */
const RESIZE_SETTLE_MS = 40;

const KEY_TOKENS = {
  "<up>": "up", "<down>": "down", "<left>": "left", "<right>": "right",
  "<enter>": "enter", "<esc>": "escape", "<backspace>": "backspace", "<resize>": "resize",
};
const NAMED_KEYS = {
  up: "up", down: "down", left: "left", right: "right",
  return: "enter", enter: "enter", escape: "escape", backspace: "backspace",
};

/** @returns {Key|null} null = key to ignore */
function mapKeypress(str, key) {
  const mapped = key && NAMED_KEYS[key.name];
  if (mapped) return { name: mapped };
  const seq = (key && key.sequence) || str;
  if (typeof seq === "string" && [...seq].length === 1 && seq >= " " && seq !== "\x7f") return { name: "char", char: seq };
  return null;
}

export function createScriptedIO(inputs, { tty = false } = {}) {
  const queue = [...inputs];
  const output = [];
  const typed = [];
  function take() {
    if (queue.length === 0) throw new InputExhaustedError();
    const next = queue.shift();
    if (next === "^C") throw new InterruptError();
    if (next === "^D") throw new InputClosedError();
    return next;
  }
  return {
    output,
    columns: 80,
    rows: 24,
    isTTY: tty,
    write(text) { output.push(`${text}\n`); },
    writeRaw(text) { output.push(text); },
    async ask(question) {
      output.push(question);
      return take();
    },
    /** @returns {Promise<Key>} */
    async readKey() {
      if (typed.length) return typed.shift();
      const next = take();
      if (KEY_TOKENS[next]) return { name: KEY_TOKENS[next] };
      if (next === "") return { name: "enter" }; // an empty answer is Enter (a prompt that waits for a key in a frame)
      const chars = [...next];
      if (chars.length === 1) return { name: "char", char: next };
      if (/^<.*>$/.test(next)) throw new Error(`nieznany token klawisza: ${next}`);
      // typed text (a name): key by key, then Enter
      typed.push(...chars.slice(1).map((char) => ({ name: "char", char })), { name: "enter" });
      return { name: "char", char: chars[0] };
    },
    discardInput() {},
    close() {},
    text() { return stripVTControlCharacters(output.join("")); },
  };
}

/** Marks a Ctrl+C that arrived inside a pasted chunk. */
const INTERRUPT = Symbol("interrupt");

export function createTerminalIO({ input = process.stdin, output = process.stdout } = {}) {
  const rl = createInterface({ input, output, terminal: Boolean(output.isTTY), historySize: 0 });
  const lines = [];
  let closed = false;
  let waiter = null;
  let keyWaiter = null;
  /** keys of a pasted chunk after the one readKey returned */
  let ahead = [];
  /** stops collecting the rest of a pasted chunk and drops it */
  let endTail = null;
  /** readline's own 'keypress' listeners, detached while readKey owns the keys */
  let held = null;
  /** readline's 'resize' listeners on output, detached together with the keypress ones */
  let heldResize = null;
  /** keys arriving before this time (ms since epoch) are ignored, see discardInput */
  let discardUntil = 0;
  let resizeTimer = null;
  /** the window changed size while nobody waited for a key: the next readKey reports it */
  let resizePending = false;

  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (keyWaiter) keyWaiter.resize();
      else resizePending = true;
    }, RESIZE_SETTLE_MS);
    resizeTimer.unref?.();
  };
  if (output.isTTY) output.on("resize", onResize);

  function suspendReadline() {
    if (held) return;
    held = input.listeners("keypress");
    for (const l of held) input.off("keypress", l);
    heldResize = output.listeners("resize").filter((l) => l !== onResize);
    for (const l of heldResize) output.off("resize", l);
  }
  function resumeReadline() {
    if (!held || keyWaiter) return;
    const restore = held;
    const restoreResize = heldResize ?? [];
    held = null;
    heldResize = null;
    if (closed) return;
    for (const l of restore) input.on("keypress", l);
    for (const l of restoreResize) output.on("resize", l);
  }

  rl.on("line", (line) => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w.resolve(line);
    } else {
      lines.push(line);
    }
  });
  rl.on("SIGINT", () => {
    if (!waiter) return;
    const w = waiter;
    waiter = null;
    w.reject(new InterruptError());
  });
  rl.on("close", () => {
    closed = true;
    output.off("resize", onResize);
    clearTimeout(resizeTimer);
    if (keyWaiter) keyWaiter.reject(new InputClosedError());
    if (!waiter || lines.length > 0) return;
    const w = waiter;
    waiter = null;
    w.reject(new InputClosedError());
  });

  return {
    rl,
    isTTY: Boolean(output.isTTY),
    diffFrames: Boolean(output.isTTY), // a frame is updated row by row; `shown` is what is on the screen (see drawFrame)
    shown: null,
    written: [], // the lines written since the last clear: a screen without frames is repainted from them after a resize
    get columns() { return output.columns || 80; },
    get rows() { return output.rows || 24; },
    write(text) { this.shown = null; this.written.push(text); output.write(`${text}\n`); },
    writeRaw(text) { output.write(text); },
    ask(question) {
      this.shown = null; // the prompt is written past the frame: the next frame starts from a clean screen
      return new Promise((resolve, reject) => {
        endTail?.();
        resumeReadline();
        if (lines.length > 0) {
          output.write(question);
          resolve(lines.shift());
          return;
        }
        if (closed) { reject(new InputClosedError()); return; }
        rl.setPrompt(question);
        rl.prompt();
        waiter = { resolve, reject };
      });
    },
    /** @returns {Promise<Key>} */
    readKey() {
      if (!output.isTTY) return Promise.reject(new Error("readKey wymaga terminala"));
      if (closed) return Promise.reject(new InputClosedError());
      if (resizePending) { resizePending = false; return Promise.resolve({ name: "resize" }); }
      if (ahead.length) { // the rest of a pasted chunk
        const next = ahead.shift();
        return next === INTERRUPT ? Promise.reject(new InterruptError()) : Promise.resolve(next);
      }
      endTail?.();
      return new Promise((resolve, reject) => {
        emitKeypressEvents(input);
        const settle = () => {
          input.off("keypress", onKey);
          keyWaiter = null;
          // The other keys of the same chunk (pasted text) arrive at once: collect them for the next readKey calls
          // until the chunk is over (next tick), where readline gets its handlers back.
          input.on("keypress", onTail);
          const end = () => { input.off("keypress", onTail); if (endTail === end) { endTail = null; ahead = []; } };
          endTail = end;
          setImmediate(() => { end(); resumeReadline(); });
        };
        const onTail = (str, key) => {
          if (key && key.ctrl && key.name === "c") { ahead.push(INTERRUPT); return; }
          if (Date.now() < discardUntil) return;
          const mapped = mapKeypress(str, key);
          if (mapped) ahead.push(mapped);
        };
        const onKey = (str, key) => {
          if (key && key.ctrl && key.name === "c") { settle(); reject(new InterruptError()); return; }
          if (Date.now() < discardUntil) return;
          const mapped = mapKeypress(str, key);
          if (!mapped) return;
          settle();
          resolve(mapped);
        };
        keyWaiter = { reject: (e) => { settle(); reject(e); }, resize: () => { settle(); resolve({ name: "resize" }); } };
        suspendReadline();
        input.on("keypress", onKey);
      });
    },
    /** Ignores keys typed ahead of a freshly shown screen (e.g. a held Enter) for `graceMs`. */
    discardInput(graceMs = 150) { discardUntil = Date.now() + graceMs; endTail?.(); ahead = []; },
    close() { rl.close(); },
  };
}
