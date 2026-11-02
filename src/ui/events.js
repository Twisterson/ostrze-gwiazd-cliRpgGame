import { itemById } from "../systems/items.js";
import { effectById } from "../systems/effects.js";
import { HUNGER_DYING } from "../systems/food.js";
import { enemyById } from "../systems/combat/data.js";
import { enemyByUid } from "../systems/combat/state.js";
import { MAX_ROUNDS } from "../systems/combat/turn.js";
import { thrownName } from "../systems/combat/techniques.js";
import { phenomenonById } from "../systems/phenomena.js";
import { paint } from "./colors.js";
import { pushNotice } from "./screen.js";
import { t } from "./strings.js";
import { questById } from "../systems/quests.js";
import { placeName, placeById } from "../systems/places.js";

const MAX_NOTICES = 8;

/** "3h" below a day, "1d 5h" / "2d" from 24 h up. */
export function formatRemaining(ui, hours) {
  if (hours < 24) return t(ui, "duration.hours", { n: hours });
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? t(ui, "duration.daysHours", { d: days, h: rest }) : t(ui, "duration.days", { d: days });
}

/** "Kamień Zmierzchu: Płonące ostrze." (+ the `whenEmpty` text and the HP paid). */
function abilityText(ui, data, e) {
  const item = itemById(data, e.artifact);
  const params = { artifact: item?.name ?? e.artifact, ability: item?.abilities?.find((a) => a.id === e.ability)?.name ?? e.ability };
  return e.viaHp !== undefined ? t(ui, "combat.abilityHp", { ...params, text: e.text, hp: e.viaHp }) : t(ui, "combat.ability", params);
}

/** "Głodny: Siła -1, Krzepa -1, gorzej się leczysz we śnie." – a stage of hunger with what it takes away. */
function hungerStage(id, data) {
  const { ui } = data;
  const def = effectById(data, id);
  const names = [...data.attributes, ...data.skills];
  const list = Object.entries(def.modifiers ?? {}).map(([key, value]) => `${names.find((n) => n.id === key)?.name ?? key} ${value}`);
  if (def.restHealMultiplier) list.push(t(ui, "event.hungerRest"));
  return paint("warn", id === HUNGER_DYING ? t(ui, "event.starving", { list: list.join(", ") }) : t(ui, "event.hunger", { name: def.name, list: list.join(", ") }));
}

/** The painted notice for one event, or null when the event is silent. */
function noticeFor(ctx, e) {
  const { data } = ctx;
  const { ui } = data;
  const effectName = () => effectById(data, e.id)?.name ?? e.id;
  const itemName = () => itemById(data, e.id)?.name ?? e.id;
  const withQty = (key) => t(ui, key, { item: itemName(), qty: e.qty }).replace(/ ×1\.$/, ".");
  switch (e.type) {
    case "zmiana_pory": return paint("dim", t(ui, `time.change.${e.to}`));
    case "efekt_obrazenia": return paint("warn", t(ui, "effect.tick", { name: effectName(), damage: e.damage }));
    case "efekt_koniec": return paint("dim", t(ui, "effect.ended", { name: effectName() }));
    case "efekt_nalozony": return paint("warn", t(ui, "effect.applied", { name: effectName() }));
    case "efekt_odparty": return paint("dim", t(ui, "effect.resisted", { name: effectName() }));
    case "otrzymano": return paint("heal", withQty("event.got"));
    case "oddano": return paint("dim", withQty("event.gave"));
    case "pieniadze": {
      if (e.delta === 0) return null;
      const currency = t(ui, "currency.short");
      return e.delta >= 0
        ? paint("heal", t(ui, "event.moneyUp", { n: e.delta, currency }))
        : paint("dim", t(ui, "event.moneyDown", { n: -e.delta, currency }));
    }
    case "xp": return paint("heal", t(ui, "event.xp", { n: e.amount }));
    case "bieglosc": return paint("heal", t(ui, "combat.mastery", { name: t(ui, `mastery.${e.masteryType}`), after: e.after }));
    case "za_ciezko": return paint("warn", t(ui, "event.tooHeavy", { item: itemName() }));
    case "zapowiedz_zjawiska": {
      const def = phenomenonById(data, e.id);
      return paint("mystic", t(ui, "event.omen", { text: def?.omen.text ?? "", name: def?.name ?? e.id }));
    }
    case "start_zjawiska": return paint("mystic", t(ui, "event.phenomenonStart", { name: phenomenonById(data, e.id)?.name ?? e.id }));
    case "koniec_zjawiska": return paint("dim", t(ui, "event.phenomenonEnd", { name: phenomenonById(data, e.id)?.name ?? e.id }));
    case "artefakt_naladowany": return paint("mystic", t(ui, "event.artifactFull", { name: itemName() }));
    case "zdolnosc": return paint("mystic", abilityText(ui, data, e));
    case "zlodziej": return paint("warn", t(ui, "event.thief"));
    case "zlodziej_przylapany": return paint("heal", t(ui, "event.thiefCaught"));
    case "zlodziej_kradnie": return e.money === 0 ? null : paint("warn", t(ui, "event.thiefStole", { n: e.money, currency: t(ui, "currency.short") }));
    case "zlodziej_artefakt": return paint("warn", t(ui, "event.thiefArtifact", { name: itemName() }));
    case "zadanie_start": return paint("title", t(ui, "event.questStart", { name: questById(data, e.id)?.name ?? e.id }));
    case "zadanie_wykonane": return paint("heal", t(ui, "event.questDone", { name: questById(data, e.id)?.name ?? e.id }));
    case "zadanie_przepadlo": {
      const quest = questById(data, e.id);
      const back = quest?.retryAt ? placeById(data, quest.retryAt)?.spot : null;
      if (back) return paint("warn", t(ui, "event.questRetry", { name: quest.name, place: back.name }));
      if (e.expired && quest?.client) return paint("warn", t(ui, "event.questExpired", { client: quest.client }));
      return paint("warn", t(ui, "event.questFailed", { name: quest?.name ?? e.id }));
    }
    case "odkryto": {
      // A place in another region is not on the map in front of the player: say where it is instead of promising it.
      const place = placeById(data, e.id);
      const here = placeById(data, ctx.state?.world?.location)?.location;
      if (place && here && place.location.region !== here.region) {
        return paint("title", t(ui, "event.revealedElsewhere", { name: placeName(data, e.id), where: place.location.name }));
      }
      return paint("title", t(ui, "event.revealed", { name: placeName(data, e.id) }));
    }
    case "zapowiedz_miejsca": return paint("mystic", t(ui, "event.hinted"));
    case "zadanie_limit": return paint("warn", t(ui, "event.questLimit", { name: questById(data, e.id)?.name ?? e.id }));
    case "goraca_strawa": return paint("heal", t(ui, e.hp > 0 ? "event.hotMeal" : "event.hotMealFull", { hp: e.hp }));
    case "posilek": return paint("dim", t(ui, "event.meal", { item: itemName(), left: e.left }));
    case "glod_etap": return hungerStage(e.id, data);
    case "glod_pora": return paint("warn", t(ui, "event.hungerHint"));
    case "zatrucie_jedzeniem": return paint("warn", t(ui, "event.foodPoison", { item: itemName() }));
    default: return null; // flaga, zmienna and unknown events stay silent
  }
}

/** Queues a notice for every visible event; more than 8 collapse into "…i n więcej.". */
export function pushEventNotices(ctx, events) {
  const messages = events.map((e) => noticeFor(ctx, e)).filter((m) => m !== null);
  for (const m of messages.slice(0, MAX_NOTICES)) pushNotice(ctx, m);
  if (messages.length > MAX_NOTICES) pushNotice(ctx, paint("dim", t(ctx.data.ui, "event.more", { n: messages.length - MAX_NOTICES })));
}

/** An enemy's display name ("Bandyta 1"); `acc` uses the accusative base ("Bandytę 1"). */
function enemyLabel(data, combat, uid, acc = false) {
  const enemy = enemyByUid(combat, uid);
  if (!enemy) return uid;
  const base = enemyById(data, enemy.id);
  if (!acc || !base?.nameAcc) return enemy.name;
  return base.nameAcc + enemy.name.slice(base.name.length); // keeps the instance number
}

/** Colour role of a journal entry: red when the hero is hurt, green for the hero's hits, blue when a foe falls or flees. */
export function combatEventRole(e) {
  switch (e.type) {
    case "atak":
      if (!e.hit) return "dim";
      return e.attacker === "player" ? "heal" : e.target === "player" ? "damage" : "dim";
    case "efekt_obrazenia": return e.target === "player" ? "damage" : "dim";
    case "rozerwanie": return "damage";
    case "wrog_pokonany":
    case "wrog_ucieka": return "foe_down";
    default: return "dim";
  }
}

/** The plain journal text of one combat event, or null when it has no entry. */
export function combatEventText(ui, data, combat, e) {
  const effectName = () => effectById(data, e.id)?.name ?? e.id;
  const who = () => enemyLabel(data, combat, e.target);
  const itemName = (id) => itemById(data, id)?.name ?? id;
  switch (e.type) {
    case "atak": {
      const crit = e.crit ? t(ui, "combat.crit") : "";
      if (e.attacker === "player") {
        const weapon = e.thrown ? thrownName(itemById(data, e.weapon)) ?? e.weapon : itemName(e.weapon);
        const [hitKey, missKey] = e.reaction ? ["combat.reactionHit", "combat.reactionMiss"]
          : e.thrown ? ["combat.throwHit", "combat.throwMiss"] : ["combat.youHit", "combat.youMiss"];
        if (!e.hit) return t(ui, missKey, { weapon });
        return t(ui, hitKey, { weapon, target: enemyLabel(data, combat, e.target, true), damage: e.damage }).replace(/\.$/, `${crit}.`);
      }
      const attacker = enemyLabel(data, combat, e.attacker);
      if (!e.hit) return t(ui, "combat.miss", { attacker });
      const key = e.target === "player" ? "combat.hitYou" : "combat.hit";
      return t(ui, key, { attacker, target: e.target === "player" ? "" : enemyLabel(data, combat, e.target, true), damage: e.damage }).replace(/\.$/, `${crit}.`);
    }
    case "przeladowanie": return t(ui, "combat.reload", { weapon: itemName(e.weapon) });
    case "uzycie": {
      const item = itemById(data, e.item)?.name ?? e.item;
      if (e.fumble) return t(ui, "combat.useFumble", { item });
      return t(ui, e.hit === false ? "combat.useMiss" : "combat.use", { item });
    }
    case "leczenie": return t(ui, "combat.heal", { amount: e.amount });
    case "zmiana_broni": return t(ui, "combat.swap");
    case "gotowosc": return t(ui, "combat.readyEvent");
    case "podniesienie": return t(ui, "combat.pickUp", { item: thrownName(itemById(data, e.item)) ?? e.item });
    case "ruch": {
      const melee = e.band === "melee";
      if (e.leap) return t(ui, "combat.leap", { name: enemyLabel(data, combat, e.mover) });
      if (e.mover === "player") return t(ui, melee ? "combat.youMoveMelee" : "combat.youMoveFar", { target: enemyLabel(data, combat, e.target, true) });
      return t(ui, melee ? "combat.moveMelee" : "combat.moveFar", { target: who() });
    }
    case "obrona": return t(ui, "combat.defend", { bonus: e.bonus });
    case "ucieczka": return t(ui, e.success ? "combat.fleeOk" : "combat.fleeFail");
    case "wrog_pokonany": return t(ui, "combat.defeated", { target: who() });
    case "wrog_ucieka": return t(ui, "combat.flees", { target: who() });
    case "tura_przepada": return e.target === "player" ? t(ui, "combat.youStunned") : t(ui, "combat.stunned", { name: who() });
    case "slabosc": return t(ui, "combat.lowHp");
    case "remis": return t(ui, "combat.draw", { rounds: MAX_ROUNDS });
    case "bieglosc": return t(ui, "combat.mastery", { name: t(ui, `mastery.${e.masteryType}`), after: e.after });
    case "niewypal": return t(ui, "combat.misfire", { weapon: itemName(e.weapon) });
    case "rozerwanie": return t(ui, "combat.burst", { weapon: itemName(e.weapon), damage: e.damage });
    case "strach_bronia": return t(ui, "combat.fear", { fear: e.fear });
    case "posilki": return t(ui, "combat.reinforcements", { names: e.enemies.map((uid) => enemyLabel(data, combat, uid)).join(", ") });
    case "dym": return t(ui, "combat.effectField", { name: effectName() });
    case "pd": return t(ui, "combat.xp", { n: e.amount });
    case "zdolnosc": return abilityText(ui, data, e);
    case "efekt_nalozony":
      if (e.target === "player") return t(ui, "effect.applied", { name: effectName() });
      return e.target === "battlefield" ? t(ui, "combat.effectField", { name: effectName() }) : t(ui, "combat.effect", { target: who(), name: effectName() });
    case "efekt_odparty":
      return e.target === "player" ? t(ui, "effect.resisted", { name: effectName() }) : t(ui, "combat.resisted", { target: who(), name: effectName() });
    case "efekt_odporny":
      return e.target === "player" ? t(ui, "combat.immuneYou", { name: effectName() }) : t(ui, "combat.immune", { target: who(), name: effectName() });
    case "efekt_obrazenia":
      return e.target === "player" ? t(ui, "effect.tick", { name: effectName(), damage: e.damage }) : t(ui, "combat.tick", { target: who(), name: effectName(), damage: e.damage });
    case "efekt_koniec":
      return e.target === "player" || e.target === "battlefield" ? t(ui, "effect.ended", { name: effectName() }) : t(ui, "combat.effectEnd", { target: who(), name: effectName() });
    case "efekt_ap":
      return e.target === "player" ? t(ui, "combat.apLossYou", { name: effectName(), ap: e.ap }) : t(ui, "combat.apLoss", { target: who(), name: effectName(), ap: e.ap });
    default: return null;
  }
}
