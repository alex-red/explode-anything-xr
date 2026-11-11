import { describe, expect, it } from 'vitest';
import { DEFAULT_PICK, newSurface, pickSurface, type Placement, type Surface, type Viewer } from '../src/app/surface-pick.ts';

/** Seated at the origin, eyes at 1.2 m, facing -z (three.js forward). */
const viewer: Viewer = { x: 0, y: 1.2, z: 0, fx: 0, fz: -1 };

function surface(over: Partial<Surface>): Surface {
  return { ...newSurface(), horizontal: true, halfW: 0.7, halfD: 0.35, ...over };
}

function pick(surfaces: Surface[], v: Viewer = viewer): Placement | null {
  const out: Placement = { x: 99, y: 99, z: 99, index: -1 };
  return pickSurface(surfaces, surfaces.length, v, out) ? out : null;
}

const desk = surface({ y: 0.72, z: -0.6, label: 'table' });
const floor = surface({ y: 0, halfW: 3, halfD: 3, label: 'floor' });

describe('pickSurface', () => {
  it('stands the stage on the desk in front of the viewer, at the wanted reach', () => {
    const p = pick([floor, desk]);
    expect(p).not.toBeNull();
    expect(p!.index).toBe(1);
    expect(p!.y).toBeCloseTo(0.72);
    expect(p!.x).toBeCloseTo(0);
    expect(p!.z).toBeCloseTo(-DEFAULT_PICK.reach);
  });

  it('finds nothing with only a floor, a ceiling and walls', () => {
    const wall = surface({ y: 1.2, z: -2, horizontal: false, label: 'wall' });
    const ceiling = surface({ y: 2.4, halfW: 3, halfD: 3, label: 'ceiling' });
    expect(pick([floor, wall, ceiling])).toBeNull();
  });

  it('rejects an unlabelled floor by height alone', () => {
    expect(pick([surface({ y: 0, halfW: 3, halfD: 3 })])).toBeNull();
  });

  it('leaves the output untouched when nothing fits', () => {
    const out: Placement = { x: 1, y: 2, z: 3, index: 7 };
    expect(pickSurface([floor], 1, viewer, out)).toBe(false);
    expect(out).toEqual({ x: 1, y: 2, z: 3, index: 7 });
  });

  it('rejects a surface too high (a shelf at eye level) or too low (a footstool)', () => {
    expect(pick([surface({ y: 1.15, z: -0.6 })])).toBeNull();
    expect(pick([surface({ y: 0.3, z: -0.6 })])).toBeNull();
  });

  it('rejects a standing viewer over a sitting-height desk', () => {
    expect(pick([desk], { ...viewer, y: 1.65 })).toBeNull();
  });

  it('rejects a surface too small to hold the stage', () => {
    expect(pick([surface({ y: 0.72, z: -0.55, halfW: 0.1, halfD: 0.1 })])).toBeNull();
  });

  it('pulls the stage back from the near edge of a desk that starts further away', () => {
    // Near edge at z = -0.6, so the wanted point (z = -0.55) is off the desk.
    const far = surface({ y: 0.72, z: -0.95, label: 'table' });
    const p = pick([far]);
    expect(p).not.toBeNull();
    expect(p!.z).toBeCloseTo(-0.95 + 0.35 - DEFAULT_PICK.inset);
  });

  it('rejects a desk that is behind the viewer or across the room', () => {
    expect(pick([surface({ y: 0.72, z: 0.8, label: 'table' })])).toBeNull();
    expect(pick([surface({ y: 0.72, z: -2.5, label: 'table' })])).toBeNull();
  });

  it('follows the direction the viewer faces', () => {
    const right = surface({ y: 0.72, x: 0.6, z: 0, halfW: 0.35, halfD: 0.7, label: 'table' });
    expect(pick([right])).toBeNull(); // facing -z, the desk is off to the side
    const p = pick([right], { ...viewer, fx: 1, fz: 0 });
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(DEFAULT_PICK.reach);
    expect(p!.z).toBeCloseTo(0);
  });

  it('handles a rotated desk: the placement stays on its surface', () => {
    const yaw = Math.PI / 4;
    const turned = surface({ y: 0.72, x: 0, z: -0.7, halfW: 0.7, halfD: 0.3, yaw, label: 'table' });
    const p = pick([turned]);
    expect(p).not.toBeNull();
    // Back in the desk's frame the point must lie inside the inset rectangle.
    const dx = p!.x - turned.x;
    const dz = p!.z - turned.z;
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    expect(Math.abs(lx)).toBeLessThanOrEqual(turned.halfW - DEFAULT_PICK.inset + 1e-9);
    expect(Math.abs(lz)).toBeLessThanOrEqual(turned.halfD - DEFAULT_PICK.inset + 1e-9);
  });

  it('prefers the surface under the wanted point, and a labelled table on a tie', () => {
    const side = surface({ y: 0.72, x: 0.9, z: -0.55, halfW: 0.3, halfD: 0.3, label: 'table' });
    expect(pick([side, desk])!.index).toBe(1);
    const unlabelled = surface({ y: 0.7, z: -0.6 });
    expect(pick([unlabelled, desk])!.index).toBe(1);
    expect(pick([desk, unlabelled])!.index).toBe(0);
  });

  it('only considers the first `count` surfaces, so a pooled list can hold stale entries', () => {
    const out: Placement = { x: 0, y: 0, z: 0, index: -1 };
    expect(pickSurface([floor, desk], 1, viewer, out)).toBe(false);
  });
});
