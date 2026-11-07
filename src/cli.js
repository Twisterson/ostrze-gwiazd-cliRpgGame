import { parseArgs } from "node:util";
import { loadData, validateData, translationReport, DataLoadError } from "./engine/data.js";
import { createTerminalIO } from "./ui/io.js";
import { setColorsEnabled, setGraphics, useColor } from "./ui/colors.js";
import { loadGraphics, loadLanguage, dataDir } from "./config.js";
import { renderPixels } from "./ui/pixels.js";
import { t } from "./ui/strings.js";
import { runApp } from "./app.js";
import { SCOPES as SCOPE_NAMES, scopeOf, scopedReport } from "./i18n/scope.js";

const MAX_SEED = 4294967295;
const LANGS = ["pl", "en"];
// Translation scopes for --validate: "all" or one act (see src/i18n/scope.js); with --strict only that scope's entries count.
const SCOPES = ["all", ...SCOPE_NAMES];

/** CLI entry point; resolves with the process exit code. */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const stderr = deps.stderr ?? ((s) => process.stderr.write(`${s}\n`));
  // tests stand in a failing loader here
  const loadData_ = deps.loadData ?? loadData;

  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        seed: { type: "string" },
        scene: { type: "string" },
        debug: { type: "boolean" },
        validate: { type: "boolean" },
        art: { type: "string" },
        help: { type: "boolean" },
        lang: { type: "string" },
        strict: { type: "boolean" },
        scope: { type: "string" },
      },
    }));
  } catch (err) {
    stderr(err.message);
    return 1;
  }

  let seed;
  if (values.seed !== undefined) {
    if (!/^\d+$/.test(values.seed) || Number(values.seed) > MAX_SEED) {
      stderr("--seed: oczekiwano liczby całkowitej 0–4294967295");
      return 1;
    }
    seed = Number(values.seed);
  }

  if (values.lang !== undefined && !LANGS.includes(values.lang)) {
    stderr(`--lang: oczekiwano ${LANGS.join(" albo ")}`);
    return 1;
  }
  if (values.scope !== undefined && !SCOPES.includes(values.scope)) {
    stderr(`--scope: nieznany zakres "${values.scope}" (dostępne: ${SCOPES.join(", ")})`);
    return 1;
  }
  if ((values.scope !== undefined || values.strict) && (values.lang ?? "pl") === "pl") {
    stderr("--strict i --scope działają tylko z --lang en (tu nic nie zmieniają)");
  }
  // --lang holds for this run only; then the saved setting; with none, Polish (a real terminal asks first, see runApp)
  let lang = values.lang ?? (values.validate ? "pl" : loadLanguage() ?? "pl");
  // a saved language whose data fails to load or validate must not lock the player out: start in Polish, say why
  const fallback = values.lang === undefined && lang !== "pl";
  let startFailure = null;

  let data;
  let report = null;
  let errors;
  const load = async (l) => {
    data = await loadData_(dataDir(), { lang: l });
    if (values.validate && l !== "pl") report = scopedReport(await translationReport(dataDir(), l), scopeOf(data), values.scope ?? "all");
    errors = validateData(data);
  };
  try {
    try {
      await load(lang);
    } catch (err) {
      if (!(err instanceof DataLoadError) || !fallback) throw err;
      errors = [err.message];
    }
    if (fallback && errors.length > 0) {
      startFailure = { lang, reason: errors[0] };
      lang = "pl";
      await load(lang);
    }
  } catch (err) {
    if (!(err instanceof DataLoadError)) throw err;
    stderr(err.message);
    return 1;
  }
  // Overlay errors always fail validation; missing / stale entries only with --strict.
  if (report) errors.push(...report.errors, ...(values.strict ? report.warnings : []));
  if (errors.length > 0) {
    for (const e of errors) stderr(e);
    return 1;
  }
  const startNotices = startFailure
    ? [t(data.ui, "menu.language.startFailed", { lang: t(data.ui, `menu.language.${startFailure.lang}`), reason: startFailure.reason })]
    : [];
  for (const notice of values.help || values.art !== undefined ? startNotices : []) stderr(notice);

  if (values.help) {
    stdout(t(data.ui, "cli.help"));
    return 0;
  }
  if (values.validate) {
    if (report && report.warnings.length > 0) {
      for (const w of report.warnings) stdout(w);
      const sum = (key) => Object.values(report.perFile).reduce((n, f) => n + f[key], 0);
      stdout(`razem: brak ${sum("missing")}, nieaktualne ${sum("stale")}`);
    }
    stdout("Dane poprawne.");
    return 0;
  }
  if (values.art !== undefined) {
    const image = data.art[values.art];
    if (!image) {
      stderr(t(data.ui, "cli.artUnknown", { id: values.art }));
      return 1;
    }
    for (const line of renderPixels(image, { color: useColor() })) stdout(line);
    return 0;
  }
  if (values.scene !== undefined && !data.story.scenes.some((s) => s.id === values.scene)) {
    stderr(`--scene: nieznana scena "${values.scene}"`);
    return 1;
  }

  if (deps.io) setColorsEnabled(false);
  else setColorsEnabled(Boolean(process.stdout.isTTY) && !process.env.NO_COLOR);
  setGraphics(loadGraphics());
  const io = deps.io ?? createTerminalIO();
  // a switch in the menu loads the data anew, checked as at start
  const reloadData = async (next) => {
    const fresh = await loadData_(dataDir(), { lang: next });
    const problems = validateData(fresh);
    if (problems.length > 0) throw new Error(problems[0]);
    return fresh;
  };
  // the question about the language needs a person at a terminal; deps.askLanguage stands in for one in tests
  const askLanguage = deps.askLanguage ?? (!deps.io && Boolean(process.stdin.isTTY && process.stdout.isTTY));
  try {
    await runApp({ data, io, reloadData, options: { seed, scene: values.scene, debug: Boolean(values.debug), lang: values.lang, askLanguage, notices: startNotices } });
  } finally {
    io.close();
  }
  return 0;
}
