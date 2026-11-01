/** Quest journal: active quests with their place, deadline and description, then the last finished ones. */
import { searchLine } from "./map_screen.js";
import { showScreen } from "./screen.js";
import { pressEnter } from "./prompt.js";
import { paint } from "./colors.js";
import { t } from "./strings.js";
import { wrap } from "./text.js";
import { deadlineText } from "./map_screen.js";
import { activeQuests, questById, errandProgress, reportedQuest, hubProgress, mainQuestsOf, sideProgress } from "../systems/quests.js";
import { placeLabel } from "../systems/places.js";
import { locationById } from "../systems/travel.js";

const FINISHED_SHOWN = 5;
const WIDTH = 74; // description lines (wrapped to WIDTH − 2 and indented by 2) stay within a frame's 76 columns

const BAR_CELLS = 10;

/** The hub the journal reports on: where the hero stands, else the hub of an active main thread. */
function progressHub(state, data) {
  const here = state.world?.map?.hub ?? null;
  if (here) return here;
  return activeQuests(state, data).find((q) => q.kind === "errand" && q.main === true)?.hub ?? null;
}

/** "Postęp w <hub>: N% ████░░░░░░" once the hub's main thread has been taken up, else null. */
function progressLine(state, data) {
  const hub = progressHub(state, data);
  if (!hub || !mainQuestsOf(data, hub).some((q) => state.quests?.[q.id])) return null;
  const progress = hubProgress(state, data, hub);
  if (!progress) return null;
  const filled = Math.round((progress.percent / 100) * BAR_CELLS);
  const bar = "█".repeat(filled) + "░".repeat(BAR_CELLS - filled);
  return paint("title", t(data.ui, "journal.progress", { place: locationById(data, hub).name, percent: progress.percent, bar }));
}

/** "Zlecenia poboczne: zostało 3 z 10 ███████░░░", or "wszystkie załatwione" when nothing is left in the hub; null when it has none. */
function sideLine(state, data) {
  const hub = progressHub(state, data);
  const side = hub ? sideProgress(state, data, hub) : null;
  if (!side) return null;
  if (side.left === 0) return paint("heal", t(data.ui, "journal.sideDone", { total: side.total }));
  const filled = Math.round((side.closed / side.total) * BAR_CELLS);
  return paint("title", t(data.ui, "journal.side", { left: side.left, total: side.total, bar: "█".repeat(filled) + "░".repeat(BAR_CELLS - filled) }));
}

/** The journal's lines (no status bar). */
export function renderJournal(state, data) {
  const { ui } = data;
  const lines = [paint("title", t(ui, "journal.title"))];
  const progress = progressLine(state, data);
  if (progress) lines.push(progress);
  const side = sideLine(state, data);
  if (side) lines.push(side);
  const hunted = searchLine(state, data);
  if (hunted) lines.push(hunted);
  const active = activeQuests(state, data);
  if (active.length === 0) lines.push(paint("dim", t(ui, "journal.none")));
  for (const quest of active) {
    if (quest.kind === "errand") {
      lines.push(t(ui, "journal.entryErrand", { name: quest.name }));
      for (const line of wrap(quest.description, WIDTH - 2).split("\n")) lines.push(paint("dim", `  ${line}`));
      const { objectives, current } = errandProgress(state, data, quest);
      const objectiveLines = (text, paintAs) => wrap(text, WIDTH - 4).split("\n").map((line, i) => (paintAs ? paint(paintAs, `${i === 0 ? "  " : "    "}${line}`) : `${i === 0 ? "  " : "    "}${line}`));
      for (const o of objectives) {
        if (o.done) lines.push(...objectiveLines(t(ui, "journal.objectiveDone", { text: o.text }), "heal"));
        else if (o.id === current.id) lines.push(...objectiveLines(t(ui, "journal.objectiveCurrent", { text: o.text, place: placeLabel(data, o.at) })));
        else lines.push(...objectiveLines(t(ui, "journal.objectivePending", { text: o.text }), "dim"));
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
