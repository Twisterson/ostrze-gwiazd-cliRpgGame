import { showScreen, pushNotice } from "../ui/screen.js";
import { pushEventNotices } from "../ui/events.js";
import { campMenu } from "../ui/camp.js";
import { confirm } from "../ui/prompt.js";
import { askDestination } from "../ui/map_screen.js";
import { paint } from "../ui/colors.js";
import { t } from "../ui/strings.js";
import { createSceneList, runScenes } from "../engine/loop.js";
import { questById, expireQuests, abandonHub, abandonQuestsOf, tripQuests, boardQuests, startQuest, advanceErrands, currentObjectives } from "../systems/quests.js";
import { routeById, locationById, EVENT_END } from "../systems/travel.js";
import { visibleSpots, spotScenes, rollVisitor, visitorOf, VISITOR_PREFIX } from "../systems/spots.js";
import { runTrip, forgetScenes } from "./trip.js";
import { walk, startWalk } from "./walk.js";
import { MissingCharacterError } from "./errors.js";
import { evaluate } from "../engine/conditions.js";

// `world.map` is read afresh each time: an interrupted fight restores the whole state object.
const mapState = (state) => state.world.map;

/** Rolls who drops by the location just entered (once per entering: saved in `world.map.visitor`). */
function arrive(ctx) {
  const { state, data } = ctx;
  const visitor = rollVisitor(state, data, state.world.location, ctx.rng);
  Object.assign(mapState(state), { visitor });
  // A forced visitor (a check, a roundup) does not wait to be picked from the menu.
  if (visitor && visitorOf(data, state.world.location, visitor)?.forced) Object.assign(mapState(state), { phase: "spot", spot: `${VISITOR_PREFIX}${visitor}`, spotScene: null });
}

/** The screen of the map: choosing a destination, "stay here" (the place menu) or the story's way on (hub only). */
async function choose(ctx, scene) {
  const { state, data, io } = ctx;
  const { ui } = data;
  pushEventNotices(ctx, expireQuests(state, data));
  const atHub = state.world.location === scene.hub;
  const place = locationById(data, state.world.location);
  const hasSpots = visibleSpots(state, data, place.id).length > 0;
  const entry = await askDestination(ctx, scene.hub, {
    continueLabel: atHub ? t(ui, "map.main", { label: scene.main.label }) : false,
    stayLabel: hasSpots ? t(ui, "map.stay", { name: place.short }) : null,
  });
  if (entry?.stay) {
    mapState(state).phase = "place";
    arrive(ctx);
    return null;
  }
  if (entry?.kind === "quest") {
    state.quests[entry.quest.id].departed = true;
    Object.assign(mapState(state), { phase: "outbound", quest: entry.quest.id, questScene: null });
    return null;
  }
  if (entry) {
    startWalk(state, data, entry.id);
    mapState(state).phase = "walk";
    return null;
  }
  if (tripQuests(state, data, scene.hub).length > 0 && !(await confirm(io, ui, t(ui, "map.confirmLeave")))) return null;
  pushEventNotices(ctx, abandonHub(state, data, scene.hub));
  state.world.map = null;
  return { goto: scene.main.goto };
}

/** Menu of the spots of the location the player stands in; "Wróć na mapę" goes to the destinations. */
async function place(ctx) {
  const { state, data } = ctx;
  const { ui } = data;
  const location = locationById(data, state.world.location);
  const spots = visibleSpots(state, data, location.id);
  if (spots.length === 0) {
    mapState(state).phase = "choose";
    return;
  }
  const marked = new Set(currentObjectives(state, data).map((c) => c.objective.at));
  const before = spots.map(({ spot, available }) => ({
    id: spot.id, label: `${marked.has(`${location.id}.${spot.id}`) ? "! " : ""}${spot.name}`, disabled: !available, hint: available ? undefined : t(ui, "map.spotLocked"),
  }));
  const visitor = mapState(state).visitor ?? null;
  const extra = visitor ? [{ id: `${VISITOR_PREFIX}${visitor}`, label: t(ui, "map.visitorLabel") }] : []; // after "Wróć na mapę", so the numbers of the places stay put
  const render = () => showScreen(ctx, { lines: [paint("title", location.name)], art: location.art });
  await render();
  const pick = await campMenu(ctx, render, { before, extra, continueLabel: t(ui, "map.backToMap"), title: t(ui, "map.places"), initial: 0 });
  if (pick === undefined) {
    mapState(state).phase = "choose";
    return;
  }
  if (pick.startsWith(VISITOR_PREFIX)) {
    Object.assign(mapState(state), { phase: "spot", spot: pick, spotScene: null });
    return;
  }
  const { spot } = spots.find((s) => s.spot.id === pick);
  if (spot.type === "board") await board(ctx, spot);
  else Object.assign(mapState(state), { phase: "spot", spot: pick, spotScene: null });
}

/** The notice board: quests of this hub that can be taken now; picking one takes it on. */
async function board(ctx, spot) {
  const { state, data } = ctx;
  const { ui } = data;
  const render = () => showScreen(ctx, { lines: [paint("title", spot.name)], art: spot.art });
  for (;;) {
    const quests = boardQuests(state, data, state.world.location);
    await render();
    if (quests.length === 0) pushNotice(ctx, paint("dim", t(ui, "map.boardEmpty")));
    const before = quests.map((q) => ({ id: q.id, label: q.name, description: q.description }));
    const pick = await campMenu(ctx, render, { before, continueLabel: t(ui, "map.boardBack"), title: t(ui, "map.boardTitle"), initial: 0 });
    if (pick === undefined) return;
    pushEventNotices(ctx, [...startQuest(state, data, pick), ...advanceErrands(state, data, ctx.rng)]);
  }
}

/** One visit at a spot: the spot's scenes run through the scene loop (so the after-scene hooks work); a talk can be had again. */
async function spot(ctx) {
  const { state, data } = ctx;
  const m = mapState(state);
  const scenes = spotScenes(data, state.world.location, m.spot);
  if (m.spotScene === null) forgetScenes(state, scenes);
  await runScenes(ctx, createSceneList(scenes), m.spotScene ?? scenes[0].id, { onScene: (id) => { mapState(state).spotScene = id; }, endId: EVENT_END, resume: m.spotScene !== null });
  const visit = mapState(state).spot.startsWith(VISITOR_PREFIX);
  Object.assign(mapState(state), { phase: "place", spot: null, spotScene: null, ...(visit ? { visitor: null } : {}) });
}

/** The way there runs from the hub; whichever end of the route that is decides the direction. */
const awayFromHub = (data, quest, hub) => routeById(data, quest.route).from !== hub;

/**
 * `map` scene: the region around a hub. The player stands in a location and either looks around its spots (`place`, `spot`),
 * walks to a near location in minutes (`walk`), sets out on a quest of the hub (`outbound` → `onsite` → `return`: the way there
 * with `runTrip`, the quest's scenes, the way back) or takes the story's way on (hub only). Everything is kept in `world.map`
 * (and `world.travel` on the road), so a save made anywhere resumes in the right phase.
 */
export async function map(ctx, scene) {
  const { state, data } = ctx;
  if (!state.character) throw new MissingCharacterError();
  const created = !state.world.map;
  if (created && scene.arriveAt) state.world.location = scene.arriveAt; // a story hub the player is brought to
  if (created && scene.leaves) pushEventNotices(ctx, abandonQuestsOf(state, data, scene.leaves)); // the hub left behind: its open quests are lost
  // The new hub's opening quests start only now, when the old ones no longer take up room.
  if (created && scene.starts) pushEventNotices(ctx, [...scene.starts.flatMap((id) => startQuest(state, data, id)), ...advanceErrands(state, data, ctx.rng)]);
  state.world.map ??= {
    hub: scene.hub, phase: visibleSpots(state, data, state.world.location).length > 0 ? "place" : "choose", quest: null, questScene: null, spot: null, spotScene: null, walk: null, visitor: null,
  };
  if (created) arrive(ctx);
  for (;;) {
    // A story condition that ends the stay at once (e.g. the part is over): leave for its scene, whatever the menu was doing.
    if (scene.exitWhen && evaluate(scene.exitWhen.if, state, data)) {
      state.world.map = null;
      return { goto: scene.exitWhen.goto };
    }
    const m = mapState(state);
    if (m.phase === "choose") {
      const result = await choose(ctx, scene);
      if (result) return result;
    } else if (m.phase === "place") {
      await place(ctx);
    } else if (m.phase === "spot") {
      await spot(ctx);
    } else if (m.phase === "walk") {
      await walk(ctx, m.walk.to);
      mapState(state).phase = "place";
      arrive(ctx);
    } else {
      await questTrip(ctx, scene);
    }
  }
}

/** The phases of a quest outing: there (`outbound`), on site (`onsite`), back (`return`). */
async function questTrip(ctx, scene) {
  const { state, data } = ctx;
  const m = mapState(state);
  const quest = questById(data, m.quest);
  const reverse = awayFromHub(data, quest, scene.hub);
  if (m.phase === "outbound") {
    await runTrip(ctx, { route: quest.route, reverse, quest: quest.id });
    // At the quest's place, or back at the hub after an escort was lost on the way.
    Object.assign(mapState(state), state.world.location === quest.location ? { phase: "onsite" } : { phase: "choose", quest: null });
  } else if (m.phase === "onsite") {
    if (m.questScene === null) forgetScenes(state, quest.scenes);
    const start = m.questScene ?? quest.scenes[0].id;
    await runScenes(ctx, createSceneList(quest.scenes), start, { onScene: (id) => { mapState(state).questScene = id; }, endId: EVENT_END });
    Object.assign(mapState(state), { phase: "return", questScene: null });
  } else {
    await runTrip(ctx, { route: quest.route, reverse: !reverse, quest: quest.id });
    Object.assign(mapState(state), { phase: "place", quest: null });
    arrive(ctx);
  }
}
