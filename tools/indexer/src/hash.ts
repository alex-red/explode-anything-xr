import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Sorted, forward-slash relative paths of every file under `dir` (skips node_modules and dot dirs). */
export function listFiles(dir: string, root: string = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, root));
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out.sort();
}

/** Content hash of a directory tree: sha256 over "path\0content\0" for each file in sorted order. */
export function hashTree(dir: string): string {
  const h = createHash('sha256');
  for (const rel of listFiles(dir)) {
    h.update(rel).update('\0').update(readFileSync(join(dir, rel))).update('\0');
  }
  return h.digest('hex');
}
