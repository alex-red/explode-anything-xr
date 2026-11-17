# EXPLODE tutor proxy (Node server)

The only server in EXPLODE ([ADR-0004](../../docs/adr/0004-backend.md)). It turns one tutor turn into one structured model call and returns a validated plan. The provider is Anthropic (Claude) by default, or Meta's Model API with `TUTOR_PROVIDER = "meta"` (see [Providers](#providers)). **The app never depends on it.** The client defaults to the scripted tutor and falls back to it whenever this proxy is slow, down, capped or killed.

## API

`POST /v1/tutor/turn`: the request body is a `TutorTurnRequest` (`packages/contracts/src/tutor.ts`).

```json
{
  "system_id": "repo-demo",
  "revision": "<graph.revision.value of the bundle the client has>",
  "trigger": "explain_selection | why_failed | what_depends | hint | free_text",
  "selected_id": "node id or null",
  "lesson_id": "lesson id or null",
  "step_id": "step id or null",
  "broken_edge_ids": ["edge ids unplugged in the sandbox"],
  "recent_events": [{ "type": "unplug", "edge_id": "..." }],
  "free_text": "optional, at most 300 characters"
}
```

The response is a `TutorTurnResponse`:

```json
{
  "plan": {
    "say": "One or two short sentences.",
    "claim_status": "observed | static_verified | authored_model | inferred | unknown",
    "evidence_ids": ["ids that exist in the bundle"],
    "actions": [{ "type": "highlight_path", "path_id": "..." }],
    "abstain": false
  },
  "source": "live | scripted",
  "model": "claude-haiku-5-5"
}
```

When the answer is scripted, the `x-tutor-fallback` header gives the reason: `kill_switch`, `no_api_key`, `daily_cap`, `timeout`, `http_error`, `network`, `refusal`, `max_tokens`, `bad_output` or `invalid_plan`. The client must still re-validate every plan with `validateTutorPlan` before running any action.

Status codes:

| Code | Meaning |
|---|---|
| 400 | Invalid JSON or request |
| 403 | Origin not allowed |
| 404 | Unknown system |
| 409 | Revision mismatch (the response includes `expected`) |
| 413 | Body over 16 KB |
| 429 | Rate limited (`retry-after: 600`) |

`POST /v1/tutor/transcribe`: the body is one spoken question as a WAV file (mono, 16-bit PCM, 16 kHz, at most 12 s). The response is `{ "text": "…" }`, from Meta's `muse-voice-transcribe-1.0` with `META_API_KEY`. 400 if it is not a WAV, 413 if too long, 429 over the rate limit or the daily voice cap, 502 if the upstream fails, 503 with no key or the kill switch on.

A `free_text` turn may also send `view` (what is on screen, including every button) and `history`; its plan may then carry `commands` ([ADR-0011](../../docs/adr/0011-tutor.md), note of Nov 12).

`GET /v1/health` returns `{ "ok": true, "version": "0.4.0", "killed": false, "provider": "anthropic", "model": "claude-haiku-5-5" }`.

## Providers

| `TUTOR_PROVIDER` | Call | Secret | Model setting (default) |
|---|---|---|---|
| `anthropic` (default) | `POST https://api.anthropic.com/v1/messages`, as below | `ANTHROPIC_API_KEY` | `TUTOR_MODEL` (`claude-haiku-5-5`) |
| `meta` | `POST https://api.meta.ai/v1/chat/completions` (OpenAI-compatible), `response_format` json_schema with `strict: true`, `reasoning_effort: low`, `max_completion_tokens: 4096` | `META_API_KEY` | `META_MODEL` (`muse-ember-1.0`) |

Both use the same system prompt, graph context, turn text, limits, validation and scripted fallback. The Meta request shape comes from Meta's docs (read Nov 11, 2026) and has **not** been run against the live API. Whether `reasoning_effort: low` is accepted, and the latency, are checked by the spike in [EXPLORE_PLAN.md](../../docs/EXPLORE_PLAN.md) W12 before the provider is switched on. Any error, including a 400, falls back to the scripted tutor.

## How a turn works

1. The request is validated with Zod and checked against the bundled `ContentBundle` (graph revision).
2. The prompt has three parts:
   - a static system prompt (prompt-cached);
   - the per-system graph context inside `<graph_data>` (prompt-cached);
   - the volatile turn text.

   Repository excerpts go inside `<untrusted_repository_data>` and learner text inside `<learner_question>`. Any tag-like text inside them is neutralized so it can't close the data block.
3. One non-streaming `POST https://api.anthropic.com/v1/messages` is made with `anthropic-version: 2023-06-01`, structured output (`output_config.format` json_schema, derived from the `TutorPlan` Zod schema and restricted to the tutor action allowlist), `effort: low` and a 5 s timeout.
4. The plan is validated server-side with `validateTutorPlan`, which checks the allowlist, that every id exists, and that the claim isn't stronger than its evidence. If anything fails, the response is the deterministic `scriptedTutorTurn`.

## Cost and abuse controls

The PWA URL is effectively public, so treat this endpoint as public too.

| Control | Setting |
|---|---|
| Origin allowlist | `ALLOWED_ORIGINS` (comma-separated). Other browser origins get 403. |
| Rate limit | 20 requests per 10 minutes per IP, fixed window, counted in memory (resets when the server restarts). Behind a reverse proxy set `TRUST_PROXY=1` so the caller's address is read from `x-forwarded-for`. |
| Daily spend cap | `DAILY_TOKEN_CAP` tokens per UTC day (default 2,000,000), counted from actual `usage`. Once exceeded, every answer is scripted. |
| Kill switch | `KILL_SWITCH=1` and a restart makes every answer scripted without calling the model, and turns voice off. |
| Daily voice cap | `DAILY_AUDIO_SECONDS_CAP` seconds of speech per UTC day (default 3600). |
| Per-address limit | `RATE_LIMIT_MAX` requests per 10 minutes per address, across tutor turns, transcriptions and proposals (default 20; a spoken question costs two). Raise it only for local capture, where retakes would otherwise fall back to the scripted guide. |
| Body limit | 16 KB |
| Secret handling | `ANTHROPIC_API_KEY` and `META_API_KEY` come from the server's environment. They are never logged or returned. |

## Running it

```sh
bun run proxy:dev        # from the repo root: Node 24, port 8787 (PORT to change), keys from .env
curl http://localhost:8787/v1/health
```

No build step and no platform account. Settings are environment variables: `ANTHROPIC_API_KEY`, `META_API_KEY`, `TUTOR_PROVIDER`, `TUTOR_MODEL`, `META_MODEL`, `ALLOWED_ORIGINS`, `DAILY_TOKEN_CAP`, `DAILY_AUDIO_SECONDS_CAP`, `RATE_LIMIT_MAX`, `EXPLODE_BUILDS_PER_DAY`, `KILL_SWITCH`, `TRUST_PROXY`, `PORT`. With only `META_API_KEY` set, turns go to Meta. `ALLOWED_ORIGINS` defaults to the app's dev server (port 8473); a deployment must set it to the hosted app's origin.

The server statically imports every bundle in `apps/quest/src/content/`, so run `bun run content:generate` first, and restart after any content change, or the client's revision will mismatch (409) and it will use the scripted tutor.

Where this runs for the submission is not decided ([ADR-0004](../../docs/adr/0004-backend.md), note of Nov 12). Whatever hosts it, keep it frozen from Nov 17 to Dec 11 ([ADR-0002](../../docs/adr/0002-distribution.md)); the kill switch is the only change allowed during judging.

## Tests

```sh
bunx vitest run services/tutor-proxy
```

Upstream is mocked, so the tests make no network calls.
