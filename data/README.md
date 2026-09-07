# Bundled models.dev snapshot

Place the committed models.dev fallback snapshot at:

```text
data/models-dev-fallback.json
```

Generate or refresh it with:

```bash
npm run update:models-dev
```

Startup metadata precedence is:

```text
valid local cache
-> bundled data/models-dev-fallback.json
-> empty/default metadata until a network refresh succeeds
```

The bundled snapshot is intentionally committed because `models.dev` may be unreachable on a new machine or during a network outage. A successful online metadata refresh is stored under `~/.cache/pi-opencodex/` and takes precedence on subsequent starts.
