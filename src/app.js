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
import { GRAPHICS, getGraphics, setGraphics, graphicsMode, useColor } from "./ui/colors.js";
import { tintLines } from "./ui/pixels.js";
import { select } from "./ui/menu.js";
import { saveGraphics, saveLanguage, loadLanguage, LANGUAGES, dataDir } from "./config.js";
import { loadData } from "./engine/data.js";
import { chooseLanguage } from "./ui/language_screen.js";
import { t } from "./ui/strings.js";
import { formatDate } from "./ui/save_screen.js";
import { MissingCharacterError, QuitToMenuError, DefeatError } from "./scenes/errors.js";

/**
 * Runs the main menu loop. Resolves with the state of the last game played (or null).
 * `reloadData(lang)` loads the data in another language (a switch in the menu, the first-run question).
 * Options: `lang` – the language was given for this run (`--lang`): a switch is not saved and nothing is asked;
 * `askLanguage` – with no saved language, ask for one before the menu (only a real terminal turns it on).
 */
export async function runApp({ data: initialData, io, options = {}, reloadData = (lang) => loadData(dataDir(), { lang }) }) {
  const debug = Boolean(options.debug);
  let lastState = null;
  // `app.data` is the data now in use and `app.story` its scene list. Everything below reads them at the moment of use
  // (never a copy taken at start), so a language switch replaces both and the next screen is in the new language.
  const app = { data: initialData, story: createSceneList(initialData.story.scenes) };
  const ui = () => app.data.ui;
  const currentLang = () => app.data.lang ?? "pl"; // hand-made test data carries no `lang`
  // `options.notices`: messages from the start (cli.js) for the first screen
  const screenCtx = { io, notices: (options.notices ?? []).map((n) => paint("warn", n)), get data() { return app.data; } };

  /** The defeat screen, then the game goes on from the newest save (auto, 1-3) that loads, or back to the menu when none does. */
  async function defeated() {
    clear(io);
    io.write(paint("warn", t(ui(), "combat.defeat")));
    await pressEnter(io, ui());
    const candidates = (await listSaves(app.data))
      .filter((s) => s.ok && ["auto", "1", "2", "3"].includes(s.slot))
      .sort((a, b) => String(b.summary.savedAt).localeCompare(String(a.summary.savedAt)));
    let loaded;
    const warnings = [];
    for (const save of candidates) {
      try {
        loaded = await loadGame(save.slot, app.data, { warnings });
        break;
      } catch (err) {
        if (!(err instanceof LoadError)) throw err;
        pushNotice(screenCtx, paint("warn", err.message));
        if (debug && err.reason) pushNotice(screenCtx, err.reason);
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
    const ctx = { state, data: app.data, io, rng, debug, story: app.story, handlers: options.handlers, notices: screenCtx.notices };
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
          io.write(paint("warn", t(ui(), "exit.inputClosed")));
        } catch (saveErr) {
          if (!(saveErr instanceof SaveError)) throw saveErr;
          io.write(paint("warn", t(ui(), "save.failed", { reason: saveErr.message })));
        }
        return "exit";
      }
      if (err instanceof InterruptError) {
        let save;
        try {
          save = await confirm(io, ui(), t(ui(), "confirm.saveOnExit"));
        } catch (inner) {
          if (inner instanceof InterruptError || inner instanceof InputClosedError) return "exit";
          throw inner;
        }
        if (save) {
          try {
            await saveGame("auto", state, rng);
          } catch (saveErr) {
            if (!(saveErr instanceof SaveError)) throw saveErr;
            io.write(paint("warn", t(ui(), "save.failed", { reason: saveErr.message })));
          }
        }
        return "exit";
      }
      if (err instanceof MissingCharacterError) {
        pushNotice(screenCtx, paint("warn", t(ui(), "error.noCharacter")));
        return "menu";
      }
      let crashSaved = true;
      try {
        await saveGame("crash", state, rng);
      } catch {
        crashSaved = false;
      }
      pushNotice(screenCtx, paint("warn", t(ui(), crashSaved ? "error.crash" : "error.crashNoSave")));
      if (debug) pushNotice(screenCtx, err.stack);
      return "menu";
    }
  }

  async function newGame() {
    const seed = options.seed ?? (Date.now() >>> 0);
    const state = createNewState({ seed, startScene: options.scene ?? app.data.story.start, rules: app.data.rules });
    const rng = createRng(seed);
    try {
      await saveGame("auto", state, rng);
    } catch (err) {
      if (!(err instanceof SaveError)) throw err;
      pushNotice(screenCtx, paint("warn", t(ui(), "save.failed", { reason: err.message })));
    }
    return play(state, rng);
  }

  async function loadMenu() {
    const saves = await listSaves(app.data);
    if (saves.length === 0) {
      pushNotice(screenCtx, t(ui(), "menu.noSaves")); // shown on the main menu's screen (written now it would be erased)
      return "menu";
    }
    const labels = [];
    const slots = [];
    for (const save of saves) {
      if (!save.ok) {
        // the OS reason (debug only) goes the same way as the corrupt line
        for (const line of [t(ui(), "load.corrupt", { slot: save.slot, reason: save.error }), ...(debug && save.reason ? [save.reason] : [])]) {
          if (io.frame) io.frame.notices.push(line);
          else io.write(line);
        }
        continue;
      }
      const { summary } = save;
      labels.push(t(ui(), "load.entry", {
        slot: save.slot,
        scene: summary.sceneTitle ?? summary.sceneId,
        day: summary.day,
        date: formatDate(summary.savedAt),
      }));
      slots.push(save.slot);
    }
    labels.push(t(ui(), "load.back"));
    const index = await choose(io, ui(), labels);
    if (index === slots.length) return "menu";
    let state;
    const warnings = [];
    try {
      state = await loadGame(slots[index], app.data, { warnings });
    } catch (err) {
      if (!(err instanceof LoadError)) throw err;
      pushNotice(screenCtx, paint("warn", err.message));
      if (debug && err.reason) pushNotice(screenCtx, err.reason);
      return "menu";
    }
    for (const w of warnings) pushNotice(screenCtx, paint("warn", w));
    const rng = createRng(state.seed);
    rng.setState(state.rngState);
    return play(state, rng);
  }

  /** Goes on to the next look of the pictures, at once and for the next runs too. */
  function nextGraphics() {
    const next = GRAPHICS[(GRAPHICS.indexOf(getGraphics()) + 1) % GRAPHICS.length];
    setGraphics(next);
    try {
      saveGraphics(next);
    } catch (err) {
      pushNotice(screenCtx, paint("warn", t(ui(), "menu.graphics.saveFailed", { reason: err.message })));
    }
  }

  /**
   * Puts the game in `lang`: reloads the data and, unless the language was given for this run (`--lang`), saves the
   * choice. A failed reload keeps the current language (and saves nothing); both failures are said on the next screen.
   */
  async function switchLanguage(lang, { save = !options.lang } = {}) {
    if (lang !== currentLang()) {
      let next;
      try {
        next = await reloadData(lang);
      } catch (err) {
        pushNotice(screenCtx, paint("warn", t(ui(), "menu.language.loadFailed", { reason: err.message })));
        return;
      }
      app.data = next;
      app.story = createSceneList(next.story.scenes);
    }
    if (!save) return;
    try {
      saveLanguage(lang);
    } catch (err) {
      pushNotice(screenCtx, paint("warn", t(ui(), "menu.language.saveFailed", { reason: err.message })));
    }
  }

  try {
    // the first run on a terminal: no language saved and none given, so ask (in both languages) and keep the answer
    if (options.askLanguage && !options.lang && loadLanguage() === null) await switchLanguage(await chooseLanguage(screenCtx));
    let cursor;
    for (;;) {
      let animate;
      if (framesOn(io)) {
        // the title screen: a picture filling the whole scene panel, a little animated while the menu waits
        await showScreen(screenCtx, { lines: [], hero: false, bare: true });
        const frame = (tick) => tintLines(titleLines({ width: sceneFullWidth(io.columns), height: sceneCapacity(io), tick, color: graphicsMode() !== "none", subtitle: t(ui(), "title.tagline") }));
        io.frame.body = frame(0);
        animate = { ms: 140, frame };
      } else {
        flushNotices(screenCtx);
        io.write(paint("title", t(ui(), "menu.title")));
      }
      // the pictures exist only in a frame: line mode has no such row
      const available = useColor();
      const graphicsRow = { id: "graphics", disabled: !available, label: t(ui(), "menu.graphics", { mode: t(ui(), `menu.graphics.${available ? getGraphics() : "off"}`) }) };
      const languageRow = { id: "language", label: t(ui(), "menu.language", { lang: t(ui(), `menu.language.${currentLang()}`) }) };
      const items = [{ id: "new", label: t(ui(), "menu.new") }, { id: "load", label: t(ui(), "menu.load") }, ...(framesOn(io) ? [graphicsRow] : []), languageRow, { id: "exit", label: t(ui(), "menu.exit") }];
      const { id } = items[await select(io, ui(), { items, initial: cursor, animate })];
      cursor = undefined;
      if (id === "exit") break;
      if (id === "graphics") {
        nextGraphics();
        cursor = items.indexOf(graphicsRow);
        continue;
      }
      if (id === "language") {
        await switchLanguage(LANGUAGES[(LANGUAGES.indexOf(currentLang()) + 1) % LANGUAGES.length]);
        cursor = items.indexOf(languageRow);
        continue;
      }
      const next = id === "new" ? await newGame() : await loadMenu();
      if (next === "exit") break;
    }
  } catch (err) {
    if (!(err instanceof InterruptError || err instanceof InputClosedError)) throw err;
  }
  clear(io); // leaving the game leaves a clean terminal (a crash above keeps what it printed)
  return { lastState };
}
