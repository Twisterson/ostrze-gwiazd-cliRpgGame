/** The one player weapon blow used by every attack (plain attack, techniques, later reach and firearms). */
import { getStats } from "../stats.js";
import { enemyById } from "./data.js";
import { onAllyDeath, livingEnemies } from "./state.js";
import { addReinforcements } from "./firearm.js";
import { playerHitChance, rollDamage, mitigate, dealDamage } from "./formulas.js";
import { applyToEnemy } from "./effects.js";
import { masteryTypeOf, masteryBonuses } from "./mastery.js";
import { explode } from "./explosive.js";
import { itemById } from "../items.js";
import { loadedAmmoOf } from "../inventory.js";

const roll100 = (rng) => rng.int(1, 100);

/** Rolls an effect's application on an enemy and records the matching event. */
export function effectOnEnemy(data, combat, enemy, id, rng, events, opts) {
  const r = applyToEnemy(data, combat, enemy, id, rng, opts);
  events.push({ type: r.immune ? "efekt_odporny" : r.applied ? "efekt_nalozony" : "efekt_odparty", id, target: enemy.uid });
  return r;
}

/** Marks the death: other living enemies lose morale. */
export function onEnemyDeath(data, combat, enemy, events) {
  events.push({ type: "wrog_pokonany", target: enemy.uid });
  onAllyDeath(data, combat);
}

/**
 * A quick kill is loud: when `enemy` falls within `noise.fastRounds` while others still stand, a person or beast may
 * hear it and come (`noise.chance` %, once per fight, never in training or a `quiet` scene). The newcomer is the scene's
 * `reinforcements`, else one more of the fallen kind.
 */
export function noiseOfKill(data, combat, enemy, rng, events) {
  const noise = data.rules.combat.noise;
  if (!noise || combat.reinforced || combat.training || combat.def.quiet || combat.round > noise.fastRounds) return;
  if (livingEnemies(combat).length === 0 || !enemyById(data, enemy.id).tags?.some((tag) => noise.tags.includes(tag))) return;
  if (rng.int(1, 100) > noise.chance) return;
  events.push(...addReinforcements(null, data, combat, rng, combat.def.reinforcements ?? [{ id: enemy.id }]));
}

/**
 * One player blow with `weapon` at `target` (an enemy object): hit roll, damage, mitigation, mastery (`killedBy`), blunt
 * rules and the weapon's effects. Spends one load of a reloadable weapon (not when thrown; the last one clears its
 * `loadedAmmo` entry); the loaded ammunition adds its `damageBonus`, and an `explosive` one bursts after the blow
 * (`explode`), whether it hit, missed or killed. AP are the caller's job.
 * @param {object} opts
 * @param {object} opts.weapon the item striking
 * @param {object} opts.target the enemy
 * @param {object} opts.rng
 * @param {number} [opts.hitPenalty] lowers the hit chance
 * @param {number} [opts.critBonus] added to the crit chance
 * @param {number} [opts.damagePercent] added to the damage % bonus (before armor)
 * @param {string} [opts.skillOverride] skill used instead of the weapon's
 * @param {boolean} [opts.thrown] a throw: ranged (`far`), mastery kind `rzucana`, nothing spent from the magazine
 * @param {boolean} [opts.pointBlank] counts the target as close for the weapon's close-range hit bonus (it has just stepped away)
 * @param {boolean} [opts.noDamage] a hit does no damage (a stun attempt): only the extra effect is rolled
 * @param {{ id: string, chance: number }} [opts.effect] extra effect rolled after a hit that did not kill (aimed attack)
 * @returns {object[]} events (`atak` first; `wrog_pokonany`, effect events, `wybuch`)
 */
export function strike(state, data, combat, { weapon, target, rng, hitPenalty = 0, critBonus = 0, damagePercent = 0, skillOverride, thrown = false, effect, noDamage = false, pointBlank = false }) {
  const stats = getStats(state, data);
  const masteryType = masteryTypeOf(weapon, { thrown });
  const used = { ...weapon, skill: skillOverride ?? weapon.skill, ...(thrown ? { range: "far" } : {}) };
  const events = [];
  const chance = playerHitChance(state, data, combat, used, target, { penalty: hitPenalty, masteryType, pointBlank });
  const hit = roll100(rng) <= chance;
  const ammo = weapon.reload && !thrown ? itemById(data, loadedAmmoOf(state, weapon)) : null;
  if (weapon.reload && !thrown) spendLoad(state, weapon);
  const ev = { type: "atak", attacker: "player", target: target.uid, hit, damage: 0, crit: false, chance, weapon: weapon.id, ...(thrown ? { thrown: true } : {}) };
  events.push(ev);
  blow({ state, data, combat, weapon, target, rng, used, masteryType, stats, ammo, ev, events, critBonus, damagePercent, thrown, effect, noDamage });
  if (ammo?.explosive) events.push(...explode(state, data, combat, target, { hit, weapon }, rng));
  return events;
}

/** Takes one round out of `weapon`; the last one leaves the weapon empty and forgets the loaded kind. */
function spendLoad(state, weapon) {
  const inv = state.inventory;
  inv.loaded[weapon.id] = (inv.loaded?.[weapon.id] ?? 0) - 1;
  if (inv.loaded[weapon.id] <= 0 && inv.loadedAmmo) delete inv.loadedAmmo[weapon.id];
}

/** The damage and after-effects of a resolved `strike` blow (`ev` is its `atak` event); pushes onto `events`. */
function blow({ state, data, combat, weapon, target, rng, used, masteryType, stats, ammo, ev, events, critBonus, damagePercent, thrown, effect, noDamage }) {
  const c = data.rules.combat;
  if (!ev.hit) return;
  if (noDamage) {
    if (effect && roll100(rng) <= effect.chance) effectOnEnemy(data, combat, target, effect.id, rng, events);
    return;
  }
  const { raw, crit } = rollDamage(rng, {
    damage: weapon.damage, melee: used.range === "melee", sila: stats.attributes.sila, bonus: stats.derived.damage + (ammo?.damageBonus ?? 0),
    bonusPercent: masteryBonuses(state, data, masteryType).damagePercent + damagePercent,
    critChance: stats.derived.critChance + critBonus, rules: c,
  });
  const base = enemyById(data, target.id);
  let amount = mitigate({
    raw, crit, armor: base.armor ?? 0, armorPierce: weapon.armorPierce ?? 0,
    reductionPercent: base.reduction?.[weapon.damageType] ?? 0, taken: base.damageTaken?.[weapon.damageType] ?? 1,
  });
  // Extra damage of the player's effects (e.g. a burning blade) rides on every weapon blow: own roll and type, no flat armor.
  if (!thrown) {
    for (const extra of stats.other.extraDamage) {
      const bonus = mitigate({
        raw: rng.int(extra.amount[0], extra.amount[1]), reductionPercent: base.reduction?.[extra.type] ?? 0, taken: base.damageTaken?.[extra.type] ?? 1,
      });
      amount += bonus;
      ev.extra = { type: extra.type, amount: (ev.extra?.amount ?? 0) + bonus };
    }
  }
  ev.damage = dealDamage(combat, target, amount);
  ev.crit = crit;
  // The finishing blow (in training: the blow that left the enemy spared at 1 HP) credits its weapon kind.
  if (masteryType && target.hp <= (combat.training ? 1 : 0)) target.killedBy = masteryType;
  if (target.dead) { onEnemyDeath(data, combat, target, events); noiseOfKill(data, combat, target, rng, events); return; }
  if (weapon.damageType === "obuchowe") {
    if (crit) { if (roll100(rng) <= c.bluntCritStun) effectOnEnemy(data, combat, target, "ogluszenie", rng, events); }
    else if (roll100(rng) <= c.bluntDaze) effectOnEnemy(data, combat, target, "zamroczenie", rng, events);
  }
  for (const fx of weapon.effects ?? []) if (roll100(rng) <= fx.chance) effectOnEnemy(data, combat, target, fx.id, rng, events);
  if (effect && roll100(rng) <= effect.chance) effectOnEnemy(data, combat, target, effect.id, rng, events);
}
