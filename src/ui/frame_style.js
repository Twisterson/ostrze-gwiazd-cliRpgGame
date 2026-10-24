/**
 * The glyphs of a frame (all of them one column wide, so the geometry in frame.js does not depend on the style).
 * Block frame: solid corners, half-block edges, a shaded band behind the titles, zigzag dividers between the panels.
 */
export const FRAME = {
  corner: "█",
  top: "▀",
  bottom: "▄",
  left: "▌",
  right: "▐",
  /** the vertical bar between the scene and the choice panel */
  bar: "▒",
  /** where that bar meets a horizontal band (the title row and the closing row) */
  junction: "▓",
  /** repeated behind the titles in the title row */
  band: "░▒▒░",
  /** the horizontal divider between rows of text */
  zigzag: "▄▀",
};

/** `n` columns of `pattern` repeated (cut at `n`). */
export function repeatTo(pattern, n) {
  if (n <= 0) return "";
  return pattern.repeat(Math.ceil(n / pattern.length)).slice(0, n);
}
