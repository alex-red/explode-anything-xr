import { resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../../..');
export const CONTENT_DIR = resolve(REPO_ROOT, 'content');
export const REPO_DEMO_DIR = resolve(CONTENT_DIR, 'repo-demo');
export const DRIVETRAIN_DIR = resolve(CONTENT_DIR, 'drivetrain');
export const WORK_DIR = resolve(REPO_ROOT, '.content-work');
export const OUTPUT_DIR = resolve(REPO_ROOT, 'apps/quest/src/content');
export const REPO_BUNDLE_PATH = resolve(OUTPUT_DIR, 'repo-demo.bundle.json');
export const DRIVETRAIN_BUNDLE_PATH = resolve(OUTPUT_DIR, 'drivetrain.bundle.json');
