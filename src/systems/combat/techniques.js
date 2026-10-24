/** Combat techniques: aimed attack (zones, listed by `zoneActions` as top-level actions), the two-weapon actions (both weapons, strike and guard, throw, pick up) and artifact abilities (`artifact:<id>`). */
import { itemById, isWeapon } from "../items.js";
import { blockedSkill } from "../phenomena.js";
import { abilityOptions, useAbility } from "../artifacts.js";
import { livingEnemies, enemyByUid } from "./state.js";
import { strike } from "./strike.js";
import { isFirearm, fireWeapon } from "./firearm.js";
import { masteryTypeOf } from "./mastery.js";

export const TECHNIQUE_IDS = ["aimed", "dual", "guard", "throw", "pickup", "ready"];
const ARTIFACT_PREFIX = "artifact:";

/** True for a technique id: a fixed one or an artifact ability (`artifact:<abilityId>`). */
export const isTechniqueId = (id) => TECHNIQUE_IDS.includes(id) || (typeof id === "string" && id.startsWith(ARTIFACT_PREFIX));

const fail = (reason) => ({ ok: false, reason });
/** Name of a weapon as it is thrown ("Włócznia" for a pair of spears). */
export const thrownName = (item) => item?.throwName ?? item?.name;
const loadedOf = (state, weapon) => state.inventory.loaded?.[weapon.id] ?? 0;
const inMelee = (combat) => livingEnemies(combat).filter((e) => e.band === "melee").map((e) => e.uid);
const reachable = (combat, weapon) => livingEnemies(combat).filter((e) => weapon.range !== "melee" || e.band === "melee").map((e) => e.uid);

/**
 * Two-weapon state. `main`: the weapon in `bron` (fists when empty); `second`: the same weapon for a `pair`, or the
 * `offhand` weapon in `bron_druga` when `main` is a melee weapon without `pair`; `thrownOut`: a weapon lies by a foe.
 * @returns {{ active: boolean, main: object, second: object|null, thrownOut: boolean }}
 */
export function dualState(state, data, combat) {
  const eq = state.inventory.equipped;
  const main = itemById(data, eq.bron ?? "piesci");
  const off = eq.bron_druga ? itemById(data, eq.bron_druga) : null;
  let second = null;
  if (eq.bron && main.pair) second = main;
  else if (eq.bron && main.range === "melee" && off?.offhand) second = off;
  const thrownOut = !!combat.thrown;
  return { active: !!second && main.range === "melee" && !thrownOut, main, second, thrownOut };
}

/** Whether the thrown weapon can be picked up: its target is in melee with the player, dead or gone. */
function canPickUp(combat) {
  const foe = enemyByUid(combat, combat.thrown.uid);
  return !foe || foe.dead || foe.fled || foe.band === "melee";
}

/** Valid target uids of technique `id` (pickup and self abilities have none). */
function targetsOf(id, ds, combat, state, data) {
  if (id.startsWith(ARTIFACT_PREFIX)) {
    const ability = abilityOptions(state, data, combat).find((o) => `${ARTIFACT_PREFIX}${o.id}` === id);
    return ability?.target === "enemy" ? livingEnemies(combat).map((e) => e.uid) : [];
  }
  if (id === "aimed") return reachable(combat, ds.main);
  if (id === "dual" || id === "guard") return inMelee(combat);
  if (id === "throw") return livingEnemies(combat).map((e) => e.uid);
  return [];
}

/** Valid target uids of technique `id` for the target picker (empty for "pickup"). */
export function techniqueTargets(state, data, combat, id) {
  return targetsOf(id, dualState(state, data, combat), combat, state, data);
}

/** Hit penalty of an aimed `zone` with `weapon`: the zone's own, eased by `masteryRelief` (`amount` per `per` points of the weapon's mastery), never below 0 for a penalty. */
export function zonePenalty(state, data, zone, weapon) {
  const relief = zone.masteryRelief;
  if (!relief || zone.penalty <= 0) return zone.penalty;
  const mastery = state.character?.mastery?.[masteryTypeOf(weapon)] ?? 0;
  return Math.max(0, zone.penalty - Math.floor(mastery / relief.per) * relief.amount);
}

/**
 * The aimed blows (`rules.combat.aimed`, in order) as top-level actions: `{ id: zone, apCost, disabled, reason? }`. Fists have
 * only the stun attempt, which any melee attack (and fists) allows; the other zones need a weapon in hand. The AP cost is the
 * weapon's plus the zone's extra.
 */
export function zoneActions(state, data, combat) {
  const c = data.rules.combat;
  const ds = dualState(state, data, combat);
  const { main } = ds;
  const armed = !!state.inventory.equipped.bron && isWeapon(main);
  const list = [];
  for (const [id, zone] of Object.entries(c.aimed)) {
    if (!armed && !zone.noDamage) continue;
    if (zone.noDamage && main.range !== "melee") continue;
    const cost = main.apCost + zone.ap;
    const reason = blockedSkill(state, data, main.skill) ? "combat.blockedByPhenomenon"
      : combat.playerAp < cost ? "combat.noAp"
        : main.reload && loadedOf(state, main) < 1 ? "combat.notLoaded"
          : targetsOf("aimed", ds, combat, state, data).length ? undefined : "combat.noTarget";
    list.push({ id, apCost: cost, penalty: zonePenalty(state, data, zone, main), disabled: !!reason, ...(reason ? { reason } : {}) });
  }
  return list;
}

/**
 * The techniques with costs; unavailable ones carry `disabled` and a `reason` (ui key). `label` is the weapon name for
 * throw / pick up. (Aimed blows are `zoneActions`.)
 * @returns {Array<{ id: string, apCost: number, disabled: boolean, reason?: string, label?: string }>}
 */
export function techniqueActions(state, data, combat) {
  const c = data.rules.combat;
  const ap = combat.playerAp;
  const ds = dualState(state, data, combat);
  const { main, second } = ds;
  const entry = (id, apCost, reason, label) => ({ id, apCost, disabled: !!reason, ...(reason ? { reason } : {}), ...(label ? { label } : {}) });
  const afford = (cost, other) => (ap < cost ? "combat.noAp" : other);
  const noTarget = (id) => (targetsOf(id, ds, combat, state, data).length ? undefined : "combat.noTarget");
  const twoHands = !second || main.range !== "melee" ? "combat.noSecond" : ds.thrownOut ? "combat.secondThrown" : undefined;
  const list = [];
  const dualCost = main.apCost + c.dual.extraAp;
  list.push(entry("dual", dualCost, twoHands ?? afford(dualCost, noTarget("dual"))));
  const guardCost = main.apCost + c.dual.guardExtraAp;
  list.push(entry("guard", guardCost, twoHands ?? afford(guardCost, noTarget("guard"))));
  const throwCost = second?.apCost ?? 0;
  list.push(entry("throw", throwCost, twoHands ?? afford(throwCost, noTarget("throw")), thrownName(second)));
  const thrownItem = combat.thrown ? itemById(data, combat.thrown.itemId) : null;
  list.push(entry("pickup", c.dual.pickUpAp, !combat.thrown ? "combat.notThrown" : afford(c.dual.pickUpAp, canPickUp(combat) ? undefined : "combat.pickUpFar"), thrownName(thrownItem)));
  // The stance of a long weapon: enemies stepping into melee until the player's next turn take one blow each. Never automatic.
  const readyReason = !(ds.active && main.reach) ? "combat.noReach" : combat.ready ? "combat.alreadyReady" : afford(c.reachReadyAp);
  list.push(entry("ready", c.reachReadyAp, readyReason));
  for (const o of abilityOptions(state, data, combat)) {
    list.push({
      ...entry(`${ARTIFACT_PREFIX}${o.id}`, o.apCost, o.reason, o.name),
      artifact: true, chargeCost: o.chargeCost, target: o.target, effect: o.effect, ...(o.viaHp !== undefined ? { viaHp: o.viaHp } : {}),
    });
  }
  return list;
}

/**
 * Performs technique `action` ({ id, target?, zone? }; `zone` ∈ glowa|tulow|nogi for "aimed"). Validates before changing
 * anything; a player's mistake returns `{ ok: false, reason }`, an unknown id or zone throws.
 * @returns {{ ok: true, events: object[], endTurn: boolean } | { ok: false, reason: string }}
 */
export function doTechnique(state, data, combat, action, rng) {
  if (!isTechniqueId(action.id)) throw new Error(`doTechnique: nieznana technika "${action.id}"`);
  if (action.id.startsWith(ARTIFACT_PREFIX)) {
    const r = useAbility(state, data, combat, action.id.slice(ARTIFACT_PREFIX.length), action.target, rng);
    return r.ok ? { ...r, endTurn: false } : r;
  }
  const c = data.rules.combat;
  const zone = action.id === "aimed" ? c.aimed[action.zone] : undefined;
  if (action.id === "aimed" && !zone) throw new Error(`doTechnique: nieznana strefa "${action.zone}"`);
  const listed = action.id === "aimed" ? zoneActions(state, data, combat).find((a) => a.id === action.zone) : techniqueActions(state, data, combat).find((a) => a.id === action.id);
  if (!listed) return fail("combat.noTechnique");
  if (listed.disabled) return fail(listed.reason);
  const ds = dualState(state, data, combat);
  const { main, second } = ds;
  const events = [];
  const done = () => ({ ok: true, events, endTurn: false });

  if (action.id === "pickup") {
    combat.playerAp -= listed.apCost;
    events.push({ type: "podniesienie", item: combat.thrown.itemId });
    combat.thrown = null;
    return done();
  }

  if (action.id === "ready") {
    combat.playerAp -= listed.apCost;
    combat.ready = true;
    events.push({ type: "gotowosc" });
    return done();
  }

  const targets = targetsOf(action.id, ds, combat, state, data);
  const uid = action.target ?? (targets.length === 1 ? targets[0] : undefined);
  if (!targets.includes(uid)) return fail("combat.noTarget");
  const target = enemyByUid(combat, uid);
  const cost = listed.apCost;
  if (cost > combat.playerAp) return fail("combat.noAp");
  combat.playerAp -= cost;

  switch (action.id) {
    case "aimed": {
      const opts = {
        hitPenalty: listed.penalty, critBonus: zone.critBonus ?? 0, damagePercent: zone.damagePercent ?? 0,
        effect: zone.effect ? { id: zone.effect, chance: zone.chance + (main.damageType === "obuchowe" ? zone.bluntBonus ?? 0 : 0) } : undefined,
        noDamage: Boolean(zone.noDamage),
      };
      events.push(...(isFirearm(main) ? fireWeapon(state, data, combat, main, target, rng, opts) : strike(state, data, combat, { weapon: main, target, rng, ...opts })));
      break;
    }
    case "dual":
      events.push(...strike(state, data, combat, { weapon: main, target, rng }));
      if (!target.dead) events.push(...strike(state, data, combat, { weapon: second, target, rng, hitPenalty: c.dual.secondHitPenalty }));
      break;
    case "guard":
      events.push(...strike(state, data, combat, { weapon: main, target, rng }));
      combat.defendBonus = Math.max(combat.defendBonus, c.dual.guardBonus);
      events.push({ type: "obrona", bonus: combat.defendBonus });
      break;
    default: // "throw": the weapon stays in the bag; it only lies by the target until picked up or the fight ends
      events.push(...strike(state, data, combat, { weapon: second, target, rng, skillOverride: second.throwSkill ?? "miotanie", thrown: true }));
      combat.thrown = { uid, itemId: second.id };
  }
  return done();
}
