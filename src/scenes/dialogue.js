import { showScreen, clear, statusBar, sceneHeader, flushNotices, pushNotice, textWidth } from "../ui/screen.js";
import { select } from "../ui/menu.js";
import { pressEnter } from "../ui/prompt.js";
import { campMenu } from "../ui/camp.js";
import { showCharacter } from "../ui/character_screen.js";
import { pushEventNotices } from "../ui/events.js";
import { paint } from "../ui/colors.js";
import { wrap } from "../ui/text.js";
import { t } from "../ui/strings.js";
import { nodeView, enterNode, chooseOption, finishDialogue, optionKey } from "../systems/dialogue.js";
import { itemById } from "../systems/items.js";
import { MissingCharacterError } from "./errors.js";
import { runCombat, combatNext } from "./combat.js";

/** "(wymaga: …)" for an item or money requirement, "(niedostępne)" for any other condition. */
function lockedHint(ctx, dialogId, nodeId, key) {
  const { data } = ctx;
  const { ui } = data;
  const node = data.dialogues.find((d) => d.id === dialogId).nodes[nodeId];
  const requires = node.options.find((o, i) => optionKey(o, i) === key).requires;
  const keys = Object.keys(requires);
  let what = null;
  if (keys.length === 1 && keys[0] === "item") {
    const ref = typeof requires.item === "string" ? { id: requires.item, qty: 1 } : requires.item;
    const name = itemById(data, ref.id)?.name ?? ref.id;
    what = ref.qty > 1 ? `${name} ×${ref.qty}` : name;
  } else if (keys.length === 1 && keys[0] === "money") {
    what = `${requires.money} ${t(ui, "currency.short")}`;
  }
  return what === null ? t(ui, "dialogue.lockedOther") : t(ui, "dialogue.locked", { what });
}

/**
 * Talk scene: walks the dialogue's nodes (entry actions run once per arrival, never on a redraw or [P]),
 * then marks the scene finished so a save made afterwards cannot replay it.
 */
export async function dialogue(ctx, scene) {
  const { state, data, io } = ctx;
  const { ui } = data;
  if (!state.character) throw new MissingCharacterError();
  const done = state.world.finishedDialogues;
  const render = (view, lines = []) => (view
    ? showScreen(ctx, { title: view.speaker, text: view.text, lines: [""], art: view.portrait ?? scene.art })
    : showScreen(ctx, { lines, art: scene.art }));

  if (done.includes(scene.id)) {
    const doneLine = [paint("dim", t(ui, "dialogue.done"))];
    await render(null, doneLine);
    await campMenu(ctx, () => render(null, doneLine));
    return;
  }

  const label = (o) => {
    if (!o.check) return o.label;
    const key = ctx.debug && o.check.chance !== undefined ? "dialogue.checkLabelDebug" : "dialogue.checkLabel";
    return t(ui, key, { ...o.check, text: o.label });
  };

  // A talk interrupted by a save resumes at the node whose entry actions already ran.
  const progress = state.world.dialogueProgress;
  const resumed = progress[scene.id];
  let nodeId = resumed ?? data.dialogues.find((d) => d.id === scene.dialogue).start;
  let result = "end";
  let entering = resumed === undefined;
  let beforePick = null;
  for (;;) {
    if (entering) pushEventNotices(ctx, enterNode(state, data, scene.dialogue, nodeId, ctx.rng).events);
    entering = false;
    progress[scene.id] = nodeId;
    const view = nodeView(state, data, scene.dialogue, nodeId, { debug: ctx.debug });
    await render(view);
    const openCard = async () => { await showCharacter(ctx); await render(view); };
    if (view.isEnd) {
      await pressEnter(io, ui, { onCharacter: openCard });
      break;
    }
    const items = view.options.map((o) => {
      const item = { label: label(o) };
      if (o.disabled) {
        const hint = o.reason === "dialogue.locked" ? lockedHint(ctx, scene.dialogue, nodeId, o.key) : t(ui, o.reason);
        Object.assign(item, { disabled: true, hint });
      }
      return item;
    });
    items.push({ label: t(ui, "camp.character"), hotkey: "p", hidden: true });
    const pick = await select(io, ui, { items });
    if (pick === view.options.length) { await showCharacter(ctx); continue; }

    // A fight started by this choice that gets interrupted rolls the state back to here, so the choice is made again.
    if (scene.onCombat) beforePick = structuredClone(state);
    const out = chooseOption(state, data, scene.dialogue, nodeId, view.options[pick].key, ctx.rng);
    // ...but a failed check stays failed: an interruption must not hand out a retry.
    if (beforePick) beforePick.world.failedChecks = structuredClone(state.world.failedChecks);
    if (out.check) pushNotice(ctx, out.check.success ? paint("heal", t(ui, "dialogue.success")) : paint("warn", t(ui, "dialogue.failure")));
    pushEventNotices(ctx, out.events);
    if (out.end !== undefined) {
      result = out.end;
      if (out.combat && ctx.debug && !scene.onCombat) pushNotice(ctx, paint("dim", t(ui, "dialogue.combatLater")));
      break;
    }
    nodeId = out.next;
    entering = true;
  }

  // The fight comes straight after the talk; its route is applied once the talk is marked finished.
  const def = result === "walka" && scene.onCombat ? { ...scene.onCombat, id: scene.id } : null;
  const outcome = def ? await runCombat(ctx, def, { restore: beforePick }) : null;
  pushEventNotices(ctx, finishDialogue(state, data, scene.dialogue, result, ctx.rng).events);
  // Marked before the camp menu: a save made there must not replay the dialogue's actions.
  delete state.world.dialogueProgress[scene.id];
  state.world.finishedDialogues.push(scene.id);
  const next = def ? combatNext(def, outcome) : undefined;
  if (next) return next;
  await render();
  await campMenu(ctx, () => render());
}
