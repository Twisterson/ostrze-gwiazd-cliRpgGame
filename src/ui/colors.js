import { styleText } from "node:util";

const STYLES = {
  title: "bold",
  dim: "gray",
  damage: "red",
  heal: "green",
  foe_down: "blue",
  check: "yellow",
  mystic: "magenta",
  warn: ["yellow", "bold"],
  hp_ok: "green",
  hp_mid: "yellow",
  hp_low: ["red", "bold"],
  xp: "blue",
  ap: "blue",
  gold: "yellow",
  bad: "red",
  worn: "greenBright",
  leading: "cyanBright",
};

/** Frame colours from the 256-colour palette (dark green lines, brown titles), with plain fallbacks. */
const RICH = {
  frame: { on: "\x1b[38;5;28m", off: "\x1b[39m", fallback: "green" },
  frame_shade: { on: "\x1b[38;5;22m", off: "\x1b[39m", fallback: "green" },
  frame_title: { on: "\x1b[1;38;5;130m", off: "\x1b[22;39m", fallback: ["yellow", "bold"] },
  heading: { on: "\x1b[1;38;5;179m", off: "\x1b[22;39m", fallback: ["yellow", "bold"] },
};

let enabled = null;
let rich = null;

export function setColorsEnabled(on) { enabled = Boolean(on); }

/** Overrides the 256-colour detection (tests); `null` detects again from the environment. */
export function setRich256(on) { rich = on === null ? null : Boolean(on); }

/**
 * True when the terminal has 256 colours: TERM …256color, COLORTERM truecolor/24bit, or the colour depth Node reports for the
 * stream (cmd.exe and PowerShell on Windows set neither variable, yet have 24 bits).
 */
export function detect256(env, stream) {
  return /256color/.test(env.TERM ?? "") || ["truecolor", "24bit"].includes(env.COLORTERM ?? "") || (stream.getColorDepth?.() ?? 1) >= 8;
}

function supports256() {
  if (rich === null) rich = detect256(process.env, process.stdout);
  return rich;
}

/** The player's choice for pictures, in the order the main menu goes through them. */
export const GRAPHICS = ["color", "gray", "none"];
let graphics = "color";

export function setGraphics(mode) { graphics = mode; }
export function getGraphics() { return graphics; }

/** How pictures are drawn now: the player's choice, or "none" on a terminal that cannot show them. Frames and text do not depend on it. */
export function graphicsMode() { return useColor() ? graphics : "none"; }

/** True when frames and art should use colour: colours are on (a TTY, no NO_COLOR) and the terminal has 256 of them. */
export function useColor() {
  if (enabled === null) enabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
  return enabled && supports256();
}

export function paint(role, text) {
  if (enabled === null) enabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
  if (!enabled || !role) return text;
  const special = RICH[role];
  if (special) return supports256() ? `${special.on}${text}${special.off}` : styleText(special.fallback, text, { validateStream: false });
  return styleText(STYLES[role], text, { validateStream: false });
}
