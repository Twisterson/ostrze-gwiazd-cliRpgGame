/** Renders `.pix` images (see src/engine/pix.js) as terminal cells: half blocks in 256 colours, or ASCII by brightness. */

const SYSTEM = [
  [0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0], [0, 0, 238], [205, 0, 205], [0, 205, 205], [229, 229, 229],
  [127, 127, 127], [255, 0, 0], [0, 255, 0], [255, 255, 0], [92, 92, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
];
const CUBE = [0, 95, 135, 175, 215, 255];
const RAMP = " .:-=+*#%@";
const RESET = "\x1b[0m";

/** Brightness 0–255 of a 256-colour terminal colour (xterm palette). */
export function luminance(index) {
  let rgb;
  if (index < 16) rgb = SYSTEM[index];
  else if (index < 232) {
    const n = index - 16;
    rgb = [CUBE[Math.floor(n / 36)], CUBE[Math.floor(n / 6) % 6], CUBE[n % 6]];
  } else {
    const v = 8 + 10 * (index - 232);
    rgb = [v, v, v];
  }
  return Math.round(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]);
}

/**
 * One line per two pixel rows. `color`: ▀ ▄ and spaces with 256-colour codes (a transparent pixel leaves the terminal's
 * background); otherwise a character from a brightness ramp (transparent cell = space).
 * @param {{ w: number, h: number, palette: Record<string, number>, rows: string[] }} art
 * @param {{ color: boolean }} opts
 * @returns {string[]}
 */
export function renderPixels(art, { color }) {
  const at = (row, x) => {
    const ch = [...art.rows[row]][x];
    return ch === "." ? null : art.palette[ch];
  };
  const lines = [];
  for (let y = 0; y < art.h; y += 2) {
    let line = "";
    for (let x = 0; x < art.w; x++) {
      const top = at(y, x);
      const bottom = at(y + 1, x);
      if (top === null && bottom === null) {
        line += " ";
      } else if (color) {
        if (bottom === null) line += `\x1b[38;5;${top}m▀${RESET}`;
        else if (top === null) line += `\x1b[38;5;${bottom}m▄${RESET}`;
        else line += `\x1b[38;5;${top}m\x1b[48;5;${bottom}m▀${RESET}`;
      } else {
        const shades = [top, bottom].filter((v) => v !== null).map(luminance);
        const mean = shades.reduce((a, b) => a + b, 0) / shades.length;
        line += RAMP[Math.round((mean / 255) * (RAMP.length - 1))];
      }
    }
    lines.push(line);
  }
  return lines;
}
