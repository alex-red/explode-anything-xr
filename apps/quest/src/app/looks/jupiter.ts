import {
  CatmullRomCurve3,
  CylinderGeometry,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  UnsignedByteType,
  Vector3,
  type BufferGeometry,
  type MeshPhysicalMaterial,
  type Texture,
} from '@iwsdk/core';
import { SPOT, paintDepths, paintDetail, paintJupiter } from './jupiter-paint.ts';
import { Assembly, aim, globeBand, globePatch, lathe, ring, type Finish } from './kit.ts';
import type { LookBuilder, Motion } from './look.ts';
import { afloat } from './motion.ts';

/**
 * Jupiter, drawn from the outside in. The cloud deck is two hemisphere shells that part at the
 * equator (belts and zones run along latitude, so the cut crosses none of them), and the Great
 * Red Spot is a shallow plug that lifts out of the southern one. The clouds are painted by rule
 * (jupiter-paint.ts): an illustration, not imagery. Under the deck, each layer is a ball with a
 * quarter cut away, so its thickness and the hollow the next layer sat in can be seen; the cut
 * faces are coloured by depth. Round it all: the magnetic field as lines of a tilted dipole with
 * a radiation belt, an auroral oval at the pole, and Io trailing an arc of its plasma ring.
 * Illustrative like the teaching model it draws: the spot's depth is exaggerated, the field, Io
 * and the aurora are not to scale, and the colours of the interior are invented.
 */

/** Equatorial radius of the model, metres, and how much shorter the planet is pole to pole. */
export const RADIUS = 0.08;
const OBLATE = 0.935;
/** Thickness of the weather layer: about 3,000 km of a 71,500 km radius. */
const DECK = RADIUS * 0.042;
const HALF = Math.PI / 2;
const RAD = Math.PI / 180;

/** The spot's direction from the planet's centre (longitude 90° faces the viewer, +z). */
const SPOT_DIR: readonly [number, number, number] = [
  -Math.cos(SPOT.lon * RAD) * Math.cos(SPOT.lat * RAD),
  Math.sin(SPOT.lat * RAD),
  Math.sin(SPOT.lon * RAD) * Math.cos(SPOT.lat * RAD),
];
/** Angular radius of the plug: the spot and the pale hollow round it. */
const PLUG = 12 * RAD;

/**
 * Where each part's own origin sits in the planet's frame; the spec's collapsed positions are
 * these, so the closed model is one whole globe. A shell's origin is inside its dome, where the
 * plain hit volume covers most of it.
 */
export const JUPITER_ORIGINS: Record<string, readonly [number, number, number]> = {
  'part:clouds-north': [0, 0.03, 0],
  'part:clouds-south': [0, -0.03, 0],
  'part:red-spot': [0, round(RADIUS * SPOT_DIR[1] * OBLATE), round(RADIUS * SPOT_DIR[2])],
  'part:molecular': [0, 0, 0],
  'part:metallic': [0, 0, 0],
  'part:core': [0, 0, 0],
  'part:field': [0, 0, 0],
  'part:aurora': [0, 0.0735, 0],
  'part:io': [0.118, 0, 0],
};

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

const PAINT_W = 1024;
const PAINT_H = 512;
let painting: DataTexture | null = null;

/** The cloud painting, made on first use and kept: every Jupiter part shares it. */
function clouds(): Texture {
  if (painting) return painting;
  painting = new DataTexture(paintJupiter(PAINT_W, PAINT_H), PAINT_W, PAINT_H, RGBAFormat, UnsignedByteType);
  painting.colorSpace = SRGBColorSpace;
  painting.wrapS = RepeatWrapping;
  painting.magFilter = LinearFilter;
  painting.minFilter = LinearMipmapLinearFilter;
  painting.generateMipmaps = true;
  painting.anisotropy = 8;
  painting.needsUpdate = true;
  return painting;
}

/** Seconds for the winds to carry the clouds through one cycle of their drift. */
const DRIFT_PERIOD = 24;
const DRIFT = { value: 0 };

/** Set the winds to `time` seconds. Called once a frame while a mechanical model is shown. */
export function driftClouds(time: number): void {
  DRIFT.value = time / DRIFT_PERIOD;
}

let streaks: DataTexture | null = null;

/** Fine streaks laid over the painting (made on first use and kept). */
function detail(): Texture {
  if (streaks) return streaks;
  streaks = new DataTexture(paintDetail(256), 256, 256, RGBAFormat, UnsignedByteType);
  streaks.wrapS = RepeatWrapping;
  streaks.wrapT = RepeatWrapping;
  streaks.magFilter = LinearFilter;
  streaks.minFilter = LinearMipmapLinearFilter;
  streaks.generateMipmaps = true;
  streaks.needsUpdate = true;
  return streaks;
}

/**
 * The painting is read twice, each copy slid along its latitude by that latitude's wind and
 * half a cycle apart, and the two are cross-faded so neither is seen snapping back: the belts and
 * zones stream past each other for ever without the picture winding up. Round the Great Red Spot
 * the slide fades to nothing, so the spot stays in its plug. Fine streaks ride on each copy, the
 * colours are deepened a little, and a warm glow is added at the limb.
 */
const WINDS_MAP = /* glsl */ `
#ifdef USE_MAP
  float jLat = vMapUv.y;
  float jWind = 0.016 * sin(jLat * 43.98) + 0.010 * sin(jLat * 15.71 + 1.0) + 0.018 * exp(-pow((jLat - 0.5) / 0.05, 2.0));
  jWind *= smoothstep(0.07, 0.15, length(vec2((vMapUv.x - ${(SPOT.lon / 360).toFixed(4)}) * 2.0, jLat - ${((SPOT.lat + 90) / 180).toFixed(4)})));
  float jA = fract(uDrift);
  float jB = fract(uDrift + 0.5);
  vec2 jUvA = vMapUv + vec2(jWind * (jA - 0.5), 0.0);
  vec2 jUvB = vMapUv + vec2(jWind * (jB - 0.5), 0.0);
  vec4 jTexA = texture2D(map, jUvA, uLook.x);
  vec4 jTexB = texture2D(map, jUvB, uLook.x);
  jTexA.rgb *= 1.0 + uLook.z * (texture2D(uDetail, jUvA * vec2(18.0, 9.0)).r - 0.5);
  jTexB.rgb *= 1.0 + uLook.z * (texture2D(uDetail, jUvB * vec2(18.0, 9.0)).r - 0.5);
  vec4 jupiterTexel = mix(jTexA, jTexB, abs(1.0 - 2.0 * jA));
  jupiterTexel.rgb = pow(max(mix(vec3(dot(jupiterTexel.rgb, vec3(0.3, 0.59, 0.11))), jupiterTexel.rgb, 1.3), 0.0), vec3(1.15));
  diffuseColor *= jupiterTexel;
#endif
`;
const WINDS_GLOW = /* glsl */ `
#ifdef USE_MAP
  totalEmissiveRadiance *= jupiterTexel.rgb;
  float jRim = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0);
  totalEmissiveRadiance += vec3(1.0, 0.8, 0.55) * jRim * uLook.y;
#endif
`;

/** Rewrite a standard fragment shader so the clouds drift (exported for tests; no WebGL needed). */
export function windsShader(fragment: string): string {
  return `uniform float uDrift;\nuniform vec3 uLook;\nuniform sampler2D uDetail;\n${fragment}`
    .replace('#include <map_fragment>', WINDS_MAP)
    .replace('#include <emissivemap_fragment>', WINDS_GLOW);
}

/** A shader hook for a painted finish: how soft the painting is read, how strong the limb glow and the fine streaks are. */
function winds(blur: number, rim: number, fine: number): (m: MeshPhysicalMaterial) => void {
  const look = { value: new Vector3(blur, rim, fine) };
  const fineMap = { value: null as Texture | null };
  return (m) => {
    m.onBeforeCompile = (shader) => {
      fineMap.value = detail();
      shader.uniforms.uDrift = DRIFT;
      shader.uniforms.uLook = look;
      shader.uniforms.uDetail = fineMap;
      shader.fragmentShader = windsShader(shader.fragmentShader);
    };
    m.customProgramCacheKey = () => 'jupiter-winds';
  };
}

/**
 * A shader hook for a light that moves along its own length or round its ring: `body` is GLSL
 * run where the glow is worked out, with the piece's own UVs in vUv and the shared clock in uDrift.
 */
function glow(key: string, body: string): (m: MeshPhysicalMaterial) => void {
  return (m) => {
    const withDefines = m as MeshPhysicalMaterial & { defines?: Record<string, string> };
    withDefines.defines = { ...withDefines.defines, USE_UV: '' };
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uDrift = DRIFT;
      shader.fragmentShader = `uniform float uDrift;\n${shader.fragmentShader}`.replace('#include <emissivemap_fragment>', body);
    };
    m.customProgramCacheKey = () => key;
  };
}

/** Bright beads running along each field line from one pole to the other. */
const BEADS = glow('jupiter-beads', /* glsl */ `
  float jBead = smoothstep(0.6, 1.0, 0.5 + 0.5 * sin(vUv.x * 18.85 - uDrift * 70.0));
  totalEmissiveRadiance *= 0.4 + 1.5 * jBead;
`);

/** Curtains of light: rays that shift round the oval, brightest at the foot and fading upward. */
const CURTAIN = glow('jupiter-curtain', /* glsl */ `
  float jRay = 0.5 + 0.5 * sin(vUv.x * 150.8 + uDrift * 55.0) * sin(vUv.x * 62.83 - uDrift * 33.0);
  float jFade = pow(1.0 - vUv.y, 1.7) * (0.35 + 0.65 * jRay);
  totalEmissiveRadiance *= mix(vec3(0.55, 1.0, 1.0), vec3(1.0, 0.55, 1.0), vUv.y) * jFade * 2.4;
  diffuseColor.a *= jFade;
`);

/** A slow breathing of the core's heat. */
const EMBER = glow('jupiter-ember', /* glsl */ `
  totalEmissiveRadiance *= 0.86 + 0.14 * sin(uDrift * 34.0);
`);

const CLOUDS: Finish = { name: 'cloud-tops', color: 0xffffff, metalness: 0, roughness: 0.9, envIntensity: 0.35, map: clouds, selfLit: 0.12, shade: winds(0, 0.2, 0.3) };
const UNDERSIDE: Finish = { name: 'deck-underside', color: 0x2c1a12, metalness: 0, roughness: 0.95, envIntensity: 0.2 };
const CUT: Finish = { name: 'deck-cut', color: 0xd8c4a2, metalness: 0, roughness: 0.7, envIntensity: 0.3 };
const SOCKET: Finish = { name: 'spot-socket', color: 0x4a2418, metalness: 0, roughness: 1, envIntensity: 0 };
const ROOT: Finish = { name: 'storm-root', color: 0x7a2e1c, metalness: 0, roughness: 0.8, envIntensity: 0.3 };

/** Flatten a piece of the globe as the planet is flattened, then move it into its part's frame. */
function place(a: Assembly, f: Finish, g: BufferGeometry, id: string): Assembly {
  const o = JUPITER_ORIGINS[id]!;
  return a.add(f, g.scale(1, OBLATE, 1), [-o[0], -o[1], -o[2]]);
}

/** One half of the cloud deck: painted outside, dark underneath, a pale cut face at the equator. */
function deck(north: boolean): LookBuilder {
  return (_part, id) => {
    const from = north ? 0 : HALF;
    const a = new Assembly();
    place(a, CLOUDS, globeBand(RADIUS, from, HALF, 128, 48), id);
    place(a, UNDERSIDE, globeBand(RADIUS - DECK, from, HALF, 64, 24), id);
    place(a, CUT, ring(RADIUS - DECK, RADIUS, 0.0003, 96), id);
    // Where the spot sits: a dark hollow just proud of the clouds, covered by the plug when closed.
    if (!north) place(a, SOCKET, globePatch(RADIUS + 0.0003, SPOT_DIR, PLUG - 0.5 * RAD), id);
    return a;
  };
}

/** The Great Red Spot: its patch of cloud tops on a shallow lens of storm beneath. */
const spot: LookBuilder = (_part, id) => {
  const r = RADIUS + 0.0007;
  const rim = r * Math.sin(PLUG);
  const top = r * Math.cos(PLUG);
  const depth = 0.006;
  const a = new Assembly();
  place(a, CLOUDS, globePatch(r, SPOT_DIR, PLUG, 48, 8), id);
  place(a, ROOT, aim(lathe([[0, top - depth], [rim * 0.6, top - depth * 0.8], [rim, top]], 48), SPOT_DIR), id);
  return a;
};


// ---------------------------------------------------------------- the interior

/** Outer and inner radius of each layer, metres. The boundaries are approximate, and gradual in the real planet. */
const MOLECULAR = [RADIUS - DECK - 0.0004, RADIUS * 0.806] as const;
const METALLIC = [RADIUS * 0.8, RADIUS * 0.46] as const;
const CORE = RADIUS * 0.35;

let depthRow: DataTexture | null = null;

/** The colour of a cut face at each depth (u = radius / RADIUS), made on first use and kept. */
function depths(): Texture {
  if (depthRow) return depthRow;
  depthRow = new DataTexture(paintDepths(256), 256, 1, RGBAFormat, UnsignedByteType);
  depthRow.colorSpace = SRGBColorSpace;
  depthRow.magFilter = LinearFilter;
  depthRow.minFilter = LinearFilter;
  depthRow.needsUpdate = true;
  return depthRow;
}

const CUT_FACE: Finish = { name: 'depth-cut', color: 0xffffff, metalness: 0, roughness: 0.6, envIntensity: 0.3, map: depths, selfLit: 0.35 };
// The envelope shows the cloud bands again, read soft and deep through amber: the same winds, further down.
const GAS_SKIN: Finish = { name: 'molecular-skin', color: 0xe8963c, metalness: 0, roughness: 0.42, clearcoat: 0.8, envIntensity: 0.8, map: clouds, selfLit: 0.1, shade: winds(5, 0.3, 0) };
const METAL_SKIN: Finish = { name: 'metallic-skin', color: 0xc2cede, metalness: 1, roughness: 0.14, envIntensity: 1.7 };
const CORE_GLOW: Finish = { name: 'core', color: 0xffd9a0, metalness: 0, roughness: 0.5, emissive: 0xff7a22, emissiveIntensity: 1.3, envIntensity: 0.2, shade: EMBER };
const CORE_HAZE: Finish = { name: 'core-haze', color: 0xff9a4a, metalness: 0, roughness: 1, opacity: 0.22, emissive: 0xff6a1a, emissiveIntensity: 0.9, envIntensity: 0 };

/** Give every vertex the depth colour of one radius, or of its own distance from the axis of a flat face. */
function shadeByDepth(g: BufferGeometry, radius?: number): BufferGeometry {
  const p = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) uv.setXY(i, (radius ?? Math.hypot(p.getX(i), p.getY(i))) / RADIUS, 0.5);
  return g;
}

/**
 * A layer as a ball with the quarter toward the viewer's left cut away (from the front, +z, round
 * to -x): its skin outside, and inside the cut the two flat faces and the hollow, coloured by depth.
 */
function layer(skin: Finish, [outer, inner]: readonly [number, number]): LookBuilder {
  return (_part, id) => {
    const a = new Assembly();
    place(a, skin, new SphereGeometry(outer, 64, 32, HALF, 3 * HALF), id);
    place(a, CUT_FACE, shadeByDepth(new SphereGeometry(inner, 48, 24, HALF, 3 * HALF), inner), id);
    // Half rings in the planes of the cut: one facing the viewer (x < 0), one facing left (z > 0).
    for (const turn of [Math.PI, -HALF]) place(a, CUT_FACE, shadeByDepth(new RingGeometry(inner, outer, 48, 1, -HALF, Math.PI)).rotateY(turn), id);
    return a;
  };
}

/** The dilute core: a hot ball with no hard edge, so it is wrapped in two thin shells of haze. */
const core: LookBuilder = (_part, id) => {
  const a = new Assembly();
  place(a, CORE_GLOW, new SphereGeometry(CORE, 40, 24), id);
  place(a, CORE_HAZE, new SphereGeometry(CORE * 1.14, 32, 20), id);
  place(a, CORE_HAZE, new SphereGeometry(CORE * 1.28, 32, 20), id);
  return a;
};

// ---------------------------------------------------------------- the field, the aurora, Io

const FIELD_LINE: Finish = { name: 'field-line', color: 0x9cc8ff, metalness: 0, roughness: 0.4, emissive: 0x4aa0ff, emissiveIntensity: 1.4, envIntensity: 0, goesOut: true, shade: BEADS };
const BELT: Finish = { name: 'radiation-belt', color: 0x3a7bff, metalness: 0, roughness: 1, opacity: 0.11, emissive: 0x2f6bff, emissiveIntensity: 0.8, envIntensity: 0, goesOut: true };
const AURORA: Finish = { name: 'aurora', color: 0xd9c2ff, metalness: 0, roughness: 0.4, emissive: 0xb07cff, emissiveIntensity: 1.8, envIntensity: 0, goesOut: true };
const VEIL: Finish = { name: 'aurora-veil', color: 0x8fd8ff, metalness: 0, roughness: 1, opacity: 0.85, emissive: 0xffffff, emissiveIntensity: 1, envIntensity: 0, goesOut: true, shade: CURTAIN };
const SULFUR: Finish = { name: 'io', color: 0xe3c64b, metalness: 0, roughness: 0.8, envIntensity: 0.4 };
const VENT: Finish = { name: 'io-vents', color: 0xb5471f, metalness: 0, roughness: 0.9, envIntensity: 0.2 };
const PLASMA: Finish = { name: 'plasma-ring', color: 0xffc46b, metalness: 0, roughness: 1, opacity: 0.3, emissive: 0xffa53a, emissiveIntensity: 0.9, envIntensity: 0 };

/**
 * One line of a dipole field about +z: it leaves the planet near one magnetic pole, reaches
 * `reach` over the magnetic equator, and returns near the other. `turn` picks its meridian.
 */
function fieldLine(reach: number, turn: number): BufferGeometry {
  // r = reach · cos²(latitude); start and end just under the clouds.
  const top = Math.acos(Math.sqrt((RADIUS * 0.92) / reach));
  const points: Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const lat = -top + (i / 24) * 2 * top;
    const r = reach * Math.cos(lat) ** 2;
    const flat = r * Math.cos(lat);
    points.push(new Vector3(flat * Math.cos(turn), flat * Math.sin(turn), r * Math.sin(lat)));
  }
  return new TubeGeometry(new CatmullRomCurve3(points), 48, 0.0005, 5, false);
}

/**
 * The magnetic field, about the part's +z (the spec tilts that axis ten degrees off the planet's
 * spin axis, as the real field is tilted): two shells of field lines and a radiation belt.
 */
const field: LookBuilder = () => {
  const a = new Assembly();
  for (let i = 0; i < 8; i++) {
    a.add(FIELD_LINE, fieldLine(0.1, (i / 8) * Math.PI * 2));
    a.add(FIELD_LINE, fieldLine(0.114, ((i + 0.5) / 8) * Math.PI * 2));
  }
  a.add(BELT, new TorusGeometry(0.107, 0.0042, 8, 64).scale(1, 1, 0.5));
  return a;
};

/**
 * The northern auroral oval, about the part's +z, which the spec turns to point down: a bright
 * ring just above the clouds, set a little off the pole as the magnetic pole is, a veil of light
 * rising from it, and the bright spot where Io's current comes down.
 */
const aurora: LookBuilder = (part) => {
  const r = (part.size[0] - part.size[1]) / 2;
  const off = 0.004;
  return new Assembly()
    .add(AURORA, new TorusGeometry(r, 0.0011, 6, 64), [off, 0, 0])
    .add(AURORA, new SphereGeometry(0.0017, 10, 8), [off + r, 0, -0.0004])
    .add(VEIL, new CylinderGeometry(r * 1.16, r, 0.014, 96, 1, true).rotateX(-HALF), [off, 0, -0.007]);
};

/** Io: a sulphur-yellow moon with dark volcanic patches, on an arc of the plasma ring that follows its orbit. */
const io: LookBuilder = (_part, id) => {
  const o = JUPITER_ORIGINS[id]!;
  const moon = 0.0055;
  const a = new Assembly().add(SULFUR, new SphereGeometry(moon, 20, 14));
  const vents: Array<readonly [number, number, number]> = [[0.2, 0.5, 0.84], [-0.6, 0.1, 0.79], [0.7, -0.4, 0.59], [-0.2, -0.8, 0.56], [0.5, 0.7, -0.5], [-0.7, -0.3, -0.65]];
  for (const [x, y, z] of vents) {
    const n = Math.hypot(x, y, z);
    a.add(VENT, globePatch(moon + 0.0001, [x / n, y / n, z / n], 0.3, 12, 2));
  }
  // The ring is centred on the planet; this part carries the sixth of it nearest the moon.
  const arc = Math.PI / 3;
  a.add(PLASMA, new TorusGeometry(Math.hypot(o[0], o[2]), 0.0032, 8, 32, arc).rotateZ(-arc / 2).rotateX(HALF), [-o[0], 0, -o[2]]);
  return a;
};

/** Builders by part id; every part of the Jupiter spec has one. */
export const JUPITER_LOOKS: Record<string, LookBuilder> = {
  'part:clouds-north': deck(true),
  'part:clouds-south': deck(false),
  'part:red-spot': spot,
  'part:molecular': layer(GAS_SKIN, MOLECULAR),
  'part:metallic': layer(METAL_SKIN, METALLIC),
  'part:core': core,
  'part:field': field,
  'part:aurora': aurora,
  'part:io': io,
};

// ---------------------------------------------------------------- motion

/**
 * The order the planet comes apart in: what is round it lifts away first, then the cloud deck
 * parts and the spot comes out, then the layers leave from the outside in. Closing runs it backwards.
 */
export const JUPITER_STAGES: Record<string, number> = {
  'part:field': 0,
  'part:aurora': 0.1,
  'part:io': 0.1,
  'part:clouds-north': 0.3,
  'part:clouds-south': 0.3,
  'part:red-spot': 0.45,
  'part:molecular': 0.6,
  'part:metallic': 0.8,
  'part:core': 1,
};

/** Radians a second the tilted field is carried round the planet's spin axis (far slower than the real ten-hour day, scaled). */
const WOBBLE = 0.25;
const SPOT_AXIS = new Vector3(...SPOT_DIR);
const TURN = Math.PI * 2;

/** The field is tilted off the spin axis and turns with the planet, so it wobbles; the aurora goes round with it. */
const wobble: Motion = (group, time) => {
  group.rotation.y = time * WOBBLE;
};

/**
 * Lifted out, the spot turns anticlockwise as the storm does. Set back in, it comes to rest the
 * way it was painted, so its clouds line up with the deck round it.
 */
const storm: Motion = (group, time, open) => {
  group.quaternion.setFromAxisAngle(SPOT_AXIS, ((time * 0.5) % TURN) * open * open * (3 - 2 * open));
};

/** Parts that move by themselves. The winds, the beads on the field lines and the aurora's rays are in their shaders. */
export const JUPITER_MOTION: Record<string, Motion> = {
  'part:field': wobble,
  'part:aurora': wobble,
  'part:red-spot': storm,
  // The cloud deck opens like a shell on a hinge: each half tips away as it leaves, and levels out.
  'part:clouds-north': afloat(0, 'x', -0.8),
  'part:clouds-south': afloat(1.6, 'x', 0.8),
  'part:molecular': afloat(3.1, 'z', 0.5),
  'part:metallic': afloat(4.4, 'z', -0.5),
  'part:core': afloat(5.5, 'z', 0),
  'part:io': afloat(2.2, 'z', 0),
};
