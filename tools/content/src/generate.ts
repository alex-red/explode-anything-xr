import type { ContentBundle } from '@explode/contracts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildDrivetrainBundle } from './drivetrain.ts';
import { DRIVETRAIN_BUNDLE_PATH, OUTPUT_DIR, REPO_BUNDLE_PATH } from './paths.ts';
import { buildRepoBundle } from './repo.ts';

function previous(path: string): ContentBundle | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as ContentBundle) : null;
}

function write(path: string, bundle: ContentBundle) {
  writeFileSync(path, `${JSON.stringify(bundle, null, 2)}\n`);
  const kb = (Buffer.byteLength(readFileSync(path)) / 1024).toFixed(1);
  console.log(
    `${bundle.graph.system_id}: ${bundle.graph.nodes.length} nodes, ${bundle.graph.edges.length} edges, ${bundle.evidence.length} evidence, ${kb} KB, hash ${bundle.content_hash.slice(0, 12)}`,
  );
}

mkdirSync(OUTPUT_DIR, { recursive: true });
write(DRIVETRAIN_BUNDLE_PATH, buildDrivetrainBundle(previous(DRIVETRAIN_BUNDLE_PATH)));
write(REPO_BUNDLE_PATH, buildRepoBundle(previous(REPO_BUNDLE_PATH)));
