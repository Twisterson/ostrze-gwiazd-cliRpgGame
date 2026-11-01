/** Artifacts: charge state, regeneration, passive modifiers, abilities in combat, exposure during rest. */
import { itemById } from "./items.js";
import { timeOfDay } from "../engine/time.js";
import { enemyById } from "./combat/data.js";
import { livingEnemies } from "./combat/state.js";
import { dealDamage, mitigate } from "./combat/formulas.js";
import { applyToPlayer, applyToEnemy } from "./combat/effects.js";
import { onEnemyDeath, noiseOfKill } from "./combat/strike.js";
import { activePhenomenon } from "./phenomena.js";
import { getStats } from "./stats.js";
import { unequip, removeItem } from "./inventory.js";

const isArtifact = (item) => item?.type === "artifact";

/** The saved `{ charge, exposed }` of an artifact, or undefined when it was never owned. */
export function artifactState(state, itemId) {
  return state.artifacts?.[itemId];
}

/** Creates the state entry on the first pick-up (charge = `charge.start`); later pick-ups keep the saved charge. */
export function registerArtifact(state, item) {
  state.artifacts ??= {};
  state.artifacts[item.id] ??= { charge: item.charge.start, exposed: false };
}

/** Artifact items currently in the bag. */
export function carriedArtifacts(state, data) {
  return (state.inventory?.items ?? []).map((s) => itemById(data, s.id)).filter(isArtifact);
}

/** The artifact whose passives and abilities work: the talisman, else a weapon artifact in `bron`, else null. */
export function equippedArtifact(state, data) {
  const eq = state.inventory?.equipped ?? {};
  for (const slot of ["talizman", "bron"]) {
    const item = eq[slot] ? itemById(data, eq[slot]) : undefined;
    if (isArtifact(item) && item.slot === slot) return item;
  }
  return null;
}

/** True when the regeneration condition `when` holds now. */
function conditionHolds(when, state, data, context, phenomenon) {
  if (when === "night") return timeOfDay(state.time.minutes, data.rules) === "noc";
  if (when === "day") return timeOfDay(state.time.minutes, data.rules) === "dzien";
  if (when === "in_combat") return Boolean(context.combat);
  if (when.startsWith("phenomenon:")) return phenomenon?.id === when.slice("phenomenon:".length);
  if (when.startsWith("near:")) {
    const tag = when.slice("near:".length);
    if ((context.sceneTags ?? []).includes(tag)) return true;
    return (context.combat?.enemies ?? []).some((e) => !e.dead && !e.fled && (enemyById(data, e.id)?.tags ?? []).includes(tag));
  }
  return false;
}

/**
 * Charges every artifact in the bag for `minutes` of game time (clock reading = the start of the stretch):
 * perHour × minutes/60 × the product of the met conditions × the phenomenon multiplier × the bag multiplier (not worn, not exposed).
 * An active phenomenon with `exposed: "full"` fills an exposed artifact at once. Charge stays within 0…max.
 * @param {{ combat?: object, sceneTags?: string[], phenomenon?: object | null }} [context]
 * @returns {Array<{ type: "artefakt_naladowany", id: string }>}
 */
export function regenerate(state, data, minutes, context = {}) {
  const events = [];
  const phenomenon = context.phenomenon ?? null;
  const worn = equippedArtifact(state, data);
  for (const item of carriedArtifacts(state, data)) {
    registerArtifact(state, item);
    const entry = state.artifacts[item.id];
    if (item.regen.requiresExposure && !entry.exposed) continue;
    const max = item.charge.max;
    const before = entry.charge;
    const effect = phenomenon?.onArtifacts?.[entry.exposed ? "exposed" : "carried"];
    if (effect === "full") entry.charge = max;
    else {
      let mult = (item.regen.conditions ?? []).reduce((m, c) => (conditionHolds(c.when, state, data, context, phenomenon) ? m * c.multiplier : m), 1);
      if (effect) mult *= effect.multiplier;
      if (item !== worn && !entry.exposed) mult *= data.rules.artifacts.carriedRegenMultiplier;
      entry.charge = Math.min(max, Math.max(0, before + (item.regen.perHour * minutes / 60) * mult));
    }
    if (before < max && entry.charge >= max) events.push({ type: "artefakt_naladowany", id: item.id });
  }
  return events;
}

/** Modifier objects of the worn artifact's passives whose `minCharge` the charge reaches. */
export function passiveModifiers(state, data) {
  const item = equippedArtifact(state, data);
  const charge = item ? artifactState(state, item.id)?.charge ?? 0 : 0;
  return item ? (item.passive ?? []).filter((p) => charge >= p.minCharge).map((p) => p.modifiers) : [];
}

/** Worn artifacts with room for more charge: the ones worth exposing (one in the bag has to be put on first). */
export function unchargedArtifacts(state, data) {
  const worn = Object.values(state.inventory?.equipped ?? {});
  return carriedArtifacts(state, data).filter((item) => worn.includes(item.id) && (artifactState(state, item.id)?.charge ?? item.charge.start) < item.charge.max);
}

/** Exposes the worn artifacts that are not full (a full one would only tempt a thief), or takes all of them back in. */
export function setExposed(state, data, on) {
  const uncharged = unchargedArtifacts(state, data);
  for (const item of carriedArtifacts(state, data)) {
    registerArtifact(state, item);
    state.artifacts[item.id].exposed = on && uncharged.includes(item);
  }
}

/** Charge an ability costs now: `fixed` value, `percent` of max, `all` = the current charge. */
function chargeCostOf(item, ability, charge) {
  const { type, value } = ability.cost;
  if (type === "fixed") return value;
  if (type === "percent") return (item.charge.max * value) / 100;
  return charge;
}

/**
 * Abilities of the worn artifact with their costs. Greyed out (`disabled`, `reason` ui key): `combat.noAp`, `combat.notThrown`
 * (`recall` with nothing thrown), `artifact.notFull` (`requiresFull`), `artifact.noCharge`; with `whenEmpty.usable` an ability the charge cannot pay is offered for `viaHp` HP
 * instead (`artifact.noHp` when HP ≤ that cost — it never kills).
 * @returns {Array<{ id: string, name: string, apCost: number, chargeCost: number, disabled: boolean, reason?: string, viaHp?: number, target: string, effect: string }>}
 */
export function abilityOptions(state, data, combat) {
  const item = equippedArtifact(state, data);
  if (!item) return [];
  const charge = artifactState(state, item.id)?.charge ?? 0;
  return (item.abilities ?? []).map((ability) => {
    const chargeCost = chargeCostOf(item, ability, charge);
    const short = ability.cost.type === "all" ? charge <= 0 : charge < chargeCost;
    let reason;
    let viaHp;
    if (combat.playerAp < ability.apCost) reason = "combat.noAp";
    else if (ability.recall && !combat.thrown) reason = "combat.notThrown";
    else if (ability.requiresFull && charge < item.charge.max) reason = "artifact.notFull";
    else if (short && item.whenEmpty?.usable) {
      viaHp = item.whenEmpty.costHp;
      if (state.character.hp <= viaHp) reason = "artifact.noHp";
    } else if (short) reason = "artifact.noCharge";
    return {
      id: ability.id, name: ability.name, apCost: ability.apCost, chargeCost, disabled: !!reason,
      ...(reason ? { reason } : {}), ...(viaHp !== undefined ? { viaHp } : {}), target: ability.effect.target, effect: ability.effect.id,
      ...(ability.description ? { description: ability.description } : {}),
    };
  });
}

/**
 * Uses ability `abilityId` of the worn artifact: spends AP and charge (or HP through `whenEmpty`), brings a thrown weapon back
 * (`recall`), deals its `damage` to the target (no hit roll, no flat armor; the target's reduction counts), then puts its effect
 * (at `effect.chance` %, if any) on the player or on `target` (uid of a living enemy, required for enemy effects); an enemy killed
 * by the damage gets no effect. A player's mistake changes nothing.
 * @returns {{ ok: true, events: object[] } | { ok: false, reason: string }}
 */
export function useAbility(state, data, combat, abilityId, target, rng) {
  const option = abilityOptions(state, data, combat).find((o) => o.id === abilityId);
  if (!option) return { ok: false, reason: "combat.noTechnique" };
  if (option.disabled) return { ok: false, reason: option.reason };
  const item = equippedArtifact(state, data);
  const ability = item.abilities.find((a) => a.id === abilityId);
  const foe = ability.effect.target === "enemy" ? livingEnemies(combat).find((e) => e.uid === target) : null;
  if (ability.effect.target === "enemy" && !foe) return { ok: false, reason: "combat.noTarget" };
  combat.playerAp -= option.apCost;
  const events = [];
  if (option.viaHp !== undefined) {
    dealDamage(combat, state.character, option.viaHp);
    events.push({ type: "zdolnosc", artifact: item.id, ability: abilityId, viaHp: option.viaHp, text: item.whenEmpty.text });
  } else {
    const entry = state.artifacts[item.id];
    entry.charge = Math.max(0, entry.charge - option.chargeCost);
    events.push({ type: "zdolnosc", artifact: item.id, ability: abilityId });
  }
  if (ability.recall) combat.thrown = null;
  if (ability.damage) {
    const base = enemyById(data, foe.id);
    const amount = mitigate({
      raw: rng.int(ability.damage[0], ability.damage[1]),
      reductionPercent: base.reduction?.[ability.damageType] ?? 0, taken: base.damageTaken?.[ability.damageType] ?? 1,
    });
    const damage = dealDamage(combat, foe, amount);
    events.push({ type: "atak", attacker: "player", target: foe.uid, hit: true, damage, crit: false, chance: 100, weapon: item.id });
    if (foe.dead) {
      onEnemyDeath(data, combat, foe, events);
      noiseOfKill(data, combat, foe, rng, events);
      return { ok: true, events };
    }
  }
  const { chance, duration } = ability.effect;
  if (chance !== undefined && rng.int(1, 100) > chance) return { ok: true, events };
  if (foe) events.push(...effectEventsOnEnemy(data, combat, foe, ability.effect.id, rng, duration));
  else {
    const r = applyToPlayer(state, data, ability.effect.id, rng, { duration });
    events.push({ type: r.resisted ? "efekt_odparty" : "efekt_nalozony", id: ability.effect.id, target: "player" });
  }
  return { ok: true, events };
}

function effectEventsOnEnemy(data, combat, enemy, id, rng, duration) {
  const r = applyToEnemy(data, combat, enemy, id, rng, { duration });
  return [{ type: r.immune ? "efekt_odporny" : r.applied ? "efekt_nalozony" : "efekt_odparty", id, target: enemy.uid }];
}

/**
 * One slept hour with exposed artifacts: rolls for a thief (`riskPerHour`, `riskPerHourPhenomenon` during a phenomenon). A thief
 * (`zlodziej`, which ends the sleep) is caught on `catchBase + catchPerPoint × attribute`; otherwise he takes `thiefMoneyPercent` of
 * the money and, at `thiefArtifactChance`, one exposed artifact (taken off its slot and out of the bag; its charge entry stays).
 * Roll order: risk, catch, money percent, artifact chance, artifact pick.
 * @returns {object[]} [] or [zlodziej, zlodziej_przylapany | zlodziej_kradnie {money}, zlodziej_artefakt {id}?]
 */
export function exposureRisk(state, data, rng) {
  const ex = data.rules.exposure;
  const exposed = carriedArtifacts(state, data).filter((item) => artifactState(state, item.id)?.exposed);
  if (exposed.length === 0) return [];
  const risk = activePhenomenon(state, data) ? ex.riskPerHourPhenomenon : ex.riskPerHour;
  if (rng.int(1, 100) > risk) return [];
  const events = [{ type: "zlodziej" }];
  const watch = getStats(state, data).attributes[ex.catchAttribute] ?? 0;
  if (rng.int(1, 100) <= ex.catchBase + ex.catchPerPoint * watch) {
    events.push({ type: "zlodziej_przylapany" });
    return events;
  }
  const ch = state.character;
  const money = Math.floor((ch.money * rng.int(ex.thiefMoneyPercent[0], ex.thiefMoneyPercent[1])) / 100);
  ch.money -= money;
  events.push({ type: "zlodziej_kradnie", money });
  if (rng.int(1, 100) <= ex.thiefArtifactChance) {
    const item = exposed[rng.int(0, exposed.length - 1)];
    for (const [slot, id] of Object.entries(state.inventory.equipped)) if (id === item.id) unequip(state, data, slot);
    removeItem(state, data, item.id, 1);
    state.artifacts[item.id].exposed = false;
    events.push({ type: "zlodziej_artefakt", id: item.id });
  }
  return events;
}
