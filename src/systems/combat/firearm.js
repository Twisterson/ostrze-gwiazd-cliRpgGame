/** Firearms: misfire, barrel burst, fear, noise (one-off reinforcements) and smoke around a normal player blow. */
import { getStats } from "../stats.js";
import { effectById, addToList } from "../effects.js";
import { destroyEquipped } from "../inventory.js";
import { livingEnemies, spawnEnemies } from "./state.js";
import { dealDamage } from "./formulas.js";
import { strike } from "./strike.js";

const roll100 = (rng) => rng.int(1, 100);

/** True for a weapon that carries firearm fields (data-driven: `misfireChance` is present). */
export const isFirearm = (weapon) => typeof weapon?.misfireChance === "number";

/** Misfire chance (%) of `weapon` for the current character: `max(1, misfireChance − fart − floor(proch / misfirePerProch))`. */
export function misfireChance(state, data, weapon) {
  const { attributes, skills } = getStats(state, data);
  return Math.max(1, weapon.misfireChance - attributes.fart - Math.floor((skills.proch ?? 0) / data.rules.combat.firearm.misfirePerProch));
}

/**
 * Adds the scene's `reinforcements` on the `far` band, once per fight (`combat.reinforced`); nothing when the scene has none.
 * Newcomers are numbered on from the enemies of the same id and join the end of the initiative order (no initiative roll).
 * @returns {object[]} `[{ type: "posilki", enemies: uids }]` or `[]`
 */
export function addReinforcements(state, data, combat, rng) { // eslint-disable-line no-unused-vars
  const groups = combat.def.reinforcements ?? [];
  if (combat.reinforced || groups.length === 0) return [];
  const before = combat.enemies.length;
  spawnEnemies(data, combat.enemies, groups, "far");
  const joined = combat.enemies.slice(before);
  combat.order.push(...joined.map((e) => e.uid));
  combat.reinforced = true;
  return [{ type: "posilki", enemies: joined.map((e) => e.uid) }];
}

/**
 * Fires `weapon` at `target`; the caller has already spent the AP. Roll order (fixed, one percent roll each unless noted):
 * 1. misfire (`<= misfireChance`): on a misfire the load is spent, no hit roll; then 2. burst (`<= burstChance`):
 *    the pistol is destroyed (one copy) and the player takes `rng.int(burstDamage)`; nothing more happens.
 * Otherwise: the normal `strike` rolls, then fear (no roll), 3. noise (`<= noise`) -> reinforcements, 4. smoke (`<= smoke`).
 * @param {object} [opts] extra `strike` options (aimed attack)
 * @returns {object[]} events: `niewypal { weapon }`, `rozerwanie { weapon, damage }`, strike events, `strach_bronia { fear }`,
 *   `posilki { enemies }`, `dym { id }`
 */
export function fireWeapon(state, data, combat, weapon, target, rng, opts = {}) {
  const events = [];
  if (roll100(rng) <= misfireChance(state, data, weapon)) {
    state.inventory.loaded[weapon.id] = (state.inventory.loaded?.[weapon.id] ?? 0) - 1;
    events.push({ type: "niewypal", weapon: weapon.id });
    if (roll100(rng) <= weapon.burstChance) {
      destroyEquipped(state, data, "bron");
      const [lo, hi] = weapon.burstDamage;
      events.push({ type: "rozerwanie", weapon: weapon.id, damage: dealDamage(combat, state.character, rng.int(lo, hi)) });
    }
    return events;
  }
  events.push(...strike(state, data, combat, { ...opts, weapon, target, rng }));
  if (weapon.fear > 0) {
    for (const e of livingEnemies(combat)) if (e.morale !== null && e.morale !== undefined) e.morale = Math.max(0, e.morale - weapon.fear);
    events.push({ type: "strach_bronia", fear: weapon.fear });
  }
  if (roll100(rng) <= weapon.noise) events.push(...addReinforcements(state, data, combat, rng));
  if (roll100(rng) <= weapon.smoke) {
    const def = effectById(data, "zadymienie");
    addToList(combat.battlefield, def, combat.battlefield.find((e) => e.id === def.id), def.duration, data.rules.effects);
    events.push({ type: "dym", id: def.id });
  }
  return events;
}
