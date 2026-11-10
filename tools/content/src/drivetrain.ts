import type { ContentBundle, Evidence, FlowPath, GraphEdge, GraphNode, Layout, PartShape, Relation } from '@explode/contracts';
import { Lesson, PartShape as PartShapeSchema } from '@explode/contracts';
import { sha256 } from '@explode/indexer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { finalizeBundle } from './bundle.ts';
import { CONE_DEG, radiusFor } from './layout.ts';
import { DRIVETRAIN_DIR } from './paths.ts';

interface DrivetrainSpec {
  system_id: string;
  display_name: string;
  model_statement: string;
  anchor_distance: number;
  parts: {
    id: string;
    label: string;
    summary: string;
    importance: number;
    shape: PartShape;
    collapsed: [number, number, number];
    exploded: [number, number, number];
  }[];
  edges: { source: string; target: string; relation: Relation; flows: GraphEdge['flows']; label: string; mutable: boolean; rule: string }[];
  path: { id: string; label: string; flow: FlowPath['flow']; node_ids: string[] };
}

export const DRIVETRAIN_MODEL_EVIDENCE = 'ev:rule:drivetrain-model';
export const PROCEDURAL_LICENSE_EVIDENCE = 'ev:license:procedural-geometry';

/** Build the procedural drivetrain tutorial bundle from authored JSON (ADR-0019: procedural only). */
export function buildDrivetrainBundle(previous?: ContentBundle | null): ContentBundle {
  const specText = readFileSync(resolve(DRIVETRAIN_DIR, 'spec.json'), 'utf8');
  const lessonText = readFileSync(resolve(DRIVETRAIN_DIR, 'lesson.json'), 'utf8');
  const spec = JSON.parse(specText) as DrivetrainSpec;
  const lesson = Lesson.parse(JSON.parse(lessonText));
  const revision = sha256(`${specText}\0${lessonText}`);

  const evidence: Evidence[] = [
    {
      id: DRIVETRAIN_MODEL_EVIDENCE,
      kind: 'authored_rule',
      truth_status: 'authored_model',
      title: 'Teaching model: simplified EV drivetrain',
      summary: spec.model_statement,
      rule: { statement: spec.model_statement, model_source: 'content/drivetrain/spec.json (authored for EXPLODE)' },
    },
    {
      id: PROCEDURAL_LICENSE_EVIDENCE,
      kind: 'asset_license',
      truth_status: 'authored_model',
      title: 'Geometry: procedural primitives',
      summary: 'Every part is generated at runtime from simple shapes described in spec.json. No third-party meshes are used.',
      license: { name: 'MIT', spdx: 'MIT', attribution: 'Procedural geometry authored for EXPLODE' },
    },
  ];

  const nodes: GraphNode[] = spec.parts.map((p) => ({
    id: p.id,
    kind: 'component',
    label: p.label,
    summary: p.summary,
    parent_id: null,
    truth_status: 'authored_model',
    evidence_ids: [DRIVETRAIN_MODEL_EVIDENCE, PROCEDURAL_LICENSE_EVIDENCE],
    importance: p.importance,
  }));

  const edges: GraphEdge[] = spec.edges.map((e) => {
    const id = `edge:${e.relation}:${e.source}->${e.target}`;
    const ruleId = `ev:rule:${id}`;
    evidence.push({
      id: ruleId,
      kind: 'authored_rule',
      truth_status: 'authored_model',
      title: `Model rule: ${e.label}`,
      summary: e.rule,
      rule: { statement: e.rule, model_source: 'content/drivetrain/spec.json (authored for EXPLODE)' },
    });
    return {
      id,
      source_id: e.source,
      target_id: e.target,
      relation: e.relation,
      flows: e.flows,
      truth_status: 'authored_model',
      evidence_ids: [ruleId, DRIVETRAIN_MODEL_EVIDENCE],
      is_mutable_in_sandbox: e.mutable,
      label: e.label,
    };
  });

  // Same path convention as the indexer: edge_ids[i] carries flow into node_ids[i + 1]
  // from the nearest earlier node on the path.
  const edgeIds: string[] = [];
  for (let i = 1; i < spec.path.node_ids.length; i++) {
    const target = spec.path.node_ids[i]!;
    let found: GraphEdge | undefined;
    for (let j = i - 1; j >= 0 && !found; j--) found = edges.find((e) => e.source_id === spec.path.node_ids[j] && e.target_id === target);
    if (!found) throw new Error(`path ${spec.path.id}: no edge into ${target}`);
    edgeIds.push(found.id);
  }
  const path: FlowPath = { ...spec.path, edge_ids: edgeIds, truth_status: 'authored_model', evidence_ids: [DRIVETRAIN_MODEL_EVIDENCE] };

  const layout: Layout = {
    system_id: spec.system_id,
    anchor_distance: spec.anchor_distance,
    cone_deg: { ...CONE_DEG },
    placements: Object.fromEntries(
      spec.parts.map((p) => [p.id, { collapsed: p.collapsed, exploded: p.exploded, radius: radiusFor(p.importance) }]),
    ),
  };

  return finalizeBundle(
    {
      graph: {
        schema_version: '1.0',
        system_id: spec.system_id,
        system_kind: 'mechanical',
        display_name: spec.display_name,
        revision: { kind: 'content_hash', value: revision },
        nodes,
        edges,
        paths: [path],
      },
      evidence: evidence.sort((a, b) => (a.id < b.id ? -1 : 1)),
      layout,
      lessons: [lesson],
      assets: { parts: Object.fromEntries(spec.parts.map((p) => [p.id, PartShapeSchema.parse(p.shape)])) },
    },
    previous,
  );
}
