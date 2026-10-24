import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GAME_NAME = "ostrze";
export const GAME_VERSION = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
export const SAVE_FORMAT_VERSION = 11;

export function homeDir() {
  return process.env.OSTRZE_HOME || path.join(os.homedir(), ".ostrze");
}

export function savesDir() {
  return path.join(homeDir(), "saves");
}

export function dataDir() {
  return process.env.OSTRZE_DATA || fileURLToPath(new URL("../data", import.meta.url));
}
