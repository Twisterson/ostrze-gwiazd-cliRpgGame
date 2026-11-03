/** Explosive bolts: fragments on the enemies in the target's zone after the shot (`rules.combat.explosive`). */
import { itemById } from "../items.js";
import { enemyById } from "./data.js";
import { livingEnemies } from "./state.js";
import { mitigate, dealDamage } from "./formulas.js";
import { masteryTypeOf } from "./mastery.js";
import { effectOnEnemy, onEnemyDeath, noiseOfKill } from "./strike.js";

const roll100 = (rng) => rng.int(1, 100);

/**
 * The blast of an explosive bolt shot at `target` (the blow is already resolved). After a hit the fragments strike every
 * other living enemy in the target's band; after a miss the bolt goes off by the ground only on a `missBurstChance` roll,
 * and then the target takes a fragment too. Each fragment: `rng.int(fragDamage)` after the enemy's armor and the
 * weapon's damage type, then a `slowChance` roll for `spowolnienie` on a survivor; a fragment kill credits the weapon's
 * mastery. A blast by a target in melee also hurts the hero (`rng.int(selfDamage)`, no armor).
 * @param {{ hit: boolean, weapon?: object }} opts `weapon` defaults to the one in hand
 * @returns {object[]} events: `wybuch { hit, victims: [{ target, damage }], selfDamage }`, then deaths and effects
 */
export function explode(state, data, combat, target, { hit, weapon = itemById(data, state.inventory.equipped.bron) }, rng) {
  const x = data.rules.combat.explosive;
  if (!hit && roll100(rng) > x.missBurstChance) return [];
  const masteryType = masteryTypeOf(weapon);
  const ev = { type: "wybuch", hit, victims: [], selfDamage: 0 };
  const events = [ev];
  const victims = livingEnemies(combat).filter((e) => e.band === target.band && (!hit || e !== target));
  for (const enemy of victims) {
    const base = enemyById(data, enemy.id);
    const amount = mitigate({
      raw: rng.int(x.fragDamage[0], x.fragDamage[1]), armor: base.armor ?? 0,
      reductionPercent: base.reduction?.[weapon.damageType] ?? 0, taken: base.damageTaken?.[weapon.damageType] ?? 1,
    });
    ev.victims.push({ target: enemy.uid, damage: dealDamage(combat, enemy, amount) });
    if (masteryType && enemy.hp <= (combat.training ? 1 : 0)) enemy.killedBy = masteryType;
  }
  for (const enemy of victims) {
    if (enemy.dead) { onEnemyDeath(data, combat, enemy, events); noiseOfKill(data, combat, enemy, rng, events); }
    else if (roll100(rng) <= x.slowChance) effectOnEnemy(data, combat, enemy, "spowolnienie", rng, events);
  }
  if (target.band === "melee") ev.selfDamage = dealDamage(combat, state.character, rng.int(x.selfDamage[0], x.selfDamage[1]));
  return events;
}
