import { readFileSync } from "node:fs";

/** The base (Polish) `data/ui.json`, for pure UI functions called without a loaded `data` (a direct caller or a test). */
export default JSON.parse(readFileSync(new URL("../../data/ui.json", import.meta.url), "utf8"));
