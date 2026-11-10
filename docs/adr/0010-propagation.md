# ADR-0010: Propagation — typed-flow paths

**Status:** Accepted, 2026-10-23

## Context

The handoff did not define a propagation rule for causal effects.

## Decision

- A `FlowPath` is an ordered list of `node_ids` and `edge_ids`, where `edge_ids[i]` links `node_ids[i]` to `node_ids[i+1]`.
- It has a flow type: `request`, `data`, `electrical`, `torque` or `control`.
- Breaking an edge affects every node after it on each path that contains it. If no path contains the edge, only its target is affected.
- `first_affected_id` answers "what fails first?".

Truth of the consequence:

- mechanical → `authored_model`;
- software with a matching recorded mutation → `observed`;
- otherwise → `inferred`.

## Consequences

- Simple, explainable and testable.
- No general dataflow analysis.

## Revisit trigger

A lesson needs branching or fan-in semantics.
