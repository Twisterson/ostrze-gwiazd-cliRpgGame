/**
 * The end screen: a night sky with falling stars over a dark ridge and a big "THE END" in the middle, drawn as half-block pixels
 * to fill the scene panel (like the title screen). `endLines` builds one animation frame (`tick`); `showEndScreen` plays it in a
 * frame and waits for Enter, or – in line mode and in a window too small for a frame – prints one plain line and does not wait.
 */
import { FONT, SKY, hash, toLine } from "./title_screen.js";
import { framesOn, showScreen, sceneCapacity, pushNotice } from "./screen.js";
import { sceneFullWidth } from "./frame.js";
import { choose } from "./prompt.js";
import { paint, useColor } from "./colors.js";
import { t } from "./strings.js";
import { clockOf } from "../engine/time.js";

const WORDS = ["THE", "END"];
const GAP = 3; // pixels between the words, in glyph pixels
const TRAIL = [231, 229, 223, 217, 181, 145, 102, 240];

/** Size in pixels of the lettering at `scale`: "THE" and "END" side by side, 5×7 glyphs with 1-pixel gaps. */
const letteringSize = (scale) => ({ w: (WORDS[0].length * 6 - 1 + GAP + WORDS[1].length * 6 - 1) * scale, h: 7 * scale });

function chooseScale(width, rows2) {
  for (const s of [4, 3, 2, 1]) {
    const { w, h } = letteringSize(s);
    if (w <= width - 4 && h + 8 <= rows2 * 0.7) return s;
  }
  return 0;
}

const centred = (text, width) => {
  const pad = Math.max(0, Math.floor((width - [...text].length) / 2));
  return " ".repeat(pad) + text;
};

/** The pixel canvas of one frame: `grid[y][x]` is an xterm-256 colour index. */
function paintCanvas(width, rows2, tick) {
  const grid = Array.from({ length: rows2 }, () => new Array(width).fill(16));
  const horizon = Math.floor(rows2 * 0.8);
  for (let y = 0; y < horizon; y++) {
    const f = y / horizon;
    grid[y].fill(SKY[Math.min(SKY.length - 1, Math.floor(f * SKY.length))]);
  }
  const set = (x, y, c) => { if (y >= 0 && y < rows2 && x >= 0 && x < width) grid[y][x] = c; };
  // twinkling stars: deterministic positions, each with its own phase
  const count = Math.floor((width * horizon) / 45);
  for (let i = 0; i < count; i++) {
    const h = hash(i + 11);
    const x = h % width;
    const y = Math.floor(((h >>> 8) % 1000) / 1000 * (horizon * 0.9));
    const phase = (tick + (h >>> 20)) % 24;
    set(x, y, phase < 3 ? 255 : phase < 12 ? 250 : phase < 18 ? 244 : 240);
  }
  // falling stars: several at once, each with its own start, angle, speed, tail and rhythm
  const falling = Math.max(4, Math.floor(width / 18));
  for (let i = 0; i < falling; i++) {
    const h = hash(i * 131 + 5);
    const period = 46 + (h % 50);
    const phase = (tick + ((h >>> 5) % period)) % period;
    const life = 30;
    if (phase >= life) continue;
    const slope = 0.45 + ((h >>> 12) % 70) / 100; // rows per column
    const dx = 1.1 + ((h >>> 20) % 60) / 100;
    const startX = (h >>> 3) % (width + Math.floor(horizon / slope));
    const startY = ((h >>> 9) % Math.max(1, Math.floor(horizon * 0.35)));
    const hx = startX - phase * dx;
    const hy = startY + phase * dx * slope;
    for (let k = 0; k < TRAIL.length; k++) {
      const x = Math.round(hx + k * 1.6);
      const y = Math.round(hy - k * 1.6 * slope);
      if (y >= horizon) continue;
      set(x, y, TRAIL[k]);
      if (k < 3) set(x + 1, y, TRAIL[k]);
    }
  }
  // the ridge: a dark silhouette at the bottom
  const ridge = (x) => horizon - Math.floor(1 + 2.2 * Math.sin(x / 8) + 1.5 * Math.sin(x / 3.3 + 2));
  for (let x = 0; x < width; x++) for (let y = Math.max(0, ridge(x)); y < rows2; y++) set(x, y, y > horizon + 4 ? 233 : 235);
  // THE END: bright letters with a dark red shadow and a diagonal glint that crosses them
  const scale = chooseScale(width, rows2);
  if (scale > 0) {
    const { w, h } = letteringSize(scale);
    const ox = Math.floor((width - w) / 2);
    const oy = Math.max(2, Math.floor((horizon - h) / 2.4));
    const sweep = (tick * 2) % (w + h + 40) - 20;
    let cursor = 0;
    WORDS.forEach((word, wi) => {
      [...word].forEach((ch) => {
        const glyph = FONT[ch];
        for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
          if (glyph[gy][gx] !== "1") continue;
          for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
            const px = ox + (cursor + gx) * scale + sx;
            const py = oy + gy * scale + sy;
            if (py + 1 < rows2 && px + 1 < width && grid[py + 1][px + 1] !== 255) grid[py + 1][px + 1] = 52;
            const near = Math.abs((px - ox) + (py - oy) - sweep) < 3;
            set(px, py, near ? 231 : gy < 3 ? 252 : gy < 5 ? 250 : 246);
          }
        }
        cursor += 6;
      });
      if (wi === 0) cursor += GAP - 1;
    });
  }
  return grid;
}

/**
 * The lines of the end screen at animation step `tick`: exactly `height` lines of `width` columns – coloured pixels, or (no
 * colours / a window under 40×12) a plain still picture with the lettering as text.
 */
export function endLines({ width, height, tick = 0, color = true, plain = "T H E   E N D" }) {
  if (!color || width < 40 || height < 12) {
    const lines = Array.from({ length: height }, () => " ".repeat(width));
    const mid = Math.max(0, Math.floor(height / 2) - 1);
    lines[mid] = centred(plain, width).padEnd(width);
    return lines;
  }
  const grid = paintCanvas(width, height * 2, tick);
  return Array.from({ length: height }, (_, r) => toLine(grid[2 * r], grid[2 * r + 1]));
}

/** "Dzień 4 · Poziom 4 · Ukończone zlecenia: 2" – the run in one line. */
export function endStatsLine(state, ui) {
  const quests = Object.values(state.quests ?? {}).filter((q) => q.status === "done").length;
  return t(ui, "end.stats", { day: clockOf(state.time.minutes).day, level: state.character?.level ?? 1, quests });
}

/** Shows the end screen after the closing text: animated and waiting for Enter in a frame, one plain line otherwise. */
export async function showEndScreen(ctx) {
  const { io, data } = ctx;
  const ui = data.ui;
  const stats = paint("dim", endStatsLine(ctx.state, ui));
  if (!framesOn(io)) {
    io.write(paint("title", t(ui, "end.plain")));
    io.write(stats);
    return;
  }
  pushNotice(ctx, stats);
  await showScreen(ctx, { lines: [], hero: false, bare: true });
  const frame = (tick) => endLines({ width: sceneFullWidth(io.columns), height: sceneCapacity(io), tick, color: useColor(), plain: t(ui, "end.plain") });
  io.frame.body = frame(0);
  await choose(io, ui, [t(ui, "end.close")], undefined, { animate: { ms: 110, frame } });
}
