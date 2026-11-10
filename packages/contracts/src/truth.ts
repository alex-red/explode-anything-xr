import { z } from 'zod';

/**
 * The truth contract. Every visible assertion carries exactly one status.
 * `inferred` and `authored_model` may never be silently promoted to `observed`.
 */
export const TruthStatus = z.enum([
  'observed', // recorded runtime evidence (a test run or mutation run captured at build time)
  'static_verified', // relation detected in source by the indexer
  'authored_model', // designer-validated instructional model, not measured reality
  'inferred', // heuristic/AI hypothesis, not verified
  'unknown', // no reliable evidence
]);
export type TruthStatus = z.infer<typeof TruthStatus>;

/** Higher rank = stronger evidence. Used to forbid accidental promotion. */
export const TRUTH_RANK: Record<TruthStatus, number> = {
  unknown: 0,
  inferred: 1,
  authored_model: 2,
  static_verified: 3,
  observed: 4,
};

export const TRUTH_LABEL: Record<TruthStatus, string> = {
  observed: 'Observed (recorded test run)',
  static_verified: 'In source',
  authored_model: 'Teaching model',
  inferred: 'Hypothesis',
  unknown: 'Unknown',
};
