import { forcePhenomenon } from "../systems/phenomena.js";
import { pushEventNotices } from "../ui/events.js";

/** Starts the named phenomenon right now (replacing a planned one); the notice appears on the next screen. */
export async function phenomenon(ctx, scene) {
  const { state, data, rng } = ctx;
  pushEventNotices(ctx, forcePhenomenon(state, data, scene.phenomenon, rng, state.time.minutes));
}
