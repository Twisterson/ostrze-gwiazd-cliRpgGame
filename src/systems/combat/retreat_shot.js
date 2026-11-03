/** The retreat shot: step back from one foe, fire the loaded weapon from the spare slot, take the main weapon back. */
import { itemById } from "../items.js";
import { swapWeapons } from "../inventory.js";
import { blockedSkill } from "../phenomena.js";
import { livingEnemies, enemyByUid } from "./state.js";
import { strike } from "./strike.js";
import { isFirearm, fireWeapon } from "./firearm.js";
import { stepBackAttack, cannotMove } from "./actions.js";

/** The spare weapon when it can be used for a retreat shot (has `retreatShotAp`), else null. */
const spareOf = (state, data) => {
  const id = state.inventory.equipped.bron_zapas;
  const item = id ? itemById(data, id) : null;
  return item?.retreatShotAp ? item : null;
};

/**
 * Availability of the retreat shot: null when the spare slot holds no weapon with `retreatShotAp` or the hand holds a
 * ranged weapon (it could not be taken back as a melee one); else `{ apCost, reason? }` with the first blocking ui key.
 */
export function retreatShotOption(state, data, combat) {
  const spare = spareOf(state, data);
  if (!spare) return null;
  const hand = state.inventory.equipped.bron;
  if (hand && itemById(data, hand).range !== "melee") return null;
  const apCost = spare.retreatShotAp;
  const loaded = state.inventory.loaded?.[spare.id] ?? 0;
  const reason = blockedSkill(state, data, spare.skill) ? "combat.blockedByPhenomenon"
    : combat.playerAp < apCost ? "combat.noAp"
      : cannotMove(data, state.character) ? "combat.slowed"
        : loaded < 1 ? "combat.notLoaded"
          : livingEnemies(combat).some((e) => e.band === "melee") ? undefined : "combat.noTarget";
  return { apCost, ...(reason ? { reason } : {}) };
}

/**
 * Performs the retreat shot at melee foe `uid` (already validated): spends the AP, the foe's free attack (the player
 * dying ends the action), the foe goes to `far`, the spare weapon is swapped in and fired without the melee penalty
 * (misfire, burst, noise, smoke as usual), then the main weapon is swapped back (after a burst only it is left).
 * @returns {object[]} events
 */
export function doRetreatShot(state, data, combat, uid, rng) {
  const events = [];
  const spare = spareOf(state, data);
  const target = enemyByUid(combat, uid);
  combat.playerAp -= spare.retreatShotAp;
  events.push(...stepBackAttack(state, data, combat, target, rng));
  if (state.character.hp <= 0) return events;
  target.band = "far";
  events.push({ type: "ruch", mover: "player", target: uid, band: "far" });
  swapWeapons(state, data);
  events.push(...(isFirearm(spare)
    ? fireWeapon(state, data, combat, spare, target, rng, { pointBlank: true })
    : strike(state, data, combat, { weapon: spare, target, rng, pointBlank: true })));
  swapWeapons(state, data);
  return events;
}
