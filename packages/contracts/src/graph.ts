import { z } from 'zod';
import { Id } from './common.ts';
import { TruthStatus } from './truth.ts';

export const FlowType = z.enum(['request', 'data', 'electrical', 'torque', 'control']);
export type FlowType = z.infer<typeof FlowType>;

export const NodeKind = z.enum([
  'system',
  'cluster',
  'module',
  'function',
  'class',
  'route',
  'test',
  'assembly',
  'component',
]);
export type NodeKind = z.infer<typeof NodeKind>;

export const GraphNode = z.object({
  id: Id,
  kind: NodeKind,
  label: z.string().min(1).max(60),
  summary: z.string().max(300).default(''),
  parent_id: Id.nullable(),
  truth_status: TruthStatus,
  evidence_ids: z.array(Id),
  /** 0..1, drives label priority and size. */
  importance: z.number().min(0).max(1),
});
export type GraphNode = z.infer<typeof GraphNode>;

export const Relation = z.enum([
  'imports',
  'calls',
  'registers_route',
  'handles',
  'depends_on',
  'powers',
  'transmits',
]);
export type Relation = z.infer<typeof Relation>;

export const GraphEdge = z.object({
  id: Id,
  source_id: Id,
  target_id: Id,
  relation: Relation,
  /** Which flows travel along this edge (source → target). */
  flows: z.array(FlowType),
  truth_status: TruthStatus,
  evidence_ids: z.array(Id),
  is_mutable_in_sandbox: z.boolean(),
  label: z.string().max(60).optional(),
});
export type GraphEdge = z.infer<typeof GraphEdge>;

/** A named, ordered causal path (e.g. "login request") used by trace and lessons. */
export const FlowPath = z.object({
  id: Id,
  label: z.string().max(60),
  flow: FlowType,
  node_ids: z.array(Id).min(2),
  edge_ids: z.array(Id).min(1),
  truth_status: TruthStatus,
  evidence_ids: z.array(Id),
});
export type FlowPath = z.infer<typeof FlowPath>;

export const Revision = z.object({
  kind: z.enum(['git', 'content_hash']),
  value: z.string().min(1),
});
export type Revision = z.infer<typeof Revision>;

export const SystemGraph = z.object({
  schema_version: z.literal('1.0'),
  system_id: Id,
  system_kind: z.enum(['software', 'mechanical']),
  display_name: z.string().min(1).max(80),
  revision: Revision,
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
  paths: z.array(FlowPath),
});
export type SystemGraph = z.infer<typeof SystemGraph>;
