import { showScreen, clear, statusBar, flushNotices, pushNotice, framesOn } from "../ui/screen.js";
import { sceneWidth, cell } from "../ui/frame.js";
import { select, multiSelect, sliders, textInput } from "../ui/menu.js";
import { renderCharacter } from "../ui/character_screen.js";
import { paint } from "../ui/colors.js";
import { t } from "../ui/strings.js";
import { createCharacter, creatorStartAttributes } from "../systems/character.js";
import { grantStartKit } from "../systems/inventory.js";
import { getStats } from "../systems/stats.js";

const NAME_PATTERN = /^[\p{L}][\p{L} -]*$/u;

/** Interactive character creator; sets `state.character` and the `klasa_<id>` flag. */
export async function character_creation(ctx) {
  const { state, data, io } = ctx;
  const { ui, rules, attributes, skills, classes } = data;
  const { creator } = rules;

  const header = (step, lines = []) => showScreen(ctx, {
    lines: [paint("title", `${t(ui, "creator.title")} – ${t(ui, step)}`), ...lines],
  });

  const width = () => sceneWidth(io.columns);
  const title = (step) => paint("title", `${t(ui, "creator.title")} – ${t(ui, step)}`);
  // Stats of a throwaway level-1 character: the live preview next to the sliders and the skill picker.
  const sheet = (classId, attrs, tagged = []) => getStats(
    { character: { classId, attributes: attrs, skillPoints: {}, tagged, perks: [], level: 1, hp: 0 }, time: { minutes: rules.startHour * 60 } },
    data, { permanentOnly: true });
  const DERIVED = ["hpMax", "ap", "defense", "initiative", "carry", "critChance"];

  for (;;) {
    await header("creator.name");
    const name = await textInput(io, ui, {
      prompt: t(ui, "prompt.choice"),
      label: t(ui, "creator.nameLabel"),
      min: creator.nameMin,
      max: creator.nameMax,
      pattern: NAME_PATTERN,
      defaultValue: t(ui, "creator.defaultName"),
    });

    await header("creator.class");
    const classIndex = await select(io, ui, {
      items: classes.map((c) => ({ label: c.name, description: c.description })),
      preview: (i) => {
        const skill = skills.find((sk) => sk.id === classes[i].taggedSkill);
        return [title("creator.class"), "", classes[i].name, "", classes[i].description, "", t(ui, "creator.classSkill", { skill: skill?.name ?? "" })];
      },
    });
    const cls = classes[classIndex];

    await header("creator.attributes");
    const start = creatorStartAttributes(data);
    const values = await sliders(io, ui, {
      rows: attributes.map((a) => ({
        label: a.name,
        value: start[a.id],
        min: creator.attributeMin,
        max: creator.attributeMax,
        note: creator.gifts[a.id] ? `(${t(ui, "creator.gift")})` : undefined,
      })),
      budget: creator.points,
      preview: (vals, cursor) => {
        const attrs = Object.fromEntries(attributes.map((a, i) => [a.id, vals[i]]));
        const { derived } = sheet(cls.id, attrs);
        const current = attributes[Math.min(cursor, attributes.length - 1)];
        return [title("creator.attributes"), "", `${current.name}: ${current.description}`, "",
          ...DERIVED.map((k) => `${t(ui, `derived.${k}`)}  ${derived[k]}`)];
      },
    });
    const chosenAttributes = Object.fromEntries(attributes.map((a, i) => [a.id, values[i]]));

    const classSkill = skills.find((s) => s.id === cls.taggedSkill);
    await header("creator.tagged", [t(ui, "creator.taggedHint", { n: creator.taggedCount - 1, skill: classSkill.name })]);
    const preview = { character: { classId: cls.id, attributes: chosenAttributes, skillPoints: {}, tagged: [], perks: [], level: 1, hp: 0 }, time: { minutes: rules.startHour * 60 } };
    const base = getStats(preview, data, { permanentOnly: true }).skills;
    const picked = await multiSelect(io, ui, {
      items: skills.map((s) => ({ label: s.name, hint: String(base[s.id]), locked: s.id === cls.taggedSkill, checked: s.id === cls.taggedSkill })),
      count: creator.taggedCount,
      preview: (checked, cursor) => {
        const tagged = checked.map((i) => skills[i].id);
        const now = sheet(cls.id, chosenAttributes, tagged).skills;
        return [title("creator.tagged"), t(ui, "creator.taggedHint", { n: creator.taggedCount - 1, skill: classSkill.name }), "",
          ...(cursor < skills.length ? [`${skills[cursor].name}: ${base[skills[cursor].id]} → ${base[skills[cursor].id] + creator.taggedBonus}`, ""] : []),
          ...checked.map((i) => `* ${skills[i].name}  ${now[skills[i].id]}`)];
      },
    });

    let character;
    try {
      character = createCharacter({ name, classId: cls.id, attributes: chosenAttributes, tagged: picked.map((i) => skills[i].id) }, data);
    } catch (err) {
      pushNotice(ctx, paint("warn", err.message));
      continue;
    }

    const full = { ...state, character };
    let summary = ["", ...renderCharacter(full, data).split("\n")];
    if (framesOn(io)) {
      const stats = getStats(full, data);
      const half = Math.floor((width() - 2) / 2);
      const left = [paint("heading", t(ui, "char.attributes")), ...attributes.map((a) => `  ${a.name}  ${stats.attributes[a.id]}`),
        "", paint("heading", t(ui, "char.derived")), ...DERIVED.map((k) => `  ${t(ui, `creator.short.${k}`)}  ${stats.derived[k]}`)];
      const right = [paint("heading", t(ui, "char.skills")), ...skills.map((s) => (character.tagged.includes(s.id) ? paint("leading", `*${s.name}  ${stats.skills[s.id]}`) : ` ${s.name}  ${stats.skills[s.id]}`))];
      summary = ["", ...Array.from({ length: Math.max(left.length, right.length) }, (_, i) => `${cell(left[i] ?? "", half)}  ${right[i] ?? ""}`)];
    }
    await header("creator.summary", summary);
    const confirmed = await select(io, ui, { items: [{ label: t(ui, "creator.confirm") }, { label: t(ui, "creator.restart") }] });
    if (confirmed === 0) {
      state.character = character;
      state.flags["klasa_" + cls.id] = true;
      grantStartKit(state, data, cls.id);
      return;
    }
  }
}
