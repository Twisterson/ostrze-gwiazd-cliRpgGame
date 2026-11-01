import { showScreen, pushNotice } from "../ui/screen.js";
import { pushEventNotices } from "../ui/events.js";
import { campMenu } from "../ui/camp.js";
import { confirm } from "../ui/prompt.js";
import { askDestination } from "../ui/map_screen.js";
import { paint } from "../ui/colors.js";
import { t } from "../ui/strings.js";
import { createSceneList, runScenes } from "../engine/loop.js";
import { questById, activeQuests, expireQuests, abandonHub, abandonQuestsOf, hubProgress, tripQuests, boardQuests, startQuest, advanceErrands, currentObjectives } from "../systems/quests.js";
import { routeById, locationById, EVENT_END } from "../systems/travel.js";
import { visibleSpots, spotScenes, playedScenes, rollAmbush, rollVisitor, visitorOf, recordHunt, VISITOR_PREFIX } from "../systems/spots.js";
import { placeById } from "../systems/places.js";
import { runTrip, forgetScenes } from "./trip.js";
import { walk, startWalk } from "./walk.js";
import { MissingCharacterError } from "./errors.js";
import { evaluate } from "../engine/conditions.js";
import { dialogueOffersQuest } from "../systems/dialogue.js";

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

/** The way on from the hub: `doneLabel` once every mandatory thread of the hub is finished (so the player can tell the story goes on), else `label`. */
const mainLabel = (state, data, scene) => (scene.main.doneLabel && (state.world.map?.exitHeld || hubProgress(state, data, scene.hub)?.percent === 100) ? scene.main.doneLabel : scene.main.label);

/** Leaves the hub for the scene of its `exitWhen`. */
function leaveHub(state, scene) {
  state.world.map = null;
  state.world.travel = null; // a far trip left half-way must not be resumed by the next travel scene
  state.world.location = scene.hub; // the story goes on from the hub, wherever the part ended (a trip starts there)
  return { goto: scene.exitWhen.goto };
}

/** True when the player may leave for good: no open quest of the hub, or they confirm the warning that those are lost. */
async function confirmExit(ctx, scene) {
  const { state, data, io } = ctx;
  // Only a hub that asks for it warns (`exitWhen.warn`), and never when the story throws the player out (`exitWhen.forced`).
  if (!scene.exitWhen.warn || (scene.exitWhen.forced && evaluate(scene.exitWhen.forced, state, data))) return true;
  const open = activeQuests(state, data, scene.hub).filter((q) => !q.main).length;
  return open === 0 || confirm(io, data.ui, t(data.ui, "map.confirmExit", { n: open }));
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
    continueLabel: atHub ? t(ui, "map.main", { label: mainLabel(state, data, scene) }) : false,
    stayLabel: hasSpots ? t(ui, "map.stay", { name: place.short }) : null,
  });
  if (entry?.stay) {
    mapState(state).phase = "place";
    arrive(ctx);
    return null;
  }
  if (entry?.kind === "far") {
    const away = locationById(data, state.world.location)?.far;
    if (entry.viaHub && away) {
      // From one far place to another across the map: back to the hub, then straight on (`farNext` waits in the map state meanwhile).
      Object.assign(mapState(state), { phase: "far", far: { route: away.route, reverse: true }, farNext: { route: entry.route, reverse: false } });
      return null;
    }
    if (entry.viaHub) {
      // The trip starts at the hub: walk there first, the far trip follows (`far` waits in the map state meanwhile).
      startWalk(state, data, scene.hub);
      Object.assign(mapState(state), { phase: "walk", far: { route: entry.route, reverse: false } });
      return null;
    }
    Object.assign(mapState(state), { phase: "far", far: { route: entry.route, reverse: entry.reverse } });
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
  // Only a way on that really leaves the hub costs its open quests; "Prześpij noc" (thread unfinished) just closes the day and the story returns here.
  if (scene.exitWhen && mapState(state).exitHeld) { // the chapter is over and the player stayed on: this entry is the way out
    if (await confirmExit(ctx, scene)) return leaveHub(state, scene);
    return null;
  }
  const leaving = !scene.main.doneLabel || hubProgress(state, data, scene.hub)?.percent === 100;
  if (leaving) {
    if (tripQuests(state, data, scene.hub).length > 0 && !(await confirm(io, ui, t(ui, "map.confirmLeave")))) return null;
    pushEventNotices(ctx, abandonHub(state, data, scene.hub));
  }
  state.world.map = null;
  return { goto: scene.main.goto };
}

/** True when a job waits at the spot: a notice board with quests, or a talk whose first words can take one. */
function offersJob(state, data, spot) {
  if (spot.type === "board") return boardQuests(state, data, mapState(state).hub).length > 0;
  const dialogues = spot.type === "talk" ? [spot.ref] : (spot.scenes ?? []).filter((s) => s.type === "dialogue" && (!s.if || evaluate(s.if, state, data))).map((s) => s.dialogue);
  return dialogues.some((id) => dialogueOffersQuest(state, data, id));
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
  const offering = new Set(spots.filter(({ spot, available }) => available && offersJob(state, data, spot)).map(({ spot }) => spot.id));
  const before = spots.map(({ spot, available }) => ({
    id: spot.id, label: `${marked.has(`${location.id}.${spot.id}`) ? "! " : offering.has(spot.id) ? "* " : ""}${spot.name}`, disabled: !available, hint: available ? undefined : t(ui, spot.type === "hunt" ? "map.huntCooldown" : "map.spotLocked"),
  }));
  const visitor = mapState(state).visitor ?? null;
  const extra = visitor ? [{ id: `${VISITOR_PREFIX}${visitor}`, label: t(ui, "map.visitorLabel") }] : []; // after "Wróć na mapę", so the numbers of the places stay put
  const render = () => showScreen(ctx, { lines: [paint("title", location.name)], art: location.art });
  await render();
  const pick = await campMenu(ctx, render, { before, extra, continueLabel: t(ui, "map.backToMap"), title: t(ui, offering.size > 0 ? "map.placesJobs" : "map.places"), initial: 0 });
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
  const own = spotScenes(data, state.world.location, m.spot);
  // The ambush at the door is rolled once per entering and kept in `world.map.ambush`, so a resumed save plays the same list.
  if (m.ambush == null) {
    const here = m.spot.startsWith(VISITOR_PREFIX) ? null : placeById(data, `${state.world.location}.${m.spot}`)?.spot;
    m.ambush = here && m.spotScene === null ? rollAmbush(state, data, state.world.location, here, ctx.rng) : false;
  }
  const scenes = playedScenes(data, state.world.location, m.spot, m.ambush) ?? own;
  if (m.spotScene === null) forgetScenes(state, scenes);
  await runScenes(ctx, createSceneList(scenes), m.spotScene ?? scenes[0].id, { onScene: (id) => { mapState(state).spotScene = id; }, endId: EVENT_END, resume: m.spotScene !== null });
  const visit = mapState(state).spot.startsWith(VISITOR_PREFIX);
  const here = visit ? null : placeById(data, `${state.world.location}.${mapState(state).spot}`)?.spot;
  if (here?.type === "hunt") recordHunt(state, data, state.world.location, here);
  Object.assign(mapState(state), { phase: "place", spot: null, spotScene: null, ambush: null, ...(visit ? { visitor: null } : {}) });
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
  // A save made in the hub before its main thread existed: the thread starts now (never again once taken, failed or done).
  if (!created) for (const id of scene.starts ?? []) if (questById(data, id)?.main && !state.quests?.[id]) pushEventNotices(ctx, startQuest(state, data, id));
  state.world.map ??= {
    hub: scene.hub, phase: visibleSpots(state, data, state.world.location).length > 0 ? "place" : "choose", quest: null, questScene: null, spot: null, spotScene: null, walk: null, visitor: null, far: null,
  };
  if (created) arrive(ctx);
  for (;;) {
    // A story condition that ends the stay at once (e.g. the part is over): leave for its scene, whatever the menu was doing.
    // With open quests left the player is warned first; declining keeps them in the hub (`exitHeld`) and the way on becomes the menu's main entry.
    if (scene.exitWhen && !mapState(state).exitHeld && evaluate(scene.exitWhen.if, state, data)) {
      if (await confirmExit(ctx, scene)) return leaveHub(state, scene);
      mapState(state).exitHeld = true;
    }
    const m = mapState(state);
    if (m.phase === "choose") {
      const result = await choose(ctx, scene);
      if (result) return result;
    } else if (m.phase === "place") {
      await place(ctx);
    } else if (m.phase === "spot") {
      await spot(ctx);
    } else if (m.phase === "far") {
      // The trip to a far place of the hub (or back); `runTrip` resumes a trip saved on the road.
      await runTrip(ctx, { route: m.far.route, reverse: m.far.reverse });
      const next = mapState(state).farNext;
      if (next) {
        Object.assign(mapState(state), { far: next, farNext: null });
        continue;
      }
      Object.assign(mapState(state), { far: null, phase: visibleSpots(state, data, state.world.location).length > 0 ? "place" : "choose" });
      arrive(ctx);
    } else if (m.phase === "walk") {
      await walk(ctx, m.walk.to);
      if (m.far) { // the walk to the hub was the first half of a far trip
        mapState(state).phase = "far";
        continue;
      }
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
