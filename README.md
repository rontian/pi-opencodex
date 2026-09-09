# pi-opencodex

Pi provider package for a local [OpenCodex](https://github.com/lidge-jun/opencodex) proxy.

It keeps the same model-discovery pattern that made `0xRichardH/pi-cliproxyapi-provider` useful:

1. OpenCodex `GET /v1/models` is the source of **available model IDs**.
2. `models.dev` is the source of **context/output limits, reasoning, modalities, and cost metadata**.
3. The package enriches the available OpenCodex models and registers them dynamically with Pi.
4. The model ID sent to OpenCodex is never changed by metadata matching.

The metadata-enrichment architecture and substantial implementation ideas are derived from
[`0xRichardH/pi-cliproxyapi-provider`](https://github.com/0xRichardH/pi-cliproxyapi-provider), MIT licensed.

## Why

OpenCodex routed models commonly look like:

```text
rontian/glm-5.3-flash
rontian/deepseek-v4-pro
```

The `rontian/` portion is an OpenCodex routing namespace, not the canonical model name used for metadata lookup. `pi-opencodex` therefore keeps:

```text
inference id:      rontian/glm-5.3-flash
metadata lookup:   glm-5.3-flash
```

The default metadata-only prefix is `rontian/`. It is configurable and can be disabled.

## Requirements

- Pi >= 0.84
- Node.js >= 22
- OpenCodex installed locally and available as `ocx`
- OpenCodex running on its configured endpoint (default `http://127.0.0.1:10100/v1`)

OpenCodex remains a separate local process. This package does not embed or reimplement OpenCodex protocol translation.

## Install from Git

```bash
pi install git:github.com/rontian/pi-opencodex@main
```

No npm or pi.dev publication is required.

## Defaults

```json
{
  "providerName": "opencodex",
  "baseUrl": "http://127.0.0.1:10100/v1",
  "modelPrefix": "rontian/",
  "modelsDevEnabled": true,
  "metadataFallbackProvider": "openrouter",
  "contextWindowCap": 272000,
  "modelAliases": {},
  "modelOverrides": {}
}
```

Global config path:

```text
~/.pi/agent/pi-opencodex/config.json
```

Project metadata-only overrides are supported at:

```text
<project>/.pi/pi-opencodex/config.json
```

Project config can only change `metadataFallbackProvider`, `modelAliases`, and `modelOverrides`; connection identity and the global context-window policy remain user-level.

Environment overrides:

```text
PI_OPENCODEX_PROVIDER_NAME
PI_OPENCODEX_BASE_URL
PI_OPENCODEX_MODEL_PREFIX
PI_OPENCODEX_MODELS_DEV_ENABLED
PI_OPENCODEX_METADATA_FALLBACK_PROVIDER
```

## Working context window

`models.dev` still provides the model's physical context limit, but very large physical windows are not used as Pi's default working window. By default, the registered Pi `contextWindow` is:

```text
min(models.dev physical context, contextWindowCap)
```

The default `contextWindowCap` is `272000` tokens. With Pi's default `reserveTokens = 16384`, automatic compaction starts at roughly `255616` tokens instead of letting a long-running Agent session grow toward a 1M-token physical limit.

Change the global cap in `~/.pi/agent/pi-opencodex/config.json` when a different working window is desired:

```json
{
  "contextWindowCap": 512000
}
```

Set it to `null` to disable the global cap and register the physical model context from metadata:

```json
{
  "contextWindowCap": null
}
```

A per-model `modelOverrides.<model>.contextWindow` is applied after the global cap. This remains the explicit escape hatch for correcting metadata or opting a specific model/project into a larger working window without raising the default for every model.

## Prefix behavior

With the default configuration:

```text
OpenCodex id                  metadata lookup id
rontian/glm-5.3-flash    ->   glm-5.3-flash
rontian/kimi-k3           ->   kimi-k3
gpt-5.6-sol               ->   gpt-5.6-sol
```

Only a leading configured prefix is removed. The registered Pi model still uses the original OpenCodex ID, so routing remains intact.

To use another OpenCodex route namespace:

```json
{
  "modelPrefix": "another-provider/"
}
```

To disable prefix stripping:

```json
{
  "modelPrefix": ""
}
```

## Commands

```text
/opencodex status
/opencodex start
/opencodex refresh
/opencodex refresh models
/opencodex refresh metadata
/opencodex aliases
/opencodex config
/opencodex help
```

`status` uses `ocx ready --json` and `ocx status --json` for OpenCodex lifecycle diagnostics.

`start` invokes `ocx start`, waits for readiness, then refreshes the Pi provider. OpenCodex itself synchronizes provider models during `ocx start`, so the package does not run a second `ocx sync` in this path.

The three refresh forms have intentionally different scopes:

| Command | `ocx sync` | `GET /v1/models` | models.dev |
| --- | --- | --- | --- |
| `/opencodex refresh` | yes | yes | yes |
| `/opencodex refresh models` | yes | yes | no |
| `/opencodex refresh metadata` | no | no | yes |

For model or full refresh, the package first runs `ocx sync`, waits for OpenCodex readiness, then reloads `/v1/models` and republishes the dynamic Pi provider. Metadata-only refresh updates the models.dev catalog without touching OpenCodex provider discovery.

Startup/background refresh and Pi's provider `refreshModels` hook intentionally do **not** run `ocx sync`. Ordinary Pi startup always registers the provider from local cache/bundled data first, then may refresh the current local OpenCodex `/v1/models` catalog. `models.dev` is not fetched on every Pi startup: metadata refresh is freshness-gated to at most one background attempt per 24 hours across Pi processes. Background refresh failures are silent because the already-registered cache/bundled snapshot remains usable. Use an explicit `/opencodex refresh` or `/opencodex refresh metadata` when you want an immediate metadata refresh with visible success/failure details.

## Metadata matching

The package follows the matching approach from `0xRichardH/pi-cliproxyapi-provider`:

```text
explicit alias
-> exact id
-> owner prefix
-> suffix
-> normalized suffix
-> configured fallback provider (default: openrouter)
```

An alias only affects metadata lookup. It never changes the model ID sent to OpenCodex.

Example:

```json
{
  "modelAliases": {
    "rontian/glm-5.3-flash": "zhipuai/glm-5.3-flash"
  }
}
```

## Cache and bundled metadata

Runtime snapshots are local-only under:

```text
~/.cache/pi-opencodex/
```

The package caches the last successful OpenCodex model list and models.dev catalog. It also stores a small local timestamp for the last automatic models.dev refresh attempt, so multiple Pi processes do not all retry the same external metadata request on startup. When no local models.dev cache exists it loads the committed `data/models-dev-fallback.json` snapshot, so metadata enrichment does not depend on models.dev being reachable during startup.

A successful models.dev cache younger than 24 hours is used without any startup network request. If metadata is stale, bundled, or missing, startup may make one opportunistic background refresh attempt per 24 hours. If that request fails, Pi keeps using the existing cache or bundled fallback and does not write a warning into the TUI. Manual `/opencodex refresh` and `/opencodex refresh metadata` bypass this background cadence and continue to report concrete errors to the user.

If no OpenCodex model cache exists and `ocx ready --json` succeeds, first-run startup synchronously discovers the local `/v1/models` list before returning from extension initialization. Later startup/background refreshes may read the current OpenCodex catalog without running `ocx sync`; explicit `/opencodex refresh` commands provide the upstream discovery path when needed.

Refresh the committed models.dev snapshot with:

```bash
npm run update:models-dev
```

Check whether it matches the current upstream catalog without writing it:

```bash
npm run update:models-dev -- --check
```

## Development

### Static checks

```bash
npm install
npm run check
```

`npm run check` runs TypeScript type checking and the Node test suite. These tests cover config parsing, route-prefix stripping, metadata matching, context-window policy, bundled metadata fallback behavior, startup metadata freshness/backoff policy, and explicit refresh/catalog-sync semantics.

### Run the local checkout directly in Pi

Pi can load a package directly from a local directory without copying or publishing it. For an isolated extension smoke test, disable auto-discovered extensions and explicitly load this checkout:

```bash
pi -ne -e /absolute/path/to/pi-opencodex \
  --provider opencodex \
  --model 'rontian/glm-5.3-flash'
```

This is the preferred development loop when a Git-installed `pi-opencodex` may already exist globally, because `-ne` prevents the installed copy from being auto-loaded while `-e` loads the checkout under test.

Inside Pi verify:

```text
/opencodex status
/opencodex aliases
/opencodex refresh
/model
```

A non-interactive end-to-end model smoke test can be run with:

```bash
pi -ne -e /absolute/path/to/pi-opencodex \
  --provider opencodex \
  --model 'rontian/glm-5.3-flash' \
  --no-session \
  -p '只回复 OK'
```

To inspect the dynamically registered model catalog and its metadata:

```bash
pi -ne -e /absolute/path/to/pi-opencodex --list-models opencodex
```

For protocol/tool-call compatibility, also run a real prompt that requires one harmless Pi tool call, for example asking the model to run `pwd` and report the directory. That exercises the Pi -> pi-opencodex -> OpenCodex -> upstream round trip beyond a text-only completion.

After editing the local package, restart the smoke-test Pi process for the most deterministic reload behavior.
