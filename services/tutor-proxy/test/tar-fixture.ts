import { gzipSync } from 'node:zlib';

export interface TarEntry {
  path: string;
  data?: string | Buffer;
  /** '0' file (default), '2' symbolic link, '5' directory, 'g' pax global header. */
  type?: string;
  /** Link target, for type '2'. */
  link?: string;
  /** Write the name in a pax header before the entry, as tar does for long names. */
  pax?: boolean;
}

function header(name: string, size: number, type: string, link = ''): Buffer {
  const block = Buffer.alloc(512);
  block.write(name.slice(0, 100), 0, 'utf8');
  block.write('0000644\0', 100);
  block.write('0000000\0', 108);
  block.write('0000000\0', 116);
  block.write(size.toString(8).padStart(11, '0') + '\0', 124);
  block.write('00000000000\0', 136);
  block.write('        ', 148);
  block.write(type, 156);
  block.write(link.slice(0, 100), 157);
  block.write('ustar\0' + '00', 257);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return block;
}

function padded(data: Buffer): Buffer {
  const pad = (512 - (data.length % 512)) % 512;
  return Buffer.concat([data, Buffer.alloc(pad)]);
}

/** A gzipped tar archive of `entries`, written the way `tar` writes one. */
export function makeTarGz(entries: TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '', 'utf8');
    const type = entry.type ?? '0';
    if (entry.pax) {
      const body = `path=${entry.path}\n`;
      let len = body.length + 3;
      while (`${len} ${body}`.length !== len) len = `${len} ${body}`.length;
      const record = Buffer.from(`${len} ${body}`, 'utf8');
      blocks.push(header('PaxHeader', record.length, 'x'), padded(record));
      blocks.push(header('truncated-name', data.length, type, entry.link), padded(data));
    } else blocks.push(header(entry.path, data.length, type, entry.link), padded(data));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/** The archive as a stream of small chunks, so headers and files straddle chunk edges. */
export async function* chunks(data: Buffer, size = 700): AsyncGenerator<Uint8Array> {
  for (let at = 0; at < data.length; at += size) yield data.subarray(at, Math.min(data.length, at + size));
}
