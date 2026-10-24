import { applyEffect, removeEffect } from "../systems/effects.js";
import { pushEventNotices } from "../ui/events.js";
import { MissingCharacterError } from "./errors.js";

/** Removes then applies status effects silently (notices appear on the next screen). */
export async function effect(ctx, scene) {
  const { state, data, rng } = ctx;
  if (!state.character) throw new MissingCharacterError();
  const events = [];
  for (const id of scene.remove ?? []) {
    if (removeEffect(state, id).removed) events.push({ type: "efekt_koniec", id });
  }
  for (const id of scene.add ?? []) {
    const r = applyEffect(state, data, id, rng, { force: scene.force === true });
    events.push({ type: r.resisted ? "efekt_odparty" : "efekt_nalozony", id });
  }
  pushEventNotices(ctx, events);
}
