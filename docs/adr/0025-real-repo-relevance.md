# ADR-0025: A real repository, drawn from its most relevant parts under parent nodes a model chose

**Status:** Accepted, 2026-11-12 · **Builds on:** [ADR-0006](0006-indexer.md), [ADR-0007](0007-evidence.md), [ADR-0018](0018-fixture-repo.md), [ADR-0022](0022-hologram-look.md)

## Context

- [ADR-0018](0018-fixture-repo.md) chose a sample service written for the demo, and named its own cost: "less impressive than a well-known repo".
- A real repository is far too big to draw. Meta's Immersive Web SDK has 195 source files and 1,273 declarations in the three packages indexed here. The headset holds about 50 parts ([ADR-0014](0014-layout-cone.md)).
- Directories are a poor table of contents: 38 of them, several of them plumbing.
- A model can name the ideas in a codebase well, but what it says is not evidence ([ADR-0007](0007-evidence.md)).

## Decision

1. **The repository is `meta/immersive-web-sdk`** (MIT), the framework this app runs on, pinned to one commit. Three packages' `src` directories are copied unmodified into `content/iwsdk/source` and indexed by the same ts-morph indexer. Nothing from it is built or run.
2. **It is added next to the sample service, not in place of it.** The sample keeps the break-and-repair lessons, because only it has recorded test and mutation runs. The SDK gets a tour: open it, read the groups, trace one real call chain, check a part against its source.
3. **Relevance is computed, at build time, in three steps** (`tools/content/src/relevance.ts`):
   - fold the index to *parts* (classes and top-level functions; a method counts as its class);
   - rank parts from the call graph: PageRank, callers and callees in other files, a little for being exported or having a per-frame `update`, less for very short parts;
   - keep the best of each group inside a budget (46 parts, 3 to 8 per group, 64 connections).
4. **Parent nodes come from a curation step** (`tools/content/src/curate.ts`), run by hand, never by the generator. A model is shown a digest of every directory and returns the groups, the parts most worth showing, and where to start. The answer is checked against the index, written exactly as returned to `content/iwsdk/curation.json` with the provider's own model name, and committed.
5. **Truth statuses:**
   - a parent node is `inferred`, cites no evidence, and its label carries the hypothesis glyph;
   - every part and connection is `static_verified` and cites the source lines it came from;
   - a connection between two parts stands for one or more real call sites and cites the first;
   - nothing is `observed`, and no connection is sandbox-mutable.
6. **Ranking and roles are presentation.** `importance` and the new optional `role` on a node decide size, shape and detail tier, and never truth. Roles: `concept` (a curated group), `entry` (the curation's starting points), `hub` (called by four or more of the parts shown), `engine` (a per-frame `update` and no caller in the repository).

## Consequences

- The app can say, truthfully, "this is Meta's SDK, from source", and show a judge the framework they know.
- The model's choice is visible and bounded: it decides grouping and emphasis, never what is true.
- The copy adds 1.7 MB of third-party source to the repository. The app ships only excerpts.
- The SDK copy is of `main` at one commit, which is newer than the 1.0.1 the app is pinned to. The app says the commit, not a version.
- A tour is less of a lesson than break-and-repair. Recording real test runs of the SDK would allow one, and is out of scope.

## Not known without a headset

How the added blending (group clouds, light-thread connections, motes) affects frame rate, and how the clouds read over passthrough.

## Revisit trigger

A device test; or the SDK's tests become runnable in the build, which would allow observed evidence and a break-and-repair lesson on it.
