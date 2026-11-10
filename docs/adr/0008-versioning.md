# ADR-0008: Versioning — git revision for code, content hash for authored content

**Status:** Accepted, 2026-10-23

## Context

The handoff used a git hash as `graph_revision` even for mechanical content, which has no git history.

## Decision

- `SystemGraph.revision = {kind: 'git' | 'content_hash', value}`.
- The repo uses the fixture's git revision. The drivetrain uses sha256 of its canonical spec.
- `ContentBundle.content_hash` is sha256 of `canonicalJson(bundle minus content_hash and generated_at)`.
- Evidence ids and source ranges include the revision.

## Consequences

- Line links stay truthful.
- The submitted bundle hash can be checked daily (AT-13).

## Revisit trigger

None expected.
