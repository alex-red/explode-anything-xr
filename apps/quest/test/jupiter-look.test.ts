/**
 * Jupiter's look: the painted clouds (pure, so checked pixel by pixel) and the parts built from
 * them. No WebGL: what the painting looks like on the globe is judged in the emulator.
 */
import { describe, expect, it } from 'vitest';
import { Box3, type Mesh, type MeshPhysicalMaterial } from '@iwsdk/core';
import { ContentBundle } from '@explode/contracts';
import jupiterJson from '../src/content/jupiter.bundle.json';
import { SPOT, paintDepths, paintJupiter } from '../src/app/looks/jupiter-paint.ts';
import { JUPITER_ORIGINS, RADIUS, windsShader } from '../src/app/looks/jupiter.ts';
import { buildLook, hasLook, tickLooks } from '../src/app/looks/registry.ts';

const W = 256;
const H = 128;
const px = paintJupiter(W, H);
const at = (lon: number, lat: number) => {
  const o = (Math.floor(((lat + 90) / 180) * H) * W + Math.floor((lon / 360) * W)) * 4;
  return [px[o]!, px[o + 1]!, px[o + 2]!] as const;
};
/** Mean colour along a whole line of latitude. */
const ring = (lat: number) => {
  const sum = [0, 0, 0];
  for (let i = 0; i < W; i++) at(((i + 0.5) / W) * 360, lat).forEach((c, k) => (sum[k]! += c / W));
  return sum as [number, number, number];
};
const luma = (c: readonly number[]) => 0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!;

describe('the cloud painting', () => {
  it('is the same every time, and opaque', () => {
    expect(Buffer.from(paintJupiter(W, H)).equals(Buffer.from(px))).toBe(true);
    for (let i = 3; i < px.length; i += 4) expect(px[i]).toBe(255);
    expect(Buffer.from(paintJupiter(W, H, 6)).equals(Buffer.from(px))).toBe(false);
  });

  it('has light zones between dark belts, and greyer, bluer poles', () => {
    expect(luma(ring(0))).toBeGreaterThan(luma(ring(12)) + 40); // equatorial zone over the north belt
    expect(luma(ring(0))).toBeGreaterThan(luma(ring(-17)) + 40);
    expect(luma(ring(20))).toBeGreaterThan(luma(ring(12)) + 40);
    const belt = ring(12);
    expect(belt[0]).toBeGreaterThan(belt[2] * 1.5); // a belt is red-brown
    const pole = ring(84);
    expect(pole[0] - pole[2]).toBeLessThan(belt[0] - belt[2] - 40);
  });

  it('paints the Great Red Spot where the plug is cut, redder than anything beside it', () => {
    const spot = at(SPOT.lon, SPOT.lat);
    expect(spot[0]).toBeGreaterThan(spot[1] * 1.5);
    expect(spot[0]).toBeGreaterThan(spot[2] * 2);
    const far = at(SPOT.lon + 180, SPOT.lat);
    expect(far[0] - far[2]).toBeLessThan(spot[0] - spot[2] - 30);
  });

  it('wraps round the back without a seam', () => {
    let worst = 0;
    for (let j = 0; j < H; j++) {
      const a = (j * W) * 4;
      const b = (j * W + W - 1) * 4;
      worst = Math.max(worst, Math.abs(px[a]! - px[b]!), Math.abs(px[a + 1]! - px[b + 1]!), Math.abs(px[a + 2]! - px[b + 2]!));
    }
    // No bigger a step across the seam than between ordinary neighbours.
    let usual = 0;
    for (let j = 0; j < H; j++) for (let i = 100; i < 110; i++) usual = Math.max(usual, Math.abs(px[(j * W + i) * 4]! - px[(j * W + i + 1) * 4]!));
    expect(worst).toBeLessThanOrEqual(usual + 12);
  });
});

describe('the planet built from it', () => {
  const bundle = ContentBundle.parse(jupiterJson);
  const parts = bundle.assets!.parts;
  const build = (id: string) => buildLook(bundle.graph.system_id, id, parts[id]!, null);
  const mesh = (id: string, finish: string) => build(id).group.children.find((c) => c.name === finish) as Mesh | undefined;

  it('draws every part as its own model, in at most 25 draw calls for the whole planet', () => {
    let draws = 0;
    for (const id of Object.keys(parts)) {
      expect(hasLook(bundle.graph.system_id, id), id).toBe(true);
      draws += build(id).meshes;
    }
    expect(Object.keys(JUPITER_ORIGINS).sort()).toEqual(Object.keys(parts).sort());
    expect(draws).toBeLessThanOrEqual(25); // 21 on Nov 12
  });

  it('nests the layers: core inside the metallic ocean inside the molecular envelope inside the deck', () => {
    const reach = (id: string, finish: string) => {
      const p = mesh(id, finish)!.geometry.getAttribute('position');
      let near = Infinity;
      let far = 0;
      for (let i = 0; i < p.count; i++) {
        const d = Math.hypot(p.getX(i), p.getY(i) / 0.935, p.getZ(i)); // undo the flattening
        near = Math.min(near, d);
        far = Math.max(far, d);
      }
      return { near, far };
    };
    const hollow = (id: string) => reach(id, 'depth-cut').near;
    expect(reach('part:core', 'core-haze').far).toBeLessThan(hollow('part:metallic'));
    expect(reach('part:metallic', 'metallic-skin').far).toBeLessThan(hollow('part:molecular'));
    expect(reach('part:molecular', 'molecular-skin').far).toBeLessThan(RADIUS * (1 - 0.042)); // the deck's underside
    // Each layer has a quarter cut away: nothing of its skin in front and to the left.
    const skin = mesh('part:metallic', 'metallic-skin')!.geometry.getAttribute('position');
    for (let i = 0; i < skin.count; i++) expect(skin.getX(i) < -1e-4 && skin.getZ(i) > 1e-4).toBe(false);
  });

  it('colours a cut face by depth: hot at the centre, steel through the metal, amber under the clouds', () => {
    const row = paintDepths(256);
    const c = (t: number) => [row[Math.round(t * 255) * 4]!, row[Math.round(t * 255) * 4 + 1]!, row[Math.round(t * 255) * 4 + 2]!];
    expect(luma(c(0))).toBeGreaterThan(luma(c(0.6)) + 60);
    expect(c(0.65)[2]).toBeGreaterThan(c(0.65)[0]); // metallic: bluer than red
    expect(c(0.9)[0]).toBeGreaterThan(c(0.9)[2] + 60); // molecular: amber
    const uv = mesh('part:molecular', 'depth-cut')!.geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThan(0.8);
      expect(uv.getX(i)).toBeLessThanOrEqual(1);
    }
  });

  it('a stopped field and aurora go dark; a stopped layer of the planet glows red like any other part', () => {
    const glow = (id: string, finish: string) => {
      const look = build(id);
      const mat = (look.group.children.find((c) => c.name === finish) as Mesh).material as MeshPhysicalMaterial;
      const lit = mat.emissiveIntensity;
      look.set('fault', 1);
      return { lit, stopped: mat.emissiveIntensity };
    };
    for (const [id, finish] of [['part:field', 'field-line'], ['part:field', 'radiation-belt'], ['part:aurora', 'aurora'], ['part:aurora', 'aurora-veil']] as const) {
      const g = glow(id, finish);
      expect(g.lit, finish).toBeGreaterThan(0.5);
      expect(g.stopped, finish).toBeLessThanOrEqual(0.1);
    }
    expect(glow('part:metallic', 'metallic-skin').stopped).toBeGreaterThan(0.5);
  });

  it('the field reaches from pole to pole outside the planet, tilted off its spin axis', () => {
    const p = mesh('part:field', 'field-line')!.geometry.getAttribute('position');
    const b = new Box3().setFromBufferAttribute(p as never);
    let far = 0;
    for (let i = 0; i < p.count; i++) far = Math.max(far, Math.hypot(p.getX(i), p.getY(i), p.getZ(i)));
    expect(far).toBeGreaterThan(RADIUS * 1.3);
    expect(far).toBeLessThanOrEqual(0.116); // inside its ray target
    expect(b.max.y).toBeGreaterThan(0.03);
    // Tilted: the lines are not mirror images above and below the planet's equator at the front.
    let frontTop = 0;
    let backTop = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getZ(i) > 0.05) frontTop = Math.max(frontTop, p.getY(i));
      if (p.getZ(i) < -0.05) backTop = Math.max(backTop, p.getY(i));
    }
    expect(Math.abs(frontTop - backTop)).toBeGreaterThan(0.005);
  });

  it('closed, the parts sit where the spec puts them, so the globe is whole', () => {
    for (const [id, origin] of Object.entries(JUPITER_ORIGINS)) expect(bundle.layout.placements[id]!.collapsed, id).toEqual([...origin]);
  });

  it('wraps the painting round both decks and the spot, lit a little from within', () => {
    for (const id of ['part:clouds-north', 'part:clouds-south', 'part:red-spot']) {
      const m = mesh(id, 'cloud-tops')!;
      expect(m.geometry.getAttribute('uv'), id).toBeDefined();
      const mat = m.material as MeshPhysicalMaterial;
      expect(mat.map, id).not.toBeNull();
      expect(mat.emissiveMap).toBe(mat.map);
    }
    // One painting, shared.
    expect((mesh('part:clouds-north', 'cloud-tops')!.material as MeshPhysicalMaterial).map).toBe((mesh('part:red-spot', 'cloud-tops')!.material as MeshPhysicalMaterial).map);
    // A plain finish carries no painting.
    expect((mesh('part:clouds-north', 'deck-underside')!.material as MeshPhysicalMaterial).map).toBeNull();
  });

  it('the decks meet at the equator, and each is a dome of the planet, flattened at the pole', () => {
    const box = (id: string) => {
      const o = JUPITER_ORIGINS[id]!;
      const b = new Box3().setFromBufferAttribute(mesh(id, 'cloud-tops')!.geometry.getAttribute('position') as never);
      return { minY: b.min.y + o[1], maxY: b.max.y + o[1], maxX: b.max.x + o[0] };
    };
    const north = box('part:clouds-north');
    const south = box('part:clouds-south');
    expect(north.minY).toBeCloseTo(0, 5);
    expect(south.maxY).toBeCloseTo(0, 5);
    expect(north.maxX).toBeCloseTo(RADIUS, 5);
    expect(north.maxY).toBeLessThan(RADIUS * 0.95);
    expect(north.maxY).toBeGreaterThan(RADIUS * 0.9);
    expect(south.minY).toBeCloseTo(-north.maxY, 5);
  });

  it('the spot plug covers its socket, and its painting lines up with the deck under it', () => {
    const o = JUPITER_ORIGINS['part:red-spot']!;
    const plug = mesh('part:red-spot', 'cloud-tops')!.geometry;
    const uv = plug.getAttribute('uv');
    let u = 0;
    let v = 0;
    for (let i = 0; i < uv.count; i++) {
      u += uv.getX(i) / uv.count;
      v += uv.getY(i) / uv.count;
    }
    expect(u * 360).toBeCloseTo(SPOT.lon, 0);
    expect(v * 180 - 90).toBeCloseTo(SPOT.lat, 0);
    const reach = (id: string, finish: string, origin: readonly number[]) => {
      const p = mesh(id, finish)!.geometry.getAttribute('position');
      let far = 0;
      for (let i = 0; i < p.count; i++) far = Math.max(far, Math.hypot(p.getX(i) + origin[0]! - o[0], p.getY(i) + origin[1]! - o[1], p.getZ(i) + origin[2]! - o[2]));
      return far;
    };
    expect(reach('part:red-spot', 'cloud-tops', o)).toBeGreaterThan(reach('part:clouds-south', 'spot-socket', JUPITER_ORIGINS['part:clouds-south']!));
    expect(mesh('part:clouds-north', 'spot-socket')).toBeUndefined();
  });

  it('the clouds drift: only their shader is rewritten, and one shared clock drives all three parts', () => {
    const stock = 'void main() {\n#include <map_fragment>\n#include <normal_fragment_begin>\n#include <emissivemap_fragment>\n}';
    const out = windsShader(stock);
    expect(out.startsWith('uniform float uDrift;')).toBe(true);
    expect(out).not.toMatch(/#include <map_fragment>|#include <emissivemap_fragment>/);
    expect(out).toMatch(/#include <normal_fragment_begin>/);
    expect(out.indexOf('jupiterTexel = mix')).toBeLessThan(out.indexOf('totalEmissiveRadiance *= jupiterTexel'));
    // The slide is held to nothing at the spot, which is painted where the plug is cut.
    expect(out).toContain(`vMapUv.x - ${(SPOT.lon / 360).toFixed(4)}`);

    const clocks = ['part:clouds-north', 'part:clouds-south', 'part:red-spot'].map((id) => {
      const mat = mesh(id, 'cloud-tops')!.material as MeshPhysicalMaterial;
      expect(mat.customProgramCacheKey()).toBe('jupiter-winds');
      const shader = { uniforms: {} as Record<string, { value: unknown }>, fragmentShader: stock };
      mat.onBeforeCompile(shader as never, null as never);
      expect(shader.fragmentShader).toBe(out);
      return shader.uniforms.uDrift as { value: number };
    });
    expect(clocks[1]).toBe(clocks[0]);
    expect(clocks[2]).toBe(clocks[0]);
    tickLooks(12);
    const a = clocks[0]!.value;
    tickLooks(24);
    expect(clocks[0]!.value).toBeGreaterThan(a);
    // A plain finish keeps the stock shader.
    const plain = mesh('part:clouds-north', 'deck-underside')!.material as MeshPhysicalMaterial;
    expect(plain.customProgramCacheKey()).not.toMatch(/^jupiter-/);
    // Lights that move carry their own UVs to do it with.
    for (const [id, finish, key] of [['part:field', 'field-line', 'jupiter-beads'], ['part:aurora', 'aurora-veil', 'jupiter-curtain']] as const) {
      const m = mesh(id, finish)!;
      expect(m.geometry.getAttribute('uv'), finish).toBeDefined();
      expect((m.material as MeshPhysicalMaterial).customProgramCacheKey()).toBe(key);
      expect((m.material as MeshPhysicalMaterial).defines).toHaveProperty('USE_UV');
    }
  });

  it('moves by itself where it should: the field and aurora wobble together, the spot turns only once lifted out', () => {
    const field = build('part:field');
    const aurora = build('part:aurora');
    field.tick(10, 0);
    aurora.tick(10, 0);
    expect(field.group.rotation.y).toBeGreaterThan(0);
    expect(aurora.group.rotation.y).toBe(field.group.rotation.y);
    const spot = build('part:red-spot');
    spot.tick(7, 0);
    expect(spot.group.quaternion.w).toBe(1); // set in its socket: at rest, as painted
    spot.tick(7, 1);
    expect(spot.group.quaternion.w).toBeLessThan(1);
    // A layer tips as it flies and is level when it arrives, then only rides up and down.
    const metal = build('part:metallic');
    metal.tick(7, 0);
    expect(metal.group.rotation.z).toBeCloseTo(0, 12);
    expect(metal.group.position.y).toBeCloseTo(0, 12);
    metal.tick(7, 0.5);
    expect(Math.abs(metal.group.rotation.z)).toBeGreaterThan(0.1);
    metal.tick(7, 1);
    expect(Math.abs(metal.group.rotation.z)).toBeLessThan(1e-9);
    expect(Math.abs(metal.group.position.y)).toBeLessThanOrEqual(0.002);
  });

  it('comes apart from the outside in', () => {
    const stage = (id: string) => build(id).stage!;
    expect(stage('part:field')).toBeLessThan(stage('part:clouds-north'));
    expect(stage('part:clouds-north')).toBe(stage('part:clouds-south'));
    expect(stage('part:clouds-south')).toBeLessThan(stage('part:red-spot'));
    expect(stage('part:red-spot')).toBeLessThan(stage('part:molecular'));
    expect(stage('part:molecular')).toBeLessThan(stage('part:metallic'));
    expect(stage('part:metallic')).toBeLessThan(stage('part:core'));
  });
});

describe('the headset and the drivetrain in motion', () => {
  const build = (system: string, id: string) => buildLook(system, id, { shape: 'box', size: [0.1, 0.05, 0.02], color: '#ffffff', rotation_deg: [0, 0, 0] }, null);

  it('the headset comes apart shell first and lenses last; the drivetrain wheels first and battery last', () => {
    const hs = (id: string) => build('system:mr-headset', `part:${id}`).stage!;
    expect(hs('shell')).toBe(0);
    expect(hs('shell')).toBeLessThan(hs('cameras'));
    expect(hs('cameras')).toBeLessThan(hs('board'));
    expect(hs('board')).toBeLessThan(hs('display'));
    expect(hs('display')).toBeLessThan(hs('lens-left'));
    expect(hs('lens-left')).toBe(hs('lens-right'));
    const dt = (id: string) => build('system:ev-drivetrain', `part:${id}`).stage!;
    expect(dt('wheel-left')).toBe(0);
    expect(dt('wheel-left')).toBeLessThan(dt('axle-left'));
    expect(dt('axle-left')).toBeLessThan(dt('differential'));
    expect(dt('differential')).toBeLessThan(dt('gearbox'));
    expect(dt('gearbox')).toBeLessThan(dt('motor'));
    expect(dt('motor')).toBeLessThan(dt('inverter'));
    expect(dt('inverter')).toBeLessThan(dt('battery'));
  });

  it('a closed model is exactly its layout: nothing tips or rides until it opens', () => {
    for (const [system, id] of [['system:mr-headset', 'part:shell'], ['system:mr-headset', 'part:lens-left'], ['system:ev-drivetrain', 'part:battery']] as const) {
      const look = build(system, id);
      look.tick(33, 0);
      expect(look.group.rotation.x, id).toBeCloseTo(0, 12);
      expect(look.group.rotation.z, id).toBeCloseTo(0, 12);
      expect(look.group.position.y, id).toBeCloseTo(0, 12);
      look.tick(33, 1);
      expect(Math.abs(look.group.rotation.x) + Math.abs(look.group.rotation.z), id).toBeLessThan(1e-9); // level again on arrival
      expect(Math.abs(look.group.position.y), id).toBeLessThanOrEqual(0.002);
    }
    // Lenses never tip, even in flight; parts that spin on their shafts are left alone.
    const lens = build('system:mr-headset', 'part:lens-left');
    lens.tick(5, 0.5);
    expect(lens.group.rotation.z).toBeCloseTo(0, 12);
    expect(build('system:ev-drivetrain', 'part:motor').move).toBeNull();
    expect(build('system:ev-drivetrain', 'part:wheel-left').move).toBeNull();
  });
});
