import { showScreen, clear, statusBar, flushNotices, pushNotice } from "../ui/screen.js";
import { pushEventNotices } from "../ui/events.js";
import { campMenu } from "../ui/camp.js";
import { renderDeparture, renderStageSummary, renderCampHeader } from "../ui/travel_screen.js";
import { paint } from "../ui/colors.js";
import { t } from "../ui/strings.js";
import { advanceTime, clockOf } from "../engine/time.js";
import { createSceneList, runScenes } from "../engine/loop.js";
import {
  startTravel, stageArtId, rollStageEvent, marchHour, finishStage, nextDay, endTravel, forage, markEventSeen, eventById, locationById, turnBack, EVENT_END,
} from "../systems/travel.js";
import { questById } from "../systems/quests.js";
import { eatMeal } from "../systems/food.js";
import { forcePhenomenon, activePhenomenon } from "../systems/phenomena.js";
import { unchargedArtifacts } from "../systems/artifacts.js";
import { itemById } from "../systems/items.js";
import { save_point } from "./save_point.js";
import { rest } from "./rest.js";
import { MissingCharacterError } from "./errors.js";

// `world.travel` is read afresh each time: an interrupted fight restores the whole state object.
const trip = (state) => state.world.travel;

const screen = (ctx, body, stage) => showScreen(ctx, { lines: body(), art: stageArtId(ctx.state, ctx.data, stage) });

/** Moves the clock to the next `departHour:00` (today when not past it yet). */
function waitForDawn(ctx) {
  const { state, data } = ctx;
  const { hour, minute } = clockOf(state.time.minutes);
  const target = data.rules.travel.departHour * 60;
  const now = hour * 60 + minute;
  const wait = now <= target ? target - now : 24 * 60 - now + target;
  if (wait > 0) pushEventNotices(ctx, advanceTime(state, wait, data, ctx.rng));
}

/** Whole hours the sleep can take before the next departure (a later sleep would cost a day): `rest.maxHours` at most, `rest.minHours` at least. */
function hoursToDawn(state, data) {
  const { hour, minute } = clockOf(state.time.minutes);
  const left = (data.rules.travel.departHour * 60 - (hour * 60 + minute) + 24 * 60) % (24 * 60);
  const { minHours, maxHours } = data.rules.rest;
  return Math.max(minHours, Math.min(maxHours, Math.floor(left / 60)));
}

/** Departure: dawn, auto save, the travel screen (none after a quiet night, unless the weather has a warning); "Ruszaj" rolls the stage's event and starts the march. */
async function depart(ctx) {
  const { state, data } = ctx;
  const quietMorning = trip(state).quietMorning === true;
  delete trip(state).quietMorning;
  waitForDawn(ctx);
  await save_point(ctx);
  const weather = activePhenomenon(state, data)?.world.travel;
  if (!quietMorning || (weather && weather !== "normal")) {
    const render = () => screen(ctx, () => renderDeparture(state, data), "depart");
    await render();
    await campMenu(ctx, render, { continueLabel: t(data.ui, "travel.depart") });
  }
  const rolled = rollStageEvent(state, data, ctx.rng);
  Object.assign(trip(state), { event: rolled?.id ?? null, eventHour: rolled?.hour ?? null, phase: "march" });
}

/** Clears what a scene remembers having done, so a repeatable event plays its fights, talks and rewards again. */
export function forgetScenes(state, scenes) {
  const ids = new Set(scenes.map((s) => s.id));
  const w = state.world;
  for (const id of ids) {
    delete w.finishedCombats[id];
    delete w.dialogueProgress[id];
  }
  w.claimedRewards = w.claimedRewards.filter((id) => !ids.has(id));
  w.finishedDialogues = w.finishedDialogues.filter((id) => !ids.has(id));
}

/** Plays the stage's event: a weather event starts its phenomenon, the others run their scenes (resuming at `eventScene`). */
async function playEvent(ctx) {
  const { state, data } = ctx;
  const event = eventById(data, trip(state).event);
  Object.assign(trip(state), { phase: "event", eventful: true });
  if (event.phenomenon) {
    pushEventNotices(ctx, forcePhenomenon(state, data, event.phenomenon, ctx.rng, state.time.minutes));
  } else {
    if (trip(state).eventScene === null) { forgetScenes(state, event.scenes); delete state.world.heavyLoot; }
    const start = trip(state).eventScene ?? event.scenes[0].id;
    await runScenes(ctx, createSceneList(event.scenes), start, { onScene: (id) => { trip(state).eventScene = id; }, endId: EVENT_END });
  }
  markEventSeen(state, data, event.id);
  Object.assign(trip(state), { event: null, eventScene: null, phase: "march" });
}

/** An escort lost on the way there (its quest no longer active): the rest of the march already leads back. */
function checkTurnBack(ctx) {
  const { state, data } = ctx;
  const t0 = trip(state);
  if (!t0.quest || t0.reverse || state.quests?.[t0.quest]?.status === "active") return;
  turnBack(state);
  pushNotice(ctx, paint("warn", t(data.ui, "travel.turnBack", { client: questById(data, t0.quest).clientGen })));
}

/** The march: hour by hour, the event at its hour; then the stage summary and the camp. */
async function march(ctx) {
  const { state, data } = ctx;
  const { marchHours } = data.rules.travel;
  for (;;) {
    const t0 = trip(state);
    if (t0.event !== null && t0.hoursWalked >= t0.eventHour) {
      const endsTrip = eventById(data, t0.event).endsTrip === true;
      await playEvent(ctx);
      if (endsTrip) {
        // No summary, no camp: the trip is over (runTrip brings the clock to dawn and the character to the destination).
        trip(state).day = trip(state).daysTotal + 1;
        return;
      }
      checkTurnBack(ctx);
      continue;
    }
    if (t0.hoursWalked >= marchHours) break;
    pushEventNotices(ctx, marchHour(state, data, ctx.rng));
  }
  finishStage(state, data);
  trip(state).phase = "camp"; // the evening screen says it all
}

/**
 * Camp, one screen: how the day went and "go on" as the main choice, foraging (once an evening) beside it; then the meal and a sleep
 * that takes all the time left until dawn, and the next day starts by itself. Only a worn artifact to charge brings the rest's
 * questions back, since exposing it is a real decision.
 */
async function camp(ctx) {
  const { state, data } = ctx;
  const { ui } = data;
  let plain = false;
  if (trip(state).phase === "camp") {
    for (;;) {
      plain = unchargedArtifacts(state, data).length === 0; // foraging can change the charge
      const t0 = trip(state);
      const day = t0.delayed
        ? renderStageSummary(state, data, { delayed: true, by: t0.slowBy }).slice(1)
        : [t(ui, t0.eventful ? "travel.camp" : "travel.quietCamp")];
      const render = () => screen(ctx, () => [renderCampHeader(state, data), ...day], "camp");
      await render();
      const extra = t0.foraged ? [] : [{ id: "forage", label: t(ui, "camp.forage") }];
      const pick = await campMenu(ctx, render, { continueLabel: t(ui, plain ? "travel.goOn" : "camp.pitch"), extra });
      if (pick !== "forage") break;
      trip(state).foraged = true;
      const { found, events } = forage(state, data, ctx.rng);
      pushEventNotices(ctx, events);
      pushNotice(ctx, found
        ? paint("heal", t(ui, "travel.forageFound", { item: itemById(data, found.id).name, qty: found.qty }))
        : paint("dim", t(ui, "travel.forageNone")));
    }
    trip(state).phase = "sleep";
    pushEventNotices(ctx, eatMeal(state, data, ctx.rng));
  }
  await rest(ctx, {}, {
    ...(plain ? { quickHours: hoursToDawn(state, data) } : {}),
    afterSleep: () => {
      nextDay(state);
      trip(state).quietMorning = true;
    },
  });
}

/**
 * A trip along `route` (from its end back to its start with `reverse`), stage by stage (departure → march with at most one
 * event → camp), all of it kept in `world.travel`, so a save made anywhere resumes in the right phase; an existing
 * `world.travel` is resumed as it is. With `quest` the road rolls that quest's events; an escort lost on the way there
 * turns the trip back. Ends with the arrival (`world.location` = the end reached).
 */
export async function runTrip(ctx, { route, reverse = false, quest = null }) {
  const { state, data } = ctx;
  if (!state.character) throw new MissingCharacterError();
  if (!trip(state)) startTravel(state, data, route, { reverse, quest });
  while (trip(state).day <= trip(state).daysTotal) {
    const { phase } = trip(state);
    if (phase === "depart") await depart(ctx);
    else if (phase === "march" || phase === "event") await march(ctx);
    else await camp(ctx);
  }
  waitForDawn(ctx); // the last stretch is walked at first light, as every stage starts
  endTravel(state, data);
  pushNotice(ctx, paint("title", t(data.ui, "travel.arrival", { name: locationById(data, state.world.location).name })));
}
