import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  METADATA_BACKGROUND_REFRESH_INTERVAL_MS,
  markMetadataBackgroundRefreshAttempt,
  readLastMetadataBackgroundRefreshAttempt,
  shouldBackgroundRefreshMetadata,
  startupRefreshTarget,
} from "../src/startup-refresh.ts";

const now = 2_000_000_000_000;

test("fresh cached models.dev metadata skips startup network refresh", () => {
  assert.equal(shouldBackgroundRefreshMetadata({
    metadataSource: "cache",
    metadataUpdatedAt: now - 60_000,
  }, now), false);
});

test("stale cached metadata refreshes at most once per interval", () => {
  const stale = {
    metadataSource: "cache" as const,
    metadataUpdatedAt: now - METADATA_BACKGROUND_REFRESH_INTERVAL_MS - 1,
  };
  assert.equal(shouldBackgroundRefreshMetadata(stale, now), true);
  assert.equal(shouldBackgroundRefreshMetadata(
    stale,
    now,
    now - METADATA_BACKGROUND_REFRESH_INTERVAL_MS + 1,
  ), false);
  assert.equal(shouldBackgroundRefreshMetadata(
    stale,
    now,
    now - METADATA_BACKGROUND_REFRESH_INTERVAL_MS - 1,
  ), true);
});

test("bundled or missing metadata gets an opportunistic refresh with daily backoff", () => {
  for (const metadataSource of ["bundled", "missing"] as const) {
    assert.equal(shouldBackgroundRefreshMetadata({ metadataSource }, now), true);
    assert.equal(shouldBackgroundRefreshMetadata(
      { metadataSource },
      now,
      now - 60_000,
    ), false);
  }
  assert.equal(shouldBackgroundRefreshMetadata({ metadataSource: "disabled" }, now), false);
});

test("startup refresh target keeps local models fresh without redundant metadata requests", () => {
  assert.equal(startupRefreshTarget(false, false), "models");
  assert.equal(startupRefreshTarget(false, true), "all");
  assert.equal(startupRefreshTarget(true, true), "metadata");
  assert.equal(startupRefreshTarget(true, false), null);
});

test("metadata background attempt state persists independently from metadata freshness", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-opencodex-refresh-state-"));
  const path = join(dir, "state.json");
  try {
    assert.equal(await readLastMetadataBackgroundRefreshAttempt(path), undefined);
    await markMetadataBackgroundRefreshAttempt(now, path);
    assert.equal(await readLastMetadataBackgroundRefreshAttempt(path), now);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
