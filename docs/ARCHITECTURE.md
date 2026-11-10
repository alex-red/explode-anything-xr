# EXPLODE — Architecture (v2)

**Supersedes:** handoff §8, §9, §10, §12, §14 · **Related ADRs:** [0001](adr/0001-engine.md)–[0020](adr/0020-testing.md)

---

## 1. Overview

```
BUILD TIME (Mac, Node 24)                            RUNTIME (Quest Browser PWA, offline-first)
content/repo-demo/fixture @ tree hash┐               ┌─ renderer (IWSDK 1.0.1 / three.js)
  tools/indexer (ts-morph) → graph   │               │    nodes, tube edges, CanvasTexture labels/panels
  node --test + NODE_V8_COVERAGE     ├─▶ ContentBundle├─ input: ray+select, two-hand pinch-pull, buttons
     → test_run evidence (observed)  │   (*.bundle.json│
  mutation runs → mutation_run       │    statically   ├─ @explode/lesson-engine
content/drivetrain spec (authored)  ─┘    imported)    │    reduce() · propagation · step machine
  tools/content: layout, lessons,                     ├─ validateTutorPlan() ◀── tutor plan
  hash, integrity check                               │        ▲ scriptedTutorTurn() (default/fallback)
                                                      └─ optional fetch ──▶ services/tutor-proxy
                                                                            (Cloudflare Worker → Anthropic API)
```

**Principles:**

- **No backend in the critical path.** The client is static and offline-first.
- **One language.** TypeScript everywhere.
- **Contracts first.** Zod 4 is the single source of truth.
- **The engine is a pure function of the event log**, so it is deterministic, replayable and undoable.
- **Evidence is recorded at build time**, never claimed live.

## 2. Repository layout

```
apps/quest/                 IWSDK 1.0.1 app (Vite). iwsdk.config.json is the project authority
  src/content/              drivetrain.bundle.json, repo-demo.bundle.json (generated, committed)
packages/contracts/         Zod schemas + canonicalJson + checkBundleIntegrity
packages/lesson-engine/     createContext, reduce/replay/undo, computeConsequence,
                            validateTutorPlan, scriptedTutorTurn
tools/indexer/              ts-morph indexer → SystemGraph + source_range evidence
tools/content/              generate.ts (pipeline), check.ts, layout, lessons, evidence runners
services/tutor-proxy/       Cloudflare Worker: POST tutor turn → validated TutorPlan
content/repo-demo/fixture/  sample auth-service (MIT, written for this demo; ADR-0018)
content/drivetrain/         authored drivetrain spec (procedural parts; ADR-0019)
docs/                       this tree
```

Root scripts:

| Script | What it does |
|---|---|
| `npm test` | Vitest over the packages, tools and services |
| `npm run typecheck` | Typecheck |
| `npm run content:generate` | Regenerate the bundles |
| `npm run content:check` | Validate the bundles |

Packages export TypeScript source directly. Vite transforms it, and Node 24 runs it with type stripping. The syntax is therefore erasable-only: no enums, namespaces or parameter properties.

## 3. Truth contract

`TruthStatus` (`packages/contracts/src/truth.ts`):

| Status | Meaning | Produced by | UI badge |
|---|---|---|---|
| `observed` | A recorded run captured at build time | test_run / mutation_run evidence | **Observed** (solid glyph + run record) |
| `static_verified` | Relation found in source by the indexer | source_range evidence | **In source** (path:line) |
| `authored_model` | Designer-validated teaching model, not measured reality | authored_rule evidence (drivetrain) | **Teaching model** |
| `inferred` | Hypothesis | Breaks with no matching recording; tutor guesses | **Hypothesis** (dotted) |
| `unknown` | No reliable evidence | — | **Unknown** |

**Invariants:**

- They are enforced by `checkBundleIntegrity()` and `validateTutorPlan()`, using `TRUTH_RANK`.
- No claim may be stronger than its strongest cited evidence.
- Edges are never `observed`.
- A node is `observed` only when an `observed` evidence record backs it.

## 4. Contracts

All schemas live in `packages/contracts/src/`.

| Schema | Key fields |
|---|---|
| `Evidence` (discriminated on `kind`) | `source_range` {source: path, start/end line, revision, excerpt, excerpt_sha256} · `test_run` {run: RunRecord, executed_node_ids} · `mutation_run` {run, mutation: {id, edge_id, description, file, diff}} · `authored_rule` {rule} · `asset_license` {license} |
| `RunRecord` | command, node_version, recorded_at, exit_code, passed, failed, failing_tests, output_excerpt, output_sha256 |
| `SystemGraph` | schema_version `1.0`, system_id, system_kind `software`\|`mechanical`, display_name, revision {kind `git`\|`content_hash`, value}, nodes, edges, paths |
| `GraphNode` | id, kind (system/cluster/module/function/class/route/test/assembly/component), label, summary, parent_id, truth_status, evidence_ids, importance 0..1 |
| `GraphEdge` | id, source_id, target_id, relation (imports/calls/registers_route/handles/depends_on/powers/transmits), flows[], truth_status, evidence_ids, is_mutable_in_sandbox |
| `FlowPath` | id, label, flow (request/data/electrical/torque/control), ordered node_ids, edge_ids (edge i links node i to node i+1), truth_status, evidence_ids |
| `Layout` | anchor_distance, cone_deg {horizontal, vertical}, placements{nodeId: {collapsed, exploded, radius}} |
| `AssetManifest` | parts{nodeId: {shape box/cylinder/sphere/torus/gear, size, color, rotation_deg, spin_axis?}} |
| `Lesson` / `LessonStep` | steps with kind, caption, `expect` (next, explode_at_least, collapse_below, select, trace, unplug, predict, repair, open_evidence), on_enter actions, hint, feedback; the lesson also has break_edge_id, repair_candidates, misconception_on_wrong_prediction |
| `EngineEvent` | set_explode, select, trace, unplug, plug, predict, open_evidence, next, skip_lesson, reset, apply_action{origin, action}. `UNDOABLE_EVENTS` = set_explode, select, trace, unplug, plug |
| `SceneState` | explode_factor, selected/focus, isolated, highlighted, active path and flow animation, broken_edge_ids, consequences, prediction, evidence_open_id, annotation, question, feedback, misplug_count, misconceptions, lesson {id, step_index, status} |
| `Consequence` | edge_id, affected_ids, first_affected_id, truth_status, evidence_ids |
| `TutorTurnRequest` / `TutorPlan` / `TutorTurnResponse` | request: trigger, selected_id, lesson and step, broken edges, ≤10 recent events. Plan: say ≤400 chars, claim_status, evidence_ids ≤6, actions ≤4, abstain |
| `ContentBundle` | graph, evidence, layout, lessons, assets\|null, content_hash = sha256(canonicalJson(bundle minus content_hash and generated_at)), generated_at, generator |

## 5. Lesson engine

The engine lives in `packages/lesson-engine/src/`.

**Main functions:**

- `createContext(bundle)` builds read-only indexes: nodes, edges, paths, evidence, lessons, outgoing, incoming, children.
- `reduce(ctx, state, event)` is pure. It applies the event, then `advanceLesson()` checks the current step's `expect` and enters the next step, applying its `on_enter` actions. A step whose state-based expectation (`explode_at_least`, `unplug`) is already met on entry completes immediately, so a learner who acts early never dead-ends.
- `replay(ctx, events)` rebuilds state from the log. `undo(events)` drops the last undoable event, and the caller then replays.

**Event rules:**

- **Unplug** works only when `is_mutable_in_sandbox` is set. It computes the consequence on unplug.
- **Plug** restores the edge only if `target_id === edge.target_id`. Otherwise it increments `misplug_count` and gives feedback; after the second miss the feedback names the expected socket.
- **Predict** is correct if the node is in the consequence of the lesson's `break_edge_id`. A wrong prediction records the misconception tag.

**Propagation (`computeConsequence`, [ADR-0010](adr/0010-propagation.md)):**

- The affected nodes are those after the broken edge on every path containing it. If no path contains it, the edge's target is the only affected node.
- Truth of the consequence:
  - mechanical → `authored_model`;
  - software with a mutation_run for this edge where `failed > 0` → `observed`;
  - otherwise → `inferred`.

## 6. SceneAction allowlist

`SceneAction` (`actions.ts`):

| Action | Fields |
|---|---|
| `focus` | target_id |
| `isolate` | target_ids (1–12) |
| `explode` | factor |
| `collapse` | — |
| `highlight` | target_ids |
| `highlight_path` | path_id |
| `animate_flow` | path_id |
| `clear_highlight` | — |
| `show_evidence` | evidence_id |
| `show_annotation` | target_id, text (≤160 chars) |
| `ask_prediction` | question |
| `reset_experiment` | — |

**Who can use what:**

- Lessons may use every action.
- **The tutor** is limited to `TUTOR_ACTION_TYPES`: every action *except* `reset_experiment`, capped at `MAX_TUTOR_ACTIONS = 4`.
- No action breaks or repairs an edge, or passes, fails or advances a lesson. Only learner events (`unplug`, `plug`, `predict`, `next`) and the engine do that.

**Never allowed:** scripts, shell commands, file paths, shaders, or object creation from text.

**Validation (`validateTutorPlan`):**

- The plan must parse against the Zod schema.
- Every action must be in the allowlist.
- Every node, path and evidence id must exist.
- `claim_status` must be supported by the cited evidence, unless the plan abstains.
- **Any error rejects the whole plan**, and the client falls back to `scriptedTutorTurn`.

## 7. Build-time content pipeline

`npm run content:generate` (tools/content) writes `apps/quest/src/content/{drivetrain,repo-demo}.bundle.json`. The app imports both statically, so they are bundled and precached.

**Repo pipeline:**

1. **Index** `content/repo-demo/fixture` with ts-morph ([ADR-0006](adr/0006-indexer.md)). It produces:
   - modules, exported functions/classes and route registrations as nodes;
   - `imports` and resolvable `calls` edges, plus route/middleware adapter edges, all `static_verified` with `source_range` evidence;
   - clusters from directories.

   IDs are deterministic.
2. **Baseline run.** `node --test` with `NODE_V8_COVERAGE` produces one `test_run` evidence record. Its `executed_node_ids` are the function nodes whose ranges executed, and those nodes may become `observed`.
3. **Mutations.** 2–3 mutation specs: each stubs one dependency in a temp copy, reruns the tests, and records the failing tests. The result is `mutation_run` evidence keyed by `edge_id` ([ADR-0007](adr/0007-evidence.md)).
4. **Layout.** A deterministic layout fits clusters within the 60°×50° cone ([ADR-0014](adr/0014-layout-cone.md)).
5. **Lessons and hashing.** The lessons are authored, then the bundle gets its `content_hash`, then `ContentBundle.parse` and `checkBundleIntegrity()` must both pass, or the pipeline fails.

**Drivetrain pipeline:**

- The spec is authored JSON (parts, procedural shapes, `powers`/`transmits` edges, electrical and torque paths).
- Every edge is `authored_model` with `authored_rule` evidence.
- The revision is a `content_hash` ([ADR-0008](adr/0008-versioning.md)).

## 8. Tutor

[ADR-0011](adr/0011-tutor.md)

**Turn flow:**

1. A chip fires a trigger.
2. The client builds a `TutorTurnRequest`.
3. If `VITE_TUTOR_URL` is set and the network is up, the client POSTs to the proxy with a **6 s timeout**.
4. Otherwise, on a timeout, or on an invalid plan, it uses `scriptedTutorTurn(ctx, state, req)`, which is deterministic and built only from graph facts.
5. Every plan, live or scripted, passes `validateTutorPlan` before any action runs. Actions run as `apply_action{origin:'tutor'}` events.

**Proxy (`services/tutor-proxy`, Cloudflare Worker):**

- Calls the Anthropic Messages API. The model defaults to `claude-haiku-5-5` and can be set through env.
- The structured-output schema comes from `tutorPlanJsonSchema()`.
- The system prompt includes the whole small graph (no RAG) and treats repo text as untrusted data.
- The proxy validates the plan server-side too.
- Controls: a per-IP rate limit, a daily spend cap (KV counter), and a `KILL_SWITCH` env var.
- No secrets live in the client.

## 9. Threat model and controls

| Threat | Control |
|---|---|
| Prompt injection in repo comments | Repo text is data in the prompt; the plan is schema- and allowlist-validated twice; the tutor can't mutate state beyond display actions |
| The LLM invents ids, lines or test results | Unknown ids reject the plan; claim_status is checked against evidence rank; evidence is built only at build time |
| Abuse of the public proxy URL | Rate limit, daily spend cap, kill switch, CORS restricted to the app origin |
| API key leak | Key lives only in a Worker secret; the client has no keys |
| Executing untrusted code | Only the pinned, self-authored fixture's tests run, at build time on the dev machine; nothing runs at runtime |
| Asset or license problems in a public PWA | Procedural geometry only ([ADR-0019](adr/0019-assets.md)); provenance in [DATA_PROVENANCE.md](DATA_PROVENANCE.md) |
| Post-deadline changes | Immutable versioned deploy path; daily hash check ([ADR-0002](adr/0002-distribution.md)) |
| Privacy | No accounts, no analytics in P0; the local event log only (localStorage); proxy requests contain graph ids and no personal data |
