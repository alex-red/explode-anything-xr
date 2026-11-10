import { AdditiveBlending, BackSide, Color, CylinderGeometry, DoubleSide, Group, Mesh, PlaneGeometry, ShaderMaterial, type IUniform } from '@iwsdk/core';
import { COLOR } from './palette.ts';

/**
 * The holographic look, without post-processing (ADR-0013, ADR-0022): a body shader with bright
 * rims and scanlines, additive halos that stand in for bloom, energy-conduit edges, and a
 * projector stage. Everything animates from one shared clock uniform, so a frame costs one
 * number write and no allocation.
 */

/** Seconds, wrapped so the shaders keep float precision. Advanced once per frame by `tickHolo`. */
const TIME: IUniform<number> = { value: 0 };

export function tickHolo(dt: number): void {
  TIME.value = (TIME.value + dt) % 600;
}

/**
 * World-space height below which hologram bodies are drawn. A model boots up by raising this
 * from its stage; a bright scan front rides the edge. Far above everything when not booting.
 */
const REVEAL: IUniform<number> = { value: 1e6 };
const REVEALED = 1e6;

export function setReveal(worldY: number | null): void {
  REVEAL.value = worldY ?? REVEALED;
}

// World-space varyings shared by the body shader; handles instanced batches and single meshes.
const BODY_VERTEX = /* glsl */ `
uniform vec3 uColor;
varying vec3 vWorld;
varying vec3 vColor;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
    m = modelMatrix * instanceMatrix;
  #endif
  vec4 world = m * vec4(position, 1.0);
  vWorld = world.xyz;
  vColor = uColor;
  #ifdef USE_INSTANCING_COLOR
    vColor *= instanceColor;
  #endif
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const BODY_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uReveal;
uniform vec3 uEmissive;
varying vec3 vWorld;
varying vec3 vColor;
void main() {
  // Boot-up: nothing above the scan front yet, and a bright line riding it.
  float below = uReveal - vWorld.y;
  if (below < 0.0) discard;
  float front = smoothstep(0.03, 0.0, below);
  // Faceted normal from screen-space derivatives: every face reads as a cut crystal plane.
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 v = normalize(cameraPosition - vWorld);
  if (dot(n, v) < 0.0) n = -n;
  float rim = pow(1.0 - dot(n, v), 2.2);
  float light = 0.3 + 0.7 * max(dot(n, normalize(vec3(0.35, 1.0, 0.55))), 0.0);
  // Fine scanlines drifting upward, and a slow bright band sweeping through the whole model.
  float scan = smoothstep(0.55, 1.0, 0.5 + 0.5 * sin(vWorld.y * 520.0 - uTime * 5.0));
  float sweep = smoothstep(0.985, 1.0, 0.5 + 0.5 * sin(vWorld.y * 7.0 - uTime * 0.9));
  float flicker = 0.97 + 0.03 * sin(uTime * 41.0);
  vec3 body = vColor * light * 0.55;
  vec3 glow = vColor * (rim * 1.7 + scan * 0.22 + sweep * 0.9) + uEmissive + vec3(0.6, 0.95, 1.0) * front * 1.6;
  float alpha = clamp(uOpacity + rim * 0.75 + scan * 0.12 + sweep * 0.35 + front, 0.0, 1.0);
  gl_FragColor = vec4((body + glow) * flicker, alpha);
  #include <colorspace_fragment>
}`;

/**
 * A hologram body: dark translucent facets, bright rim, scanlines. `color` and `emissive` are
 * live `Color`s (as on a standard material), so state changes are plain colour writes.
 */
export class HoloMaterial extends ShaderMaterial {
  readonly color: Color;
  readonly emissive: Color;

  constructor(color: number | Color = 0xffffff, opacity = 0.5) {
    const c = new Color(color);
    const e = new Color(0x000000);
    super({
      uniforms: { uTime: TIME, uReveal: REVEAL, uColor: { value: c }, uEmissive: { value: e }, uOpacity: { value: opacity } },
      vertexShader: BODY_VERTEX,
      fragmentShader: BODY_FRAGMENT,
      transparent: true,
    });
    this.color = c;
    this.emissive = e;
  }
}

/**
 * Edges as energy conduits, one instanced batch. `aFlow` (per instance, 0..1) turns on pulses
 * that travel from source to target; only traced-path edges set it, so moving light always
 * means "this is the traced flow". Other edges just breathe.
 */
export function conduitMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: TIME },
    vertexShader: /* glsl */ `
attribute float aFlow;
varying vec3 vColor;
varying float vAlong;
varying float vFlow;
varying float vSide;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 world = m * vec4(position, 1.0);
  vColor = instanceColor;
  // Metres along the tube from its source end (the unit cylinder runs -0.5..0.5 on y).
  vAlong = (position.y + 0.5) * length(instanceMatrix[1].xyz);
  vFlow = aFlow;
  vec3 n = normalize(mat3(m) * normal);
  vSide = abs(dot(n, normalize(cameraPosition - world.xyz)));
  gl_Position = projectionMatrix * viewMatrix * world;
}`,
    fragmentShader: /* glsl */ `
uniform float uTime;
varying vec3 vColor;
varying float vAlong;
varying float vFlow;
varying float vSide;
void main() {
  float core = 0.55 + 0.45 * vSide; // hotter down the middle of the tube
  float breathe = 0.85 + 0.15 * sin(uTime * 1.7 + vAlong * 9.0);
  float pulse = smoothstep(0.7, 1.0, 0.5 + 0.5 * sin(vAlong * 55.0 - uTime * 7.0)) * vFlow;
  vec3 c = vColor * core * breathe * (1.25 + vFlow * 0.5) + vColor * pulse * 1.8 + vec3(pulse * 0.5);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`,
  });
}

/**
 * Soft additive halos, one instanced batch of camera-facing quads: the stand-in for bloom. Each
 * instance's matrix gives a centre and a size (its scale); its colour carries the intensity.
 */
export function haloMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: TIME },
    vertexShader: /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  float size = length(m[0].xyz);
  vec4 view = viewMatrix * vec4(m[3].xyz, 1.0);
  view.xy += position.xy * size;
  vUv = uv * 2.0 - 1.0;
  vColor = instanceColor;
  gl_Position = projectionMatrix * view;
}`,
    fragmentShader: /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
void main() {
  float d = length(vUv);
  float a = pow(max(0.0, 1.0 - d), 2.4);
  gl_FragColor = vec4(vColor * a, a);
  #include <colorspace_fragment>
}`,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}

/**
 * The projector stage under the model: concentric rings, a rotating scanner arc, tick marks and
 * a radial grid, drawn by one shader on one flat quad, plus a faint beam of light rising from
 * its rim. Two draw calls. Purely decorative; rays ignore it.
 */
export function createStage(radius: number): { group: Group; dispose(): void } {
  const material = new ShaderMaterial({
    uniforms: { uTime: TIME, uColor: { value: new Color(COLOR.stage) }, uAccent: { value: new Color(COLOR.route) } },
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uAccent;
varying vec2 vUv;
const float TAU = 6.28318530718;
float ring(float r, float at, float w) { return smoothstep(w, 0.0, abs(r - at)); }
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float a = atan(vUv.y, vUv.x);
  float glow = 0.0;
  // Fixed rings.
  glow += ring(r, 0.97, 0.012) * 0.9;
  glow += ring(r, 0.62, 0.006) * 0.5;
  glow += ring(r, 0.30, 0.006) * 0.45;
  // Tick marks round the rim, every 5 degrees, longer every 30.
  float tick = smoothstep(0.035, 0.0, abs(fract(a / TAU * 72.0 + 0.5) - 0.5));
  float major = smoothstep(0.05, 0.0, abs(fract(a / TAU * 12.0 + 0.5) - 0.5));
  glow += tick * ring(r, 0.905, 0.03) * 0.7 + major * ring(r, 0.86, 0.07) * 0.8;
  // Two dashed rings turning opposite ways.
  float dashA = step(0.5, fract((a + uTime * 0.25) / TAU * 18.0));
  float dashB = step(0.35, fract((a - uTime * 0.4) / TAU * 7.0));
  glow += ring(r, 0.78, 0.014) * dashA * 0.8;
  glow += ring(r, 0.46, 0.012) * dashB * 0.7;
  // Faint radial spokes and fine concentric grid inside.
  float spokes = smoothstep(0.02, 0.0, abs(fract(a / TAU * 24.0 + 0.5) - 0.5)) * step(0.3, r) * step(r, 0.62);
  float grid = smoothstep(0.08, 0.0, abs(fract(r * 14.0 + 0.5) - 0.5)) * 0.12;
  glow += spokes * 0.22 + grid;
  // A scanner wedge sweeping round, and a soft pool of light in the middle.
  float sweep = fract((a + uTime * 0.6) / TAU);
  float wedge = pow(sweep, 9.0) * step(r, 0.97) * 0.28;
  float pool = pow(max(0.0, 1.0 - r), 3.0) * 0.55;
  vec3 c = uColor * (glow + pool) + uAccent * wedge;
  float alpha = clamp(glow + pool * 0.6 + wedge, 0.0, 1.0) * smoothstep(1.0, 0.94, r);
  gl_FragColor = vec4(c * alpha, alpha);
  #include <colorspace_fragment>
}`,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const disc = new Mesh(new PlaneGeometry(radius * 2, radius * 2), material);
  disc.rotation.x = -Math.PI / 2;
  disc.renderOrder = -1;

  // The beam: an open cylinder whose light thins out as it rises, with slow streaks turning in it.
  const beamHeight = radius * 0.55;
  const beamMaterial = new ShaderMaterial({
    uniforms: { uTime: TIME, uColor: { value: new Color(COLOR.stage) } },
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float rise = pow(1.0 - vUv.y, 2.6);
  float streaks = 0.6 + 0.4 * sin(vUv.x * 150.0 + uTime * 0.8) * sin(vUv.x * 37.0 - uTime * 0.5);
  float a = rise * streaks * 0.3;
  gl_FragColor = vec4(uColor * a, a);
  #include <colorspace_fragment>
}`,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const beam = new Mesh(new CylinderGeometry(radius * 1.03, radius * 0.97, beamHeight, 48, 1, true), beamMaterial);
  beam.position.y = beamHeight / 2;
  beam.renderOrder = -1;

  const group = new Group();
  group.add(disc, beam);
  return {
    group,
    dispose() {
      disc.geometry.dispose();
      material.dispose();
      beam.geometry.dispose();
      beamMaterial.dispose();
    },
  };
}

/**
 * The inside of the backdrop sphere for the dimmed and virtual views: deep navy overhead, a
 * glowing horizon, and a perspective grid running out along a floor below. `uOpacity` fades the
 * whole thing, so the dimmed view lays the grid faintly over the real room.
 */
export function backdropMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: TIME, uOpacity: { value: 0 }, uGrid: { value: new Color(COLOR.stage) }, uHorizon: { value: new Color(COLOR.route) } },
    vertexShader: /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uGrid;
uniform vec3 uHorizon;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 sky = mix(vec3(0.012, 0.03, 0.065), vec3(0.004, 0.008, 0.02), smoothstep(-0.1, 0.9, d.y));
  // Horizon: a thin bright line with a soft violet haze above and below it.
  float haze = exp(-abs(d.y) * 9.0);
  vec3 c = sky + uHorizon * haze * 0.16 + uGrid * smoothstep(0.012, 0.0, abs(d.y)) * 0.35;
  // Floor grid 1.4 m below the eyes, 0.5 m cells, fading with distance.
  if (d.y < -0.02) {
    vec2 p = d.xz / -d.y * 1.4;
    vec2 cell = abs(fract(p / 0.5 + 0.5) - 0.5);
    float w = 0.012 * (1.0 + length(p) * 0.6); // keep the lines about as wide on screen
    float line = max(smoothstep(w, 0.0, cell.x), smoothstep(w, 0.0, cell.y));
    float fade = exp(-length(p) * 0.16);
    float pulse = 0.75 + 0.25 * sin(length(p) * 1.6 - uTime * 0.9); // a slow ripple running outward
    c += uGrid * line * fade * pulse * 0.4;
  }
  gl_FragColor = vec4(c, uOpacity);
  #include <colorspace_fragment>
}`,
    transparent: true,
    depthWrite: false,
    side: BackSide,
  });
}
