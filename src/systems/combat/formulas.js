/** Combat formulas (pure; RNG only via rng.int): hit chances, damage, mitigation, fleeing. */
import { getStats } from "../stats.js";
import { effectById } from "../effects.js";
import { itemById } from "../items.js";
import { enemyById } from "./data.js";
import { masteryTypeOf, masteryBonuses } from "./mastery.js";
import { phenomenonEnemyModifiers } from "../phenomena.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Sum of a numeric modifier over an enemy's active effects (× stacks). */
function effectMod(data, enemy, key) {
  return (enemy.effects ?? []).reduce((acc, e) => acc + (effectById(data, e.id)?.modifiers?.[key] ?? 0) * (e.stacks ?? 1), 0);
}

/** Sum of a numeric modifier over the battlefield effects (e.g. smoke: rangedHitChance, fleeChance). */
function battlefieldMod(data, combat, key) {
  return (combat.battlefield ?? []).reduce((acc, e) => acc + (effectById(data, e.id)?.modifiers?.[key] ?? 0) * (e.stacks ?? 1), 0);
}

const isDazed = (data, enemy) => (enemy.effects ?? []).some((e) => effectById(data, e.id)?.dazed);

/**
 * Player's chance (%) to hit `enemy` with `weapon`. `penalty`: extra technique penalty; `masteryType`: the kind whose
 * mastery bonus applies (default: the weapon's own). A pair with one weapon thrown (`combat.thrown`) gets `oneLeftPenalty`.
 */
export function playerHitChance(state, data, combat, weapon, enemy, { penalty = 0, masteryType = masteryTypeOf(weapon), pointBlank = false } = {}) {
  const c = data.rules.combat;
  const { skills, attributes, derived } = getStats(state, data);
  const melee = weapon.range === "melee";
  const defense = enemyById(data, enemy.id).defense + effectMod(data, enemy, "defense") + phenomenonEnemyModifiers(state, data, enemy).defense;
  const chance = c.hitBase + (skills[weapon.skill] ?? 0) - defense + derived.hitChance
    + (melee ? derived.meleeHitChance : derived.rangedHitChance + battlefieldMod(data, combat, "rangedHitChance"))
    + (!melee ? ((enemy.band === "melee" || pointBlank) ? weapon.hitClose : weapon.hitFar) ?? 0 : 0)
    - (!melee && enemy.band === "melee" && !weapon.noMeleePenalty ? c.rangedInMeleePenalty : 0)
    - c.minStrengthPenalty * Math.max(0, (weapon.minStrength ?? 0) - attributes.sila)
    - penalty - (weapon.pair && combat?.thrown?.itemId === weapon.id ? c.dual.oneLeftPenalty : 0)
    + masteryBonuses(state, data, masteryType).hit;
  return clamp(chance, c.hitMin, c.hitMax);
}

/** Enemy `attack` hit chance (%) against the player. */
export function enemyHitChance(state, data, combat, enemy, attack) {
  const c = data.rules.combat;
  const main = itemById(data, state.inventory?.equipped?.bron ?? "piesci");
  const defense = getStats(state, data).derived.defense + combat.defendBonus
    + (main?.range === "melee" ? masteryBonuses(state, data, masteryTypeOf(main)).defense : 0);
  const chance = attack.hit - defense + effectMod(data, enemy, "hitChance") + phenomenonEnemyModifiers(state, data, enemy).hitChance
    + (attack.range === "far" ? battlefieldMod(data, combat, "rangedHitChance") : 0)
    - (attack.range === "far" && enemy.band === "melee" ? c.rangedInMeleePenalty : 0)
    - (enemy.enteredSmoke && attack.range !== "far" ? c.smokeEnterPenalty : 0) // entered melee through smoke this turn
    - (isDazed(data, enemy) ? c.dazedPenalty : 0)
    - (enemy.morale !== null && enemy.morale !== undefined && enemy.morale < c.moraleThreshold ? c.lowMoraleHitPenalty : 0);
  return clamp(chance, c.hitMin, c.hitMax);
}

/**
 * Raw damage before mitigation (`rules` = rules.combat): `rng.int(damage) + strength bonus (melee) + bonus`, ×(1 + bonusPercent/100) floored; a crit (roll ≤ critChance) is ×critMult, floored.
 * @returns {{ raw: number, crit: boolean }}
 */
export function rollDamage(rng, { damage, melee, sila, bonus = 0, bonusPercent = 0, critChance = 0, rules }) {
  if (!rules) throw new Error("rollDamage: brak rules (rules.combat)");
  let raw = rng.int(damage[0], damage[1]) + (melee ? Math.max(0, sila - rules.meleeStrengthBase) : 0) + bonus;
  if (bonusPercent) raw = Math.floor(raw * (1 + bonusPercent / 100));
  const crit = critChance > 0 && rng.int(1, 100) <= critChance;
  if (crit) raw = Math.floor(raw * rules.critMult);
  return { raw, crit };
}

/** Final damage: flat armor (skipped on crit, reduced by pierce), then reduction % (cap 75), then type multiplier; min 1 unless taken is 0. */
export function mitigate({ raw, crit = false, armor = 0, armorPierce = 0, reductionPercent = 0, taken = 1 }) {
  const afterArmor = crit ? raw : Math.max(0, raw - Math.max(0, armor - armorPierce));
  const result = Math.floor(afterArmor * (1 - Math.min(75, reductionPercent) / 100) * taken);
  return taken === 0 ? 0 : Math.max(1, result);
}

/** Chance (%) of escaping: base + per zrecznosc + fleeChance mod − per enemy in melee, clamped 5–95. */
export function fleeChance(state, data, combat) {
  const c = data.rules.combat;
  const { attributes, derived } = getStats(state, data);
  const inMelee = combat.enemies.filter((e) => !e.dead && !e.fled && e.band === "melee").length;
  return clamp(c.fleeBase + c.fleePerZrecznosc * attributes.zrecznosc + derived.fleeChance + battlefieldMod(data, combat, "fleeChance") - c.fleePerMeleeEnemy * inMelee, 5, 95);
}

/**
 * Lowers `target.hp` (state.character or a combat enemy) by `amount`, floor 0 (1 in training); marks enemies dead at 0.
 * @returns {number} HP actually lost
 */
export function dealDamage(combat, target, amount) {
  const before = target.hp;
  target.hp = Math.max(combat.training ? 1 : 0, before - amount);
  if ("uid" in target && target.hp <= 0) target.dead = true;
  return before - target.hp;
}
