import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG } from "../src/config.ts";
import {
  ProviderCatalog,
  parseModelsDevCatalog,
  readBundledModelsDevFallback,
} from "../src/provider.ts";

const rawSnapshot = {
  zhipuai: {
    models: {
      "glm-5.3-flash": {
        id: "glm-5.3-flash",
        name: "GLM 5.3 Flash",
        reasoning: true,
        modalities: { input: ["text", "image"] },
        limit: { context: 1_000_000, output: 131_072 },
      },
    },
  },
};

test("models.dev parser accepts both raw API data and flattened cache data", () => {
  const parsed = parseModelsDevCatalog(rawSnapshot);
  assert.equal(parsed["zhipuai/glm-5.3-flash"].limit?.context, 1_000_000);

  const reparsed = parseModelsDevCatalog(parsed);
  assert.equal(reparsed["zhipuai/glm-5.3-flash"].limit?.output, 131_072);
  assert.equal(reparsed["zhipuai/glm-5.3-flash"].sourceProvider, "zhipuai");
});

test("ProviderCatalog loads bundled metadata when no valid metadata cache exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-opencodex-bundled-"));
  const snapshotPath = join(dir, "models-dev-fallback.json");
  try {
    await writeFile(snapshotPath, JSON.stringify(rawSnapshot), "utf8");
    const direct = await readBundledModelsDevFallback(snapshotPath);
    assert.equal(direct["zhipuai/glm-5.3-flash"].reasoning, true);

    const catalog = new ProviderCatalog(
      {
        ...DEFAULT_CONFIG,
        providerName: `opencodex-test-${Date.now()}`,
        baseUrl: "http://127.0.0.1:65534/v1",
      },
      { bundledModelsDevPath: snapshotPath },
    );
    const loaded = await catalog.load();
    assert.equal(loaded.metadataSource, "bundled");
    assert.equal(loaded.metadata["zhipuai/glm-5.3-flash"].limit?.context, 1_000_000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
