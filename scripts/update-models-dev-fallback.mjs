import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODELS_DEV_URL = "https://models.dev/api.json";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "data", "models-dev-fallback.json");

const response = await fetch(MODELS_DEV_URL, {
  headers: { Accept: "application/json" },
});
if (!response.ok) {
  throw new Error(`models.dev fetch failed: HTTP ${response.status} ${response.statusText}`);
}

const payload = await response.json();
if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
  throw new Error("models.dev payload is not a JSON object");
}

let modelCount = 0;
for (const provider of Object.values(payload)) {
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) continue;
  const models = provider.models;
  if (!models || typeof models !== "object" || Array.isArray(models)) continue;
  modelCount += Object.keys(models).length;
}
if (modelCount === 0) {
  throw new Error("models.dev payload contained no models; refusing to replace bundled snapshot");
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote ${modelCount} models to ${output}`);
