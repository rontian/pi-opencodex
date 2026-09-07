export function normalizeModelsDevCatalog(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("models.dev catalog must be a JSON object");
  }

  const catalog = {};
  for (const [providerId, rawProvider] of Object.entries(payload)) {
    if (!rawProvider || typeof rawProvider !== "object" || Array.isArray(rawProvider)) continue;

    if (rawProvider.models && typeof rawProvider.models === "object" && !Array.isArray(rawProvider.models)) {
      for (const [modelId, rawMetadata] of Object.entries(rawProvider.models)) {
        if (!rawMetadata || typeof rawMetadata !== "object" || Array.isArray(rawMetadata)) continue;
        if (typeof rawMetadata.id !== "string") continue;

        const canonicalId = rawMetadata.id.includes("/") ? rawMetadata.id : `${providerId}/${modelId}`;
        const catalogKey = canonicalId.startsWith(`${providerId}/`)
          ? canonicalId
          : `${providerId}/${canonicalId}`;
        catalog[catalogKey] = {
          ...rawMetadata,
          id: canonicalId,
          sourceProvider: providerId,
        };
      }
      continue;
    }

    // Also accept an already-normalized catalog so the helper is idempotent.
    if (typeof rawProvider.id === "string") {
      catalog[providerId] = {
        ...rawProvider,
        id: rawProvider.id.includes("/") ? rawProvider.id : providerId,
      };
    }
  }

  const entries = Object.entries(catalog).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length < 100) {
    throw new Error(`models.dev catalog contained only ${entries.length} valid models; refusing to replace the fallback`);
  }
  return Object.fromEntries(entries);
}

export function validateCatalogSize(currentCatalog, nextCatalog) {
  const currentCount = currentCatalog && typeof currentCatalog === "object" && !Array.isArray(currentCatalog)
    ? Object.keys(currentCatalog).length
    : 0;
  const nextCount = Object.keys(nextCatalog).length;
  if (currentCount > 0 && nextCount < currentCount * 0.5) {
    throw new Error(`models.dev catalog shrank from ${currentCount} to ${nextCount} models; refusing the update`);
  }
}
