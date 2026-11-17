/**
 * Turns a recorded take (video/takes/<take>/, from take.mjs) into one clip per beat:
 *
 *   node scripts/capture/encode.mjs <take>
 *
 * Each beat's screencast frames, held for their real durations, become a constant 30 fps video
 * cropped to the eye view (the 10:9 panel the emulator draws centred in its 1920x1080 window, 1200x1080), with
 * the emulator's "Remote Control Active" pill (drawn into its own canvas at the bottom centre) patched out,
 * the slice of the take's sound recorded over the same wall-clock span. `<beat>.events.json`
 * lists the app's events in seconds from the clip's start, for cutting.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const name = process.argv[2];
if (!name) throw new Error('usage: encode.mjs <take>');
const dir = resolve(APP, '../../video/takes', name);
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

const audioStart = JSON.parse(readFileSync(join(dir, 'audio.json'), 'utf8')).start;
const events = JSON.parse(readFileSync(join(dir, 'events.json'), 'utf8'));
const wav = join(dir, 'audio.wav');
ff(['-i', join(dir, 'audio.webm'), '-ar', '48000', '-ac', '2', wav]);

for (const beat of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
  const bdir = join(dir, beat);
  if (!existsSync(join(bdir, 'frames.json'))) continue;
  const times = JSON.parse(readFileSync(join(bdir, 'frames.json'), 'utf8'));
  if (times.length < 2) continue;
  const lines = ['ffconcat version 1.0'];
  times.forEach((t, i) => {
    lines.push(`file 'frames/${String(i).padStart(6, '0')}.jpg'`);
    lines.push(`duration ${((times[i + 1] ?? t + 1 / 30) - t).toFixed(6)}`);
  });
  lines.push(`file 'frames/${String(times.length - 1).padStart(6, '0')}.jpg'`);
  writeFileSync(join(bdir, 'frames.ffconcat'), lines.join('\n'));
  const start = times[0];
  const length = times.at(-1) + 1 / 30 - start;
  const offset = start - audioStart;
  const out = join(dir, `${beat}.mp4`);
  ff([
    '-f', 'concat', '-safe', '0', '-i', join(bdir, 'frames.ffconcat'),
    '-ss', Math.max(0, offset).toFixed(3), '-t', length.toFixed(3), '-i', wav,
    '-filter_complex', `[0:v]crop=trunc(ih*10/18)*2:ih:trunc((iw-ih*10/9)/4)*2:0,scale=1200:1080:flags=lanczos,delogo=x=496:y=1034:w=208:h=40,crop=1176:1058:12:11,scale=1200:1080:flags=lanczos,fps=30,format=yuv420p[v]${offset < 0 ? `;[1:a]adelay=${Math.round(-offset * 1000)}:all=1[a]` : ''}`,
    '-map', '[v]', '-map', offset < 0 ? '[a]' : '1:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-c:a', 'aac', '-b:a', '192k', '-t', length.toFixed(3), '-movflags', '+faststart', out,
  ]);
  const mine = events.filter((e) => e.t >= start - 0.5 && e.t <= start + length).map((e) => ({ s: +(e.t - start).toFixed(2), text: e.text.slice(0, 400) }));
  writeFileSync(join(dir, `${beat}.events.json`), JSON.stringify(mine, null, 1));
  console.log(`${name}/${beat}.mp4  ${length.toFixed(1)} s  ${times.length} frames  ${mine.length} events`);
}
