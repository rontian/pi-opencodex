import assert from "node:assert/strict";
import test from "node:test";
import { mergeConfigLayers } from "../src/config.ts";

test("default route prefix is rontian/ and can be configured globally", () => {
  assert.equal(mergeConfigLayers().modelPrefix, "rontian/");
  assert.equal(mergeConfigLayers({ modelPrefix: "work/" }).modelPrefix, "work/");
  assert.equal(mergeConfigLayers({ modelPrefix: "" }).modelPrefix, "");
});

test("working context window cap defaults to 272K and can be changed globally", () => {
  assert.equal(mergeConfigLayers(undefined, undefined, {}).contextWindowCap, 272_000);
  assert.equal(mergeConfigLayers({ contextWindowCap: 512_000 }, undefined, {}).contextWindowCap, 512_000);
  assert.equal(mergeConfigLayers({ contextWindowCap: null }, undefined, {}).contextWindowCap, null);
});

test("project config cannot replace connection identity or the global context cap", () => {
  const config = mergeConfigLayers(
    { providerName: "opencodex", baseUrl: "http://127.0.0.1:10100/v1", contextWindowCap: 272_000 },
    {
      providerName: "should-not-apply",
      baseUrl: "http://wrong",
      contextWindowCap: 512_000,
      modelAliases: { foo: "openai/foo" },
    },
    {},
  );
  assert.equal(config.providerName, "opencodex");
  assert.equal(config.baseUrl, "http://127.0.0.1:10100/v1");
  assert.equal(config.contextWindowCap, 272_000);
  assert.equal(config.modelAliases.foo, "openai/foo");
});
