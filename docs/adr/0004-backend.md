# ADR-0004: Backend — none, except an optional tutor proxy

**Status:** Accepted, 2026-10-23

## Context

- The handoff's FastAPI service and nine endpoints are too much for one person, and they conflict with the offline requirement.
- The experiment engine must run on the client anyway.

## Decision

- The client is static and offline-first.
- The only server is **`services/tutor-proxy`**, a Cloudflare Worker exposing one POST endpoint. It:
  - calls the Anthropic Messages API (default model `claude-haiku-5-5`, configurable via env);
  - validates the plan server-side;
  - enforces a **per-IP rate limit**, a **daily spend cap** (KV counter), and a **`KILL_SWITCH`** env var;
  - restricts CORS to the app's origin.
- The API key is stored only as a Worker secret.

## Consequences

- The core experience never depends on the network.
- Proxy outages degrade to the scripted tutor ([ADR-0011](0011-tutor.md)).

## Note, 2026-11-11

`TUTOR_PROVIDER = "meta"` switches the upstream to Meta's Model API (OpenAI-compatible Chat Completions, default model `muse-ember-1.0`, key in the `META_API_KEY` secret). Everything above, including the limits, validation and fallback, applies unchanged. Anthropic stays the default until the latency spike in [EXPLORE_PLAN.md](../EXPLORE_PLAN.md) W12 passes.

## Note, 2026-11-12: a Node server, not a Worker

Decided by the owner on Nov 12: the proxy no longer depends on Cloudflare or wrangler. It is a plain Node server (`services/tutor-proxy/src/server.ts`, `bun run proxy:dev`) around the same handler, with keys and settings from the environment.

- The KV counters are now in memory: rate limits and the daily caps hold for one process and reset on restart.
- It gained `POST /v1/tutor/transcribe` for voice questions ([ADR-0015](0015-audio.md)), which uses `META_API_KEY`.
- With only `META_API_KEY` set, the server answers turns with the Meta provider.
- **Where it is hosted for the submission is undecided.** Any host that runs Node 24 and holds secrets will do; it must set `ALLOWED_ORIGINS` to the Pages origin, and `TRUST_PROXY=1` if it sits behind a reverse proxy.

## Revisit trigger

User-imported repos (P2+), which would need server-side indexing.
