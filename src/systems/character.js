/** Character logic: creator choices, XP, level-up, perks. No UI imports; messages are developer strings. */
import { getStats } from "./stats.js";
import { startMastery } from "./combat/mastery.js";

const NAME_PATTERN = /^[\p{L}][\p{L} -]*$/u;

/** Starting attributes of the creator: `attributeStart` + `gifts`. */
export function creatorStartAttributes(data) {
  const { creator } = data.rules;
  return Object.fromEntries(data.attributes.map((a) => [a.id, creator.attributeStart + (creator.gifts[a.id] ?? 0)]));
}

/** @returns {string[]} error messages (empty = valid) */
export function validateCreatorChoices(choices, data) {
  const { creator } = data.rules;
  const errors = [];
  const { name, classId, attributes, tagged } = choices ?? {};

  if (typeof name !== "string" || name.length < creator.nameMin || name.length > creator.nameMax) {
    errors.push(`imię musi mieć od ${creator.nameMin} do ${creator.nameMax} znaków`);
  } else if (!NAME_PATTERN.test(name)) {
    errors.push("imię może zawierać tylko litery, spacje i myślniki (i zaczyna się od litery)");
  }

  const cls = data.classes.find((c) => c.id === classId);
  if (!cls) errors.push(`nieznana klasa "${classId}"`);

  if (typeof attributes !== "object" || attributes === null || Array.isArray(attributes)) {
    errors.push("brak atrybutów");
  } else {
    const ids = data.attributes.map((a) => a.id);
    for (const key of Object.keys(attributes)) if (!ids.includes(key)) errors.push(`nieznany atrybut "${key}"`);
    let valid = true;
    for (const id of ids) {
      const v = attributes[id];
      if (!Number.isInteger(v)) {
        errors.push(`atrybut "${id}" musi być liczbą całkowitą`);
        valid = false;
      } else if (v < creator.attributeMin || v > creator.attributeMax) {
        errors.push(`atrybut "${id}" poza zakresem ${creator.attributeMin}–${creator.attributeMax}`);
      }
    }
    if (valid) {
      const start = creatorStartAttributes(data);
      const spent = ids.reduce((s, id) => s + attributes[id] - start[id], 0);
      if (spent < creator.points) errors.push(`niewydana pula punktów (${creator.points - spent})`);
      else if (spent > creator.points) errors.push(`przekroczona pula punktów (o ${spent - creator.points})`);
    }
  }

  if (!Array.isArray(tagged)) {
    errors.push("brak umiejętności wiodących");
  } else {
    if (tagged.length !== creator.taggedCount) errors.push(`wybierz dokładnie ${creator.taggedCount} umiejętności wiodące`);
    if (new Set(tagged).size !== tagged.length) errors.push("umiejętności wiodące się powtarzają");
    for (const id of tagged) if (!data.skills.some((s) => s.id === id)) errors.push(`nieznana umiejętność "${id}"`);
    if (cls && !tagged.includes(cls.taggedSkill)) errors.push(`wśród wiodących musi być umiejętność klasy "${cls.taggedSkill}"`);
  }
  return errors;
}

/** @returns {object} Character; throws Error(errors.join("; ")) on invalid choices */
export function createCharacter(choices, data) {
  const errors = validateCreatorChoices(choices, data);
  if (errors.length > 0) throw new Error(errors.join("; "));
  const character = {
    name: choices.name,
    classId: choices.classId,
    level: 1,
    xp: 0,
    money: 0,
    attributes: { ...choices.attributes },
    skillPoints: {},
    tagged: [...choices.tagged],
    perks: [],
    effects: [],
    pendingLevelUp: null,
    mastery: startMastery(data.classes.find((c) => c.id === choices.classId)),
    hp: 0,
  };
  const state = { character, time: { minutes: data.rules.startHour * 60 } };
  character.hp = getStats(state, data, { permanentOnly: true }).derived.hpMax;
  return character;
}

export const xpToReach = (level, rules) => (rules.leveling.xpStep * (level - 1) * level) / 2;

export const skillPointsPerLevel = (character, rules) =>
  rules.leveling.skillPointsBase + Math.floor(character.attributes.rozum / rules.leveling.skillPointsRozumDiv);

/** Adds XP, raising level and accumulating pendingLevelUp. */
export function addXp(character, amount, data) {
  if (!Number.isInteger(amount) || amount < 0) throw new Error(`addXp: niepoprawna ilość XP (${amount})`);
  const { rules } = data;
  const { perkEveryLevels, maxPerks, attributeEveryLevels } = rules.leveling;
  character.xp += amount;
  let levelsGained = 0;
  while (character.xp >= xpToReach(character.level + 1, rules)) {
    character.level += 1;
    levelsGained += 1;
    const pending = (character.pendingLevelUp ??= { skillPoints: 0, perks: 0 });
    pending.skillPoints += skillPointsPerLevel(character, rules);
    if (character.level % perkEveryLevels === 0 && character.perks.length + pending.perks < maxPerks) pending.perks += 1;
    // An attribute point every `attributeEveryLevels` levels, on the levels without a perk (3, 5, …).
    if ((character.level - 1) % attributeEveryLevels === 0) pending.attributePoints = (pending.attributePoints ?? 0) + 1;
  }
  return { levelsGained };
}

/** Perks with requirement check against permanent stats. */
export function availablePerks(state, data) {
  const stats = getStats(state, data, { permanentOnly: true });
  const ch = state.character;
  return data.perks.map((perk) => {
    const missing = [];
    const req = perk.requires ?? {};
    for (const [id, need] of Object.entries(req.attributes ?? {})) {
      if (stats.attributes[id] < need) missing.push({ kind: "attribute", id, need, have: stats.attributes[id] });
    }
    for (const [id, need] of Object.entries(req.skills ?? {})) {
      if (stats.skills[id] < need) missing.push({ kind: "skill", id, need, have: stats.skills[id] });
    }
    if (req.level !== undefined && ch.level < req.level) missing.push({ kind: "level", need: req.level, have: ch.level });
    if (ch.perks.includes(perk.id)) missing.push({ kind: "owned" });
    if (ch.perks.length >= data.rules.leveling.maxPerks) missing.push({ kind: "limit" });
    return { perk, ok: missing.length === 0, missing };
  });
}

/** Unclamped (permanent) value of every skill, summed from the breakdown. */
const rawSkills = (state, data) => {
  const { breakdown } = getStats(state, data, { permanentOnly: true });
  return Object.fromEntries(data.skills.map((s) => [s.id, breakdown[s.id].reduce((sum, e) => sum + e.value, 0)]));
};

/** Applies skill points and perks of a pending level-up; throws Error on any violation. Heals fully. */
export function applyLevelUp(state, choice, data) {
  const ch = state.character;
  const pending = ch.pendingLevelUp;
  if (!pending) throw new Error("brak oczekującego awansu");
  const { max, taggedPointValue } = data.rules.skills;
  const points = choice?.skillPoints ?? {};
  const perks = choice?.perks ?? [];
  const attrs = choice?.attributes ?? {};

  // Attribute points first (they are applied together with the rest or not at all).
  const attrMax = data.rules.creator.attributeMax;
  let attrTotal = 0;
  for (const [id, n] of Object.entries(attrs)) {
    if (!data.attributes.some((a) => a.id === id)) throw new Error(`nieznany atrybut "${id}"`);
    if (!Number.isInteger(n) || n < 0) throw new Error(`niepoprawna liczba punktów dla atrybutu "${id}"`);
    if (n > 0 && ch.attributes[id] + n > attrMax) throw new Error(`atrybut "${id}" przekroczyłby limit ${attrMax}`);
    attrTotal += n;
  }
  const attrPending = pending.attributePoints ?? 0;
  if (attrTotal > attrPending) throw new Error(`za dużo punktów atrybutów (${attrTotal} > ${attrPending})`);
  if (attrTotal < attrPending && data.attributes.some((a) => ch.attributes[a.id] + (attrs[a.id] ?? 0) < attrMax)) {
    throw new Error(`rozdaj wszystkie punkty atrybutów (${attrTotal} < ${attrPending})`);
  }

  let total = 0;
  for (const [id, n] of Object.entries(points)) {
    if (!data.skills.some((s) => s.id === id)) throw new Error(`nieznana umiejętność "${id}"`);
    if (!Number.isInteger(n) || n < 0) throw new Error(`niepoprawna liczba punktów dla "${id}"`);
    total += n;
  }
  if (total > pending.skillPoints) throw new Error(`za dużo punktów umiejętności (${total} > ${pending.skillPoints})`);

  // Perks must be available now, before the skill points are applied.
  if (new Set(perks).size !== perks.length) throw new Error("perki się powtarzają");
  const available = availablePerks(state, data);
  for (const id of perks) {
    const entry = available.find((p) => p.perk.id === id);
    if (!entry) throw new Error(`nieznany perk "${id}"`);
    if (!entry.ok) throw new Error(`perk "${id}" niedostępny`);
  }
  const expectedPerks = Math.min(pending.perks, available.filter((p) => p.ok).length);
  if (perks.length !== expectedPerks) throw new Error(`liczba perków ${perks.length} ≠ ${expectedPerks}`);

  // Apply the attribute and skill points tentatively; roll back if the cap check fails.
  const before = ch.skillPoints;
  const attributesBefore = ch.attributes;
  ch.attributes = { ...attributesBefore };
  for (const [id, n] of Object.entries(attrs)) ch.attributes[id] += n;
  ch.skillPoints = { ...before };
  for (const [id, n] of Object.entries(points)) ch.skillPoints[id] = (ch.skillPoints[id] ?? 0) + n;
  try {
    const raw = rawSkills(state, data);
    for (const id of Object.keys(points)) {
      if (points[id] > 0 && raw[id] > max) throw new Error(`umiejętność "${id}" przekroczyłaby limit ${max}`);
    }
    if (total < pending.skillPoints) {
      const canTake = data.skills.some((s) => raw[s.id] + (ch.tagged.includes(s.id) ? taggedPointValue : 1) <= max);
      if (canTake) throw new Error(`rozdaj wszystkie punkty umiejętności (${total} < ${pending.skillPoints})`);
    }
  } catch (err) {
    ch.skillPoints = before;
    ch.attributes = attributesBefore;
    throw err;
  }

  ch.perks.push(...perks);
  ch.pendingLevelUp = null;
  ch.hp = getStats(state, data, { permanentOnly: true }).derived.hpMax;
}
