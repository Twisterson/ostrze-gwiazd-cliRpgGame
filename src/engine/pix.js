/** The `.pix` art format: a palette line, then a grid of palette letters (`.` = transparent). */

/** Size limits in pixels by the way an image is used (checked against the field that names it). */
export const ART_LIMITS = {
  scene: { w: 96, h: 48 },
  portrait: { w: 48, h: 48 },
  enemy: { w: 64, h: 48 },
};

export class PixError extends Error {}

/**
 * Messages (`field: …`) for a reference to image `id` used as `kind` (a key of ART_LIMITS): the image must exist and fit the
 * kind's limit. Nothing for a non-string `id` (the shape check reports that).
 */
export function artRefErrors(data, id, kind, field = "art") {
  if (typeof id !== "string") return [];
  const image = data.art?.[id];
  if (!image) return [`${field}: nieznana grafika ${JSON.stringify(id)}`];
  const max = ART_LIMITS[kind];
  return image.w > max.w || image.h > max.h ? [`${field}: grafika ${image.w}×${image.h} przekracza limit ${max.w}×${max.h}`] : [];
}

const PALETTE = /^paleta:\s*(.*)$/;

/**
 * Parses a `.pix` file: `#` lines are comments, `paleta: a=236 b=94` maps letters a–z, A–Z, 0–9 (up to 62 colours) to 256-colour numbers, the rest is the grid
 * (equal-length rows, an even number of them: two pixel rows make one terminal cell row).
 * @returns {{ w: number, h: number, palette: Record<string, number>, rows: string[] }}
 * @throws {PixError} `wiersz N: …` (N counts file lines from 1)
 */
export function parsePix(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  let palette = null;
  const rows = [];
  const rowAt = [];
  lines.forEach((raw, i) => {
    const n = i + 1;
    if (raw.startsWith("#") || raw.trim() === "") return;
    const head = PALETTE.exec(raw);
    if (head) {
      if (palette) throw new PixError(`wiersz ${n}: druga linia „paleta:”`);
      palette = {};
      for (const pair of head[1].split(/\s+/).filter(Boolean)) {
        const m = /^(.)=(\d+)$/.exec(pair);
        if (!m) throw new PixError(`wiersz ${n}: zły wpis palety „${pair}”`);
        if (!/^[a-zA-Z0-9]$/.test(m[1])) throw new PixError(`wiersz ${n}: litera palety „${m[1]}” – dozwolone a–z, A–Z, 0–9 („.” to przezroczystość)`);
        if (Number(m[2]) > 255) throw new PixError(`wiersz ${n}: numer koloru ${m[2]} poza 0–255`);
        if (m[1] in palette) throw new PixError(`wiersz ${n}: litera palety „${m[1]}” powtórzona`);
        palette[m[1]] = Number(m[2]);
      }
      return;
    }
    rows.push(raw);
    rowAt.push(n);
  });
  if (!palette) throw new PixError("brak linii „paleta:”");
  if (rows.length === 0) throw new PixError("pusta siatka");
  const w = [...rows[0]].length;
  rows.forEach((row, i) => {
    const chars = [...row];
    if (chars.length !== w) throw new PixError(`wiersz ${rowAt[i]}: wiersz ma ${chars.length} znaki, oczekiwano ${w}`);
    for (const ch of chars) if (ch !== "." && !(ch in palette)) throw new PixError(`wiersz ${rowAt[i]}: nieznana litera „${ch}”`);
  });
  if (rows.length % 2 !== 0) throw new PixError(`nieparzysta liczba wierszy (${rows.length})`);
  return { w, h: rows.length, palette, rows };
}
