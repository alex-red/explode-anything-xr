import { z } from 'zod';
import { Id } from './common.ts';

/**
 * Explode Anything (ADR-0026): a system built on request, behind a proposal the learner confirms.
 *
 * The flow is always the same: the learner asks, the server does cheap read-only research, a
 * proposal says what would be created and how long it should take, and nothing expensive starts
 * until the learner confirms. What comes out is an ordinary `ContentBundle`, checked like any other.
 */

/** What the learner asked for, in their own words or as a pasted address. Untrusted text. */
export const ExplodeRequest = z.object({
  /** `repository`: a public GitHub repository. `subject`: something to be drafted by a model. */
  kind: z.enum(['repository', 'subject']),
  query: z.string().trim().min(1).max(300),
});
export type ExplodeRequest = z.infer<typeof ExplodeRequest>;

/**
 * How long the build should take. Computed by the server from builds it has timed itself, never
 * chosen by a model. A proposal with no timing to go on carries `null` instead, and says "unknown".
 */
export const ExplodeEstimate = z.object({
  low_seconds: z.number().int().nonnegative(),
  high_seconds: z.number().int().nonnegative(),
  /** What the figures rest on, e.g. "3 earlier builds on this server". */
  basis: z.string().max(120),
});
export type ExplodeEstimate = z.infer<typeof ExplodeEstimate>;

const proposalCommon = {
  title: z.string().min(1).max(120),
  /** What the build makes, one plain line each. */
  creates: z.array(z.string().max(240)).max(6),
  /** What it will not do, one plain line each. */
  leaves_out: z.array(z.string().max(240)).max(6),
  /** How the result is labelled (the truth contract, in the learner's words). */
  disclosure: z.string().max(400),
  estimate: ExplodeEstimate.nullable(),
};

/** A repository: what the learner is shown before anything is built. Every figure is counted, none is guessed. */
export const RepositoryProposal = z.object({
  kind: z.literal('repository'),
  ...proposalCommon,
  repository: z.object({
    /** `owner/name`, as GitHub writes it. */
    full_name: z.string().min(3).max(140),
    url: z.string().max(200),
    /** The full commit id that would be read. */
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    default_branch: z.string().max(200),
    /** The licence as GitHub reports it; null when it reports none. */
    license: z.string().max(80).nullable(),
  }),
  counts: z.object({
    files_total: z.number().int().nonnegative(),
    /** TypeScript and JavaScript source files that would be read. */
    files_readable: z.number().int().nonnegative(),
    bytes_readable: z.number().int().nonnegative(),
  }),
});
export type RepositoryProposal = z.infer<typeof RepositoryProposal>;

/**
 * A subject a model would draft. The name, summary and outline are the model's words and are
 * shown as such; the sources are the pages the server itself fetched for it to read.
 */
export const SubjectProposal = z.object({
  kind: z.literal('subject'),
  ...proposalCommon,
  subject: z.object({ name: z.string().min(1).max(60), summary: z.string().max(300) }),
  /** The parts the model expects to draw, by name. The finished draft may differ. */
  outline: z.array(z.string().min(1).max(40)).max(12),
  sources: z.array(z.object({ title: z.string().max(160), url: z.string().max(300) })).max(4),
  /** The model that would write it, as the provider names it. */
  model: z.string().max(80),
});
export type SubjectProposal = z.infer<typeof SubjectProposal>;

export const ExplodeProposal = z.discriminatedUnion('kind', [RepositoryProposal, SubjectProposal]);
export type ExplodeProposal = z.infer<typeof ExplodeProposal>;

/** Research: plan, research, outline. A repository build: download, index, curate, assemble. A subject build: draft, assemble. */
export const EXPLODE_STAGES = ['plan', 'research', 'outline', 'download', 'index', 'curate', 'draft', 'assemble'] as const;
export const ExplodeStage = z.enum(EXPLODE_STAGES);
export type ExplodeStage = z.infer<typeof ExplodeStage>;

/**
 * - `researching`: reading about the request; no proposal yet.
 * - `proposed`: waiting for the learner's yes or no.
 * - `refused`: the request cannot be built, and `refusal` says why in plain words.
 * - `building`, then `done` (the bundle can be fetched) or `failed` (`error` says why).
 * - `cancelled`: the learner said no, or stopped the build.
 */
export const ExplodeStatus = z.enum(['researching', 'proposed', 'refused', 'building', 'done', 'failed', 'cancelled']);
export type ExplodeStatus = z.infer<typeof ExplodeStatus>;

export const ExplodeJob = z.object({
  id: z.string().min(8).max(64),
  kind: z.enum(['repository', 'subject']),
  status: ExplodeStatus,
  /** The stage in progress. `fraction` is 0..1 when it is really known, else null. */
  stage: z.object({ id: ExplodeStage, fraction: z.number().min(0).max(1).nullable() }).nullable(),
  proposal: ExplodeProposal.nullable(),
  refusal: z.string().max(400).nullable(),
  error: z.string().max(400).nullable(),
  /** The built system's id, once `done`. */
  system_id: Id.nullable(),
  /** Seconds the build has taken so far, or took. Null before it starts. */
  build_seconds: z.number().nonnegative().nullable(),
});
export type ExplodeJob = z.infer<typeof ExplodeJob>;
