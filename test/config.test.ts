import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { mergeConfigLayers, readConfigFile } from "../src/config.ts";

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


test("model compat override accepts only supportsDeveloperRole boolean", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-opencodex-config-"));
  const file = join(dir, "config.json");
  const writeOverride = (compat: unknown) => writeFileSync(file, JSON.stringify({
    modelOverrides: { "rontian/glm-5.3-flash": { compat } },
  }));
  try {
    writeOverride({ supportsDeveloperRole: false });
    assert.deepEqual(readConfigFile(file)?.modelOverrides["rontian/glm-5.3-flash"].compat, {
      supportsDeveloperRole: false,
    });
    writeOverride({ supportsDeveloperRole: true });
    assert.equal(readConfigFile(file)?.modelOverrides["rontian/glm-5.3-flash"].compat?.supportsDeveloperRole, true);
    for (const invalid of [null, [], { supportsDeveloperRole: "false" }, { unknown: true }]) {
      writeOverride(invalid);
      assert.throws(() => readConfigFile(file), /modelOverrides contains invalid entries/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
