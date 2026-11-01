import { t } from "./strings.js";
import { select, showAllNotices } from "./menu.js";
import { paint } from "./colors.js";
import { drawFrame, say, redrawScreen } from "./screen.js";

/** Numbered choice (arrows in a terminal). Returns the zero-based index. */
export function choose(io, ui, labels, question, extra = {}) {
  return select(io, ui, { items: labels.map((label) => ({ label })), prompt: question, ...extra });
}

/**
 * Waits for Enter. With `onCharacter`, [P] opens the character sheet and the prompt returns afterwards.
 * @param {{ onCharacter?: () => Promise<void> }} [opts]
 */
export async function pressEnter(io, ui, { onCharacter } = {}) {
  const prompt = t(ui, onCharacter ? "prompt.enterOrCharacter" : "prompt.enter");
  const keyMode = io.isTTY && (onCharacter || io.frame);
  // In a frame the choice panel offers "▶ Enter – dalej" and [P] goes to the command menu; nothing is written on the answer row.
  const writePrompt = () => {
    if (!io.frame) return io.write(prompt);
    if (onCharacter && !io.frame.commands.some((c) => c.key === "P")) io.frame.commands.push({ key: "P", label: t(ui, "camp.character") });
    if (io.frame.notices.length > 2 && !io.frame.commands.some((c) => c.key === "L")) io.frame.commands.push({ key: "L", label: t(ui, "frame.notices") });
    return drawFrame(io, [paint("title", `▶ ${t(ui, "frame.next")}`)]);
  };
  // Notices hidden behind "…i N więcej [L]" are read with [L], as in the menus.
  const hidden = () => Boolean(io.frame && io.frame.notices.length > 2);
  const showHidden = async () => {
    await showAllNotices(io, ui);
    drawFrame(io, io.frame.lastChoices ?? []);
  };
  if (keyMode) writePrompt();
  for (;;) {
    if (keyMode) {
      const key = await io.readKey();
      if (key.name === "resize") redrawScreen(io);
      if (key.name === "enter" || (key.name === "char" && key.char === "1")) return; // "[1] Dalej" and Enter are the same everywhere
      if (key.name === "char" && onCharacter && (key.char === "p" || key.char === "P")) {
        await onCharacter();
        writePrompt();
      } else if (key.name === "char" && (key.char === "l" || key.char === "L") && hidden()) {
        await showHidden();
        writePrompt();
      }
    } else {
      const answer = (await io.ask(prompt)).trim();
      if (onCharacter && (answer === "p" || answer === "P")) await onCharacter();
      else if (hidden() && (answer === "l" || answer === "L")) await showHidden();
      else return;
    }
  }
}

export async function confirm(io, ui, question) {
  if (io.frame && io.isTTY) {
    // In a frame the question joins the scene text and the answer is "[T] Tak / [N] Nie" in the choice panel.
    const saved = io.frame.body;
    io.frame.body = [...saved, "", question];
    let pick;
    try {
      pick = await select(io, ui, { items: [{ label: t(ui, "confirm.yes"), hotkey: "t" }, { label: t(ui, "confirm.no"), hotkey: "n" }], initial: 1, digits: false });
    } finally {
      io.frame.body = saved;
    }
    return pick === 0;
  }
  for (;;) {
    const answer = (await io.ask(`${question} `)).trim().toLowerCase();
    if (["t", "tak", "y"].includes(answer)) return true;
    if (["n", "nie"].includes(answer)) return false;
    say(io, t(ui, "prompt.confirmInvalid"));
  }
}
