/** Player actions in combat: availability, costs and resolution (plus the shared enemy attack resolver). */
import { getStats } from "../stats.js";
import { itemById } from "../items.js";
import { effectById, addToList } from "../effects.js";
import { countOf, removeItem, swapWeapons, useConsumable } from "../inventory.js";
import { enemyById } from "./data.js";
import { livingEnemies, enemyByUid } from "./state.js";
import { playerHitChance, enemyHitChance, rollDamage, mitigate, fleeChance, dealDamage } from "./formulas.js";
import { applyToPlayer, isDazed } from "./effects.js";
import { masteryTypeOf } from "./mastery.js";
import { strike, effectOnEnemy } from "./strike.js";
import { isFirearm, fireWeapon } from "./firearm.js";
import { isTechniqueId, techniqueActions, doTechnique } from "./techniques.js";
import { blockedSkill, phenomenonEnemyModifiers } from "../phenomena.js";

export const ACTION_IDS = ["attack", "reload", "use", "swap", "move", "defend", "flee", "end", "log", "techniques"];

const roll100 = (rng) => rng.int(1, 100);
const rules = (data) => data.rules.combat;
const weaponOf = (state, data) => itemById(data, state.inventory.equipped.bron ?? "piesci");
const loadedOf = (state, weapon) => state.inventory.loaded?.[weapon.id] ?? 0;
const fail = (reason) => ({ ok: false, reason });

/** True when `holder` (the player's character or an enemy) has an active effect that forbids moving (`noMove`). */
export const cannotMove = (data, holder) => (holder.effects ?? []).some((e) => effectById(data, e.id)?.noMove);
const isSlowed = (state, data) => cannotMove(data, state.character);

/** uids of living enemies the equipped weapon can reach (melee weapons: only enemies in melee). */
export function attackTargets(state, data, combat) {
  const weapon = weaponOf(state, data);
  return livingEnemies(combat).filter((e) => weapon.range !== "melee" || e.band === "melee").map((e) => e.uid);
}

/** Usable items: belt first, then bag; `apCost` includes the bag surcharge. Food without `heal` is not for a fight. */
export function useOptions(state, data, combat) {
  const c = rules(data);
  const usable = (id) => {
    const item = itemById(data, id);
    return ["consumable", "throwable"].includes(item?.type) && !(item.food && !item.heal);
  };
  const options = [];
  const make = (itemId, from) => {
    const item = itemById(data, itemId);
    return { itemId, from, apCost: item.apCost + (from === "bag" ? c.bagUseExtraAp : 0), needsTarget: item.type === "throwable" && ["single", "single_splash"].includes(item.target) };
  };
  for (const id of state.inventory.quickSlots) if (usable(id) && countOf(state, id) > 0) options.push(make(id, "belt"));
  for (const { id } of state.inventory.items) if (usable(id) && !state.inventory.quickSlots.includes(id)) options.push(make(id, "bag"));
  return options;
}

/** The action list with costs; unavailable ones carry `disabled: true` and a `reason` (ui key). */
export function playerActions(state, data, combat) {
  const c = rules(data);
  const ap = combat.playerAp;
  const weapon = weaponOf(state, data);
  const eq = state.inventory.equipped;
  const options = useOptions(state, data, combat);
  const ammo = weapon.reload ? countOf(state, weapon.reload.ammo) : 0;
  const entry = (id, apCost, reason) => ({ id, apCost, disabled: !!reason, ...(reason ? { reason } : {}) });
  const afford = (cost, other) => (ap < cost ? "combat.noAp" : other);
  const defendCost = Math.max(c.defendMinAp, ap);
  return [
    entry("attack", weapon.apCost, blockedSkill(state, data, weapon.skill) ? "combat.blockedByPhenomenon" : afford(weapon.apCost,
      weapon.reload && loadedOf(state, weapon) < 1 ? "combat.notLoaded" : attackTargets(state, data, combat).length === 0 ? "combat.noTarget" : undefined)),
    entry("reload", weapon.reload?.apCost ?? 0, !weapon.reload ? "combat.noReload" : afford(weapon.reload.apCost,
      loadedOf(state, weapon) >= weapon.reload.capacity ? "combat.alreadyLoaded" : ammo < 1 ? "combat.noAmmo" : undefined)),
    entry("use", options.length ? Math.min(...options.map((o) => o.apCost)) : 0,
      options.length === 0 ? "combat.nothingToUse" : afford(Math.min(...options.map((o) => o.apCost)))),
    entry("swap", c.swapAp, afford(c.swapAp, eq.bron || eq.bron_zapas ? undefined : "combat.nothingToSwap")),
    entry("move", c.moveAp, afford(c.moveAp, isSlowed(state, data) ? "combat.slowed" : livingEnemies(combat).length ? undefined : "combat.noTarget")),
    entry("defend", defendCost, afford(c.defendMinAp)),
    { ...entry("flee", c.fleeAp, combat.def?.canFlee === false ? "combat.noFlee" : afford(c.fleeAp)), chance: fleeChance(state, data, combat) },
    entry("end", 0),
    entry("log", 0),
    entry("techniques", 0, techniqueActions(state, data, combat).some((t) => !t.disabled) ? undefined : "combat.noTechnique"),
  ];
}

/** Records `efekt_nalozony`/`efekt_odparty` for an effect put on the player. */
function effectOnPlayer(state, data, id, rng, events) {
  const r = applyToPlayer(state, data, id, rng);
  events.push({ type: r.resisted ? "efekt_odparty" : "efekt_nalozony", id, target: "player" });
}

/**
 * One enemy `attack` against the player (also used for the step-back free attack and by the AI): hit roll, damage after
 * the player's armor/reduction/damageTaken, then the attack's effects (blunt attacks also daze). Enemies never crit.
 * @returns {object[]} events (`atak`, effect events)
 */
export function resolveEnemyAttack(state, data, combat, uid, attack, rng) {
  const c = rules(data);
  const enemy = enemyByUid(combat, uid);
  const sure = attack.hit === undefined;
  const chance = sure ? 100 : enemyHitChance(state, data, combat, enemy, attack);
  const hit = sure || roll100(rng) <= chance;
  const ev = { type: "atak", attacker: uid, target: "player", hit, damage: 0, crit: false, chance, attack: attack.name };
  const events = [ev];
  if (!hit) return events;
  if (attack.damage) {
    const stats = getStats(state, data);
    // A running phenomenon may make enemies with some tags hit harder.
    const { raw } = rollDamage(rng, { damage: attack.damage, melee: false, sila: 0, bonus: phenomenonEnemyModifiers(state, data, enemy).damage, rules: c });
    ev.damage = dealDamage(combat, state.character, mitigate({
      raw, armor: stats.derived.armor, reductionPercent: stats.derived.reduction[attack.damageType] ?? 0,
      taken: stats.other.damageTaken[attack.damageType] ?? 1,
    }));
  }
  if (state.character.hp <= 0) return events;
  const penalty = isDazed(enemy) ? c.dazedPenalty : 0;
  if (attack.damage && attack.damageType === "obuchowe" && roll100(rng) <= c.bluntDaze - penalty) effectOnPlayer(state, data, "zamroczenie", rng, events);
  for (const fx of attack.effects ?? []) if (roll100(rng) <= fx.chance - penalty) effectOnPlayer(state, data, fx.id, rng, events);
  return events;
}

/** Throws `item` (already validated); consumes one copy. */
function throwItem(state, data, combat, item, aimUid, rng, events) {
  const c = rules(data);
  const use = { type: "uzycie", item: item.id };
  events.push(use);
  removeItem(state, data, item.id, 1);
  if (item.target === "battlefield") {
    for (const fx of item.effects ?? []) {
      if (roll100(rng) > fx.chance) continue;
      const def = effectById(data, fx.id);
      addToList(combat.battlefield, def, combat.battlefield.find((e) => e.id === fx.id), def.duration, data.rules.effects);
      events.push({ type: "efekt_nalozony", id: fx.id, target: "battlefield" });
    }
    return;
  }
  const living = livingEnemies(combat);
  const aims = item.target === "all_enemies" ? living : [enemyByUid(combat, aimUid)];
  const fumbleAt = getStats(state, data).attributes.fart >= c.fumbleFart ? 100 : c.fumbleRoll;
  const thrown = { id: item.id, range: "far", skill: item.skill, minStrength: 0 };
  use.target = aims[0].uid;
  for (const aim of aims) {
    const roll = roll100(rng);
    if (roll >= fumbleAt) {
      use.hit = false;
      use.fumble = true;
      for (const fx of item.effects ?? []) effectOnPlayer(state, data, fx.id, rng, events);
      return;
    }
    const hit = roll <= playerHitChance(state, data, combat, thrown, aim, { masteryType: masteryTypeOf(item), penalty: -c.throwHitBonus });
    use.hit = (use.hit ?? true) && hit;
    const victims = item.target === "single_splash" ? living.filter((e) => e.band === aim.band) : [aim];
    for (const victim of victims) {
      for (const fx of item.effects ?? []) {
        // Said every time, hit or miss: a player should not waste a second jar finding out.
        if ((enemyById(data, victim.id).immune ?? []).includes(fx.id)) {
          events.push({ type: "efekt_odporny", id: fx.id, target: victim.uid });
          continue;
        }
        const chance = hit ? fx.chance : Math.floor(fx.chance * c.missEffectMultiplier);
        // A near miss shortens the effect, so a one-turn one is lost; an explosion still shakes whoever stands near.
        if (!hit && item.target !== "single_splash" && effectById(data, fx.id).duration - 1 < 1) continue;
        if (roll100(rng) > chance) continue;
        const existed = victim.effects.some((e) => e.id === fx.id);
        const r = effectOnEnemy(data, combat, victim, fx.id, rng, events);
        const entry = victim.effects.find((e) => e.id === fx.id);
        if (!hit && r.applied && entry && !existed) entry.remaining = Math.max(1, entry.remaining - 1);
      }
    }
  }
}

function useConsumableItem(state, data, item, rng, events) {
  events.push({ type: "uzycie", item: item.id });
  const r = useConsumable(state, data, item.id, rng, { advance: false });
  if (r.healed > 0) events.push({ type: "leczenie", amount: r.healed });
  for (const e of r.effects) events.push({ ...e, target: "player" });
}

/**
 * Performs `action` ({ id, target?, itemId?, zone? }); technique ids go to `doTechnique`, "techniques" itself only opens
 * the submenu (no change). Validates everything before changing anything.
 * @returns {{ ok: true, events: object[], endTurn: boolean } | { ok: false, reason: string }}
 */
export function doAction(state, data, combat, action, rng) {
  if (isTechniqueId(action.id)) return doTechnique(state, data, combat, action, rng);
  if (!ACTION_IDS.includes(action.id)) throw new Error(`doAction: nieznana akcja "${action.id}"`);
  const c = rules(data);
  const listed = playerActions(state, data, combat).find((a) => a.id === action.id);
  if (listed.disabled) return fail(listed.reason);
  const events = [];
  const done = (endTurn = false) => ({ ok: true, events, endTurn });
  const living = livingEnemies(combat);
  const aimed = action.target ? living.find((e) => e.uid === action.target) : undefined;
  switch (action.id) {
    case "attack": {
      const targets = attackTargets(state, data, combat);
      const uid = action.target ?? (targets.length === 1 ? targets[0] : undefined);
      if (!targets.includes(uid)) return fail("combat.noTarget");
      const weapon = weaponOf(state, data);
      combat.playerAp -= weapon.apCost;
      const target = enemyByUid(combat, uid);
      events.push(...(isFirearm(weapon) ? fireWeapon(state, data, combat, weapon, target, rng) : strike(state, data, combat, { weapon, target, rng })));
      return done();
    }
    case "reload": {
      const weapon = weaponOf(state, data);
      const n = Math.min(weapon.reload.capacity - loadedOf(state, weapon), countOf(state, weapon.reload.ammo));
      combat.playerAp -= weapon.reload.apCost;
      removeItem(state, data, weapon.reload.ammo, n);
      state.inventory.loaded ??= {};
      state.inventory.loaded[weapon.id] = loadedOf(state, weapon) + n;
      events.push({ type: "przeladowanie", weapon: weapon.id });
      return done();
    }
    case "use": {
      const option = useOptions(state, data, combat).find((o) => o.itemId === action.itemId);
      if (!option) return fail("combat.nothingToUse");
      if (option.apCost > combat.playerAp) return fail("combat.noAp");
      const item = itemById(data, option.itemId);
      if (option.needsTarget && !aimed) return fail("combat.noTarget");
      combat.playerAp -= option.apCost;
      if (item.type === "throwable") throwItem(state, data, combat, item, action.target, rng, events);
      else useConsumableItem(state, data, item, rng, events);
      return done();
    }
    case "swap":
      combat.playerAp -= c.swapAp;
      swapWeapons(state, data);
      events.push({ type: "zmiana_broni" });
      return done();
    case "move": {
      if (!aimed) return fail("combat.noTarget");
      combat.playerAp -= c.moveAp;
      const stunned = aimed.effects.some((e) => effectById(data, e.id)?.skipTurn);
      if (aimed.band === "melee" && !stunned) {
        const attack = enemyById(data, aimed.id).attacks.find((a) => (a.range ?? "melee") === "melee");
        if (attack) events.push(...resolveEnemyAttack(state, data, combat, aimed.uid, attack, rng));
      }
      aimed.band = aimed.band === "melee" ? "far" : "melee";
      events.push({ type: "ruch", mover: "player", target: aimed.uid, band: aimed.band });
      return done();
    }
    case "defend":
      combat.defendBonus = Math.max(combat.defendBonus, c.defendPerAp * combat.playerAp);
      combat.playerAp = 0;
      events.push({ type: "obrona", bonus: combat.defendBonus });
      return done(true);
    case "flee": {
      combat.playerAp -= c.fleeAp;
      const success = roll100(rng) <= fleeChance(state, data, combat);
      if (success) combat.outcome = "fled";
      events.push({ type: "ucieczka", success });
      return done(!success);
    }
    case "end":
      return done(true);
    default: // "log", "techniques": menus only
      return done();
  }
}
