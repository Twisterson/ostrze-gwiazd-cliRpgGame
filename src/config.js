import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GAME_NAME = "ostrze";
export const GAME_VERSION = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
export const SAVE_FORMAT_VERSION = 13;

export function homeDir() {
  return process.env.OSTRZE_HOME || path.join(os.homedir(), ".ostrze");
}

export function savesDir() {
  return path.join(homeDir(), "saves");
}

/** The player's settings file, shared by all saves. */
function configPath() {
  return path.join(homeDir(), "config.json");
}

function readConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** The chosen look of the pictures: "color" (also when there is no file, or it is damaged), "gray" or "none". */
export function loadGraphics() {
  const { graphics } = readConfig();
  return ["color", "gray", "none"].includes(graphics) ? graphics : "color";
}

/** Stores the choice beside the other settings; throws when the file cannot be written. */
export function saveGraphics(graphics) {
  const config = { ...readConfig(), graphics };
  fs.mkdirSync(homeDir(), { recursive: true });
  fs.writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`);
}

export function dataDir() {
  return process.env.OSTRZE_DATA || fileURLToPath(new URL("../data", import.meta.url));
}
