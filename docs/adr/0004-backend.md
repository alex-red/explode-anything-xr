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

## Revisit trigger

User-imported repos (P2+), which would need server-side indexing.
