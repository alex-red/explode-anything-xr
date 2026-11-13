import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  LatheGeometry,
  MathUtils,
  Path,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector2,
  Vector3,
  type MeshPhysicalMaterial,
  type Texture,
} from '@iwsdk/core';

/**
 * A surface finish: what a real material looks like under light. Finishes are shared constants,
 * so an assembly groups its pieces by finish identity and draws each finish once.
 */
export interface Finish {
  readonly name: string;
  readonly color: number;
  readonly metalness: number;
  readonly roughness: number;
  readonly clearcoat?: number;
  readonly emissive?: number;
  readonly emissiveIntensity?: number;
  /** Below 1: see-through (glass). */
  readonly opacity?: number;
  /** Soft fabric response (foam, cloth). */
  readonly sheen?: number;
  readonly envIntensity?: number;
  /**
   * A painted surface (made once, shared, never disposed with a part). Every piece given this
   * finish must carry UVs.
   */
  readonly map?: () => Texture;
  /** With `map`: the painting also glows a little by itself (0..1), so it reads in a dim room. */
  readonly selfLit?: number;
  /** Last touch on the finished material (a shader hook for motion). Runs once per part, never per frame. */
  readonly shade?: (m: MeshPhysicalMaterial) => void;
  /** A light of its own (a field line, an aurora): when its part stops, it goes dark instead of glowing red. */
  readonly goesOut?: boolean;
}

const q = new Quaternion();
const e = new Euler();
const v = new Vector3();

/** Pieces of one part, grouped by finish; each finish becomes one merged mesh (one draw call). */
export class Assembly {
  readonly pieces = new Map<Finish, BufferGeometry[]>();

  /** Add `g` turned by `rot` (radians, XYZ) and moved to `at`. Returns this for chaining. */
  add(f: Finish, g: BufferGeometry, at: readonly [number, number, number] = [0, 0, 0], rot: readonly [number, number, number] = [0, 0, 0]): this {
    if (rot[0] || rot[1] || rot[2]) g.applyQuaternion(q.setFromEuler(e.set(rot[0], rot[1], rot[2])));
    g.translate(at[0], at[1], at[2]);
    const list = this.pieces.get(f);
    if (list) list.push(g);
    else this.pieces.set(f, [g]);
    return this;
  }

  /** Bake the part's authored rotation (degrees, as partGeometry does) into every piece. */
  rotate(deg: readonly [number, number, number]): this {
    if (!deg[0] && !deg[1] && !deg[2]) return this;
    q.setFromEuler(e.set(MathUtils.degToRad(deg[0]), MathUtils.degToRad(deg[1]), MathUtils.degToRad(deg[2])));
    for (const list of this.pieces.values()) for (const g of list) g.applyQuaternion(q);
    return this;
  }

  /** One merged geometry per finish. */
  merged(): Array<[Finish, BufferGeometry]> {
    return [...this.pieces].map(([f, list]) => [f, merge(list)]);
  }
}

/** Concatenate geometries (positions and normals) into one non-indexed geometry. */
export function merge(list: BufferGeometry[]): BufferGeometry {
  const flat = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (!n.getAttribute('normal')) n.computeVertexNormals();
    return n;
  });
  let count = 0;
  for (const g of flat) count += g.getAttribute('position').count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  // UVs are kept only when every piece has them (a painted finish).
  const uv = flat.every((g) => g.getAttribute('uv')) ? new Float32Array(count * 2) : null;
  let k = 0;
  for (const g of flat) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const t = uv ? g.getAttribute('uv') : null;
    for (let i = 0; i < p.count; i++, k++) {
      if (uv && t) uv.set([t.getX(i), t.getY(i)], k * 2);
      pos.set([p.getX(i), p.getY(i), p.getZ(i)], k * 3);
      nor.set([n.getX(i), n.getY(i), n.getZ(i)], k * 3);
    }
  }
  for (const g of list) g.dispose();
  for (const g of flat) g.dispose();
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nor, 3));
  if (uv) out.setAttribute('uv', new BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

/** A solid of revolution about +y from [radius, y] points (in order along the outline). */
export function lathe(profile: ReadonlyArray<readonly [number, number]>, segments = 32): BufferGeometry {
  return new LatheGeometry(profile.map(([r, y]) => new Vector2(Math.max(0, r), y)), segments);
}

/** A plain cylinder about +y; `segments` low for small pieces. */
export function cyl(r: number, h: number, segments = 24, rTop = r): BufferGeometry {
  return new CylinderGeometry(rTop, r, h, segments);
}

/** A closed tube about +y from `r0` to `r1` (a washer, a barrel, a ring), height `h`. */
export function ring(rInner: number, rOuter: number, h: number, segments = 32): BufferGeometry {
  const y = h / 2;
  return lathe([[rInner, -y], [rOuter, -y], [rOuter, y], [rInner, y], [rInner, -y]], segments);
}

/** A rounded rectangle outline centred on the origin. */
export function roundedRect(target: Shape | Path, w: number, h: number, r: number): Shape | Path {
  const x = -w / 2;
  const y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  target.moveTo(x + r, y);
  target.lineTo(x + w - r, y);
  target.quadraticCurveTo(x + w, y, x + w, y + r);
  target.lineTo(x + w, y + h - r);
  target.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  target.lineTo(x + r, y + h);
  target.quadraticCurveTo(x, y + h, x, y + h - r);
  target.lineTo(x, y + r);
  target.quadraticCurveTo(x, y, x + r, y);
  return target;
}

/** A hole path: rounded rect offset to (cx, cy). Holes are wound the other way round. */
export function roundedHole(w: number, h: number, r: number, cx: number, cy: number): Path {
  const p = roundedRect(new Path(), w, h, r) as Path;
  const pts = p.getPoints(6).map((pt) => new Vector2(pt.x + cx, pt.y + cy)).reverse();
  return new Path(pts);
}

export function circleHole(r: number, cx: number, cy: number): Path {
  const p = new Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, true);
  return p;
}

/**
 * Extrude a shape in local XY by `depth` along +z, centred on z = 0, with a soft edge bevel.
 */
export function slab(shape: Shape, depth: number, bevel = 0.0008, curveSegments = 10): BufferGeometry {
  const b = Math.min(bevel, depth * 0.4);
  const g = new ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, depth - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 2,
    curveSegments,
  });
  g.translate(0, 0, -(depth - 2 * b) / 2);
  return g;
}

/** A rounded box: a rounded-rect slab w × h, depth d along z, corner radius r. */
export function roundedBox(w: number, h: number, d: number, r: number, bevel = 0.0008): BufferGeometry {
  const b = Math.min(bevel, d * 0.4, w * 0.2, h * 0.2);
  return slab(roundedRect(new Shape(), w - 2 * b, h - 2 * b, Math.max(0, r - b)) as Shape, d, b);
}

/**
 * A spur-gear outline in XY: `teeth` trapezoid teeth between root and tip radius, with a bore
 * and optional lightening holes round a pitch circle.
 */
export function gearShape(teeth: number, rRoot: number, rTip: number, bore: number, holes = 0, holeR = 0, holeAt = 0): Shape {
  const s = new Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts: Array<[number, number]> = [
      [rRoot, a],
      [rTip, a + step * 0.18],
      [rTip, a + step * 0.42],
      [rRoot, a + step * 0.6],
    ];
    pts.forEach(([r, t], j) => {
      const x = r * Math.cos(t);
      const y = r * Math.sin(t);
      if (i === 0 && j === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    });
  }
  s.closePath();
  if (bore > 0) s.holes.push(circleHole(bore, 0, 0));
  for (let i = 0; i < holes; i++) {
    const t = (i / holes) * Math.PI * 2 + step / 2;
    s.holes.push(circleHole(holeR, holeAt * Math.cos(t), holeAt * Math.sin(t)));
  }
  return s;
}

/** Copies of `make()` placed round the +y axis at radius `r`, height `y`. */
export function around(count: number, r: number, y: number, make: () => BufferGeometry, phase = 0): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const t = phase + (i / count) * Math.PI * 2;
    v.set(r * Math.cos(t), y, r * Math.sin(t));
    out.push(make().translate(v.x, v.y, v.z));
  }
  return out;
}

/**
 * A band of a globe about +y, between polar angles `from` and `from + span` (0 is the north
 * pole), with UVs for a painting of the whole globe: u runs with longitude (u = 0.25 faces +z),
 * v from the south pole (0) to the north (1).
 */
export function globeBand(r: number, from: number, span: number, around = 96, down = 32): BufferGeometry {
  const g = new SphereGeometry(r, around, down, 0, Math.PI * 2, from, span);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (from + (1 - uv.getY(i)) * span) / Math.PI);
  return g;
}

const UP = new Vector3(0, 1, 0);

/** Turn a piece built about +y so its axis points along the unit direction `to`. */
export function aim(g: BufferGeometry, to: readonly [number, number, number]): BufferGeometry {
  return g.applyQuaternion(q.setFromUnitVectors(UP, v.set(to[0], to[1], to[2])));
}

/**
 * A round patch of a globe centred on the unit direction `to`, angular radius `angle`, with the
 * same UVs as `globeBand`. Not for patches that cross the back seam (u = 0).
 */
export function globePatch(r: number, to: readonly [number, number, number], angle: number, around = 40, down = 8): BufferGeometry {
  const g = aim(new SphereGeometry(r, around, down, 0, Math.PI * 2, 0, angle), to);
  const p = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const lon = Math.atan2(p.getZ(i), -p.getX(i));
    uv.setXY(i, (lon < 0 ? lon + Math.PI * 2 : lon) / (Math.PI * 2), 1 - Math.acos(Math.max(-1, Math.min(1, p.getY(i) / r))) / Math.PI);
  }
  return g;
}
