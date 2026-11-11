# EXPLODE tutor proxy (Cloudflare Worker)

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

`GET /v1/health` returns `{ "ok": true, "version": "0.2.0", "killed": false, "provider": "anthropic", "model": "claude-haiku-5-5" }`.

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
| Rate limit | 20 requests per 10 minutes per IP (`cf-connecting-ip`), fixed window in KV. Without a KV binding, an in-memory counter per isolate. |
| Daily spend cap | `DAILY_TOKEN_CAP` tokens per UTC day (default 2,000,000), counted from actual `usage`. Once exceeded, every answer is scripted. |
| Kill switch | `KILL_SWITCH = "1"`, then `wrangler deploy`, makes every answer scripted without calling the model. |
| Body limit | 16 KB |
| Secret handling | `ANTHROPIC_API_KEY` and `META_API_KEY` are Worker secrets. They are never logged or returned. |

## Setup (run these yourself)

```sh
cd services/tutor-proxy
bunx wrangler login
bunx wrangler kv namespace create TUTOR_KV      # paste the id into wrangler.toml
bunx wrangler secret put ANTHROPIC_API_KEY
# set ALLOWED_ORIGINS in wrangler.toml to the PWA origin
bunx wrangler deploy
curl https://<worker>.workers.dev/v1/health
```

The worker statically imports `apps/quest/src/content/repo-demo.bundle.json` and `drivetrain.bundle.json`, so run `bun run content:generate` before deploying. Redeploy after any content change, or the client's revision will mismatch (409) and it will use the scripted tutor.

Keep the deployed version frozen from Nov 17 to Dec 11 ([ADR-0002](../../docs/adr/0002-distribution.md)). The kill switch is the only change allowed during judging.

## Tests

```sh
bunx vitest run services/tutor-proxy
```

Upstream is mocked, so the tests make no network calls.
