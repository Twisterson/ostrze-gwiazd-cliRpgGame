/** Enemy AI: spends the enemy's AP on moving, attacking or fleeing (cautious). */
import { enemyById } from "./data.js";
import { enemyByUid } from "./state.js";
import { effectById } from "../effects.js";
import { resolveEnemyAttack, cannotMove } from "./actions.js";
import { readyWeapon } from "./techniques.js";
import { strike } from "./strike.js";

export { onAllyDeath } from "./state.js";

const rangeOf = (attack) => attack.range ?? "melee";
const MAX_STEPS = 20;

/** Picks one of `attacks` with probability proportional to `weight` (default 1). */
function pickWeighted(attacks, rng) {
  const total = attacks.reduce((sum, a) => sum + (a.weight ?? 1), 0);
  let roll = rng.int(1, total);
  for (const a of attacks) {
    roll -= a.weight ?? 1;
    if (roll <= 0) return a;
  }
  return attacks[attacks.length - 1];
}

/**
 * The player's free blow from the ready stance against `enemy` that just closed into melee: needs a melee weapon in hand
 * (see `readyWeapon`) and a player who is not stunned. Marks the first `atak` event `reaction: true`.
 * @returns {object[]} events (empty when no reaction)
 */
function reachReaction(state, data, combat, enemy, rng) {
  const weapon = readyWeapon(state, data, combat);
  const stunned = (state.character.effects ?? []).some((e) => effectById(data, e.id)?.skipTurn);
  if (!combat.ready || !weapon || stunned || state.character.hp <= 0) return []; // only from the stance the player took
  const events = strike(state, data, combat, { weapon, target: enemy, rng });
  events[0].reaction = true;
  return events;
}

/**
 * Plays the turn of enemy `uid`: cautious enemies flee when HP < cautiousHpPercent% or morale < moraleThreshold;
 * otherwise melee-minded ones close in (a `leap` enemy jumps in for 0 AP, once per turn) and attack, `ranged` ones step
 * back when they can afford step + shot, else shoot from melee (`far` attacks work in both bands). An enemy entering
 * melee against a player in the ready stance takes one free blow first (once per turn); if it dies, its turn ends. A `noMove` effect forbids moving and leaping.
 * @returns {object[]} events (`atak`, `ruch`, `wrog_ucieka`, effect events)
 */
export function enemyTurn(state, data, combat, uid, rng) {
  const c = data.rules.combat;
  const enemy = enemyByUid(combat, uid);
  const base = enemyById(data, enemy.id);
  const events = [];
  const lowMorale = enemy.morale !== null && enemy.morale !== undefined && enemy.morale < c.moraleThreshold;
  if (base.ai === "cautious" && (enemy.hp * 100 < c.cautiousHpPercent * enemy.hpMax || lowMorale)) {
    enemy.fled = true;
    return [{ type: "wrog_ucieka", target: uid }];
  }
  const hasMelee = base.attacks.some((a) => rangeOf(a) === "melee");
  const cheapestFar = Math.min(...base.attacks.filter((a) => rangeOf(a) === "far").map((a) => a.apCost));
  let leapt = false;
  let reacted = false;
  /** Switches band; entering melee may draw the free reach blow. @returns {boolean} the enemy died from it */
  const relocate = (extra) => {
    enemy.band = enemy.band === "melee" ? "far" : "melee";
    events.push({ type: "ruch", mover: uid, target: uid, band: enemy.band, ...extra });
    if (enemy.band === "melee" && combat.battlefield.some((e) => e.id === "zadymienie")) enemy.enteredSmoke = true;
    if (enemy.band !== "melee" || reacted) return false;
    reacted = true;
    events.push(...reachReaction(state, data, combat, enemy, rng));
    return !!enemy.dead;
  };
  for (let step = 0; step < MAX_STEPS && enemy.ap > 0 && state.character.hp > 0; step++) {
    const melee = enemy.band === "melee";
    const rooted = cannotMove(data, enemy);
    const usable = base.attacks.filter((a) => a.apCost <= enemy.ap && (melee || rangeOf(a) === "far"));
    const canStep = !rooted && enemy.ap >= c.moveAp;
    if (base.leap && !leapt && !melee && !rooted && base.ai !== "ranged" && base.attacks.some((a) => rangeOf(a) === "melee" && a.apCost <= enemy.ap)) {
      leapt = true;
      if (relocate({ leap: true })) break;
    } else if (base.ai === "ranged" && melee && canStep && enemy.ap >= c.moveAp + cheapestFar) {
      enemy.ap -= c.moveAp;
      if (relocate()) break;
    } else if (usable.length) {
      const attack = pickWeighted(usable, rng);
      enemy.ap -= attack.apCost;
      events.push(...resolveEnemyAttack(state, data, combat, uid, attack, rng));
    } else if (!melee && base.ai !== "ranged" && hasMelee && canStep) {
      enemy.ap -= c.moveAp;
      if (relocate()) break;
    } else break;
  }
  delete enemy.enteredSmoke; // transient: only for this turn
  return events;
}
