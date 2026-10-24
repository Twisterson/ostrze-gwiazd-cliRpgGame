import { addVar } from "../systems/vars.js";

/** Changes numeric story variables silently. */
export async function varScene({ state }, scene) {
  addVar(state, scene.add);
}
