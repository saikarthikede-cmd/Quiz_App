import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const tsconfigPath = resolve(scriptDir, "../services/frontend/tsconfig.json");
const source = readFileSync(tsconfigPath, "utf8");
const parsed = JSON.parse(source);

const include = Array.isArray(parsed.include) ? parsed.include : [];
parsed.include = include.filter((entry) => entry !== ".next/types/**/*.ts");

writeFileSync(tsconfigPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
