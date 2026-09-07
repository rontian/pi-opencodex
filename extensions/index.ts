import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.ts";
import { registerOpenCodexCommand } from "../src/commands.ts";
import { ocxReady } from "../src/ocx-cli.ts";
import {
  buildUnavailableProviderModels,
  ProviderCatalog,
  ProviderRuntime,
} from "../src/provider.ts";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(extensionDir);
const bundledModelsDevPath = join(packageRoot, "data", "models-dev-fallback.json");

export default async function (pi: ExtensionAPI) {
  let config = DEFAULT_CONFIG;
  let runtime: ProviderRuntime | undefined;
  let catalog: ProviderCatalog | undefined;

  try {
    config = loadConfig(process.cwd());
    catalog = new ProviderCatalog(config, { bundledModelsDevPath });
    runtime = new ProviderRuntime({ pi, config, catalog });
    registerOpenCodexCommand(pi, runtime, catalog);
    const initial = await runtime.start();

    const ready = await ocxReady();
    if (!ready.ok) return;

    let firstRunModelsLoaded = false;
    if (initial.availableModels.length === 0) {
      const firstRun = await runtime.refresh("models", "background");
      firstRunModelsLoaded = firstRun.models.updated;
      if (firstRun.models.error) {
        console.warn("[pi-opencodex] first-run OpenCodex model discovery failed; placeholder provider remains until refresh succeeds");
      }
    }

    void (async () => {
      const result = await runtime!.refresh(firstRunModelsLoaded ? "metadata" : "all", "background");
      if (result.models.error || result.metadata.error) {
        console.warn("[pi-opencodex] background refresh retained cached or bundled data after a refresh failure");
      }
    })();
  } catch (error) {
    registerOpenCodexCommand(pi, runtime, catalog);
    pi.registerProvider(config.providerName, {
      name: `OpenCodex (${config.providerName})`,
      baseUrl: config.baseUrl,
      api: "openai-completions",
      apiKey: "opencodex-loopback",
      authHeader: false,
      models: buildUnavailableProviderModels(),
    });
    console.warn(`[pi-opencodex] registered placeholder provider after startup failure: ${error instanceof Error ? error.message : String(error)}`);
  }
}
