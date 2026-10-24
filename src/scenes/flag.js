/** Sets story flags silently. */
export async function flag({ state }, scene) {
  Object.assign(state.flags, scene.set);
}
