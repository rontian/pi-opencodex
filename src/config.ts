import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface ModelOverride {
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

export interface OpenCodexProviderConfig {
  providerName: string;
  baseUrl: string;
  modelPrefix: string;
  modelsDevEnabled: boolean;
  metadataFallbackProvider: string | null;
  contextWindowCap: number | null;
  modelAliases: Record<string, string>;
  modelOverrides: Record<string, ModelOverride>;
}

export type ConfigLayer = Partial<OpenCodexProviderConfig>;

export const DEFAULT_CONTEXT_WINDOW_CAP = 272_000;

export const DEFAULT_CONFIG: OpenCodexProviderConfig = {
  providerName: "opencodex",
  baseUrl: "http://127.0.0.1:10100/v1",
  modelPrefix: "rontian/",
  modelsDevEnabled: true,
  metadataFallbackProvider: "openrouter",
  contextWindowCap: DEFAULT_CONTEXT_WINDOW_CAP,
  modelAliases: {},
  modelOverrides: {},
};

export function globalConfigPath(): string {
  return join(homedir(), ".pi", "agent", "pi-opencodex", "config.json");
}

export function projectConfigPath(cwd: string): string {
  return join(cwd, ".pi", "pi-opencodex", "config.json");
}

export function cacheDir(): string {
  return join(homedir(), ".cache", "pi-opencodex");
}

function isStringMap(value: unknown): value is Record<string, string> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === "string");
}

function isModelOverrides(value: unknown): value is Record<string, ModelOverride> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, raw]) => {
    if (!key.trim() || !raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const record = raw as Record<string, unknown>;
    const allowed = new Set(["reasoning", "contextWindow", "maxTokens"]);
    if (Object.keys(record).some((field) => !allowed.has(field))) return false;
    if (record.reasoning !== undefined && typeof record.reasoning !== "boolean") return false;
    if (record.contextWindow !== undefined && (typeof record.contextWindow !== "number" || record.contextWindow <= 0)) return false;
    if (record.maxTokens !== undefined && (typeof record.maxTokens !== "number" || record.maxTokens <= 0)) return false;
    return true;
  });
}

function validateLayer(value: unknown, path: string, project = false): ConfigLayer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Config file must contain a JSON object: ${path}`);
  }
  const record = value as Record<string, unknown>;
  const allowed = project
    ? new Set(["metadataFallbackProvider", "modelAliases", "modelOverrides"])
    : new Set(["providerName", "baseUrl", "modelPrefix", "modelsDevEnabled", "metadataFallbackProvider", "contextWindowCap", "modelAliases", "modelOverrides"]);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`Unsupported config fields in ${path}: ${unknown.join(", ")}`);

  for (const field of ["providerName", "baseUrl", "modelPrefix"] as const) {
    if (record[field] !== undefined && typeof record[field] !== "string") {
      throw new Error(`${field} must be a string in config file: ${path}`);
    }
  }
  if (record.modelsDevEnabled !== undefined && typeof record.modelsDevEnabled !== "boolean") {
    throw new Error(`modelsDevEnabled must be a boolean in config file: ${path}`);
  }
  if (record.metadataFallbackProvider !== undefined && record.metadataFallbackProvider !== null
    && (typeof record.metadataFallbackProvider !== "string" || !record.metadataFallbackProvider.trim())) {
    throw new Error(`metadataFallbackProvider must be a non-empty string or null in config file: ${path}`);
  }
  if (record.contextWindowCap !== undefined && record.contextWindowCap !== null
    && (typeof record.contextWindowCap !== "number" || !Number.isSafeInteger(record.contextWindowCap) || record.contextWindowCap <= 0)) {
    throw new Error(`contextWindowCap must be a positive integer or null in config file: ${path}`);
  }
  if (record.modelAliases !== undefined && !isStringMap(record.modelAliases)) {
    throw new Error(`modelAliases must be an object with string values in config file: ${path}`);
  }
  if (record.modelOverrides !== undefined && !isModelOverrides(record.modelOverrides)) {
    throw new Error(`modelOverrides contains invalid entries in config file: ${path}`);
  }
  return record as ConfigLayer;
}

export function readConfigFile(path: string, project = false): ConfigLayer | undefined {
  if (!existsSync(path)) return undefined;
  return validateLayer(JSON.parse(readFileSync(path, "utf8")), path, project);
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function envLayer(env: NodeJS.ProcessEnv): ConfigLayer {
  const modelsDevEnabled = parseBoolean(env.PI_OPENCODEX_MODELS_DEV_ENABLED);
  const fallback = env.PI_OPENCODEX_METADATA_FALLBACK_PROVIDER?.trim();
  return {
    ...(env.PI_OPENCODEX_PROVIDER_NAME ? { providerName: env.PI_OPENCODEX_PROVIDER_NAME } : {}),
    ...(env.PI_OPENCODEX_BASE_URL ? { baseUrl: env.PI_OPENCODEX_BASE_URL } : {}),
    ...(env.PI_OPENCODEX_MODEL_PREFIX !== undefined ? { modelPrefix: env.PI_OPENCODEX_MODEL_PREFIX } : {}),
    ...(modelsDevEnabled !== undefined ? { modelsDevEnabled } : {}),
    ...(fallback ? { metadataFallbackProvider: fallback.toLowerCase() === "none" ? null : fallback } : {}),
  };
}

function merge(base: OpenCodexProviderConfig, layer?: ConfigLayer): OpenCodexProviderConfig {
  if (!layer) return base;
  return {
    ...base,
    ...layer,
    modelAliases: { ...base.modelAliases, ...(layer.modelAliases ?? {}) },
    modelOverrides: { ...base.modelOverrides, ...(layer.modelOverrides ?? {}) },
  };
}

export function mergeConfigLayers(
  globalConfig?: ConfigLayer,
  projectConfig?: ConfigLayer,
  env: NodeJS.ProcessEnv = process.env,
): OpenCodexProviderConfig {
  const projectSafe: ConfigLayer | undefined = projectConfig ? {
    ...(projectConfig.metadataFallbackProvider !== undefined ? { metadataFallbackProvider: projectConfig.metadataFallbackProvider } : {}),
    ...(projectConfig.modelAliases ? { modelAliases: projectConfig.modelAliases } : {}),
    ...(projectConfig.modelOverrides ? { modelOverrides: projectConfig.modelOverrides } : {}),
  } : undefined;
  const merged = merge(merge(merge(DEFAULT_CONFIG, globalConfig), projectSafe), envLayer(env));
  return {
    ...merged,
    providerName: merged.providerName.trim() || DEFAULT_CONFIG.providerName,
    baseUrl: merged.baseUrl.replace(/\/+$/, ""),
    metadataFallbackProvider: merged.metadataFallbackProvider?.trim().toLowerCase() === "none"
      ? null
      : merged.metadataFallbackProvider,
  };
}

export function loadConfig(cwd: string, env: NodeJS.ProcessEnv = process.env): OpenCodexProviderConfig {
  return mergeConfigLayers(
    readConfigFile(globalConfigPath()),
    readConfigFile(projectConfigPath(cwd), true),
    env,
  );
}

export function writeConfigFile(path: string, config: ConfigLayer): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
