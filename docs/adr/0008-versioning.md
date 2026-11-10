# ADR-0008: Versioning — content hashes for the sample repo and authored content

**Status:** Accepted, 2026-10-23. Amended 2026-11-09 to match the implementation.

## Context

The handoff used a git hash as `graph_revision` even for mechanical content, which has no git history.

## Decision

- `SystemGraph.revision = {kind: 'git' | 'content_hash', value}`.
- The sample repo uses a sha256 **tree hash** of the fixture's source files (`hashTree` in `tools/indexer`), so its revision kind is `content_hash` too. The `git` kind stays in the schema for a future bring-your-own-repo mode. The UI shows the value as `@ tree <hash>` and never calls it a commit.
- The drivetrain uses sha256 of its canonical spec.
- `ContentBundle.content_hash` is sha256 of `canonicalJson(bundle minus content_hash and generated_at)`.
- Evidence ids and source ranges include the revision.

## Consequences

- Line links stay truthful.
- The bundle hashes are recorded in the release manifest and checked with the deployed files (AT-13).

## Revisit trigger

None expected.
