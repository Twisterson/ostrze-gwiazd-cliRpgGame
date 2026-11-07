import { select } from "./menu.js";
import { t } from "./strings.js";
import { framesOn, showScreen, flushNotices } from "./screen.js";
import { LANGUAGES } from "../config.js";

/**
 * The first-run question about the language, asked in both languages at once. Resolves with "pl" or "en".
 * `ctx` is the menu's screen context ({ io, data, notices }).
 */
export async function chooseLanguage(ctx) {
  const { io, data: { ui } } = ctx;
  if (framesOn(io)) await showScreen(ctx, { lines: [], hero: false, bare: true });
  else flushNotices(ctx);
  const items = LANGUAGES.map((lang) => ({ id: lang, label: t(ui, `language.${lang}`) }));
  const index = await select(io, ui, { title: t(ui, "language.title"), items });
  return items[index].id;
}
