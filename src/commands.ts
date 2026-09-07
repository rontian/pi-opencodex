import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_CONFIG,
  globalConfigPath,
  loadConfig,
  readConfigFile,
  writeConfigFile,
  type ConfigLayer,
} from "./config.ts";
import type {
  CatalogRefreshResult,
  CatalogSnapshot,
  ProviderCatalog,
  ProviderRuntime,
  RefreshTarget,
  SourceRefreshResult,
} from "./provider.ts";
import { ocxReady, ocxStart, ocxStatus, waitForOcxReady } from "./ocx-cli.ts";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function age(timestamp?: number): string {
  if (timestamp === undefined) return "missing";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

function capabilityCount(snapshot: CatalogSnapshot, capability: "reasoning" | "image"): number {
  return snapshot.built.models.filter((model) => capability === "reasoning"
    ? model.reasoning
    : model.input.includes("image")).length;
}

function refreshPart(label: string, result: SourceRefreshResult): string {
  if (!result.attempted) return `${label}: not requested`;
  if (result.error) return `${label}: failed (${errorText(result.error)}); retained previous snapshot`;
  return `${label}: ${result.changed ? "updated" : "unchanged"}`;
}

function parseRefreshTarget(value: string | undefined): RefreshTarget | undefined {
  if (!value || value === "all") return "all";
  if (value === "models") return "models";
  if (value === "metadata") return "metadata";
  return undefined;
}

function statusText(config: ReturnType<typeof loadConfig>, snapshot: CatalogSnapshot): string {
  const metadataAge = snapshot.metadataUpdatedAt ? `, ${age(snapshot.metadataUpdatedAt)}` : "";
  return [
    `OpenCodex provider: ${config.providerName}`,
    `Base URL: ${config.baseUrl}`,
    `Metadata prefix strip: ${config.modelPrefix ? JSON.stringify(config.modelPrefix) : "disabled"}`,
    `Models: ${snapshot.built.stats.total} (${snapshot.built.stats.enriched} enriched, ${snapshot.built.stats.unmatched} unmatched)`,
    `Reasoning models: ${capabilityCount(snapshot, "reasoning")}`,
    `Image-capable models: ${capabilityCount(snapshot, "image")}`,
    `OpenCodex model snapshot: ${age(snapshot.modelsUpdatedAt)}`,
    `models.dev metadata: ${snapshot.metadataSource}${metadataAge}`,
  ].join("\n");
}

function summarizeOcx(label: string, result: Awaited<ReturnType<typeof ocxReady>>): string {
  if (result.ok) return `${label}: ok${result.stdout ? `\n${result.stdout}` : ""}`;
  return `${label}: failed (${result.error ?? result.stderr ?? "unknown error"})`;
}

async function requireReady(ctx: ExtensionCommandContext): Promise<boolean> {
  const ready = await ocxReady();
  if (ready.ok) return true;
  ctx.ui.notify([
    "OpenCodex is not ready.",
    ready.error ?? ready.stderr ?? "ocx ready failed",
    "Run /opencodex start or start OpenCodex manually with `ocx start`.",
  ].join("\n"), "warning");
  return false;
}

export async function runConfig(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/opencodex config requires an interactive UI.", "warning");
    return;
  }

  let current = DEFAULT_CONFIG;
  try {
    current = loadConfig(ctx.cwd);
  } catch (error) {
    ctx.ui.notify(`Existing pi-opencodex config is invalid; using defaults for repair: ${errorText(error)}`, "warning");
  }

  const path = globalConfigPath();
  let existing: ConfigLayer | undefined;
  try {
    existing = readConfigFile(path);
  } catch (error) {
    ctx.ui.notify(`Existing global config is invalid and will be replaced if saved: ${errorText(error)}`, "warning");
  }
  const defaults = { ...current, ...existing };

  const providerName = await ctx.ui.input(
    `Provider name (blank keeps ${defaults.providerName})`,
    defaults.providerName,
  );
  if (providerName === undefined) return;
  const baseUrl = await ctx.ui.input(
    `OpenCodex base URL (blank keeps ${defaults.baseUrl})`,
    defaults.baseUrl,
  );
  if (baseUrl === undefined) return;
  const modelPrefix = await ctx.ui.input(
    `Model prefix stripped only for metadata lookup (blank disables; current ${JSON.stringify(defaults.modelPrefix)})`,
    defaults.modelPrefix,
  );
  if (modelPrefix === undefined) return;

  writeConfigFile(path, {
    ...existing,
    providerName: providerName.trim() || defaults.providerName,
    baseUrl: baseUrl.trim() || defaults.baseUrl,
    modelPrefix,
  });

  ctx.ui.notify(`Saved pi-opencodex config to ${path}. Reloading Pi...`, "info");
  await ctx.reload();
}

const HELP = [
  "OpenCodex provider commands:",
  "  /opencodex status            Show ocx and provider/catalog status",
  "  /opencodex start             Start OpenCodex with `ocx start`, then refresh",
  "  /opencodex refresh           Refresh OpenCodex models and models.dev metadata",
  "  /opencodex refresh models    Refresh OpenCodex models only",
  "  /opencodex refresh metadata  Refresh models.dev metadata only",
  "  /opencodex aliases           Show unmatched model IDs and metadata IDs",
  "  /opencodex config            Configure provider base URL/name/model prefix",
  "  /opencodex help              Show this help",
].join("\n");

export function argumentCompletions(prefix: string): Array<{ value: string; label: string }> {
  return ["status", "start", "refresh", "refresh models", "refresh metadata", "aliases", "config", "help"]
    .filter((item) => item.startsWith(prefix))
    .map((value) => ({ value, label: value }));
}

async function notifyRefresh(ctx: ExtensionCommandContext, result: CatalogRefreshResult): Promise<void> {
  const level = result.models.error || result.metadata.error ? "warning" : "info";
  ctx.ui.notify([
    "pi-opencodex refresh complete.",
    refreshPart("OpenCodex models", result.models),
    refreshPart("models.dev metadata", result.metadata),
    `Registered: ${result.snapshot.built.stats.total} models, ${result.snapshot.built.stats.enriched} enriched, ${result.snapshot.built.stats.unmatched} unmatched.`,
  ].join("\n"), level);
}

export function registerOpenCodexCommand(pi: ExtensionAPI, runtime?: ProviderRuntime, catalog?: ProviderCatalog): void {
  pi.registerCommand("opencodex", {
    description: "Inspect, start, configure, and refresh the OpenCodex Pi provider.",
    getArgumentCompletions(prefix) {
      return argumentCompletions(prefix);
    },
    async handler(args, ctx) {
      const commandArgs = args.trim();
      const [subcommand, option] = commandArgs ? commandArgs.split(/\s+/) : ["help"];

      if (subcommand === "help") {
        ctx.ui.notify(HELP, "info");
        return;
      }
      if (subcommand === "config") {
        await runConfig(ctx);
        return;
      }
      if (!["status", "start", "refresh", "aliases"].includes(subcommand)) {
        ctx.ui.notify(`${HELP}\n\nUnknown command: ${subcommand}`, "warning");
        return;
      }
      if (!runtime || !catalog) {
        ctx.ui.notify("pi-opencodex provider runtime is unavailable. Check the config and reload Pi.", "error");
        return;
      }

      const config = loadConfig(ctx.cwd);
      if (subcommand === "status") {
        const [ready, status] = await Promise.all([ocxReady(), ocxStatus()]);
        const snapshot = catalog.current() ?? await catalog.load();
        ctx.ui.notify([
          summarizeOcx("ocx ready", ready),
          summarizeOcx("ocx status", status),
          "",
          statusText(config, snapshot),
        ].join("\n"), ready.ok ? "info" : "warning");
        return;
      }

      if (subcommand === "start") {
        const started = await ocxStart();
        if (!started.ok) {
          ctx.ui.notify(`Failed to start OpenCodex: ${started.error ?? started.stderr}`, "error");
          return;
        }
        const ready = await waitForOcxReady();
        if (!ready.ok) {
          ctx.ui.notify(`OpenCodex start returned successfully but readiness failed: ${ready.error ?? ready.stderr}`, "warning");
          return;
        }
        const result = await runtime.refresh("all", "manual");
        await notifyRefresh(ctx, result);
        return;
      }

      if (subcommand === "refresh") {
        const target = parseRefreshTarget(option);
        if (!target) {
          ctx.ui.notify("Usage: /opencodex refresh [models|metadata]", "warning");
          return;
        }
        if (target !== "metadata" && !(await requireReady(ctx))) return;
        const result = await runtime.refresh(target, "manual");
        await notifyRefresh(ctx, result);
        return;
      }

      const snapshot = catalog.current() ?? await catalog.load();
      if (snapshot.built.stats.unmatched === 0) {
        ctx.ui.notify("All OpenCodex models matched models.dev metadata.", "info");
        return;
      }
      const rows = snapshot.availableModels
        .filter((model) => snapshot.built.stats.unmatchedModelIds.includes(model.id))
        .slice(0, 40)
        .map((model) => `  ${model.id} -> ${model.metadataId}`);
      ctx.ui.notify([
        `Unmatched OpenCodex models (${snapshot.built.stats.unmatched}):`,
        ...rows,
        "",
        `Configure aliases in ${globalConfigPath()} as modelAliases, keyed by either the routed ID or stripped metadata ID.`,
      ].join("\n"), "warning");
    },
  });
}
