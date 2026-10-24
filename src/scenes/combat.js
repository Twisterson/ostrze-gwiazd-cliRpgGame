import { clear, flushNotices, pushNotice, statusBar, framesOn, drawFrame, sceneCapacity } from "../ui/screen.js";
import { heroPanel } from "../ui/hero_panel.js";
import { sceneWidth, frameWidth, sceneLines } from "../ui/frame.js";
import { select } from "../ui/menu.js";
import { pressEnter } from "../ui/prompt.js";
import { pushEventNotices, combatEventText } from "../ui/events.js";
import { renderCombat, combatActionItems, techniqueItems, zoneItems } from "../ui/combat_screen.js";
import { paint } from "../ui/colors.js";
import { t } from "../ui/strings.js";
import { itemById } from "../systems/items.js";
import { createCombat, livingEnemies, outcomeOf } from "../systems/combat/state.js";
import { playerActions, doAction, attackTargets, useOptions } from "../systems/combat/actions.js";
import { techniqueActions, techniqueTargets, zoneActions } from "../systems/combat/techniques.js";
import { beginTurn, endTurn, runEnemyTurns, finishCombat } from "../systems/combat/turn.js";
import { DefeatError, MissingCharacterError } from "./errors.js";

/** Appends the journal text of every event that has one. */
function logEvents(data, combat, events) {
  for (const e of events) {
    const text = combatEventText(data.ui, data, combat, e);
    if (text !== null) combat.log.push(text);
  }
}

/** Log length at the previous draw of each fight's screen (for the skipped-entries marker). */
const logSeen = new WeakMap();

/** Redraws the combat screen above the action list (in a frame: the hero panel with AP, the enemies' block as the scene). */
function drawScreen(ctx, combat, targetUid, extra = []) {
  const { state, data, io } = ctx;
  clear(io);
  if (!logSeen.has(combat)) io.discardInput?.(); // the fight's first screen: drop keys typed ahead during the previous one
  const view = { columns: io.columns, rows: io.rows, tty: io.isTTY, targetUid, logSeen: logSeen.get(combat) ?? 0 };
  if (framesOn(io)) {
    const notices = (ctx.notices ?? []).splice(0);
    io.frame = { hero: heroPanel(state, data, { cols: frameWidth(io.columns), combat }), title: combat.def?.title ?? null, body: [], commands: [], notices, page: 0, choiceTitle: null };
    // the enemies' block and the journal fill the scene panel exactly, so the text never pages
    const below = sceneLines(extra, sceneWidth(io.columns));
    const height = sceneCapacity(io) - below.length;
    io.frame.body = [...renderCombat(state, data, combat, { ...view, frame: true, width: sceneWidth(io.columns), height }), ...below];
    drawFrame(io, []);
  } else {
    flushNotices(ctx);
    for (const line of renderCombat(state, data, combat, view)) io.write(line);
    for (const line of extra) io.write(line);
  }
  logSeen.set(combat, combat.log.length);
}

/** Picks one of `uids` (no question for a single one); null = "Wróć". The screen is redrawn with only the picker below it. */
async function pickTarget(ctx, combat, uids, targetUid) {
  if (uids.length === 1) return uids[0];
  const { data, io } = ctx;
  drawScreen(ctx, combat, targetUid);
  const { ui } = data;
  const items = uids.map((uid) => {
    const e = combat.enemies.find((x) => x.uid === uid);
    const pct = Math.max(1, Math.round((e.hp / e.hpMax) * 100));
    return { label: t(ui, "combat.targetRow", { name: e.name, pct, band: t(ui, `range.${e.band === "melee" ? "melee" : "far"}`) }) };
  });
  items.push({ label: t(ui, "combat.back"), hotkey: "w" });
  const pick = await select(io, ui, { title: t(ui, "combat.pickTarget"), items, initial: Math.max(0, uids.indexOf(targetUid)) });
  return pick === uids.length ? null : uids[pick];
}

/**
 * The full journal: one `select` row per entry (the widget scrolls), the cursor on the newest one, then "Wróć".
 * Any choice closes it; nothing is spent.
 */
async function showLog(ctx, combat) {
  const { data, io } = ctx;
  const { ui } = data;
  if (framesOn(io)) return showLogFrame(ctx, combat);
  const back = { label: t(ui, "combat.back"), hotkey: "w" };
  const empty = combat.log.length === 0;
  const note = empty ? [paint("title", t(ui, "combat.logTitle")), paint("dim", t(ui, "combat.logEmpty"))] : [];
  if (framesOn(io)) drawScreen(ctx, combat, undefined, note);
  else {
    clear(io);
    for (const line of note) io.write(line);
  }
  if (empty) {
    await select(io, ui, { items: [back] });
    return;
  }
  const items = [...combat.log.map((line) => ({ label: `· ${line}` })), back];
  await select(io, ui, { title: t(ui, "combat.logTitle"), items, initial: combat.log.length - 1 });
}

/** The journal in a frame: the scene panel shows it in full height (newest at the bottom), ↑/↓ scroll, Enter or [W] closes. */
async function showLogFrame(ctx, combat) {
  const { data, io } = ctx;
  const { ui } = data;
  drawScreen(ctx, combat, undefined);
  io.frame.title = t(ui, "combat.logTitle");
  const width = sceneWidth(io.columns);
  const lines = combat.log.length ? sceneLines(combat.log.map((entry) => `· ${entry}`), width) : [paint("dim", t(ui, "combat.logEmpty"))];
  const rows = sceneCapacity(io);
  const maxTop = Math.max(0, lines.length - rows);
  let top = maxTop;
  for (;;) {
    io.frame.body = lines.slice(top, top + rows);
    drawFrame(io, [paint("dim", t(ui, "combat.logScroll")), "", paint("title", `▶ [W] ${t(ui, "combat.back")}`)]);
    const key = await io.readKey();
    if (key.name === "enter" || (key.name === "char" && key.char.toLowerCase() === "w")) return;
    if (key.name === "up") top = Math.max(0, top - 1);
    else if (key.name === "down") top = Math.min(maxTop, top + 1);
  }
}

/**
 * The "Techniki" submenu, then the target (when the technique needs one and there is a choice).
 * @returns {Promise<object|null>} the action for `doAction`, or null when "Wróć" was chosen at any level
 */
async function pickTechnique(ctx, combat, targetUid) {
  const { state, data, io } = ctx;
  const { ui } = data;
  drawScreen(ctx, combat, targetUid);
  const techniques = techniqueActions(state, data, combat);
  const items = [...techniqueItems(data, techniques), { label: t(ui, "combat.back"), hotkey: "w" }];
  const pick = await select(io, ui, { title: t(ui, "combat.pickTechnique"), items });
  if (pick === techniques.length) return null;
  const action = { id: techniques[pick].id };
  // pick-up and self abilities of an artifact need no target
  if (!["pickup", "ready"].includes(action.id) && !(techniques[pick].artifact && techniques[pick].target !== "enemy")) {
    const uid = await pickTarget(ctx, combat, techniqueTargets(state, data, combat, action.id), targetUid);
    if (uid === null) return null;
    action.target = uid;
  }
  return action;
}

/** Chooses the item for "Użyj"; null = "Wróć". The screen is redrawn with only the picker below it. */
async function pickUse(ctx, combat, targetUid) {
  const { state, data, io } = ctx;
  const { ui } = data;
  drawScreen(ctx, combat, targetUid);
  const options = useOptions(state, data, combat);
  const items = options.map((o) => ({
    label: t(ui, "combat.useRow", { item: itemById(data, o.itemId).name, ap: o.apCost }) + (o.from === "bag" ? t(ui, "combat.useBag") : ""),
    ...(o.apCost > combat.playerAp ? { disabled: true } : {}),
  }));
  items.push({ label: t(ui, "combat.back"), hotkey: "w" });
  const pick = await select(io, ui, { title: t(ui, "combat.pickItem"), items });
  return pick === options.length ? null : options[pick];
}

/**
 * One player turn: the action list until the turn ends or the fight is over.
 * @returns {Promise<string|undefined>} the last chosen target uid
 */
async function playerTurn(ctx, combat, targetUid) {
  const { state, data, io, rng } = ctx;
  const { ui } = data;
  let target = targetUid;
  let cursor = 0;
  while (!outcomeOf(state, combat)) {
    drawScreen(ctx, combat, target);
    // The aimed blows (head, torso, legs, stun) sit right below "Atak".
    const actions = playerActions(state, data, combat);
    const zones = zoneActions(state, data, combat);
    // A weapon pair (or a second hand weapon) puts "Atak obiema" and "Rzuć" right there too, not only in "Techniki".
    const pairTech = techniqueActions(state, data, combat).filter((a) => (a.id === "pickup" ? Boolean(combat.thrown) : a.id === "ready" ? a.reason !== "combat.noReach" : ["dual", "throw"].includes(a.id) && a.reason !== "combat.noSecond" && !(a.id === "throw" && combat.thrown)));
    const menu = actions.flatMap((a) => (a.id === "attack" ? [{ id: a.id }, ...zones.map((z) => ({ id: "aimed", zone: z.id })), ...pairTech.map((a2) => ({ id: a2.id, technique: true }))] : [{ id: a.id }]));
    const zoneRows = [...zoneItems(data, zones), ...techniqueItems(data, pairTech)];
    const items = combatActionItems(ui, actions).flatMap((item, i) => (actions[i].id === "attack" ? [item, ...zoneRows] : [item]));
    const pick = await select(io, ui, { items, initial: cursor });
    cursor = pick;
    const { id, zone, technique } = menu[pick];
    if (id === "log") { await showLog(ctx, combat); continue; }
    let action = zone ? { id, zone } : { id };
    if (technique && (id === "pickup" || id === "ready")) {
      // no target to choose
    } else if (technique) {
      const uid = await pickTarget(ctx, combat, techniqueTargets(state, data, combat, id), target);
      if (uid === null) continue;
      action.target = uid;
    } else if (zone) {
      const uid = await pickTarget(ctx, combat, techniqueTargets(state, data, combat, "aimed"), target);
      if (uid === null) continue;
      action.target = uid;
    } else if (id === "techniques") {
      action = await pickTechnique(ctx, combat, target);
      if (action === null) continue;
    } else if (id === "attack" || id === "move") {
      const uids = id === "attack" ? attackTargets(state, data, combat) : livingEnemies(combat).map((e) => e.uid);
      const uid = await pickTarget(ctx, combat, uids, target);
      if (uid === null) continue;
      action.target = uid;
    } else if (id === "use") {
      const option = await pickUse(ctx, combat, target);
      if (option === null) continue;
      action.itemId = option.itemId;
      if (option.needsTarget) {
        const uid = await pickTarget(ctx, combat, livingEnemies(combat).map((e) => e.uid), target);
        if (uid === null) continue;
        action.target = uid;
      }
    }
    const result = doAction(state, data, combat, action, ctx.rng);
    if (!result.ok) { pushNotice(ctx, paint("warn", t(ui, result.reason))); continue; }
    if (action.target && livingEnemies(combat).some((e) => e.uid === action.target)) target = action.target;
    logEvents(data, combat, result.events);
    if (result.endTurn) break;
  }
  return target;
}

/**
 * After the enemies' phase: when more entries arrived than the journal shows (e.g. several free reach blows and bites at once),
 * lists the newest of them on the combat screen until Enter, so no wound appears out of nowhere.
 */
async function recap(ctx, combat, since, target) {
  const { data, io } = ctx;
  const entries = combat.log.slice(since);
  if (entries.length <= data.rules.combat.logSize) return;
  const shown = entries.slice(-RECAP_MAX);
  const lines = [paint("warn", t(data.ui, "combat.recap", { n: entries.length })), ...shown.map((text) => paint("dim", `· ${text}`))];
  drawScreen(ctx, combat, target, lines);
  await pressEnter(io, data.ui);
}
const RECAP_MAX = 8;

/** Replaces the contents of `state` with `snapshot`, keeping the object itself (the context holds it). */
function restoreState(state, snapshot) {
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, snapshot);
}

/** The post-fight screen: final combat view, result line (none after a lethal defeat), loot notices, Enter. */
async function summary(ctx, combat, result, lethal = false) {
  const { state, data, io } = ctx;
  const { ui } = data;
  const key = result.outcome === "win" ? "combat.summaryWin"
    : result.outcome === "defeat" ? (combat.training ? "combat.summaryLostTraining" : "combat.summaryLost")
      : result.outcome === "draw" ? "combat.summaryDraw" : "combat.summaryFled";
  const line = lethal ? null : paint(result.outcome === "win" ? "heal" : "warn", t(ui, key, { xp: result.xp }));
  if (!lethal) pushEventNotices(ctx, result.events);
  if (framesOn(io)) {
    drawScreen(ctx, combat, undefined, line ? ["", line] : []);
    await pressEnter(io, ui);
    return;
  }
  clear(io);
  io.write(statusBar(state, data, { debug: ctx.debug, width: io.columns }));
  for (const l of renderCombat(state, data, combat, { columns: io.columns, rows: io.rows, tty: io.isTTY })) io.write(l);
  io.write("");
  if (lethal) {
    await pressEnter(io, ui);
    return;
  }
  io.write(line);
  flushNotices(ctx);
  await pressEnter(io, ui);
}

/**
 * Plays a whole fight for `def` ({ id, enemies, start, canFlee, nonLethal, training, minutes, onDefeat }) and shows the summary.
 * With `opts.record` the outcome is stored in `world.finishedCombats[opts.record]` as soon as the rewards are paid,
 * so a save made right after (level-up screen) skips the fight instead of paying twice.
 * Any interruption (Ctrl+C, closed input) restores the state to what it was before the fight (or to `opts.restore`),
 * so an auto save made then points at the scene and the fight starts over after loading, with no double reward.
 * A lethal defeat (no `onDefeat`, not `nonLethal`) only shows the final view (the killing blow): the caller throws `DefeatError`.
 * @returns {Promise<"win"|"defeat"|"fled"|"draw">}
 */
export async function runCombat(ctx, def, opts = {}) {
  const { state, data, rng } = ctx;
  if (!state.character) throw new MissingCharacterError();
  const snapshot = opts.restore ?? structuredClone(state);
  const hpBefore = state.character.hp;
  try {
    // Sparring ends at HP 1, so starting at 1 would be an instant defeat; the real HP is restored afterwards.
    if (def.training && hpBefore < 2) state.character.hp = 2;
    const combat = createCombat(state, data, def, rng);
    let target;
    logEvents(data, combat, runEnemyTurns(state, data, combat, rng));
    while (!outcomeOf(state, combat)) {
      const begun = beginTurn(state, data, combat, rng);
      logEvents(data, combat, begun.events);
      if (outcomeOf(state, combat)) break;
      if (begun.skip) {
        drawScreen(ctx, combat, target);
        await pressEnter(ctx.io, data.ui);
      } else {
        target = await playerTurn(ctx, combat, target);
      }
      if (outcomeOf(state, combat)) break;
      const mark = combat.log.length;
      logEvents(data, combat, endTurn(state, data, combat));
      logEvents(data, combat, runEnemyTurns(state, data, combat, rng));
      if (!outcomeOf(state, combat)) await recap(ctx, combat, mark, target);
    }
    const result = finishCombat(state, data, combat, rng);
    if (opts.record) (state.world.finishedCombats ??= {})[opts.record] = result.outcome;
    const spared = result.outcome === "defeat" && Boolean(def.onDefeat || def.nonLethal);
    if (spared) state.character.hp = 1;
    // Sparring with blunt wood leaves no lasting wounds, win or lose.
    if (def.training) state.character.hp = hpBefore;
    await summary(ctx, combat, result, result.outcome === "defeat" && !spared);
    return result.outcome;
  } catch (err) {
    restoreState(state, snapshot);
    throw err;
  }
}

/** Maps a fight outcome to the scene result: `{ goto }`, nothing (carry on) or a thrown `DefeatError`. */
export function combatNext(def, outcome) {
  if (outcome === "fled" || outcome === "draw") return def.onFlee ? { goto: def.onFlee } : undefined;
  if (outcome === "defeat") {
    if (def.onDefeat) return { goto: def.onDefeat };
    if (def.nonLethal) return undefined;
    throw new DefeatError();
  }
  return undefined;
}

/** `combat` scene: a fight (see `runCombat`) followed by the outcome's route. */
export async function combat(ctx, scene) {
  const done = ctx.state.world.finishedCombats?.[scene.id];
  if (done) return combatNext(scene, done);
  const outcome = await runCombat(ctx, scene, { record: scene.id });
  return combatNext(scene, outcome);
}
