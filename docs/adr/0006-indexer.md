# ADR-0006: Indexer — ts-morph, build-time, conservative

**Status:** Accepted, 2026-10-23

## Context

The handoff left the parser open (Tree-sitter or the TypeScript compiler API) and suggested GitNexus. GitNexus's license is unverified, and the handoff linked a fork ([canonical repo](https://github.com/abhigyanpatwari/GitNexus)).

## Decision

`tools/indexer` uses **ts-morph 28** over the pinned fixture.

Nodes:

- one per module;
- one per exported function/class;
- one per route registration (a project-specific adapter for the fixture's router);
- clusters from directories.

Edges are `imports`, `calls` that resolve through the type checker, and `registers_route`/`handles`. All are `static_verified`, each with a `source_range` evidence record (path, lines, revision, excerpt, sha256).

Unresolvable calls are **omitted**, never guessed. IDs are deterministic.

## Consequences

- High precision, lower recall.
- The router adapter is specific to the fixture.

## Revisit trigger

A third-party repo (P1) whose routing the adapter doesn't cover.
