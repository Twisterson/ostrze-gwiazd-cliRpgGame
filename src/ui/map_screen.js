/** Map screen pieces: the title and one destination row. */
import { paint } from "./colors.js";
import { t } from "./strings.js";
import { showScreen, sceneCapacity, displayWidth } from "./screen.js";
import { campMenu } from "./camp.js";
import { sceneWidth } from "./frame.js";
import { locationById, routeById, walkMinutes } from "../systems/travel.js";
import { isKnown } from "../systems/places.js";
import { searchLevel } from "../systems/search.js";
import { mapOptions, currentObjectives } from "../systems/quests.js";

/** "1 dzień" / "2 dni"; the plural form comes from the template. */
export const daysText = (ui, n) => t(ui, "map.days", { n });

/** "został 1 dzień" / "zostały 3 dni" / "zostało 5 dni"; the template picks the forms. */
export const deadlineText = (ui, n) => t(ui, "map.deadlineDays", { n });

/** "{hub} – dokąd?" */
export function renderMapTitle(data, hub) {
  return paint("title", t(data.ui, "map.title", { hub: locationById(data, hub).short }));
}

/** "Wilcza Nora · zadanie „Wilcza Nora” · 1 dzień[ · termin: zostały 2 dni]" for a `mapOptions` entry. */
export function destinationLabel(data, option) {
  const { ui } = data;
  const parts = [option.location.name, t(ui, `map.kind.${option.quest.kind}`, { name: option.quest.name }), daysText(ui, option.days)];
  if (option.deadlineLeft !== null) parts.push(t(ui, "map.deadline", { left: deadlineText(ui, option.deadlineLeft) }));
  return parts.join(" · ");
}

// --- the map of the region and its destinations ---

/** The region map needs this much room in the scene panel; below it the panel describes the selected place instead. */
export const MAP_MIN_COLS = 60;
export const MAP_MIN_ROWS = 14;

/** "Bezpiecznie" … "Wysokie" for a danger level 1–4. */
export const dangerText = (ui, n) => t(ui, `map.danger.${n ?? 1}`);

/** "~25 min", "~1 h", "~1 h 30 min". */
export function minutesText(ui, minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t(ui, "map.minutes", { m });
  return m === 0 ? t(ui, "map.hours", { h }) : t(ui, "map.hoursMinutes", { h, m });
}

const locationOf = (at) => at.split(".")[0];

/** Ids of the locations where an active errand has its current objective. */
const markedLocations = (state, data) => new Set(currentObjectives(state, data).map((c) => locationOf(c.objective.at)));

/**
 * Where the player can go from where they stand: known near locations (and the hub, when away) with the walk time and the
 * danger, and – only at the hub – the destinations of the active trip quests. `marked`: an errand has its current objective there.
 */
export function destinationEntries(state, data, hub) {
  const { ui } = data;
  const here = state.world.location;
  const marked = markedLocations(state, data);
  const entries = [];
  const region = locationById(data, hub)?.region;
  const away = locationById(data, here)?.far; // standing in a far place: back to the hub or on to another far place
  for (const location of data.travel.locations) {
    if (away || location.region !== region || location.id === here || location.temporary || !(location.near || location.id === hub) || !isKnown(state, data, location.id)) continue;
    const minutes = walkMinutes(data, here, location.id);
    const objectives = currentObjectives(state, data).filter((c) => locationOf(c.objective.at) === location.id).map((c) => c.objective.text);
    entries.push({
      id: location.id, kind: "near", location, minutes, danger: location.danger ?? 1, quest: null, marked: marked.has(location.id),
      label: [location.name, minutesText(ui, minutes), dangerText(ui, location.danger)].join(" · "),
      lines: [location.name, `${minutesText(ui, minutes)} · ${dangerText(ui, location.danger)}`, ...objectives.map((o) => `→ ${o}`)],
    });
  }
  const farEntry = (location, route, reverse) => {
    const days = routeById(data, route).days;
    const label = reverse ? t(ui, "map.backTo", { name: location.name }) : location.name;
    const danger = dangerText(ui, location.danger);
    return {
      id: location.id, kind: "far", location, route, reverse, days, danger: location.danger ?? 1, quest: null, marked: marked.has(location.id),
      label: [label, daysText(ui, days), danger].join(" · "),
      lines: [location.name, `${daysText(ui, days)} · ${danger}`],
    };
  };
  if (away) {
    entries.push(farEntry(locationById(data, hub), away.route, true));
    // To another far place of the hub: straight there when a shortcut joins them, otherwise (the other side of the map) through the hub.
    const hubName = locationById(data, hub).short ?? locationById(data, hub).name;
    for (const location of data.travel.locations) {
      if (!location.far || location.id === here || location.region !== region || !isKnown(state, data, location.id)) continue;
      const shortcut = data.travel.routes.find((r) => (r.from === here && r.to === location.id) || (r.to === here && r.from === location.id));
      if (shortcut) {
        entries.push(farEntry(location, shortcut.id, shortcut.to === here));
        continue;
      }
      const entry = farEntry(location, location.far.route, false);
      const days = entry.days + routeById(data, away.route).days;
      const danger = dangerText(ui, location.danger);
      entries.push({
        ...entry, days, viaHub: true, label: [location.name, daysText(ui, days), danger].join(" · "),
        lines: [location.name, `${daysText(ui, days)} · ${danger}`, t(ui, "map.viaHub", { hub: hubName })],
      });
    }
  } else if (here !== hub) {
    // From an ordinary place of the hub the far trails are open too: the way leads through the hub first.
    for (const location of data.travel.locations) {
      if (!location.far || location.region !== region || !isKnown(state, data, location.id)) continue;
      const entry = farEntry(location, location.far.route, false);
      entries.push({ ...entry, viaHub: true, lines: [...entry.lines, t(ui, "map.viaHub", { hub: locationById(data, hub).short ?? locationById(data, hub).name })] });
    }
  }
  if (here === hub) {
    for (const location of data.travel.locations) {
      if (location.far && location.region === region && isKnown(state, data, location.id)) entries.push(farEntry(location, location.far.route, false));
    }
    for (const option of mapOptions(state, data, hub)) {
      entries.push({
        id: option.location.id, kind: "quest", location: option.location, days: option.days, danger: 3, quest: option.quest, marked: true,
        label: destinationLabel(data, option),
        lines: [option.location.name, t(ui, `map.kind.${option.quest.kind}`, { name: option.quest.name }), option.quest.description],
      });
    }
  }
  return entries.map((e) => ({ ...e, description: e.lines.slice(1).join(" ") }));
}

/** "??? · hint" for every location the player has only heard of. */
export function undiscoveredLines(state, data, hub) {
  const region = locationById(data, hub)?.region;
  return data.travel.locations
    .filter((l) => l.region === region && l.secret && !isKnown(state, data, l.id) && (state.world.hinted ?? []).includes(l.id))
    .map((l) => paint("dim", t(data.ui, "map.unknown", { hint: l.hint ?? t(data.ui, "map.unknownHint") })));
}

/**
 * The region map as lines (`{id}` tokens of data/maps/<region>.txt replaced: "@ Name" where the player stands, "[n] Name" for a
 * destination (n is its row in the list, "!" after it when an errand waits there), "[?]" for a place only heard of, blanks for the
 * rest) plus a legend; null when the panel is too small or the region has no map.
 */
export function renderRegionMap(state, data, { hub, width, height }) {
  if (width < MAP_MIN_COLS || height < MAP_MIN_ROWS) return null;
  const here = state.world.location;
  const text = data.maps?.[locationById(data, here)?.region];
  if (!text) return null;
  const entries = destinationEntries(state, data, hub);
  const marked = markedLocations(state, data);
  const hinted = state.world.hinted ?? [];
  const label = (token, id) => {
    const location = locationById(data, id);
    if (!location) return " ".repeat(token.length);
    if (id === here) return `@ ${location.short}`;
    const n = entries.findIndex((e) => e.id === id);
    if (n >= 0) return `[${n + 1}]${marked.has(id) || entries[n].marked ? "!" : ""} ${location.short}`;
    return hinted.includes(id) && !isKnown(state, data, id) ? "[?]" : " ".repeat(token.length);
  };
  const lines = text.replace(/\s+$/, "").split("\n").map((l) => l.replace(/\{([a-z0-9_]+)\}/g, label).trimEnd());
  lines.push("", t(data.ui, "map.legend"));
  return lines.length <= height && lines.every((l) => displayWidth(l) <= width) ? lines : null;
}

/** "Poszukiwania: czujność" (painted) from the first threshold up; null while the scouts have no trail. */
export function searchLine(state, data) {
  if (!locationById(data, state.world.location)?.tracksSearch) return null; // shown only where the scouts' attention changes something
  const level = searchLevel(state, data);
  if (level === "spokoj") return null;
  return paint(level === "oblawa" || level === "poscig" ? "warn" : "dim", t(data.ui, "search.line", { level: t(data.ui, `search.level.${level}`) }));
}

/**
 * The destination screen: "Dokąd iść?" with the known places (time and danger), the way on ("Dalej", `continueLabel`; `false`
 * – none) and "Nieodkryte"; the scene panel shows the region map, or – in a small window – the selected place.
 * @returns {Promise<object | undefined>} the chosen `destinationEntries` entry, `{ stay: true }` for `stayLabel`, undefined for the way on
 */
export async function askDestination(ctx, hub, { continueLabel, stayLabel = null }) {
  const { state, data, io } = ctx;
  const { ui } = data;
  const entries = destinationEntries(state, data, hub);
  const before = entries.map((e) => ({ id: e.id, label: `${e.marked ? "! " : ""}${e.label}`, description: e.description || undefined }));
  const unknown = undiscoveredLines(state, data, hub);
  const hidden = unknown.length === 0 ? [] : [t(ui, "map.undiscovered"), ...unknown].map((label, i) => ({ id: `?${i}`, label, disabled: true }));
  const extra = [...(stayLabel ? [{ id: "stay", label: stayLabel }] : []), ...hidden];
  const here = paint("title", t(ui, "map.here", { name: locationById(data, state.world.location).name }));
  const render = () => showScreen(ctx, { lines: [here, ...(searchLine(state, data) ? [searchLine(state, data)] : [])] });
  const preview = (cursor) => {
    const map = renderRegionMap(state, data, { hub, width: sceneWidth(io.columns), height: sceneCapacity(io) });
    if (map) return map;
    const entry = entries[cursor];
    return [here, "", ...(entry ? entry.lines : [])];
  };
  await render();
  const pick = await campMenu(ctx, render, { before, extra, continueLabel, title: t(ui, "map.choose"), preview });
  return pick === "stay" ? { stay: true } : entries.find((e) => e.id === pick);
}
