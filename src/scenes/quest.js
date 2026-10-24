import { pushEventNotices } from "../ui/events.js";
import { startQuest, completeQuest, failQuest } from "../systems/quests.js";

/** `quest` scene: takes on, completes or fails a quest; the notice shows on the next screen. */
export async function quest(ctx, scene) {
  const { state, data } = ctx;
  if (scene.start) pushEventNotices(ctx, startQuest(state, data, scene.start));
  else if (scene.report) {
    if (state.quests?.[scene.report]?.status === "active") state.quests[scene.report].reported = true;
  } else if (scene.complete) pushEventNotices(ctx, completeQuest(state, data, scene.complete));
  else pushEventNotices(ctx, failQuest(state, data, scene.fail));
}
