import { z } from 'zod';
import { Id, Sha256 } from './common.ts';
import { TruthStatus } from './truth.ts';

export const SourceRange = z.object({
  path: z.string().min(1),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  revision: z.string().min(1),
  excerpt: z.string(),
  excerpt_sha256: Sha256,
});
export type SourceRange = z.infer<typeof SourceRange>;

export const RunRecord = z.object({
  command: z.string().min(1),
  node_version: z.string(),
  recorded_at: z.string(), // ISO timestamp of the build-time run
  exit_code: z.number().int(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  failing_tests: z.array(z.string()),
  output_excerpt: z.string(),
  output_sha256: Sha256,
});
export type RunRecord = z.infer<typeof RunRecord>;

const base = {
  id: Id,
  title: z.string().min(1).max(120),
  summary: z.string().max(400),
};

export const Evidence = z.discriminatedUnion('kind', [
  z.object({
    ...base,
    kind: z.literal('source_range'),
    truth_status: z.literal('static_verified'),
    source: SourceRange,
  }),
  z.object({
    ...base,
    kind: z.literal('test_run'),
    truth_status: z.literal('observed'),
    run: RunRecord,
    /** Graph node ids whose code executed during this run (from V8 coverage). */
    executed_node_ids: z.array(Id),
  }),
  z.object({
    ...base,
    kind: z.literal('mutation_run'),
    truth_status: z.literal('observed'),
    run: RunRecord,
    mutation: z.object({
      id: Id,
      /** The sandbox edge this mutation stands in for. */
      edge_id: Id,
      description: z.string(),
      file: z.string(),
      diff: z.string(),
    }),
  }),
  z.object({
    ...base,
    kind: z.literal('authored_rule'),
    truth_status: z.literal('authored_model'),
    rule: z.object({ statement: z.string(), model_source: z.string() }),
  }),
  z.object({
    ...base,
    kind: z.literal('asset_license'),
    truth_status: TruthStatus,
    license: z.object({ name: z.string(), spdx: z.string().optional(), url: z.string().optional(), attribution: z.string() }),
  }),
]);
export type Evidence = z.infer<typeof Evidence>;
export type EvidenceKind = Evidence['kind'];
