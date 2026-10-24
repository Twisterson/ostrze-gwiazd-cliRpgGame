import { saveGame, listSaves, SaveError } from "../engine/save.js";
import { select } from "./menu.js";
import { confirm } from "./prompt.js";
import { pushNotice, clear } from "./screen.js";
import { paint } from "./colors.js";
import { t } from "./strings.js";

const pad = (n) => String(n).padStart(2, "0");

/** "YYYY-MM-DD HH:MM" local time, "?" for a missing/invalid date. */
export function formatDate(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "?";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Label of an occupied slot (same format as the load menu). */
export function slotLabel(ui, save) {
  if (!save.ok) return t(ui, "load.corrupt", { slot: save.slot, reason: save.error });
  const { summary } = save;
  return t(ui, "load.entry", {
    slot: save.slot,
    scene: summary.sceneTitle ?? summary.sceneId,
    day: summary.day,
    date: formatDate(summary.savedAt),
  });
}

/** Lets the player pick slot 1-3 and saves there (asks before overwriting). */
export async function saveToSlot(ctx) {
  const { state, data, io, rng } = ctx;
  const { ui } = data;
  for (;;) {
    const saves = await listSaves(data);
    const items = ["1", "2", "3"].map((slot) => {
      const save = saves.find((s) => s.slot === slot);
      return { label: save ? slotLabel(ui, save) : t(ui, "save.slotEmpty", { slot }) };
    });
    items.push({ label: t(ui, "load.back") });
    const pick = await select(io, ui, { title: t(ui, "save.title"), items });
    if (pick === 3) return;
    const slot = String(pick + 1);
    if (saves.some((s) => s.slot === slot) && !(await confirm(io, ui, t(ui, "save.overwrite", { slot })))) {
      clear(io); // back to a fresh slot list, not a second copy under the old one
      continue;
    }
    try {
      await saveGame(slot, state, rng);
      pushNotice(ctx, t(ui, "save.done"));
    } catch (err) {
      if (!(err instanceof SaveError)) throw err;
      pushNotice(ctx, paint("warn", t(ui, "save.failed", { reason: err.message })));
    }
    return;
  }
}
