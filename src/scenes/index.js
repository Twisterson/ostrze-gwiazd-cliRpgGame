import { narration } from "./narration.js";
import { flag } from "./flag.js";
import { varScene } from "./var.js";
import { save_point } from "./save_point.js";
import { ending } from "./ending.js";
import { character_creation } from "./character_creation.js";
import { reward } from "./reward.js";
import { effect } from "./effect.js";
import { rest } from "./rest.js";
import { shop } from "./shop.js";
import { dialogue } from "./dialogue.js";
import { combat } from "./combat.js";
import { phenomenon } from "./phenomenon.js";
import { travel } from "./travel.js";
import { quest } from "./quest.js";
import { map } from "./map.js";

/** Scene type handlers, keyed by scene `type`. */
export const defaultHandlers = { narration, flag, var: varScene, save_point, ending, character_creation, reward, effect, rest, shop, dialogue, combat, phenomenon, travel, quest, map };
