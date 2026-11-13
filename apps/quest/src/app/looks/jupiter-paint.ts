/**
 * Jupiter's cloud tops, painted by rule: no photograph and no third-party texture (ADR-0019).
 * A latitude profile of belts and zones, bent and streaked by tiling noise, with the Great Red
 * Spot, a few white ovals and grey-blue poles. The same seed always paints the same planet.
 *
 * The painting is an equirectangular map: column 0 is longitude 0 and wraps; row 0 is the south
 * pole. It is an illustration of the planet's look, not a map of its real clouds.
 */

/** Where the Great Red Spot is painted: degrees of longitude and latitude, and its half-axes. */
export const SPOT = { lon: 90, lat: -22, a: 8.5, b: 5 } as const;

type Rgb = readonly [number, number, number];
const hex = (h: number): Rgb => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

/** Belts (dark) and zones (light) from the south pole to the north: [from°, to°, colour]. */
const BANDS: ReadonlyArray<readonly [number, number, Rgb]> = [
  [-90, -62, hex(0x6e727c)],
  [-62, -54, hex(0x8d8377)],
  [-54, -48, hex(0xb9a88e)],
  [-48, -43, hex(0x94806b)],
  [-43, -37, hex(0xcfbfa2)],
  [-37, -29, hex(0x9c7557)], // south temperate belt
  [-29, -21, hex(0xeadfc9)], // south tropical zone
  [-21, -15.5, hex(0x9c6044)], // south equatorial belt, with a paler lane along its middle
  [-15.5, -12, hex(0xb98a66)],
  [-12, -7, hex(0xa2664a)],
  [-7, 7, hex(0xecdcb6)], // equatorial zone
  [7, 17, hex(0x8c5138)], // north equatorial belt
  [17, 23, hex(0xe8d8bb)], // north tropical zone
  [23, 28, hex(0xb47f58)], // north temperate belt
  [28, 35, hex(0xdccdb0)],
  [35, 40, hex(0x9f8870)],
  [40, 47, hex(0xc9b99e)],
  [47, 53, hex(0x8f8272)],
  [53, 60, hex(0xa89c8c)],
  [60, 90, hex(0x6d7380)],
];

/** Small storms: [lon°, lat°, half-width°, half-height°, colour]. */
const OVALS: ReadonlyArray<readonly [number, number, number, number, Rgb]> = [
  [118, -33, 3.2, 2.2, hex(0xe2b89a)], // a pale red oval trailing the spot
  [40, -40.5, 2.2, 1.6, hex(0xf3ecdc)],
  [64, -40.5, 2.2, 1.6, hex(0xf3ecdc)],
  [203, -40.5, 2.2, 1.6, hex(0xf3ecdc)],
  [229, -40.5, 2.2, 1.6, hex(0xf3ecdc)],
  [301, -40.5, 2.2, 1.6, hex(0xf3ecdc)],
  [162, 41, 2.4, 1.6, hex(0xefe6d2)],
  [322, 20, 2.6, 1.5, hex(0x8a5a40)], // a dark barge on the belt's edge
];

const SPOT_DEEP = hex(0xa5432b);
const SPOT_PALE = hex(0xd58258);
const HOLLOW = hex(0xefe4cf);
const FESTOON = hex(0x77838f);
const POLE = hex(0x747a84);
const ASH = hex(0x6f6660);

const LUT_N = 2048;
const EDGE = 1.3; // degrees over which one band shades into the next
let lut: Float32Array | null = null;

function bandLut(): Float32Array {
  if (lut) return lut;
  lut = new Float32Array(LUT_N * 3);
  for (let i = 0; i < LUT_N; i++) {
    const lat = (i / (LUT_N - 1)) * 180 - 90;
    let k = BANDS.findIndex((b) => lat <= b[1]);
    if (k < 0) k = BANDS.length - 1;
    const here = BANDS[k]!;
    let [r, g, b] = here[2];
    const next = BANDS[k + 1];
    const prev = BANDS[k - 1];
    if (next && here[1] - lat < EDGE / 2) {
      const t = smooth(0.5 - (here[1] - lat) / EDGE);
      r += (next[2][0] - r) * t;
      g += (next[2][1] - g) * t;
      b += (next[2][2] - b) * t;
    } else if (prev && lat - here[0] < EDGE / 2) {
      const t = smooth(0.5 - (lat - here[0]) / EDGE);
      r += (prev[2][0] - r) * t;
      g += (prev[2][1] - g) * t;
      b += (prev[2][2] - b) * t;
    }
    lut.set([r, g, b], i * 3);
  }
  return lut;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const step = (a: number, b: number, x: number) => smooth((x - a) / (b - a));

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise, 0..1, that repeats every `period` cells along x. */
function noise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const a = ((x0 % period) + period) % period;
  const b = (a + 1) % period;
  const u = fx * fx * (3 - 2 * fx);
  const w = fy * fy * (3 - 2 * fy);
  const top = hash(a, y0, seed) + (hash(b, y0, seed) - hash(a, y0, seed)) * u;
  const bottom = hash(a, y0 + 1, seed) + (hash(b, y0 + 1, seed) - hash(a, y0 + 1, seed)) * u;
  return top + (bottom - top) * w;
}

/** Layered noise, 0..1, that repeats every `period` cells along x. */
function fbm(x: number, y: number, period: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x, y, period, seed + o * 17);
    norm += amp;
    x *= 2;
    y *= 2;
    period *= 2;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Degrees from `lon` to `to`, the short way round. */
function lonDiff(lon: number, to: number): number {
  let d = lon - to;
  if (d > 180) d -= 360;
  else if (d < -180) d += 360;
  return d;
}

interface Eddy {
  lon: number;
  lat: number;
  /** Radius in degrees of arc, and how far it winds its middle round (radians, signed). */
  size: number;
  wind: number;
}

/** Storms that wind the clouds round them: thick along the belts' edges and over the poles. */
function eddies(seed: number): Eddy[] {
  const out: Eddy[] = [];
  const edges = [-37, -29, -21, -7, 7, 17, 23, 28, 35, 40, -43, -48];
  for (let i = 0; i < 150; i++) {
    const r = (k: number) => hash(i, k, seed + 900);
    const polar = i >= 90;
    const lat = polar ? (r(1) < 0.5 ? -1 : 1) * (56 + r(2) * 28) : edges[Math.floor(r(1) * edges.length)]! + (r(2) - 0.5) * 5;
    // Keep them off the spot, which is drawn by itself.
    const lon = r(3) * 360;
    if (Math.abs(lat - SPOT.lat) < 12 && Math.abs(lonDiff(lon, SPOT.lon)) < 22) continue;
    out.push({ lon, lat, size: polar ? 3 + r(4) * 5 : 1.6 + r(4) * 3.4, wind: (r(5) < 0.5 ? -1 : 1) * (1.6 + r(6) * 3) });
  }
  return out;
}

/**
 * Paint the cloud tops as sRGB bytes (RGBA, row 0 at the south pole). `width` should be twice
 * `height`. Pure: no canvas, no randomness beyond `seed`.
 */
export function paintJupiter(width: number, height: number, seed = 5): Uint8Array {
  const bands = bandLut();
  const storms = eddies(seed);
  const near: Eddy[] = [];
  const out = new Uint8Array(width * height * 4);
  for (let j = 0; j < height; j++) {
    const lat0 = ((j + 0.5) / height) * 180 - 90;
    const abs = Math.abs(lat0);
    const cos = Math.max(0.05, Math.cos((lat0 * Math.PI) / 180));
    const polar = step(52, 74, abs);
    // The belts churn more than the zones, and the poles are all storms.
    const churn = 1 + 1.2 * step(5, 9, abs) * (1 - step(19, 24, abs)) + 1.6 * polar;
    near.length = 0;
    for (const e of storms) if (Math.abs(e.lat - lat0) < e.size) near.push(e);
    for (let i = 0; i < width; i++) {
      const lon0 = ((i + 0.5) / width) * 360;
      let lon = lon0;
      let lat = lat0;

      // Each storm winds the clouds near it round its middle.
      for (const e of near) {
        const ex = lonDiff(lon, e.lon) * cos;
        const ey = lat - e.lat;
        const d = Math.sqrt(ex * ex + ey * ey) / e.size;
        if (d >= 1) continue;
        const turn = e.wind * (1 - d) * (1 - d);
        const c = Math.cos(turn);
        const sn = Math.sin(turn);
        lon = e.lon + (ex * c - ey * sn) / cos;
        lat = e.lat + ex * sn + ey * c;
      }

      // The spot shoulders the belt beside it aside, and stirs a wake on one side.
      const dx = lonDiff(lon0, SPOT.lon) / SPOT.a;
      const dy = (lat0 - SPOT.lat) / SPOT.b;
      const rs = Math.sqrt(dx * dx + dy * dy);
      const wake = Math.max(0, 1 - Math.abs(lat0 + 14) / 8) * step(0.6, 2.5, dx) * (1 - step(4, 10, dx));
      const stir = churn * (1 + 2.2 * wake);

      // Two rounds of bending: broad waves, then the curls riding on them.
      const u = lon / 360;
      const u1 = u + (fbm(u * 6, lat * 0.07, 6, 3, seed) - 0.5) * 0.02 * stir;
      const lat1 = lat + (fbm(u * 6, lat * 0.07, 6, 3, seed + 53) - 0.5) * 4.6 * stir;
      const u2 = u1 + (fbm(u1 * 26, lat1 * 0.3, 26, 3, seed + 101) - 0.5) * 0.007 * stir;
      let at = lat1 + (fbm(u1 * 26, lat1 * 0.3, 26, 3, seed + 157) - 0.5) * 2.1 * stir;
      if (rs < 2.4) at += (1 - step(1, 2.4, rs)) * SPOT.b * 0.75 * (dy >= 0 ? 1 : -0.45);

      const k = Math.min(LUT_N - 1, Math.max(0, Math.round(((at + 90) / 180) * (LUT_N - 1)))) * 3;
      let r = bands[k]!;
      let g = bands[k + 1]!;
      let b = bands[k + 2]!;

      // Thin layers within each band, long streaks along the wind, and a fine grain.
      const layers = noise(0.5, at * 2.3, 1, seed + 601) * 0.6 + noise(0.5, at * 6.1, 1, seed + 607) * 0.4;
      const streak = fbm(u2 * 11, at * 1.5, 11, 4, seed + 211);
      const grain = fbm(u2 * 80, at * 2.8, 80, 2, seed + 307);
      const shade = (0.9 + 0.2 * layers) * (0.84 + 0.32 * streak) * (0.95 + 0.1 * grain);
      // Some stretches of a belt are greyer than others.
      const ash = step(0.5, 0.8, fbm(u2 * 4, at * 0.12, 4, 3, seed + 701)) * 0.3 * (1 - polar);
      r = (r + (ASH[0] - r) * ash) * shade;
      g = (g + (ASH[1] - g) * ash) * shade;
      b = (b + (ASH[2] - b) * ash) * shade;

      // Grey-blue plumes trailing from the north edge of the equatorial zone.
      const festoonBand = Math.max(0, 1 - Math.abs(at - 5.5) / 4.5);
      if (festoonBand > 0) {
        const f = festoonBand * step(0.52, 0.68, fbm(u2 * 20 + at * 0.02, at * 0.22, 20, 3, seed + 401)) * 0.62;
        r += (FESTOON[0] - r) * f;
        g += (FESTOON[1] - g) * f;
        b += (FESTOON[2] - b) * f;
      }

      // Poles: the bands give way to a mottle of blue-grey cyclones.
      if (polar > 0) {
        const cell = fbm(u2 * 36, at * 0.5, 36, 4, seed + 503);
        const p = polar * (0.3 + 0.45 * step(0.35, 0.7, cell));
        const m = 0.7 + 0.7 * cell;
        r += (POLE[0] * m - r) * p;
        g += (POLE[1] * m - g) * p;
        b += (POLE[2] * m - b) * p;
      }

      for (const [olon, olat, oa, ob, c] of OVALS) {
        const ey = (lat0 - olat) / ob;
        if (ey > 1 || ey < -1) continue;
        const ex = lonDiff(lon0, olon) / oa;
        const e = 1 - step(0.5, 1, Math.sqrt(ex * ex + ey * ey));
        if (e <= 0) continue;
        r += (c[0] * shade - r) * e;
        g += (c[1] * shade - g) * e;
        b += (c[2] * shade - b) * e;
      }

      // The Great Red Spot: a pale hollow round it, a brick-red oval wound into a spiral.
      if (rs < 1.5) {
        const hollow = (1 - step(1.05, 1.5, rs)) * 0.7;
        r += (HOLLOW[0] * shade - r) * hollow;
        g += (HOLLOW[1] * shade - g) * hollow;
        b += (HOLLOW[2] * shade - b) * hollow;
        if (rs < 1) {
          const wound = fbm((Math.atan2(dy, dx) / (Math.PI * 2) + rs * 0.9) * 6, rs * 5, 6, 3, seed + 811);
          const t = Math.min(1, wound * 0.75 + (1 - rs) * 0.2);
          const rimDark = 1 - 0.22 * step(0.6, 0.95, rs);
          const inside = 1 - step(0.84, 1, rs);
          r += ((SPOT_DEEP[0] + (SPOT_PALE[0] - SPOT_DEEP[0]) * t) * rimDark - r) * inside;
          g += ((SPOT_DEEP[1] + (SPOT_PALE[1] - SPOT_DEEP[1]) * t) * rimDark - g) * inside;
          b += ((SPOT_DEEP[2] + (SPOT_PALE[2] - SPOT_DEEP[2]) * t) * rimDark - b) * inside;
        }
      }

      const o = (j * width + i) * 4;
      out[o] = Math.min(255, Math.max(0, Math.round(r * 255)));
      out[o + 1] = Math.min(255, Math.max(0, Math.round(g * 255)));
      out[o + 2] = Math.min(255, Math.max(0, Math.round(b * 255)));
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Colour by depth, from the centre (0) to the cloud tops (1): [depth, colour]. */
const DEPTHS: ReadonlyArray<readonly [number, Rgb]> = [
  [0, hex(0xfff4c8)], // the dilute core, hottest
  [0.3, hex(0xffc76a)],
  [0.42, hex(0xf08a3a)],
  [0.5, hex(0x6b6f94)], // core gives way to metallic hydrogen
  [0.62, hex(0x7f93b8)],
  [0.79, hex(0xc3d0e2)],
  [0.81, hex(0x8f5a22)], // metallic gives way to molecular hydrogen
  [0.88, hex(0xc98a3a)],
  [0.96, hex(0xe6bf78)],
  [1, hex(0xf3e3c2)],
];

/**
 * Paint the planet's depth as one row of sRGB bytes (RGBA), centre first: the colour a cut face
 * shows at each radius. The colours are illustrative; nobody has seen these layers.
 */
export function paintDepths(width: number): Uint8Array {
  const out = new Uint8Array(width * 4);
  for (let i = 0; i < width; i++) {
    const t = i / (width - 1);
    let k = DEPTHS.findIndex((d) => t <= d[0]);
    if (k < 1) k = 1;
    const [t0, a] = DEPTHS[k - 1]!;
    const [t1, b] = DEPTHS[k]!;
    const f = smooth((t - t0) / (t1 - t0));
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round((a[c]! + (b[c]! - a[c]!) * f) * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Fine streaks for looking closely: grey sRGB bytes (RGBA) that tile both ways, long along the
 * wind. Laid over the painting many times round the planet, it keeps the clouds crisp up close.
 */
export function paintDetail(size: number, seed = 9): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  // Two noises a half tile apart, cross-faded down the tile, so the top row meets the bottom one.
  const rows = 24;
  for (let j = 0; j < size; j++) {
    const y = (j / size) * rows;
    const w = smooth(Math.abs(1 - (2 * j) / size));
    for (let i = 0; i < size; i++) {
      const x = (i / size) * 6;
      const a = fbm(x, y, 6, 4, seed);
      const b = fbm(x + 2.5, y + (y < rows / 2 ? rows / 2 : -rows / 2) + 100, 6, 4, seed);
      const v = Math.round(Math.min(1, Math.max(0, 0.5 + (a + (b - a) * w - 0.5) * 2.2)) * 255);
      out.set([v, v, v, 255], (j * size + i) * 4);
    }
  }
  return out;
}
