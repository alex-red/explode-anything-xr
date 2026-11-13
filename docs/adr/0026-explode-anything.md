# ADR-0026: Explode Anything — systems built on request, behind a proposal the learner confirms

**Status:** Proposed, 2026-11-13 (draft; not accepted, nothing built) · **Builds on:** [ADR-0004](0004-backend.md), [ADR-0007](0007-evidence.md), [ADR-0011](0011-tutor.md), [ADR-0025](0025-real-repo-relevance.md) · **Plan:** [ANYTHING_PLAN.md](../ANYTHING_PLAN.md)

## Context

- The app opens five systems, all built ahead of time and served as static files.
- [ADR-0025](0025-real-repo-relevance.md) built the pipeline that draws a real repository from its most relevant parts, for one repository, with three hand-made inputs.
- [ADR-0004](0004-backend.md) names this case as its revisit trigger: "User-imported repos (P2+), which would need server-side indexing."
- A learner may also ask for a subject nobody authored ("Mars"). Only a model can draft that on request, and what a model says is not evidence ([ADR-0007](0007-evidence.md)).

## Decision (proposed)

1. **One flow for every request: plan, research, proposal, build.** Research is read-only and cheap. Nothing expensive starts until the learner presses Build on a card that says what will be created, what will not, how it is labelled, and how long it should take.
2. **Two builders, both on the server** (`services/tutor-proxy`):
   - **Repository:** a public GitHub repository at one commit, downloaded, indexed by the ts-morph indexer and drawn as in ADR-0025. TypeScript and JavaScript only. Its code is never installed or run.
   - **Subject:** a model returns parts, connections, one path and one break in a fixed schema. The server computes the layout and builds the lesson from a template.
3. **Truth statuses:**
   - repository parts, connections and the traced path are `static_verified` and cite source lines; groups are `inferred`; nothing is `observed`; no connection is sandbox-mutable;
   - in a subject model every node, edge and path is `inferred`, cites no evidence and shows the hypothesis glyph. It is never `authored_model`;
   - no new truth status is added.
4. **Sources of a subject model** are the pages the server fetched during research, recorded by the server and shown as "what the model read". They are not per-claim evidence.
5. **The time estimate is computed from measured rates** and shown as a range, or as "unknown". It is never chosen by a model.
6. **The assistant gets one new command, `propose_system`**, on `free_text` turns only. It opens the proposal. Build and Cancel are ordinary buttons that go through the same handlers as a hand.
7. **Every created bundle passes `checkBundleIntegrity` = `[]`** on the server and again in the app before it opens.
8. **The app is whole without the server.** With the proxy unreachable the entry points are hidden or say why.

## Consequences

- The proxy stops being optional for this feature and must be hosted. **Decided by the owner on Nov 13: Render**, running the same plain Node server as local development, with nothing host-specific in the code. It gains job state, a download step and a parse step, each with limits.
- The static, frozen entry ([ADR-0002](0002-distribution.md)) now shows content that was not in the release manifest. The manifest still covers every shipped file; created bundles are outside it by nature, and the entry text must say so.
- A subject model can be wrong. The label says so on every part, and the card says so before Build.
- Third-party source excerpts are shown to the learner who asked for them. Nothing is committed or published by us.
- Repositories in other languages are refused.

## Not known

- Render's Node versions, instance tiers, idle sleep and disk limits; none was checked for this draft.
- How long indexing and curation take on repositories other than the SDK copy.
- Whether a model's choice of simple shapes makes a model worth looking at.
- Frame rate of a created scene on a headset.

## Note, 2026-11-13: as built

All of it is built except the deploy; the status is in [ANYTHING_PLAN.md](../ANYTHING_PLAN.md) §5. Two things differ from the decision above:

- **Research for a subject is this server reading English Wikipedia**, one fixed host, not a web search by the model. The sources shown are still the server's own record of what it fetched.
- **The lesson engine was changed** so that cutting a connection gives a consequence no stronger than the connection: `authored_model` for a person's teaching model, `inferred` for a draft. Before, every break in a mechanical model was `authored_model`.

The status above is still **Proposed**: accepting it, and the reopening of WIN_PLAN's scope with it, is the owner's call.

## Revisit trigger

A measured build time that is too long to wait for in a headset; a created model that reads as fact despite its labels; or a host that cannot hold the limits.
