import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';

/**
 * A small reader for a gzipped tar archive, as GitHub serves a repository. It keeps only the
 * files the caller wants and never touches the disk itself: no links, devices or directories are
 * ever produced, only (path, bytes) pairs for regular files.
 *
 * Limits are enforced as the bytes arrive, so an archive that is too big, or that expands far
 * beyond its size, is abandoned without being held in memory.
 */

export class ArchiveLimitError extends Error {}

export interface UnpackOptions {
  /** Called for each regular file; return true to receive its bytes. */
  want: (path: string, size: number) => boolean;
  onFile: (path: string, data: Buffer) => void;
  /** Compressed bytes accepted. */
  maxCompressedBytes: number;
  /** Decompressed bytes accepted. */
  maxUnpackedBytes: number;
  /** Leading path segments dropped from every name (GitHub wraps a repository in one directory). */
  strip?: number;
}

const BLOCK = 512;
/** A pax or long-name record larger than this is not a file name. */
const MAX_META_BYTES = 64 * 1024;

function text(block: Buffer, start: number, length: number): string {
  const slice = block.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
}

function octal(block: Buffer, start: number, length: number): number {
  const field = block.subarray(start, start + length);
  // GNU base-256 for sizes that do not fit in octal.
  if (field[0]! & 0x80) {
    let n = 0;
    for (let i = 1; i < field.length; i++) n = n * 256 + field[i]!;
    return n;
  }
  const n = parseInt(text(block, start, length).trim() || '0', 8);
  return Number.isFinite(n) ? n : 0;
}

/** The `path` of a pax extended header ("<len> key=value\n" records), if it has one. */
function paxPath(data: Buffer): string | undefined {
  let at = 0;
  let found: string | undefined;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    if (space === -1) break;
    const len = Number(data.subarray(at, space).toString('utf8'));
    if (!Number.isInteger(len) || len <= 0) break;
    const record = data.subarray(space + 1, at + len - 1).toString('utf8');
    const eq = record.indexOf('=');
    if (eq !== -1 && record.slice(0, eq) === 'path') found = record.slice(eq + 1);
    at += len;
  }
  return found;
}

/** Read a .tar.gz from `source`, handing the wanted regular files to `onFile`. Returns how many it handed over. */
export async function unpackTarGz(source: AsyncIterable<Uint8Array>, opts: UnpackOptions): Promise<number> {
  let compressed = 0;
  async function* counted(): AsyncGenerator<Uint8Array> {
    for await (const chunk of source) {
      compressed += chunk.byteLength;
      if (compressed > opts.maxCompressedBytes) throw new ArchiveLimitError('the archive is larger than this server reads');
      yield chunk;
    }
  }
  const input = Readable.from(counted());
  const gunzip = input.pipe(createGunzip());
  // `pipe` does not pass errors on: without this a refused download would leave the reader waiting forever.
  input.on('error', (err) => gunzip.destroy(err));

  let pending: Buffer = Buffer.alloc(0);
  let unpacked = 0;
  let files = 0;
  // The entry whose data is being read: how much is left, what it is, and where its bytes go.
  let remaining = 0;
  let padding = 0;
  let collect: Buffer[] | null = null;
  let kind: 'file' | 'pax' | 'longname' | 'skip' = 'skip';
  let name = '';
  let nextName: string | undefined;

  const finishEntry = () => {
    if (kind === 'file' && collect) {
      opts.onFile(name, Buffer.concat(collect));
      files++;
    } else if (kind === 'pax' && collect) {
      nextName = paxPath(Buffer.concat(collect)) ?? nextName;
    } else if (kind === 'longname' && collect) {
      nextName = text(Buffer.concat(collect), 0, MAX_META_BYTES);
    }
    collect = null;
    kind = 'skip';
  };

  const header = (block: Buffer) => {
    if (block.every((b) => b === 0)) return; // end-of-archive marker
    const size = octal(block, 124, 12);
    const type = String.fromCharCode(block[156]!);
    remaining = size;
    padding = (BLOCK - (size % BLOCK)) % BLOCK;
    if (type === 'x' || type === 'L') {
      kind = type === 'x' ? 'pax' : 'longname';
      collect = size <= MAX_META_BYTES ? [] : null;
    } else if (type === 'g') {
      kind = 'skip'; // a global header (GitHub puts the commit id there); not a name
    } else {
      const prefix = text(block, 345, 155);
      const own = text(block, 0, 100);
      let path = nextName ?? (prefix ? `${prefix}/${own}` : own);
      nextName = undefined;
      const strip = opts.strip ?? 0;
      if (strip > 0) path = path.split('/').slice(strip).join('/');
      // Only regular files: links, devices and directories are never produced.
      const regular = type === '0' || type === '\0';
      kind = regular && path !== '' && opts.want(path, size) ? 'file' : 'skip';
      name = path;
      collect = kind === 'file' ? [] : null;
    }
    if (remaining === 0) {
      finishEntry();
      padding = 0;
    }
  };

  for await (const chunk of gunzip as AsyncIterable<Buffer>) {
    unpacked += chunk.length;
    if (unpacked > opts.maxUnpackedBytes) {
      gunzip.destroy();
      throw new ArchiveLimitError('the archive unpacks to more than this server reads');
    }
    let at = 0;
    while (at < chunk.length) {
      if (remaining > 0) {
        const take = Math.min(remaining, chunk.length - at);
        // Assigned inside `header`, which the compiler cannot see from here.
        const sink = collect as Buffer[] | null;
        if (sink) sink.push(Buffer.from(chunk.subarray(at, at + take)));
        at += take;
        remaining -= take;
        if (remaining === 0) finishEntry();
        continue;
      }
      if (padding > 0) {
        const take = Math.min(padding, chunk.length - at);
        at += take;
        padding -= take;
        continue;
      }
      const need = BLOCK - pending.length;
      const take = Math.min(need, chunk.length - at);
      pending = pending.length === 0 && take === BLOCK ? chunk.subarray(at, at + BLOCK) : Buffer.concat([pending, chunk.subarray(at, at + take)]);
      at += take;
      if (pending.length === BLOCK) {
        const block = pending;
        pending = Buffer.alloc(0);
        header(block);
      }
    }
  }
  return files;
}
