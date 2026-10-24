import { createNewState } from "./engine/state.js";
import { createRng } from "./engine/dice.js";
import { createSceneList, runStory } from "./engine/loop.js";
import { saveGame, loadGame, listSaves, SaveError, LoadError } from "./engine/save.js";
import { InputClosedError, InterruptError, InputExhaustedError } from "./ui/io.js";
import { choose, confirm, pressEnter } from "./ui/prompt.js";
import { paint } from "./ui/colors.js";
import { clear, flushNotices, pushNotice, framesOn, showScreen, sceneCapacity } from "./ui/screen.js";
import { sceneFullWidth } from "./ui/frame.js";
import { titleLines } from "./ui/title_screen.js";
import { useColor } from "./ui/colors.js";
import { t } from "./ui/strings.js";
import { formatDate } from "./ui/save_screen.js";
import { MissingCharacterError, QuitToMenuError, DefeatError } from "./scenes/errors.js";

/** Runs the main menu loop. Resolves with the state of the last game played (or null). */
export async function runApp({ data, io, options = {} }) {
  const { ui } = data;
  const debug = Boolean(options.debug);
  const story = createSceneList(data.story.scenes);
  let lastState = null;
  const screenCtx = { io, notices: [] };

  /** The defeat screen, then the game goes on from the newest save (auto, 1-3) that loads, or back to the menu when none does. */
  async function defeated() {
    clear(io);
    io.write(paint("warn", t(ui, "combat.defeat")));
    await pressEnter(io, ui);
    const candidates = (await listSaves(data))
      .filter((s) => s.ok && ["auto", "1", "2", "3"].includes(s.slot))
      .sort((a, b) => String(b.summary.savedAt).localeCompare(String(a.summary.savedAt)));
    let loaded;
    const warnings = [];
    for (const save of candidates) {
      try {
        loaded = await loadGame(save.slot, data, { warnings });
        break;
      } catch (err) {
        if (!(err instanceof LoadError)) throw err;
        pushNotice(screenCtx, paint("warn", err.message));
      }
    }
    if (!loaded) return "menu";
    for (const w of warnings) pushNotice(screenCtx, paint("warn", w));
    const loadedRng = createRng(loaded.seed);
    loadedRng.setState(loaded.rngState);
    return play(loaded, loadedRng);
  }

  /** Plays one game; returns "menu" to go back to the menu or "exit" to quit the app. */
  async function play(state, rng) {
    lastState = state;
    const ctx = { state, data, io, rng, debug, story, handlers: options.handlers, notices: screenCtx.notices };
    try {
      await runStory(ctx);
      return "menu";
    } catch (err) {
      if (err instanceof InputExhaustedError) throw err;
      if (err instanceof QuitToMenuError) return "menu";
      if (err instanceof DefeatError) return defeated();
      if (err instanceof InputClosedError) {
        try {
          await saveGame("auto", state, rng);
          io.write(paint("warn", t(ui, "exit.inputClosed")));
        } catch (saveErr) {
          if (!(saveErr instanceof SaveError)) throw saveErr;
          io.write(paint("warn", t(ui, "save.failed", { reason: saveErr.message })));
        }
        return "exit";
      }
      if (err instanceof InterruptError) {
        let save;
        try {
          save = await confirm(io, ui, t(ui, "confirm.saveOnExit"));
        } catch (inner) {
          if (inner instanceof InterruptError || inner instanceof InputClosedError) return "exit";
          throw inner;
        }
        if (save) {
          try {
            await saveGame("auto", state, rng);
          } catch (saveErr) {
            if (!(saveErr instanceof SaveError)) throw saveErr;
            io.write(paint("warn", t(ui, "save.failed", { reason: saveErr.message })));
          }
        }
        return "exit";
      }
      if (err instanceof MissingCharacterError) {
        pushNotice(screenCtx, paint("warn", t(ui, "error.noCharacter")));
        return "menu";
      }
      let crashSaved = true;
      try {
        await saveGame("crash", state, rng);
      } catch {
        crashSaved = false;
      }
      pushNotice(screenCtx, paint("warn", t(ui, crashSaved ? "error.crash" : "error.crashNoSave")));
      if (debug) pushNotice(screenCtx, err.stack);
      return "menu";
    }
  }

  async function newGame() {
    const seed = options.seed ?? (Date.now() >>> 0);
    const state = createNewState({ seed, startScene: options.scene ?? data.story.start, rules: data.rules });
    const rng = createRng(seed);
    try {
      await saveGame("auto", state, rng);
    } catch (err) {
      if (!(err instanceof SaveError)) throw err;
      pushNotice(screenCtx, paint("warn", t(ui, "save.failed", { reason: err.message })));
    }
    return play(state, rng);
  }

  async function loadMenu() {
    const saves = await listSaves(data);
    if (saves.length === 0) {
      pushNotice(screenCtx, t(ui, "menu.noSaves")); // shown on the main menu's screen (written now it would be erased)
      return "menu";
    }
    const labels = [];
    const slots = [];
    for (const save of saves) {
      if (!save.ok) {
        const corrupt = t(ui, "load.corrupt", { slot: save.slot, reason: save.error });
        if (io.frame) io.frame.notices.push(corrupt);
        else io.write(corrupt);
        continue;
      }
      const { summary } = save;
      labels.push(t(ui, "load.entry", {
        slot: save.slot,
        scene: summary.sceneTitle ?? summary.sceneId,
        day: summary.day,
        date: formatDate(summary.savedAt),
      }));
      slots.push(save.slot);
    }
    labels.push(t(ui, "load.back"));
    const index = await choose(io, ui, labels);
    if (index === slots.length) return "menu";
    let state;
    const warnings = [];
    try {
      state = await loadGame(slots[index], data, { warnings });
    } catch (err) {
      if (!(err instanceof LoadError)) throw err;
      pushNotice(screenCtx, paint("warn", err.message));
      return "menu";
    }
    for (const w of warnings) pushNotice(screenCtx, paint("warn", w));
    const rng = createRng(state.seed);
    rng.setState(state.rngState);
    return play(state, rng);
  }

  try {
    for (;;) {
      let animate;
      if (framesOn(io)) {
        // the title screen: a picture filling the whole scene panel, a little animated while the menu waits
        await showScreen(screenCtx, { lines: [], hero: false, bare: true });
        const frame = (tick) => titleLines({ width: sceneFullWidth(io.columns), height: sceneCapacity(io), tick, color: useColor() });
        io.frame.body = frame(0);
        animate = { ms: 140, frame };
      } else {
        flushNotices(screenCtx);
        io.write(paint("title", t(ui, "menu.title")));
      }
      const pick = await choose(io, ui, [t(ui, "menu.new"), t(ui, "menu.load"), t(ui, "menu.exit")], undefined, { animate });
      if (pick === 2) break;
      const next = pick === 0 ? await newGame() : await loadMenu();
      if (next === "exit") break;
    }
  } catch (err) {
    if (!(err instanceof InterruptError || err instanceof InputClosedError)) throw err;
  }
  return { lastState };
}
