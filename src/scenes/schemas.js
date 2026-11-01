const ID = /^[a-z0-9_]+$/;

const common = {
  id: { type: "string", pattern: ID },
  type: { type: "string" },
  if: { type: "object" },
  goto: { type: "string" },
  time: { type: "integer", min: 0 },
  tags: { type: "array", items: { type: "string" } },
  art: { type: "string", pattern: ID }, // an illustration (data/art), checked in validateScenes
  waitUntil: { type: "integer", min: 0 }, // the scene starts at this hour (0–23, max checked in validateScenes)
};

/** Fields of a fight, shared by the `combat` scene and `dialogue.onCombat` (content checked in validateScenes). */
const ENEMY_GROUP = {
  type: "array",
  items: { type: "object", required: ["id"], fields: { id: { type: "string" }, count: { type: "integer", min: 1 } }, additional: false },
};
const COMBAT_FIELDS = {
  enemies: ENEMY_GROUP,
  reinforcements: ENEMY_GROUP,
  start: { type: "string", enum: ["far", "melee"] },
  canFlee: { type: "boolean" },
  ambush: { type: "boolean" },
  onFlee: { type: "string" },
  onDefeat: { type: "string" },
  nonLethal: { type: "boolean" },
  training: { type: "boolean" },
  quiet: { type: "boolean" },
  minutes: { type: "integer", min: 1 },
  title: { type: "string" },
  // Scene loot, given once after a win (entries as in enemy loot; checked in validateScenes).
  loot: { type: "array" },
};

// Common fields without `time` (for scenes that move the clock themselves).
const { time: _time, ...commonUntimed } = common;

const scene = (required, fields) => ({
  type: "object",
  required: ["id", "type", ...required],
  fields: { ...common, ...fields },
  additional: false,
});

export const SCENE_TYPES = {
  narration: scene(["text"], {
    text: { type: "string", nonEmpty: true },
    title: { type: "string" },
  }),
  flag: scene(["set"], {
    set: { type: "object", values: { type: "boolean" } },
  }),
  var: scene(["add"], {
    add: { type: "object", values: { type: "integer" } },
  }),
  save_point: scene([], {}),
  character_creation: scene([], {}),
  // `items` entries (id string or {id, qty}) are checked in validateScenes, which also knows the item list.
  reward: scene([], {
    xp: { type: "integer", min: 0 },
    money: { type: "integer", min: 0 },
    items: { type: "array" },
  }),
  // `add`/`remove` ids are checked in validateScenes, which also knows the effect list.
  effect: scene([], {
    add: { type: "array", items: { type: "string" } },
    remove: { type: "array", items: { type: "string" } },
    force: { type: "boolean" },
  }),
  rest: scene([], { allowExposure: { type: "boolean" } }),
  // `shop` must name a merchant from shops.json (checked in validateScenes).
  shop: scene(["shop"], { shop: { type: "string", nonEmpty: true } }),
  // `dialogue` must name a file from dialogues/ (checked in validateScenes); `onCombat` starts a fight after a `walka` result.
  dialogue: scene(["dialogue"], {
    dialogue: { type: "string", nonEmpty: true },
    camp: { type: "boolean" }, // false: no camp menu after the talk (the next scene is a fight, a menu would be an empty screen)
    onCombat: { type: "object", required: ["enemies"], fields: COMBAT_FIELDS, additional: false },
  }),
  combat: scene(["enemies"], COMBAT_FIELDS),
  // `phenomenon` must name an entry of phenomena.json (checked in validateScenes); it starts right away.
  phenomenon: scene(["phenomenon"], { phenomenon: { type: "string", nonEmpty: true } }),
  // `hub` must be a permanent location of travel.json and `main.goto` a story scene (checked in validateScenes); the way on is
  // only through `main.goto`.
  map: {
    type: "object", required: ["id", "type", "hub", "main"], additional: false,
    fields: (({ time: _t, goto: _g, ...rest }) => ({ ...rest, hub: { type: "string", nonEmpty: true }, title: { type: "string", nonEmpty: true },
      arriveAt: { type: "string" }, leaves: { type: "string" }, starts: { type: "array", items: { type: "string" } }, exitWhen: { type: "object", required: ["if", "goto"], fields: { if: { type: "object" }, goto: { type: "string" }, warn: { type: "boolean" }, forced: { type: "object" } }, additional: false },
      main: { type: "object", required: ["label", "goto"], fields: { label: { type: "string", nonEmpty: true }, doneLabel: { type: "string", nonEmpty: true }, goto: { type: "string" } }, additional: false } }))(common),
  },
  // Exactly one of start / complete / fail, naming a quest of quests.json (checked in validateScenes).
  quest: scene([], { start: { type: "string" }, complete: { type: "string" }, fail: { type: "string" }, report: { type: "string" } }),
  // `route` must name a route of travel.json (checked in validateScenes); the scene takes days, so it has no `time`.
  travel: { ...scene(["route"], { route: { type: "string", nonEmpty: true } }), fields: { ...commonUntimed, route: { type: "string", nonEmpty: true }, title: { type: "string", nonEmpty: true } } },
  ending: scene(["text"], {
    text: { type: "string", nonEmpty: true },
  }),
};
