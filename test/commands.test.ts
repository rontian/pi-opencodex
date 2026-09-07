import assert from "node:assert/strict";
import test from "node:test";
import { refreshRequiresOcxSync } from "../src/commands.ts";

test("full refresh synchronizes the OpenCodex catalog", () => {
  assert.equal(refreshRequiresOcxSync("all"), true);
});

test("model refresh synchronizes the OpenCodex catalog", () => {
  assert.equal(refreshRequiresOcxSync("models"), true);
});

test("metadata-only refresh does not synchronize the OpenCodex catalog", () => {
  assert.equal(refreshRequiresOcxSync("metadata"), false);
});
