/** Quest journal: active quests with their place, deadline and description, then the last finished ones. */
import { searchLine } from "./map_screen.js";
import { showScreen } from "./screen.js";
import { pressEnter } from "./prompt.js";
import { paint } from "./colors.js";
import { t } from "./strings.js";
import { wrap } from "./text.js";
import { deadlineText } from "./map_screen.js";
import { activeQuests, questById, errandProgress, reportedQuest } from "../systems/quests.js";
import { placeLabel } from "../systems/places.js";
import { locationById } from "../systems/travel.js";

const FINISHED_SHOWN = 5;
const WIDTH = 74; // description lines (wrapped to WIDTH − 2 and indented by 2) stay within a frame's 76 columns

/** The journal's lines (no status bar). */
export function renderJournal(state, data) {
  const { ui } = data;
  const lines = [paint("title", t(ui, "journal.title"))];
  const hunted = searchLine(state, data);
  if (hunted) lines.push(hunted);
  const active = activeQuests(state, data);
  if (active.length === 0) lines.push(paint("dim", t(ui, "journal.none")));
  for (const quest of active) {
    if (quest.kind === "errand") {
      lines.push(t(ui, "journal.entryErrand", { name: quest.name }));
      for (const line of wrap(quest.description, WIDTH - 2).split("\n")) lines.push(paint("dim", `  ${line}`));
      const { objectives, current } = errandProgress(state, data, quest);
      for (const o of objectives) {
        if (o.done) lines.push(paint("heal", `  ${t(ui, "journal.objectiveDone", { text: o.text })}`));
        else if (o.id === current.id) lines.push(`  ${t(ui, "journal.objectiveCurrent", { text: o.text, place: placeLabel(data, o.at) })}`);
        else lines.push(paint("dim", `  ${t(ui, "journal.objectivePending", { text: o.text })}`));
      }
      continue;
    }
    if (reportedQuest(state, quest.id)) {
      lines.push(t(ui, "journal.entryReported", { name: quest.name, who: quest.reportTo }));
      continue;
    }
    const { deadline, departed } = state.quests[quest.id];
    const left = deadline === null || departed ? null : Math.ceil((deadline - state.time.minutes) / (24 * 60));
    const when = left === null ? t(ui, "journal.noDeadline")
      : left <= 0 ? t(ui, "journal.overdue")
      : t(ui, "map.deadline", { left: deadlineText(ui, left) });
    lines.push(t(ui, "journal.entry", { name: quest.name, place: locationById(data, quest.location).name, when }));
    for (const line of wrap(quest.description, WIDTH - 2).split("\n")) lines.push(paint("dim", `  ${line}`));
  }
  const finished = Object.entries(state.quests ?? {}).filter(([, e]) => e.status !== "active").slice(-FINISHED_SHOWN);
  if (finished.length > 0) {
    lines.push("", paint("title", t(ui, "journal.finished")));
    for (const [id, e] of finished) {
      lines.push(paint(e.status === "done" ? "heal" : "dim", `${e.status === "done" ? "✓" : "✗"} ${questById(data, id)?.name ?? id}`));
    }
  }
  return lines;
}

/** Shows the journal until Enter. */
export async function showJournal(ctx) {
  const { state, data, io } = ctx;
  await showScreen(ctx, { lines: renderJournal(state, data), });
  await pressEnter(io, data.ui);
}
