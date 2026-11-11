import type { ContentBundle } from '@explode/contracts';
import { buildAuthoredBundle } from './authored.ts';
import { HEADSET_DIR } from './paths.ts';

export const HEADSET_MODEL_EVIDENCE = 'ev:rule:headset-model';

/** The headset teaching model: the opening lesson in docs/WIN_PLAN.md §4. */
export function buildHeadsetBundle(previous?: ContentBundle | null): ContentBundle {
  return buildAuthoredBundle({ dir: HEADSET_DIR, modelEvidenceId: HEADSET_MODEL_EVIDENCE, modelTitle: 'Teaching model: mixed-reality headset' }, previous);
}
