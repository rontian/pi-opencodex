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

Project config can only change `metadataFallbackProvider`, `modelAliases`, and `modelOverrides`; connection identity remains user-level.

Environment overrides:

```text
PI_OPENCODEX_PROVIDER_NAME
PI_OPENCODEX_BASE_URL
PI_OPENCODEX_MODEL_PREFIX
PI_OPENCODEX_MODELS_DEV_ENABLED
PI_OPENCODEX_METADATA_FALLBACK_PROVIDER
```

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

`start` invokes `ocx start`, waits for readiness, then refreshes the Pi provider.

`refresh` checks OpenCodex readiness, reloads the OpenCodex model list, refreshes models.dev metadata, and republishes the dynamic Pi provider. Pi's own model refresh hook also refreshes the OpenCodex model list.

## Metadata matching

The package follows the matching approach from `0xRichardH/pi-cliproxyapi-provider`:

```text
explicit alias
-> exact id
-> owner prefix / owner hint
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

## Cache

Runtime snapshots are local-only under:

```text
~/.cache/pi-opencodex/
```

The package caches the last successful OpenCodex model list and models.dev catalog. Startup can register cached data immediately, then performs a short background refresh when `ocx ready --json` succeeds.

## Development

```bash
npm install
npm test
npm run typecheck
```
