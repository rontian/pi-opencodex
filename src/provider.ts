import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cacheDir, type ModelOverride, type OpenCodexProviderConfig } from "./config.ts";

export type InputModality = "text" | "image";
export type RefreshTarget = "models" | "metadata" | "all";
export type RefreshMode = "background" | "manual";

export interface OpenCodexModel {
  id: string;
  metadataId: string;
  owned_by?: string;
}

export interface ModelsDevMetadata {
  id: string;
  sourceProvider?: string;
  name?: string;
  reasoning?: boolean;
  modalities?: { input?: string[] };
  limit?: { context?: number; output?: number };
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
    tiers?: Array<{
      input?: number;
      output?: number;
      cache_read?: number;
      cache_write?: number;
      tier?: { type?: string; size?: number };
    }>;
  };
}

export type ModelsDevCatalog = Record<string, ModelsDevMetadata>;
export type MetadataMatchMethod = "alias" | "exact" | "owner-prefix" | "suffix" | "normalized-suffix" | "provider-fallback";

export interface PiProviderModel {
  id: string;
  name: string;
  reasoning: boolean;
  input: InputModality[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    tiers?: Array<{
      inputTokensAbove: number;
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    }>;
  };
  contextWindow: number;
  maxTokens: number;
  thinkingLevelMap?: Partial<Record<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra", string | null>>;
}

export interface CatalogSnapshot {
  availableModels: OpenCodexModel[];
  modelsUpdatedAt?: number;
  metadata: ModelsDevCatalog;
  metadataUpdatedAt?: number;
  built: {
    models: PiProviderModel[];
    stats: {
      total: number;
      enriched: number;
      unmatched: number;
      unmatchedModelIds: string[];
      matchMethods: Record<MetadataMatchMethod, number>;
    };
  };
}

export interface SourceRefreshResult {
  attempted: boolean;
  updated: boolean;
  changed: boolean;
  error?: unknown;
}

export interface CatalogRefreshResult {
  snapshot: CatalogSnapshot;
  models: SourceRefreshResult;
  metadata: SourceRefreshResult;
}

const MODELS_DEV_URL = "https://models.dev/api.json";
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;
const OWNER_MAP: Record<string, string> = {
  openai: "openai", anthropic: "anthropic", google: "google", deepseek: "deepseek",
  xai: "xai", zhipuai: "zhipuai", alibaba: "alibaba", moonshotai: "moonshotai", minimax: "minimax",
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function cacheKey(config: OpenCodexProviderConfig): string {
  return Buffer.from(`${config.providerName}\n${config.baseUrl}\n${config.modelPrefix}`).toString("base64url");
}

function modelCachePath(config: OpenCodexProviderConfig): string {
  return join(cacheDir(), `models-${cacheKey(config)}.json`);
}

function metadataCachePath(): string {
  return join(cacheDir(), "models-dev.json");
}

async function readCache<T>(path: string, parser: (value: unknown) => T): Promise<{ data: T; fetchedAt: number } | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as { version?: unknown; fetchedAt?: unknown; data?: unknown };
    if (value.version !== 1 || typeof value.fetchedAt !== "number") return undefined;
    return { data: parser(value.data), fetchedAt: value.fetchedAt };
  } catch {
    return undefined;
  }
}

async function writeCache(path: string, data: unknown, fetchedAt: number): Promise<void> {
  await mkdir(cacheDir(), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ version: 1, fetchedAt, data }, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
}

async function fetchJson(url: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`request timed out after ${timeoutMs}ms`)), timeoutMs);
  const abort = () => controller.abort(signal?.reason ?? new Error("request aborted"));
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export function stripConfiguredPrefix(modelId: string, prefix: string): string {
  return prefix && modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId;
}

export function modelsEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

function parseModelRows(entries: unknown[], modelPrefix: string): OpenCodexModel[] {
  const map = new Map<string, OpenCodexModel>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id.trim()) continue;
    const id = row.id.trim();
    map.set(id, {
      id,
      metadataId: stripConfiguredPrefix(id, modelPrefix),
      owned_by: typeof row.owned_by === "string" ? row.owned_by : undefined,
    });
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function parseOpenCodexModelsResponse(payload: unknown, modelPrefix = "rontian/"): OpenCodexModel[] {
  const data = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) throw new Error("OpenCodex /v1/models response must contain a data array");
  return parseModelRows(data, modelPrefix);
}

function parseModelCache(payload: unknown, prefix: string): OpenCodexModel[] {
  if (!Array.isArray(payload)) throw new Error("OpenCodex model cache must be an array");
  return parseModelRows(payload, prefix);
}

export async function fetchOpenCodexModels(config: Pick<OpenCodexProviderConfig, "baseUrl" | "modelPrefix">, timeoutMs: number, signal?: AbortSignal): Promise<OpenCodexModel[]> {
  return parseOpenCodexModelsResponse(await fetchJson(modelsEndpoint(config.baseUrl), timeoutMs, signal), config.modelPrefix);
}

function isMetadata(value: unknown): value is ModelsDevMetadata {
  return !!value && typeof value === "object" && !Array.isArray(value) && typeof (value as { id?: unknown }).id === "string";
}

export function parseModelsDevCatalog(payload: unknown): ModelsDevCatalog {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("models.dev catalog must be an object");
  const result: ModelsDevCatalog = {};
  for (const [providerId, rawProvider] of Object.entries(payload as Record<string, unknown>)) {
    const models = rawProvider && typeof rawProvider === "object" && !Array.isArray(rawProvider)
      ? (rawProvider as { models?: unknown }).models : undefined;
    if (!models || typeof models !== "object" || Array.isArray(models)) continue;
    for (const [modelId, rawMetadata] of Object.entries(models as Record<string, unknown>)) {
      if (!isMetadata(rawMetadata)) continue;
      const canonical = rawMetadata.id.includes("/") ? rawMetadata.id : `${providerId}/${modelId}`;
      const key = canonical.startsWith(`${providerId}/`) ? canonical : `${providerId}/${canonical}`;
      result[key] = { ...rawMetadata, id: canonical, sourceProvider: providerId };
    }
  }
  return result;
}

export async function fetchModelsDevCatalog(timeoutMs: number, signal?: AbortSignal): Promise<ModelsDevCatalog> {
  return parseModelsDevCatalog(await fetchJson(MODELS_DEV_URL, timeoutMs, signal));
}

function modelName(key: string, metadata: ModelsDevMetadata): string {
  return metadata.id.split("/").at(-1) ?? key.split("/").at(-1) ?? key;
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function unique(values: string[]): string | undefined {
  const set = [...new Set(values)];
  return set.length === 1 ? set[0] : undefined;
}

export function findMetadataMatch(
  model: OpenCodexModel,
  catalog: ModelsDevCatalog,
  aliases: Record<string, string>,
  fallbackProvider: string | null,
): { metadata: ModelsDevMetadata; method: MetadataMatchMethod } | undefined {
  const lookup = model.metadataId || model.id;
  const alias = aliases[model.id] ?? aliases[lookup];
  if (alias && catalog[alias]) return { metadata: catalog[alias], method: "alias" };

  for (const id of [model.id, lookup]) {
    if (catalog[id]) return { metadata: catalog[id], method: "exact" };
    const exact = unique(Object.keys(catalog).filter((key) => catalog[key]?.id === id));
    if (exact) return { metadata: catalog[exact], method: "exact" };
  }

  const owner = model.owned_by?.trim().toLowerCase();
  const ownerPrefix = owner ? OWNER_MAP[owner] : undefined;
  if (ownerPrefix && catalog[`${ownerPrefix}/${lookup}`]) {
    return { metadata: catalog[`${ownerPrefix}/${lookup}`], method: "owner-prefix" };
  }

  const keys = Object.keys(catalog);
  const suffix = unique(keys.filter((key) => modelName(key, catalog[key]) === lookup));
  if (suffix) return { metadata: catalog[suffix], method: "suffix" };

  const normalizedMatches = keys.filter((key) => normalized(modelName(key, catalog[key])) === normalized(lookup));
  const normalizedKey = unique(normalizedMatches);
  if (normalizedKey) return { metadata: catalog[normalizedKey], method: "normalized-suffix" };

  if (fallbackProvider) {
    const fallback = unique(normalizedMatches.filter((key) => (catalog[key].sourceProvider ?? key.split("/")[0]).toLowerCase() === fallbackProvider.toLowerCase()));
    if (fallback) return { metadata: catalog[fallback], method: "provider-fallback" };
  }
  return undefined;
}

function gpt56Thinking(model: OpenCodexModel, metadata?: ModelsDevMetadata): PiProviderModel["thinkingLevelMap"] | undefined {
  const ids = [model.id, model.metadataId, metadata?.id].filter((id): id is string => !!id);
  if (!ids.some((id) => /(^|\/)gpt-5\.6(?:-|$)/.test(id))) return undefined;
  return { off: "none", minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" };
}

function cost(metadata: ModelsDevMetadata): PiProviderModel["cost"] {
  const tiers = metadata.cost?.tiers?.flatMap((tier) => tier.tier?.type === "context" && typeof tier.tier.size === "number" ? [{
    inputTokensAbove: tier.tier.size,
    input: tier.input ?? 0,
    output: tier.output ?? 0,
    cacheRead: tier.cache_read ?? 0,
    cacheWrite: tier.cache_write ?? 0,
  }] : []);
  return {
    input: metadata.cost?.input ?? 0,
    output: metadata.cost?.output ?? 0,
    cacheRead: metadata.cost?.cache_read ?? 0,
    cacheWrite: metadata.cost?.cache_write ?? 0,
    ...(tiers?.length ? { tiers } : {}),
  };
}

function applyOverride(model: PiProviderModel, override?: ModelOverride): PiProviderModel {
  return override ? {
    ...model,
    ...(override.reasoning !== undefined ? { reasoning: override.reasoning } : {}),
    ...(override.contextWindow !== undefined ? { contextWindow: override.contextWindow } : {}),
    ...(override.maxTokens !== undefined ? { maxTokens: override.maxTokens } : {}),
  } : model;
}

function makeModel(model: OpenCodexModel, metadata?: ModelsDevMetadata): PiProviderModel {
  const thinking = gpt56Thinking(model, metadata);
  return {
    id: model.id,
    name: metadata?.name ?? model.metadataId ?? model.id,
    reasoning: thinking ? true : (metadata?.reasoning ?? false),
    input: metadata?.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
    cost: metadata ? cost(metadata) : { ...ZERO_COST },
    contextWindow: metadata?.limit?.context ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: metadata?.limit?.output ?? DEFAULT_MAX_TOKENS,
    ...(thinking ? { thinkingLevelMap: thinking } : {}),
  };
}

function emptyMethods(): Record<MetadataMatchMethod, number> {
  return { alias: 0, exact: 0, "owner-prefix": 0, suffix: 0, "normalized-suffix": 0, "provider-fallback": 0 };
}

export function buildProviderModels(
  available: OpenCodexModel[],
  metadata: ModelsDevCatalog,
  config: Pick<OpenCodexProviderConfig, "modelAliases" | "modelOverrides" | "metadataFallbackProvider">,
): CatalogSnapshot["built"] {
  const matchMethods = emptyMethods();
  const unmatchedModelIds: string[] = [];
  let enriched = 0;
  const models = available.map((model) => {
    const match = findMetadataMatch(model, metadata, config.modelAliases, config.metadataFallbackProvider);
    if (!match) unmatchedModelIds.push(model.id);
    else { enriched += 1; matchMethods[match.method] += 1; }
    return applyOverride(makeModel(model, match?.metadata), config.modelOverrides[model.id] ?? config.modelOverrides[model.metadataId]);
  });
  return { models, stats: { total: models.length, enriched, unmatched: unmatchedModelIds.length, unmatchedModelIds, matchMethods } };
}

export function buildUnavailableProviderModels(): PiProviderModel[] {
  return [{ id: "opencodex-unavailable", name: "OpenCodex unavailable", reasoning: false, input: ["text"], cost: { ...ZERO_COST }, contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_TOKENS }];
}

export class ProviderCatalog {
  private snapshot?: CatalogSnapshot;
  private readonly config: OpenCodexProviderConfig;
  constructor(config: OpenCodexProviderConfig) { this.config = config; }

  current(): CatalogSnapshot | undefined { return this.snapshot; }

  async load(): Promise<CatalogSnapshot> {
    const models = await readCache(modelCachePath(this.config), (value) => parseModelCache(value, this.config.modelPrefix));
    const metadata = this.config.modelsDevEnabled ? await readCache(metadataCachePath(), parseModelsDevCatalog) : undefined;
    return this.set(models?.data ?? [], models?.fetchedAt, metadata?.data ?? {}, metadata?.fetchedAt);
  }

  async refresh(target: RefreshTarget = "all", mode: RefreshMode = "manual", signal?: AbortSignal): Promise<CatalogRefreshResult> {
    const current = this.snapshot ?? await this.load();
    let available = current.availableModels;
    let modelsUpdatedAt = current.modelsUpdatedAt;
    let metadata = current.metadata;
    let metadataUpdatedAt = current.metadataUpdatedAt;
    const models: SourceRefreshResult = { attempted: target !== "metadata", updated: false, changed: false };
    const meta: SourceRefreshResult = { attempted: target !== "models" && this.config.modelsDevEnabled, updated: false, changed: false };

    if (models.attempted) {
      try {
        const fresh = await fetchOpenCodexModels(this.config, mode === "background" ? 2_500 : 10_000, signal);
        if (mode === "background" && current.availableModels.length && !fresh.length) throw new Error("OpenCodex returned an empty model list");
        models.changed = stable(fresh) !== stable(current.availableModels);
        modelsUpdatedAt = Date.now();
        await writeCache(modelCachePath(this.config), fresh, modelsUpdatedAt);
        available = fresh;
        models.updated = true;
      } catch (error) { models.error = error; }
    }

    if (meta.attempted) {
      try {
        const fresh = await fetchModelsDevCatalog(mode === "background" ? 5_000 : 12_000, signal);
        meta.changed = stable(fresh) !== stable(current.metadata);
        metadataUpdatedAt = Date.now();
        await writeCache(metadataCachePath(), fresh, metadataUpdatedAt);
        metadata = fresh;
        meta.updated = true;
      } catch (error) { meta.error = error; }
    }

    return { snapshot: this.set(available, modelsUpdatedAt, metadata, metadataUpdatedAt), models, metadata: meta };
  }

  private set(availableModels: OpenCodexModel[], modelsUpdatedAt: number | undefined, metadata: ModelsDevCatalog, metadataUpdatedAt: number | undefined): CatalogSnapshot {
    return this.snapshot = { availableModels, modelsUpdatedAt, metadata, metadataUpdatedAt, built: buildProviderModels(availableModels, metadata, this.config) };
  }
}

export class ProviderRuntime {
  private fingerprint?: string;
  private readonly options: { pi: ExtensionAPI; config: OpenCodexProviderConfig; catalog: ProviderCatalog };
  constructor(options: { pi: ExtensionAPI; config: OpenCodexProviderConfig; catalog: ProviderCatalog }) { this.options = options; }

  async start(): Promise<CatalogSnapshot> {
    const snapshot = await this.options.catalog.load();
    this.register(snapshot, true);
    return snapshot;
  }

  async refresh(target: RefreshTarget = "all", mode: RefreshMode = "manual", signal?: AbortSignal): Promise<CatalogRefreshResult> {
    const result = await this.options.catalog.refresh(target, mode, signal);
    if (result.models.updated || result.metadata.updated) this.register(result.snapshot, false);
    return result;
  }

  async refreshModels(context: { allowNetwork: boolean; force?: boolean; signal?: AbortSignal }): Promise<PiProviderModel[]> {
    if (!context.allowNetwork) {
      const snapshot = await this.options.catalog.load();
      return snapshot.built.models.length ? snapshot.built.models : buildUnavailableProviderModels();
    }
    const result = await this.options.catalog.refresh("models", context.force ? "manual" : "background", context.signal);
    return result.snapshot.built.models.length ? result.snapshot.built.models : buildUnavailableProviderModels();
  }

  private register(snapshot: CatalogSnapshot, force: boolean): void {
    const models = snapshot.built.models.length ? snapshot.built.models : buildUnavailableProviderModels();
    const next = stable(models);
    if (!force && next === this.fingerprint) return;
    this.options.pi.registerProvider(this.options.config.providerName, {
      name: `OpenCodex (${this.options.config.providerName})`,
      baseUrl: this.options.config.baseUrl,
      api: "openai-completions",
      apiKey: "opencodex-loopback",
      authHeader: false,
      models,
      refreshModels: (context: { allowNetwork: boolean; force?: boolean; signal?: AbortSignal }) => this.refreshModels(context),
    });
    this.fingerprint = next;
  }
}
