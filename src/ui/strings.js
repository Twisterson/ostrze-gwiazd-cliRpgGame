/** Chooses the form of a plural token for the count `n`: 2 forms follow English (1 / rest), 3 forms follow Polish (1 / 2-4 except 12-14 / rest). */
function pluralForm(n, forms) {
  const m = Math.abs(n);
  if (forms.length === 2) return m === 1 ? forms[0] : forms[1];
  if (m === 1) return forms[0];
  const few = Number.isInteger(m) && m % 10 >= 2 && m % 10 <= 4 && !(m % 100 >= 12 && m % 100 <= 14);
  return few ? forms[1] : forms[2];
}

import DEFAULT_UI from "./default_ui.js";

/**
 * The hotkey letter of `id` in this language (`key.character`, `combat.key.attack`…), lower case. A ui without the key
 * (a test's own ui) falls back to the base Polish one, so a binding never ends up empty.
 */
export function hotkey(ui, id) {
  const letter = ui?.[id] ?? DEFAULT_UI[id];
  return typeof letter === "string" ? letter.toLowerCase() : "";
}

/** True when the typed character is the hotkey `id` (either case). */
export const isHotkey = (ui, id, char) => typeof char === "string" && char.toLowerCase() === hotkey(ui, id);

/** Variables for the yes/no letters in a question ("[{yes}/{no}]") and for "[{character}]"-style mentions. */
export function keyVars(ui) {
  return {
    yes: hotkey(ui, "key.yes"), no: hotkey(ui, "key.no"),
    character: hotkey(ui, "key.character").toUpperCase(), notices: hotkey(ui, "key.notices").toUpperCase(),
    log: hotkey(ui, "combat.key.log").toUpperCase(), back: hotkey(ui, "key.back").toUpperCase(),
  };
}

/**
 * Fills a template. `{name}` is a variable; `{n|a|b}` or `{n|a|b|c}` picks a plural form by the number `n`.
 * `{yes}`, `{no}`, `{character}`, `{notices}`, `{log}` and `{back}` are the hotkey letters of this language (see keyVars)
 * unless `vars` names them. An unknown variable, a non-number, or a token with fewer than 2 or more than 3 forms is left as is.
 */
export function t(ui, key, vars = {}) {
  const template = ui[key];
  if (typeof template !== "string") return `[[${key}]]`;
  return template.replace(/\{(\w+)((?:\|[^{}|]*)*)\}/g, (whole, name, rest) => {
    if (!rest) {
      if (name in vars) return String(vars[name]);
      // the hotkey letters ("[{yes}/{no}]", "[{notices}]") come from the same ui keys as the bindings
      const keys = keyVars(ui);
      return name in keys ? keys[name] : whole;
    }
    const forms = rest.slice(1).split("|");
    const n = vars[name];
    if (forms.length < 2 || forms.length > 3 || typeof n !== "number" || !Number.isFinite(n)) return whole;
    return pluralForm(n, forms);
  });
}
