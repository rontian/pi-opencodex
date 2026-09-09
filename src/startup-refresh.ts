import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheDir } from "./config.ts";
import type { CatalogSnapshot, RefreshTarget } from "./provider.ts";

export const METADATA_BACKGROUND_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STATE_VERSION = 1;

function metadataBackgroundRefreshStatePath(): string {
  return join(cacheDir(), "models-dev-background-refresh.json");
}

export async function readLastMetadataBackgroundRefreshAttempt(
  path = metadataBackgroundRefreshStatePath(),
): Promise<number | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as {
      version?: unknown;
      lastAttemptAt?: unknown;
    };
    if (value.version !== STATE_VERSION || typeof value.lastAttemptAt !== "number") return undefined;
    return value.lastAttemptAt;
  } catch {
    return undefined;
  }
}

export async function markMetadataBackgroundRefreshAttempt(
  at = Date.now(),
  path = metadataBackgroundRefreshStatePath(),
): Promise<void> {
  await mkdir(cacheDir(), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ version: STATE_VERSION, lastAttemptAt: at }, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(tmp, path);
}

export function shouldBackgroundRefreshMetadata(
  snapshot: Pick<CatalogSnapshot, "metadataSource" | "metadataUpdatedAt">,
  now = Date.now(),
  lastAttemptAt?: number,
): boolean {
  if (snapshot.metadataSource === "disabled") return false;

  if (
    snapshot.metadataSource === "cache"
    && snapshot.metadataUpdatedAt !== undefined
    && now - snapshot.metadataUpdatedAt < METADATA_BACKGROUND_REFRESH_INTERVAL_MS
  ) {
    return false;
  }

  if (
    lastAttemptAt !== undefined
    && now - lastAttemptAt < METADATA_BACKGROUND_REFRESH_INTERVAL_MS
  ) {
    return false;
  }

  return true;
}

export function startupRefreshTarget(
  firstRunModelsLoaded: boolean,
  refreshMetadata: boolean,
): RefreshTarget | null {
  if (firstRunModelsLoaded) return refreshMetadata ? "metadata" : null;
  return refreshMetadata ? "all" : "models";
}
