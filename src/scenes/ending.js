import { narration } from "./narration.js";

/** Like narration, then ends the game. */
export async function ending(ctx, scene) {
  await narration(ctx, scene);
  return { end: true };
}
