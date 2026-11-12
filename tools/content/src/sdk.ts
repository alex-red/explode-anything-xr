import type { ContentBundle, Evidence, Lesson } from '@explode/contracts';
import type { IndexResult, PathSpec } from '@explode/indexer';
import { indexRepository } from '@explode/indexer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BundleDraft } from './bundle.ts';
import { finalizeBundle } from './bundle.ts';
import { layoutSoftware } from './layout.ts';
import { IWSDK_DIR } from './paths.ts';
import type { Selection } from './relevance.ts';
import { Curation, selectRelevant } from './relevance.ts';

/**
 * A real open source repository, drawn from its most relevant parts only (docs/RELEVANCE_PLAN.md):
 * Meta's Immersive Web SDK, the framework this app itself runs on. `content/iwsdk/source` is an
 * unmodified copy of three of its packages at the commit in `content/iwsdk/SOURCE.json`.
 *
 * Nothing in it is run here, so nothing in this bundle is `observed`, and no connection can be
 * unplugged: there is no recorded run to say what would break.
 */
export const SDK_SYSTEM_ID = 'system:iwsdk';
export const SDK_LESSON_ID = 'lesson:sdk-tour';

/** How much of the index is drawn. The headset's field of view and ray targets set the ceiling. */
export const SDK_BUDGET = { budget: 46, perGroupMin: 3, perGroupMax: 8, maxEdges: 64 } as const;

export interface SdkSource {
  repository: string;
  name: string;
  commit: string;
  license: string;
  copyright: string;
}

export function sdkSource(): SdkSource {
  return JSON.parse(readFileSync(resolve(IWSDK_DIR, 'SOURCE.json'), 'utf8')) as SdkSource;
}

export function indexSdk(): IndexResult {
  return indexRepository({
    root: resolve(IWSDK_DIR, 'source'),
    systemId: SDK_SYSTEM_ID,
    displayName: 'Immersive Web SDK',
    include: ['packages/*/src/**/*.ts'],
    tsPaths: { '@iwsdk/xr-input': ['packages/xr-input/src/index.ts'], '@iwsdk/locomotor': ['packages/locomotor/src/index.ts'] },
    gitRevision: sdkSource().commit,
  });
}

export function sdkCuration(): Curation {
  return Curation.parse(JSON.parse(readFileSync(resolve(IWSDK_DIR, 'curation.json'), 'utf8')));
}

export function selectSdk(): { selection: Selection; curation: Curation; source: SdkSource } {
  const source = sdkSource();
  const curation = sdkCuration();
  if (curation.source.commit !== source.commit) {
    throw new Error(`curation.json was made for commit ${curation.source.commit}, but the source is ${source.commit}: run the curation step again`);
  }
  const paths = JSON.parse(readFileSync(resolve(IWSDK_DIR, 'paths.json'), 'utf8')) as PathSpec[];
  const selection = selectRelevant(indexSdk(), curation, {
    ...SDK_BUDGET,
    paths,
    systemId: SDK_SYSTEM_ID,
    displayName: 'Immersive Web SDK (meta/immersive-web-sdk)',
  });
  return { selection, curation, source };
}

export function buildSdkBundle(previous?: ContentBundle | null): ContentBundle {
  const { selection, curation, source } = selectSdk();
  const license: Evidence = {
    id: 'ev:license:iwsdk',
    kind: 'asset_license',
    truth_status: 'static_verified',
    title: `Source: ${source.name} (MIT License)`,
    summary: `Every excerpt in this system is quoted from ${source.name} at commit ${source.commit.slice(0, 12)}. Not affiliated with or endorsed by Meta.`,
    license: { name: 'MIT License', spdx: 'MIT', url: source.repository, attribution: source.copyright },
  };
  const evidence = [...selection.evidence, license].sort((a, b) => (a.id < b.id ? -1 : 1));
  const draft: BundleDraft = {
    graph: selection.graph,
    evidence,
    layout: layoutSoftware(
      selection.graph,
      curation.groups.map((g) => `concept:${g.id}`),
    ),
    lessons: [sdkLesson(selection, curation, source)],
    assets: null,
  };
  return finalizeBundle(draft, previous);
}

/**
 * A tour, not a break-and-repair lesson: open it, read what the curation chose, follow one real
 * call chain, and check a part against its source lines. Every number is counted from the index.
 */
function sdkLesson(selection: Selection, curation: Curation, source: SdkSource): Lesson {
  const { graph, stats } = selection;
  const path = graph.paths[0];
  const model = curation.produced_by.model;
  const steps: Lesson['steps'] = [
    {
      id: 'step:sdk-intro',
      kind: 'intro',
      caption: `This is Meta's Immersive Web SDK, the open source framework this app runs on (${source.name}, MIT). Its source was indexed: ${stats.indexed.files} files, ${stats.indexed.declarations} declarations.`,
      expect: { type: 'next' },
      on_enter: [],
    },
    {
      id: 'step:sdk-explode',
      kind: 'explode',
      caption: `Nobody can read ${stats.indexed.declarations} parts at once. Press Explode to see the ${stats.shown.parts} that matter most, in ${stats.shown.groups} groups.`,
      hint: 'Press Explode. You can also pinch with both hands and pull them apart.',
      expect: { type: 'explode_at_least', factor: 0.8 },
      on_enter: [],
    },
    {
      id: 'step:sdk-groups',
      kind: 'explain',
      caption: `The ${stats.shown.groups} glowing groups were chosen by an AI model (${model}) from a digest of the index, so each is marked a hypothesis. The parts inside were ranked from the call graph and come straight from the source.`,
      expect: { type: 'next' },
      on_enter: [{ type: 'highlight', target_ids: graph.nodes.filter((n) => n.role === 'concept').map((n) => n.id) }],
    },
  ];
  if (path) {
    steps.push({
      id: 'step:sdk-trace',
      kind: 'trace',
      caption: `Follow one real chain of calls. Press Trace ${path.label}.`,
      hint: 'The Trace button is in the panel next to you.',
      expect: { type: 'trace', path_id: path.id },
      on_enter: [{ type: 'clear_highlight' }, { type: 'focus', target_id: path.node_ids[0]! }],
    });
  }
  steps.push(
    {
      id: 'step:sdk-evidence',
      kind: 'explain',
      caption: path
        ? `Each of the ${path.node_ids.length} steps is a call found in the source. Select one and open its evidence to see the lines.`
        : 'Every part comes from the source. Select one and open its evidence to see the lines.',
      hint: 'Select any part, then press Evidence.',
      expect: { type: 'open_evidence' },
      on_enter: [],
    },
    {
      id: 'step:sdk-reflect',
      kind: 'reflect',
      caption: `That is ${stats.shown.parts} of ${stats.indexed.parts} classes and functions. Nothing here was run, so nothing is marked observed, and no connection can be unplugged. Explore freely.`,
      expect: { type: 'next' },
      on_enter: path ? [{ type: 'animate_flow', path_id: path.id }] : [],
    },
  );
  return {
    id: SDK_LESSON_ID,
    system_id: graph.system_id,
    title: 'Explode a real SDK',
    objectives: ['See a large open source codebase through its most relevant parts.', 'Tell what an AI chose from what the source proves.'],
    repair_candidates: [],
    steps,
  };
}
