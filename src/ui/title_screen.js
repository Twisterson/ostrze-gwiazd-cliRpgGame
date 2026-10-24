/**
 * The title screen: a night sky over a ridge with the Observatory, a sword planted in the ground and the logo, drawn as
 * half-block pixels to fill the whole scene panel. Pure: `titleLines` builds the lines of one animation frame (`tick`);
 * the menu redraws it a few times a second. Without colours (or too small) it returns a plain still picture.
 */
const RESET = "\x1b[0m";

// 5×7 glyphs of the letters of the logo ("1" = pixel)
const FONT = {
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
};
const LOGO = ["OSTRZE", "GWIAZD"];
const SKY = [16, 16, 17, 17, 17, 18, 18, 19, 19, 53, 53, 54, 89, 95];
const hash = (n) => { let x = (n * 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return x >>> 0; };

/** Pixel size of the logo at `scale`: two lines of six 5×7 letters with 1-pixel gaps. */
const logoSize = (scale) => ({ w: (6 * 5 + 5) * scale, h: (7 * 2 + 2) * scale });

function chooseScale(width, rows2) {
  for (const s of [3, 2, 1]) {
    const { w, h } = logoSize(s);
    if (w <= width - 4 && h + 14 <= rows2) return s;
  }
  return 0;
}

/** The pixel canvas of one frame: `grid[y][x]` is an xterm-256 colour index. */
function paintCanvas(width, rows2, tick) {
  const grid = Array.from({ length: rows2 }, () => new Array(width).fill(16));
  const horizon = Math.floor(rows2 * 0.68);
  // sky: bands from black to a dusky glow at the horizon, the glow breathing a little
  for (let y = 0; y < horizon; y++) {
    const f = y / horizon;
    let c = SKY[Math.min(SKY.length - 1, Math.floor(f * SKY.length))];
    if (f > 0.78 && Math.sin(tick / 9 + y) > 0.55) c = SKY[Math.min(SKY.length - 1, Math.floor(f * SKY.length) + 1)];
    grid[y].fill(c);
  }
  // stars: deterministic positions, each twinkles with its own phase
  const count = Math.floor((width * horizon) / 55);
  for (let i = 0; i < count; i++) {
    const h = hash(i + 7);
    const x = h % width;
    const y = Math.floor(((h >>> 8) % 1000) / 1000 * (horizon * 0.82));
    const phase = (tick + (h >>> 20)) % 24;
    grid[y][x] = phase < 3 ? 255 : phase < 12 ? 250 : phase < 18 ? 244 : 240;
    if (i % 11 === 0 && phase < 3 && x + 1 < width) grid[y][x + 1] = 244;
  }
  // a falling star every ~70 ticks: a bright head with a fading trail
  const cycle = tick % 70;
  if (cycle < 24) {
    const hx = width - 4 - Math.floor(cycle * (width * 0.032) * 1.0);
    const hy = 2 + Math.floor(cycle * (horizon * 0.032));
    const trail = [231, 229, 223, 217, 181, 145, 102, 240];
    for (let k = 0; k < trail.length; k++) {
      const x = hx + k * 2; const y = hy - k;
      if (x >= 0 && x < width && y >= 0 && y < horizon) grid[y][x] = trail[k];
      if (x + 1 < width && y >= 0 && y < horizon && k < 4) grid[y][x + 1] = trail[k];
    }
  }
  // far ridge, then the near hill (silhouettes)
  const ridge = (x) => horizon - Math.floor(2 + 2.2 * Math.sin(x / 7) + 1.6 * Math.sin(x / 3.1 + 1) + 0.04 * x);
  for (let x = 0; x < width; x++) for (let y = Math.max(0, ridge(x)); y < rows2; y++) grid[y][x] = 235;
  const hill = (x) => horizon + 2 - Math.floor(3 * Math.sin(x / 11 + 2) + 0.03 * Math.abs(x - width * 0.72));
  for (let x = 0; x < width; x++) for (let y = Math.max(0, hill(x)); y < rows2; y++) grid[y][x] = y > horizon + 8 ? 233 : 234;
  const set = (x, y, c) => { if (y >= 0 && y < rows2 && x >= 0 && x < width) grid[y][x] = c; };
  // the Observatory on the right hill: tower, dome, telescope, a flickering window
  const tx = Math.floor(width * 0.74);
  const base = hill(tx);
  const th = Math.max(8, Math.floor(rows2 * 0.2));
  for (let y = base - th; y <= base; y++) for (let x = tx - 3; x <= tx + 3; x++) set(x, y, 232);
  for (let x = tx - 4; x <= tx + 4; x++) set(x, base - th - 1, 232);
  for (let k = 0; k < 4; k++) for (let x = tx - 3 + k; x <= tx + 3 - k; x++) set(x, base - th - 2 - k, 232);
  for (let k = 0; k < 6; k++) set(tx + 3 + k, base - th - 4 - Math.floor(k / 2), 232);
  const flick = (tick % 17 < 2) ? 94 : (tick % 5 < 3 ? 220 : 214);
  for (let y = base - th + 3; y <= base - th + 4; y++) { set(tx - 1, y, flick); set(tx, y, flick); }
  set(tx, base - th + 8, flick === 94 ? 94 : 178);
  // the sword planted in the ground on the left: blade, guard, grip and a glint on the tip
  const sx = Math.floor(width * 0.12);
  const sb = Math.min(rows2 - 2, hill(sx) + 3);
  const bladeTop = Math.max(2, sb - Math.floor(rows2 * 0.34));
  for (let y = bladeTop; y < sb; y++) { set(sx, y, 250); set(sx + 1, y, 244); }
  for (let x = sx - 3; x <= sx + 4; x++) set(x, sb - 5, 137);
  for (let y = sb - 4; y < sb; y++) set(sx, y, 94);
  const glint = tick % 40;
  if (glint < 4) {
    set(sx, bladeTop, 231); set(sx, bladeTop - 1, 231);
    if (glint === 1 || glint === 2) { set(sx - 1, bladeTop, 255); set(sx + 2, bladeTop, 255); }
  }
  // the logo
  const scale = chooseScale(width, rows2);
  if (scale > 0) {
    const { w, h } = logoSize(scale);
    const ox = Math.floor((width - w) / 2);
    const oy = Math.max(2, Math.floor((horizon - h) / 3));
    const sweep = (tick * 2) % (w + h + 40) - 20; // a bright diagonal that runs across the letters
    LOGO.forEach((word, row) => {
      [...word].forEach((ch, i) => {
        const glyph = FONT[ch];
        for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
          if (glyph[gy][gx] !== "1") continue;
          for (let sy = 0; sy < scale; sy++) for (let sx2 = 0; sx2 < scale; sx2++) {
            const px = ox + (i * 6 + gx) * scale + sx2;
            const py = oy + (row * 9 + gy) * scale + sy;
            if (px < 0 || px >= width || py < 0 || py >= rows2) continue;
            if (py + 1 < rows2 && px + 1 < width && grid[py + 1][px + 1] !== 255) grid[py + 1][px + 1] = 52; // a dark red shadow
            const diag = (px - ox) + (py - oy);
            const near = Math.abs(diag - sweep) < 3;
            grid[py][px] = near ? 231 : (gy < 3 ? 252 : gy < 5 ? 250 : 246);
          }
        }
      });
    });
  }
  return grid;
}

/** One text line from two pixel rows: runs of equal pixel pairs share one colour escape. */
function toLine(top, bottom) {
  let out = "";
  let run = 0;
  let t = -1; let b = -1;
  const flush = () => { if (run > 0) out += `\x1b[38;5;${t}m\x1b[48;5;${b}m${"▀".repeat(run)}${RESET}`; run = 0; };
  for (let x = 0; x < top.length; x++) {
    if (top[x] !== t || bottom[x] !== b) { flush(); t = top[x]; b = bottom[x]; }
    run++;
  }
  flush();
  return out;
}

const centred = (text, width) => " ".repeat(Math.max(0, Math.floor((width - [...text].length) / 2))) + text;

/**
 * The lines of the title screen at animation step `tick`, exactly `height` lines of `width` columns (colour) – or a plain
 * still picture of the same size without colours.
 */
export function titleLines({ width, height, tick = 0, color = true, subtitle = "" }) {
  if (!color) {
    const blank = " ".repeat(width);
    const lines = Array.from({ length: height }, () => blank);
    const mid = Math.max(0, Math.floor(height / 2) - 1);
    lines[mid] = centred("O S T R Z E   G W I A Z D", width).padEnd(width);
    if (subtitle && mid + 2 < height) lines[mid + 2] = centred(subtitle, width).padEnd(width);
    return lines;
  }
  const grid = paintCanvas(width, height * 2, tick);
  const lines = [];
  for (let r = 0; r < height; r++) lines.push(toLine(grid[2 * r], grid[2 * r + 1]));
  if (subtitle && height >= 12) {
    const row = Math.floor(height * 0.34) + 4;
    const text = ` ${subtitle} `;
    if (row < height - 2) {
      const pad = Math.max(0, Math.floor((width - [...text].length) / 2));
      lines[row] = " ".repeat(pad) + `\x1b[38;5;250m\x1b[48;5;232m${text}${RESET}`;
      // keep the exact width: the plain pad and text replace the pixels of that row
      const used = pad + [...text].length;
      lines[row] += " ".repeat(Math.max(0, width - used));
    }
  }
  return lines;
}
