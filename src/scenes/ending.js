import { narration } from "./narration.js";
import { showEndScreen } from "../ui/end_screen.js";

/** Like narration, then the end screen ("THE END" and falling stars), then ends the game. */
export async function ending(ctx, scene) {
  await narration(ctx, scene);
  await showEndScreen(ctx);
  return { end: true };
}
