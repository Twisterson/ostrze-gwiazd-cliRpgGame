/** Travel screens: departure, end of a day's march, camp header (pure line builders). */
import { paint } from "./colors.js";
import { t } from "./strings.js";
import { locationById, tripEnds } from "../systems/travel.js";
import { activePhenomenon, phenomenonById } from "../systems/phenomena.js";
import { mealsLeft } from "../systems/food.js";

/** `Brzezina ──●──○── Wilczy Bród`: one dot per day of the trip, filled up to the current day. */
function routeBar(state, data) {
  const travel = state.world.travel;
  const ends = tripEnds(data, travel.route, travel.reverse);
  const dots = Array.from({ length: travel.daysTotal }, (_, i) => `──${i < travel.day ? "●" : "○"}`).join("");
  return `${locationById(data, ends.from).short} ${dots}── ${locationById(data, ends.to).short}`;
}

/** Food line: count, yellow at one meal, red with a warning at none. */
function foodLine(state, data) {
  const n = mealsLeft(state, data);
  if (n === 0) return paint("warn", t(data.ui, "travel.noFood"));
  return paint(n === 1 ? "warn" : "dim", t(data.ui, "travel.food", { n }));
}

/** Departure screen body (below the status bar). */
export function renderDeparture(state, data) {
  const { ui } = data;
  const travel = state.world.travel;
  const ends = tripEnds(data, travel.route, travel.reverse);
  const lines = [
    paint("title", t(ui, "travel.title", { from: locationById(data, ends.from).name, to: locationById(data, ends.to).name })),
    routeBar(state, data),
    t(ui, "travel.day", { day: travel.day, days: travel.daysTotal }),
    foodLine(state, data),
  ];
  const p = activePhenomenon(state, data);
  if (p && p.world.travel !== "normal") lines.push(paint("mystic", t(ui, `travel.weather.${p.world.travel}`, { name: p.name })));
  return lines;
}

/** End of the day's march: a plain line, or the delay caused by `summary.by`. */
export function renderStageSummary(state, data, summary) {
  const { ui } = data;
  const text = summary.delayed
    ? paint("warn", t(ui, "travel.delayed", { name: phenomenonById(data, summary.by)?.name ?? summary.by }))
    : t(ui, "travel.stageDone");
  return [paint("title", t(ui, "travel.summaryTitle")), text];
}

/** Camp title with the day and the food left. */
export function renderCampHeader(state, data) {
  const travel = state.world.travel;
  return `${paint("title", t(data.ui, "travel.campTitle", { day: travel.day, days: travel.daysTotal }))} · ${foodLine(state, data)}`;
}
