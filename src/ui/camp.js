import { select } from "./menu.js";
import { pressEnter, confirm } from "./prompt.js";
import { pushNotice } from "./screen.js";
import { showInventory } from "./inventory_screen.js";
import { showCharacter } from "./character_screen.js";
import { showJournal } from "./journal_screen.js";
import { saveToSlot } from "./save_screen.js";
import { saveGame, SaveError } from "../engine/save.js";
import { paint } from "./colors.js";
import { t } from "./strings.js";
import { QuitToMenuError } from "../scenes/errors.js";

/**
 * Camp menu shown at the end of narration, reward and rest scenes. Returns on "Dalej" (undefined) or on one of the
 * `before` items (listed above "Dalej") or `extra` items (right after it) – their `id`. Without a character (before the
 * creator) it is a plain "press Enter".
 * @param {object} ctx
 * @param {() => void} render redraws the scene screen after a sub-screen
 * `initial` is the row the cursor starts on (and an empty line-mode answer picks); "Dalej" by default.
 * @param {{ continueLabel?: string|false, before?: Array<{ id: string, label: string, description?: string, hint?: string, disabled?: boolean }>, extra?: Array<{ id: string, label: string, description?: string, hint?: string, disabled?: boolean }>, initial?: number, title?: string, preview?: (cursor: number) => string[] }} [opts]
 * (rows may carry `description` for the description field, `hint` and `disabled`; `title` heads the choice panel, `preview` fills the scene panel; `continueLabel: false` leaves out "Dalej")
 */
export async function campMenu(ctx, render, { continueLabel, before = [], extra = [], initial, title, preview } = {}) {
  const { state, data, io } = ctx;
  const { ui } = data;
  if (!state.character) return pressEnter(io, ui);
  const hasContinue = continueLabel !== false; // `false`: no "Dalej" row at all
  const row = (e) => ({ label: e.label, description: e.description, hint: e.hint, disabled: e.disabled });
  const start = initial ?? (hasContinue ? before.length : 0);
  for (;;) {
    const items = [
      ...before.map(row),
      ...(hasContinue ? [{ label: continueLabel ?? t(ui, "camp.continue") }] : []),
      ...extra.map(row),
      { label: t(ui, "camp.character"), hotkey: "p", hidden: true },
      { label: t(ui, "camp.inventory"), hotkey: "e", hidden: true },
      { label: t(ui, "camp.journal"), hotkey: "d", hidden: true },
      { label: t(ui, "camp.save"), hotkey: "z", hidden: true },
      { label: t(ui, "camp.menu"), hotkey: "m", hidden: true },
    ];
    const pick = await select(io, ui, { items, initial: start, emptyPicksInitial: true, title, preview });
    if (pick < before.length) return before[pick].id;
    let rest = pick - before.length;
    if (hasContinue) {
      if (rest === 0) return undefined;
      rest -= 1;
    }
    if (rest < extra.length) return extra[rest].id;
    const fixed = rest - extra.length + 1;
    if (fixed === 1) await showCharacter(ctx);
    else if (fixed === 2) await showInventory(ctx);
    else if (fixed === 3) await showJournal(ctx);
    else if (fixed === 4) await saveToSlot(ctx);
    else {
      if (await confirm(io, ui, t(ui, "confirm.saveOnExit"))) {
        try {
          await saveGame("auto", state, ctx.rng);
        } catch (err) {
          if (!(err instanceof SaveError)) throw err;
          pushNotice(ctx, paint("warn", t(ui, "save.failed", { reason: err.message })));
        }
      }
      throw new QuitToMenuError();
    }
    await render();
  }
}
