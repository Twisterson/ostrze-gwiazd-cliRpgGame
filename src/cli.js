import { parseArgs } from "node:util";
import { loadData, validateData, DataLoadError } from "./engine/data.js";
import { createTerminalIO } from "./ui/io.js";
import { setColorsEnabled, useColor } from "./ui/colors.js";
import { renderPixels } from "./ui/pixels.js";
import { t } from "./ui/strings.js";
import { runApp } from "./app.js";

const MAX_SEED = 4294967295;

/** CLI entry point; resolves with the process exit code. */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const stderr = deps.stderr ?? ((s) => process.stderr.write(`${s}\n`));

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

  let data;
  try {
    data = await loadData();
  } catch (err) {
    if (!(err instanceof DataLoadError)) throw err;
    stderr(err.message);
    return 1;
  }
  const errors = validateData(data);
  if (errors.length > 0) {
    for (const e of errors) stderr(e);
    return 1;
  }

  if (values.help) {
    stdout(t(data.ui, "cli.help"));
    return 0;
  }
  if (values.validate) {
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
  const io = deps.io ?? createTerminalIO();
  try {
    await runApp({ data, io, options: { seed, scene: values.scene, debug: Boolean(values.debug) } });
  } finally {
    io.close();
  }
  return 0;
}
