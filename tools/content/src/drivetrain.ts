import type { ContentBundle } from '@explode/contracts';
import { buildAuthoredBundle } from './authored.ts';
import { DRIVETRAIN_DIR } from './paths.ts';

export const DRIVETRAIN_MODEL_EVIDENCE = 'ev:rule:drivetrain-model';
export { PROCEDURAL_LICENSE_EVIDENCE } from './authored.ts';

/** The procedural EV drivetrain tutorial bundle. */
export function buildDrivetrainBundle(previous?: ContentBundle | null): ContentBundle {
  return buildAuthoredBundle({ dir: DRIVETRAIN_DIR, modelEvidenceId: DRIVETRAIN_MODEL_EVIDENCE, modelTitle: 'Teaching model: simplified EV drivetrain' }, previous);
}
