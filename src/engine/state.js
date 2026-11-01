import { GAME_VERSION, SAVE_FORMAT_VERSION } from "../config.js";

/** Creates a fresh game state for a new run. */
export function createNewState({ seed, startScene, rules }) {
  return {
    version: SAVE_FORMAT_VERSION,
    gameVersion: GAME_VERSION,
    savedAt: null,
    seed,
    rngState: seed >>> 0,
    time: { minutes: rules.startHour * 60 },
    scene: { id: startScene },
    context: "story",
    flags: {},
    vars: {},
    character: null,
    inventory: { items: [], equipped: {}, quickSlots: [], loaded: {} },
    artifacts: {},
    world: {
      location: rules.travel?.startLocation ?? null, locations: {}, travel: null, eventsSeen: [], failedChecks: [], finishedDialogues: [], dialogueProgress: {}, finishedCombats: {}, shops: {}, claimedRewards: [],
      phenomenon: null, phenomenonRolledDay: 0, map: null, discovered: [], hinted: [], search: 0, passes: {}, hunts: {},
    },
    quests: {},
  };
}
