import assert from "node:assert/strict";
import test from "node:test";
import { mergeConfigLayers } from "../src/config.ts";

test("default route prefix is rontian/ and can be configured globally", () => {
  assert.equal(mergeConfigLayers().modelPrefix, "rontian/");
  assert.equal(mergeConfigLayers({ modelPrefix: "work/" }).modelPrefix, "work/");
  assert.equal(mergeConfigLayers({ modelPrefix: "" }).modelPrefix, "");
});

test("project config cannot replace connection identity", () => {
  const config = mergeConfigLayers(
    { providerName: "opencodex", baseUrl: "http://127.0.0.1:10100/v1" },
    { providerName: "should-not-apply", baseUrl: "http://wrong", modelAliases: { foo: "openai/foo" } },
    {},
  );
  assert.equal(config.providerName, "opencodex");
  assert.equal(config.baseUrl, "http://127.0.0.1:10100/v1");
  assert.equal(config.modelAliases.foo, "openai/foo");
});
