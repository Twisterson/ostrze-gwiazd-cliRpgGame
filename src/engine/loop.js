import { evaluate } from "./conditions.js";
import { defaultHandlers } from "../scenes/index.js";
import { advanceTime } from "./time.js";
import { defaultAfterScene } from "../scenes/after.js";
import { pushEventNotices } from "../ui/events.js";

/** Indexes scenes by id once; lookups and sequential navigation are O(1). */
export function createSceneList(scenes) {
  const index = new Map(scenes.map((scene, i) => [scene.id, i]));
  const indexOf = (id) => {
    if (!index.has(id)) throw new Error(`nieznana scena: ${id}`);
    return index.get(id);
  };
  return {
    scenes,
    has: (id) => index.has(id),
    get: (id) => scenes[indexOf(id)],
    nextId: (id) => {
      const next = scenes[indexOf(id) + 1];
      return next ? next.id : null;
    },
  };
}

/**
 * Runs scenes starting at `startId`, following if/goto/time/end per the spec's loop algorithm.
 * `opts.resume` starts at `startId` without judging its `if`; `opts.trackScene` records the scene in `state.scene.id`; `opts.onScene(id)` is told each scene before its handler;
 * a `goto` to `opts.endId` ends the list.
 */
export async function runScenes(ctx, list, startId, opts = {}) {
  const handlers = ctx.handlers ?? defaultHandlers;
  const hooks = ctx.afterScene ?? defaultAfterScene;
  let id = startId;
  let resuming = opts.resume === true; // the first scene was already entered (its actions may have changed its `if`)
  while (id) {
    const scene = list.get(id);
    if (opts.trackScene) ctx.state.scene.id = id;
    opts.onScene?.(id);
    const skipIf = resuming;
    resuming = false;
    if (!skipIf && scene.if && !evaluate(scene.if, ctx.state, ctx.data)) {
      id = list.nextId(id);
      continue;
    }
    if (scene.waitUntil !== undefined) {
      // The scene starts at this hour: wait for it today, or tomorrow when it has passed (the story's own clock, e.g. "noon", "midnight").
      const day = 24 * 60;
      const wait = (scene.waitUntil * 60 - (ctx.state.time.minutes % day) + day) % day;
      if (wait > 0) pushEventNotices(ctx, advanceTime(ctx.state, wait, ctx.data, ctx.rng));
    }
    const handler = Object.hasOwn(handlers, scene.type) ? handlers[scene.type] : undefined;
    if (!handler) throw new Error(`brak handlera dla typu sceny: ${scene.type}`);
    const result = (await handler(ctx, scene)) ?? {};
    if (scene.time) {
      pushEventNotices(ctx, advanceTime(ctx.state, scene.time, ctx.data, ctx.rng));
    }
    for (const hook of hooks) await hook(ctx);
    if (result.end) {
      return result.outcome === undefined ? { end: true } : { end: true, outcome: result.outcome };
    }
    id = result.goto ?? scene.goto ?? list.nextId(id);
    if (opts.endId !== undefined && id === opts.endId) break;
  }
  return { end: true };
}

/** Runs the whole story from the current scene recorded in the state. */
export async function runStory(ctx) {
  for (const hook of ctx.afterScene ?? defaultAfterScene) await hook(ctx);
  return runScenes(ctx, ctx.story, ctx.state.scene.id, { trackScene: true });
}
