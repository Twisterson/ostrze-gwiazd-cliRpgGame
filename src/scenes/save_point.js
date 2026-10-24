import { saveGame, SaveError } from "../engine/save.js";
import { paint } from "../ui/colors.js";
import { pushNotice } from "../ui/screen.js";
import { t } from "../ui/strings.js";

/** Writes the "auto" slot; the result is queued as a notice and a failed save never aborts the game. */
export async function save_point(ctx) {
  const { state, data, rng } = ctx;
  try {
    await saveGame("auto", state, rng);
    pushNotice(ctx, paint("dim", t(data.ui, "save.done")));
  } catch (error) {
    if (!(error instanceof SaveError)) throw error;
    pushNotice(ctx, paint("warn", t(data.ui, "save.failed", { reason: error.message })));
  }
}
