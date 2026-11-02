/** getStats: pure computation of attributes, skills and derived values over a registry of modifier sources. */
import { emptyTotals, addModifiers, NUMERIC_KEYS, DAMAGE_TYPES } from "./modifiers.js";
import { itemById } from "./items.js";
import { timeOfDay } from "../engine/time.js";
import { passiveModifiers, equippedArtifact } from "./artifacts.js";
import { activePhenomenon } from "./phenomena.js";

/** @typedef {{ source: { kind: "class" | "perk" | "timeOfDay" | "item" | "effect" | "artifact" | "phenomenon", id: string }, modifiers: object, permanent: boolean }} Source */

const classSource = (state, data) => {
  const cls = data.classes.find((c) => c.id === state.character.classId);
  return cls?.modifiers ? [{ source: { kind: "class", id: cls.id }, modifiers: cls.modifiers, permanent: true }] : [];
};

const perkSources = (state, data) =>
  state.character.perks
    .map((id) => data.perks.find((p) => p.id === id))
    .filter((perk) => perk?.modifiers)
    .map((perk) => ({ source: { kind: "perk", id: perk.id }, modifiers: perk.modifiers, permanent: true }));

/** `modifiers` plus `penalty` on every skill based on Bystrość (night, phenomena). */
function withBystroscPenalty(data, modifiers, penalty) {
  const out = { ...modifiers };
  if (penalty !== undefined) {
    for (const skill of data.skills) {
      if (skill.primary === "bystrosc" || skill.secondary === "bystrosc") out[skill.id] = (out[skill.id] ?? 0) + penalty;
    }
  }
  return out;
}

const timeOfDaySource = (state, data) => {
  const id = timeOfDay(state.time.minutes, data.rules);
  const entry = data.rules.timeOfDay.find((e) => e.id === id);
  return [{ source: { kind: "timeOfDay", id }, modifiers: withBystroscPenalty(data, entry.modifiers, entry.bystroscSkillPenalty), permanent: false }];
};

/** The running phenomenon: its modifiers and its Bystrość penalty (adds up with the night's). */
const phenomenonSource = (state, data) => {
  const def = activePhenomenon(state, data);
  return def ? [{ source: { kind: "phenomenon", id: def.id }, modifiers: withBystroscPenalty(data, def.modifiers ?? {}, def.bystroscSkillPenalty), permanent: false }] : [];
};

/** Worn items (all slots except the back-up and off-hand weapons); tolerates a missing/null inventory. */
function wornItems(state, data) {
  const equipped = state.inventory?.equipped ?? {};
  return Object.entries(equipped)
    .filter(([slot, id]) => slot !== "bron_zapas" && slot !== "bron_druga" && id)
    .map(([, id]) => itemById(data, id))
    .filter(Boolean);
}

const equipmentSource = (state, data) =>
  wornItems(state, data)
    .filter((item) => item.modifiers)
    .map((item) => ({ source: { kind: "item", id: item.id }, modifiers: item.modifiers, permanent: false }));

/** Active status effects, modifiers × stacks; reads data.effects directly (effects.js imports this module). */
const effectSources = (state, data) =>
  (state.character?.effects ?? []).flatMap((entry) => {
    const def = (data.effects ?? []).find((e) => e.id === entry.id);
    if (!def?.modifiers) return [];
    const modifiers = Object.fromEntries(Object.entries(def.modifiers).map(([key, v]) => [key, typeof v === "number" ? v * entry.stacks : v]));
    return [{ source: { kind: "effect", id: entry.id }, modifiers, permanent: false }];
  });

/** Passives of the worn artifact reached by its charge. */
const artifactSources = (state, data) => {
  const item = state.inventory ? equippedArtifact(state, data) : null;
  return item ? passiveModifiers(state, data).map((modifiers) => ({ source: { kind: "artifact", id: item.id }, modifiers, permanent: false })) : [];
};

/** Registry of modifier sources: (state, data) => Source[]. Later cycles append here. */
export const STAT_SOURCES = [classSource, perkSources, timeOfDaySource, equipmentSource, effectSources, artifactSources, phenomenonSource];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param {object} state game state with a non-null `character`
 * @param {object} data GameData
 * @param {{ permanentOnly?: boolean }} [opts]
 */
export function getStats(state, data, opts = {}) {
  const ch = state.character;
  if (!ch) throw new Error("getStats: brak postaci");
  const { rules } = data;
  const sources = STAT_SOURCES.flatMap((fn) => fn(state, data)).filter((s) => !(opts.permanentOnly && !s.permanent));
  const sum = (list) => list.reduce((acc, s) => addModifiers(acc, s.modifiers), emptyTotals());
  const permanentTotals = sum(sources.filter((s) => s.permanent));
  const allTotals = sum(sources);

  const breakdown = {};
  const track = (key, base) => {
    const entries = [{ source: { kind: "base" }, value: base }];
    for (const s of sources) {
      const v = s.modifiers[key];
      if (typeof v === "number" && v !== 0) entries.push({ source: s.source, value: v });
    }
    breakdown[key] = entries;
  };

  // (2) permanent attributes, (5) final attributes
  const permAttrs = {};
  const attributes = {};
  for (const { id } of data.attributes) {
    permAttrs[id] = ch.attributes[id] + (permanentTotals.numbers[id] ?? 0);
    attributes[id] = Math.max(0, ch.attributes[id] + (allTotals.numbers[id] ?? 0));
    track(id, ch.attributes[id]);
  }

  // (3) skill base from permanent attributes, (4) final skill with all sources
  const sk = rules.skills;
  const skills = {};
  for (const skill of data.skills) {
    const tagged = ch.tagged.includes(skill.id);
    const base = sk.primaryMult * permAttrs[skill.primary] + sk.secondaryMult * permAttrs[skill.secondary]
      + (tagged ? rules.creator.taggedBonus : 0)
      + (ch.skillPoints[skill.id] ?? 0) * (tagged ? sk.taggedPointValue : 1);
    skills[skill.id] = clamp(base + (allTotals.numbers[skill.id] ?? 0), 0, sk.max);
    track(skill.id, base);
  }

  // (6) derived
  const d = rules.derived;
  const a = attributes;
  const bases = {
    hpMax: d.hpBase + d.hpPerKrzepa * a.krzepa + (ch.level - 1) * (d.hpPerLevelBase + Math.floor(a.krzepa / d.hpPerLevelKrzepaDiv)),
    ap: d.apBase + Math.floor(a.zrecznosc / d.apZrecznoscDiv),
    carry: d.carryBase + d.carryPerSila * a.sila,
    defense: d.defensePerZrecznosc * a.zrecznosc,
    initiative: a.zrecznosc + a.bystrosc,
    critChance: a.fart,
  };
  const derived = {};
  for (const key of NUMERIC_KEYS) {
    const base = bases[key] ?? 0;
    derived[key] = base + (allTotals.numbers[key] ?? 0);
    track(key, base);
  }

  // equipment armor and per-type reduction (capped), not affected by permanentOnly
  const worn = opts.permanentOnly ? [] : wornItems(state, data);
  // Past `softCap` a full set counts at `rate`: a light kit stays as it is, the sum of many pieces stops making the wearer untouchable.
  const { softCap } = rules.inventory;
  const soft = (total, from) => (!softCap || total <= from ? total : Math.floor(from + (total - from) * softCap.rate));
  derived.armor = soft(worn.reduce((acc, item) => acc + (item.armor ?? 0), 0), softCap?.armorFrom);
  derived.reduction = {};
  for (const type of DAMAGE_TYPES) {
    const total = worn.reduce((acc, item) => acc + (item.reduction?.[type] ?? 0), 0);
    derived.reduction[type] = soft(Math.min(total, rules.inventory.maxReductionPercent), softCap?.reductionFrom);
  }

  const other = {};
  for (const [key, value] of Object.entries(allTotals.numbers)) {
    if (key.startsWith("resist_") || key.startsWith("effectDuration_")) other[key] = value;
  }
  other.damageTaken = allTotals.damageTaken;
  other.extraDamage = allTotals.extraDamage;

  return { attributes, skills, derived, other, breakdown, timeOfDay: timeOfDay(state.time.minutes, rules) };
}
