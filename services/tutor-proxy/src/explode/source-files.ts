/**
 * Which files of a stranger's repository are read, and how much of it at most (ADR-0026).
 * The same rule counts files for the proposal and filters them when the tarball is unpacked, so
 * the proposal's figures are the build's figures.
 */

/** Compressed tarball size at which the download is abandoned. */
export const MAX_TARBALL_BYTES = 40 * 1024 * 1024;
/** Decompressed bytes at which unpacking is abandoned (a small archive can expand enormously). */
export const MAX_UNPACKED_BYTES = 400 * 1024 * 1024;
/** Source files read at most; a repository with more is refused before anything is downloaded. */
export const MAX_SOURCE_FILES = 1500;
/** Total bytes of source read at most. */
export const MAX_SOURCE_BYTES = 24 * 1024 * 1024;
/** One file larger than this is generated or bundled code, not something a person wrote to be read. */
export const MAX_FILE_BYTES = 400 * 1024;
const MAX_PATH_LENGTH = 160;

const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const NOT_SOURCE = /\.d\.[cm]?ts$|\.min\.[cm]?js$|\.(test|spec|stories|story|bench|config|conf)\.[a-z]+$|(^|\/)(gulpfile|gruntfile|webpack|rollup|vite|vitest|jest|babel|eslint|prettier)[^/]*$/i;
const SKIPPED_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'lib-cov', 'coverage', 'vendor', 'third_party', 'third-party', 'bower_components',
  'test', 'tests', '__tests__', '__mocks__', '__fixtures__', 'fixtures', 'e2e', 'spec', 'specs', 'benchmark', 'benchmarks',
  'example', 'examples', 'demo', 'demos', 'docs', 'doc', 'website', 'scripts', 'typings', 'generated', '__generated__',
]);

/** A path that may be written under the unpack directory: relative, and never climbing out of it. */
export function safePath(path: string): boolean {
  if (path === '' || path.length > MAX_PATH_LENGTH || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  return path.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

function inSkippedDir(path: string): boolean {
  const segs = path.split('/');
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i]!;
    if (seg.startsWith('.') || SKIPPED_DIRS.has(seg.toLowerCase())) return true;
  }
  return false;
}

/** A TypeScript or JavaScript source file worth indexing: not a test, a build output, or a config. */
export function isReadableSource(path: string, size: number): boolean {
  if (!safePath(path) || size <= 0 || size > MAX_FILE_BYTES) return false;
  if (!SOURCE_EXT.test(path) || NOT_SOURCE.test(path)) return false;
  return !inSkippedDir(path);
}

/** A package manifest or compiler config, kept so imports between packages and through aliases can be resolved. It is read as data, never run. */
export function isManifest(path: string, size: number): boolean {
  return safePath(path) && size > 0 && size <= MAX_FILE_BYTES && /(^|\/)(package|tsconfig|tsconfig\.base|jsconfig)\.json$/.test(path) && !inSkippedDir(path);
}
