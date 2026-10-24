import { showScreen, clear, statusBar, flushNotices, pushNotice } from "../ui/screen.js";
import { select, sliders } from "../ui/menu.js";
import { paint } from "../ui/colors.js";
import { t } from "../ui/strings.js";
import { availablePerks, applyLevelUp } from "../systems/character.js";
import { getStats } from "../systems/stats.js";
import { pushEventNotices } from "../ui/events.js";
import { advanceErrands } from "../systems/quests.js";

/** Describes what a perk still requires, joined with commas (empty when nothing is missing). */
function missingText(missing, data) {
  const { ui } = data;
  return missing.map((m) => {
    if (m.kind === "attribute") return t(ui, "perk.missing.attribute", { name: data.attributes.find((a) => a.id === m.id).name, need: m.need });
    if (m.kind === "skill") return t(ui, "perk.missing.skill", { name: data.skills.find((s) => s.id === m.id).name, need: m.need });
    return t(ui, `perk.missing.${m.kind}`, { need: m.need });
  }).join(", ");
}

/** Level-up screen: skill points, then perks; applies the choice once at the end. */
export async function levelUpHook(ctx) {
  const { state } = ctx;
  const character = state.character;
  const pending = character?.pendingLevelUp;
  if (!pending) return;
  const { data, io } = ctx;
  const { ui, rules } = data;

  const header = (step) => showScreen(ctx, {
    lines: [paint("title", t(ui, "levelUp.title", { level: character.level })), paint("title", t(ui, step))],
  });

  // Perk availability is judged before the skill points are applied (as applyLevelUp does).
  const startPerks = availablePerks(state, data);

  // Attributes first (an attribute lifts the skills built on it), shown against the preview of the new values.
  const attributes = {};
  const attributePoints = pending.attributePoints ?? 0;
  const attrBase = character.attributes;
  if (attributePoints > 0 && data.attributes.some((a) => attrBase[a.id] < rules.creator.attributeMax)) {
    await header("levelUp.attributes");
    const vals = await sliders(io, ui, {
      rows: data.attributes.map((a) => ({ label: a.name, value: attrBase[a.id], min: attrBase[a.id], max: rules.creator.attributeMax, note: a.description })),
      budget: attributePoints,
    });
    data.attributes.forEach((a, i) => { if (vals[i] > attrBase[a.id]) attributes[a.id] = vals[i] - attrBase[a.id]; });
  }
  const preview = structuredClone(state);
  for (const [id, n] of Object.entries(attributes)) preview.character.attributes[id] += n;

  const skills = getStats(preview, data, { permanentOnly: true }).skills;
  const stepOf = (s) => (character.tagged.includes(s.id) ? rules.skills.taggedPointValue : 1);
  await header("levelUp.skills");
  const values = await sliders(io, ui, {
    rows: data.skills.map((s) => ({ label: s.name, value: skills[s.id], min: skills[s.id], max: rules.skills.max, step: stepOf(s) })),
    budget: pending.skillPoints,
  });
  const skillPoints = {};
  data.skills.forEach((s, i) => {
    const points = (values[i] - skills[s.id]) / stepOf(s);
    if (points > 0) skillPoints[s.id] = points;
  });

  const picked = [];
  if (pending.perks > 0 && !startPerks.some((p) => p.ok)) {
    pushNotice(ctx, paint("dim", t(ui, "levelUp.noPerk")));
  } else {
    for (let n = 0; n < pending.perks; n++) {
      // Availability stays that of the initial state (as applyLevelUp judges it); only ownership and the cap change.
      const entries = startPerks.map((e) => {
        const missing = [...e.missing];
        if (picked.includes(e.perk.id) && !missing.some((m) => m.kind === "owned")) missing.push({ kind: "owned" });
        if (character.perks.length + picked.length >= rules.leveling.maxPerks && !missing.some((m) => m.kind === "limit")) missing.push({ kind: "limit" });
        return { perk: e.perk, ok: missing.length === 0, missing };
      });
      if (!entries.some((p) => p.ok)) {
        pushNotice(ctx, paint("dim", t(ui, "levelUp.noPerk")));
        break;
      }
      await header("levelUp.perk");
      const index = await select(io, ui, {
        items: entries.map(({ perk, ok, missing }) => ({
          label: perk.name,
          hint: ok ? perk.description : missingText(missing, data),
          disabled: !ok,
        })),
      });
      picked.push(entries[index].perk.id);
    }
  }

  applyLevelUp(state, { skillPoints, perks: picked, attributes }, data);
  pushNotice(ctx, paint("mystic", t(ui, "levelUp.done", { level: character.level })));
}

/** Latches errand objectives met by the scene that just ran and completes the finished errands. */
export async function errandHook(ctx) {
  if (!ctx.state?.quests || !Array.isArray(ctx.data?.quests)) return; // minimal contexts of engine tests
  pushEventNotices(ctx, advanceErrands(ctx.state, ctx.data, ctx.rng));
}

/** Hooks run after every executed scene (and once before a story starts). */
export const defaultAfterScene = [levelUpHook, errandHook];
