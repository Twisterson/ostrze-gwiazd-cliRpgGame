import { runTrip } from "./trip.js";

/** `travel` scene: the story's trip along `scene.route` (see `runTrip`); the story goes on after the arrival. */
export async function travel(ctx, scene) {
  await runTrip(ctx, { route: scene.route });
}
