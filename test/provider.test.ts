import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProviderModels,
  findMetadataMatch,
  parseOpenCodexModelsResponse,
  stripConfiguredPrefix,
  type ModelsDevCatalog,
} from "../src/provider.ts";

const catalog: ModelsDevCatalog = {
  "zhipuai/glm-5.3-flash": {
    id: "zhipuai/glm-5.3-flash",
    sourceProvider: "zhipuai",
    name: "GLM 5.3 Flash",
    reasoning: true,
    modalities: { input: ["text", "image"] },
    limit: { context: 1_000_000, output: 131_072 },
  },
  "openrouter/glm-5.3-flash": {
    id: "openrouter/glm-5.3-flash",
    sourceProvider: "openrouter",
    name: "GLM 5.3 Flash via OpenRouter",
    reasoning: true,
    modalities: { input: ["text", "image"] },
    limit: { context: 1_000_000, output: 131_072 },
  },
};

test("stripConfiguredPrefix strips only a configured leading route prefix", () => {
  assert.equal(stripConfiguredPrefix("rontian/glm-5.3-flash", "rontian/"), "glm-5.3-flash");
  assert.equal(stripConfiguredPrefix("gpt-5.6-sol", "rontian/"), "gpt-5.6-sol");
  assert.equal(stripConfiguredPrefix("other/glm", ""), "other/glm");
});

test("OpenCodex discovery preserves routed id and exposes stripped metadata id", () => {
  const models = parseOpenCodexModelsResponse({
    object: "list",
    data: [
      { id: "rontian/glm-5.3-flash", owned_by: "rontian" },
      { id: "gpt-5.6-sol", owned_by: "openai" },
    ],
  }, "rontian/");
  assert.deepEqual(models.map(({ id, metadataId }) => ({ id, metadataId })), [
    { id: "gpt-5.6-sol", metadataId: "gpt-5.6-sol" },
    { id: "rontian/glm-5.3-flash", metadataId: "glm-5.3-flash" },
  ]);
});

test("metadata fallback matches the stripped routed id without changing inference id", () => {
  const [model] = parseOpenCodexModelsResponse({ data: [{ id: "rontian/glm-5.3-flash", owned_by: "rontian" }] }, "rontian/");
  const match = findMetadataMatch(model, catalog, {}, "openrouter");
  assert.ok(match);
  assert.equal(match.method, "provider-fallback");

  const built = buildProviderModels([model], catalog, {
    modelAliases: {},
    modelOverrides: {},
    metadataFallbackProvider: "openrouter",
  });
  assert.equal(built.models[0].id, "rontian/glm-5.3-flash");
  assert.equal(built.models[0].contextWindow, 1_000_000);
  assert.equal(built.models[0].maxTokens, 131_072);
  assert.equal(built.models[0].reasoning, true);
  assert.deepEqual(built.models[0].input, ["text", "image"]);
});

test("explicit alias wins over fallback matching", () => {
  const [model] = parseOpenCodexModelsResponse({ data: [{ id: "rontian/glm-5.3-flash" }] }, "rontian/");
  const match = findMetadataMatch(model, catalog, {
    "rontian/glm-5.3-flash": "zhipuai/glm-5.3-flash",
  }, "openrouter");
  assert.ok(match);
  assert.equal(match.method, "alias");
  assert.equal(match.metadata.sourceProvider, "zhipuai");
});
