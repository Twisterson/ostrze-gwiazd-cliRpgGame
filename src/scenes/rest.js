import { showScreen, clear, statusBar, flushNotices, pushNotice } from "../ui/screen.js";
import { pushEventNotices } from "../ui/events.js";
import { sliders, select } from "../ui/menu.js";
import { campMenu } from "../ui/camp.js";
import { paint } from "../ui/colors.js";
import { t } from "../ui/strings.js";
import { advanceTime } from "../engine/time.js";
import { clearBySleep, restHealMultiplier } from "../systems/effects.js";
import { getStats } from "../systems/stats.js";
import { unchargedArtifacts, setExposed, exposureRisk } from "../systems/artifacts.js";
import { MissingCharacterError } from "./errors.js";

/**
 * Rest: with a worn artifact that is not fully charged the player may first expose it (unless the scene sets `allowExposure: false`); then picks
 * hours; each hour advances the clock and heals. While exposed, every slept hour may bring a thief, who ends the sleep.
 * `afterSleep` runs once the sleep is over (the travel camp moves to the next day there). `quickHours`: no questions and no summary,
 * that long a sleep (a traveller's camp); what it heals and whatever happens in it go to the notices.
 */
export async function rest(ctx, scene = {}, { afterSleep, quickHours } = {}) {
  const { state, data, io } = ctx;
  const { ui, rules } = data;
  if (!state.character) throw new MissingCharacterError();
  const { minHours, maxHours, healBase, healKrzepaDiv } = rules.rest;

  const header = (lines = []) => showScreen(ctx, { lines, art: scene.art });

  let exposed = false;
  const quick = quickHours !== undefined;
  if (!quick && scene.allowExposure !== false && unchargedArtifacts(state, data).length > 0) {
    // The question is long: in a frame it belongs to the scene panel (wrapped), not to the one-line choice title.
    await header([paint("title", t(ui, "rest.expose"))]);
    const pick = await select(io, ui, { items: [{ label: t(ui, "rest.exposeYes") }, { label: t(ui, "rest.exposeNo") }] });
    exposed = pick === 0;
    if (exposed) setExposed(state, data, true);
  }

  let hours = quickHours;
  if (!quick) {
    await header();
    [hours] = await sliders(io, ui, { rows: [{ label: t(ui, "rest.hours"), value: minHours, min: minHours, max: maxHours }] });
  }

  let healed = 0;
  let slept = 0;
  let interrupted = false;
  const events = []; // all slept hours: one pushEventNotices call keeps the notice cap
  for (let h = 0; h < hours && !interrupted; h++) {
    events.push(...advanceTime(state, 60, data, ctx.rng));
    const stats = getStats(state, data);
    const ch = state.character;
    const before = ch.hp;
    const heal = Math.floor((healBase + Math.floor(stats.attributes.krzepa / healKrzepaDiv)) * restHealMultiplier(state, data));
    ch.hp = Math.max(ch.hp, Math.min(stats.derived.hpMax, ch.hp + heal)); // sleep never takes HP away
    healed += Math.max(0, ch.hp - before);
    slept++;
    if (exposed) {
      const thief = exposureRisk(state, data, ctx.rng);
      events.push(...thief);
      interrupted = thief.length > 0;
    }
  }
  if (exposed) setExposed(state, data, false);
  for (const id of clearBySleep(state, data, slept)) events.push({ type: "efekt_koniec", id });
  pushEventNotices(ctx, events);
  afterSleep?.(); // before the camp menu, so a save made there starts after the sleep
  if (quick) {
    if (healed > 0) pushNotice(ctx, paint("heal", t(ui, "rest.summary", { hours: slept, hp: healed })));
    return;
  }

  const render = () => header([
    ...(interrupted ? [paint("warn", t(ui, "rest.interrupted", { hours: slept }))] : []),
    paint("heal", t(ui, "rest.summary", { hours: slept, hp: healed })),
  ]);
  await render();
  await campMenu(ctx, render);
}
