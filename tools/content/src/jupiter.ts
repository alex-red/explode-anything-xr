import type { ContentBundle } from '@explode/contracts';
import { buildAuthoredBundle } from './authored.ts';
import { JUPITER_DIR } from './paths.ts';

export const JUPITER_MODEL_EVIDENCE = 'ev:rule:jupiter-model';

/** The Jupiter teaching model: what makes the poles glow (sources in docs/DATA_PROVENANCE.md). */
export function buildJupiterBundle(previous?: ContentBundle | null): ContentBundle {
  return buildAuthoredBundle({ dir: JUPITER_DIR, modelEvidenceId: JUPITER_MODEL_EVIDENCE, modelTitle: 'Teaching model: Jupiter' }, previous);
}
