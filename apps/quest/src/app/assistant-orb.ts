import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, SphereGeometry, type Entity, type Vector3, type World } from '@iwsdk/core';
import { placeFacing, type LayoutMode } from './fov.ts';
import { makeInteractive } from './interactions.ts';
import { COLOR, CSS } from './palette.ts';
import { TextPanel } from './text.ts';

export type OrbState = 'idle' | 'listening' | 'thinking';

const RADIUS = 0.022; // 4.4 cm across: a ray target on its own
const LABEL_W = 0.13;
const LABEL_H = 0.034;
/** Wide layout: low on the right, in the gap between the evidence panel and the gesture card, nearer than both. */
const WIDE = { x: 0.36, y: -0.14, z: 0.24, yaw: -0.55 };
/** Narrow layout, as [right°, up°, distance m] from the eye: below the evidence panel, above the toolbar strip. */
const NARROW = [26, -19, 0.55] as const;
/** m the icon keeps above a real surface. */
const FLOOR_MARGIN = 0.012;
const TINT: Record<OrbState, number> = { idle: COLOR.action, listening: COLOR.path, thinking: COLOR.route };
const LABEL: Record<OrbState, string> = { idle: 'Ask', listening: 'Listening…', thinking: 'Thinking…' };

/**
 * The assistant's icon: a small glowing ball with a label. Pinch it (or click it) to ask a
 * question aloud, and again to stop. It swells with the speaker's voice while listening and
 * breathes while the answer is on its way. State is also in the label, never in colour alone.
 */
export class AssistantOrb {
  readonly group = new Group();
  private readonly core: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly glow: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly label: TextPanel;
  private state: OrbState = 'idle';
  private hovered = false;
  private clock = 0;

  constructor(world: World, parent: Entity, onPress: () => void) {
    const entity = world.createTransformEntity(this.group, { parent });
    const geometry = new SphereGeometry(RADIUS, 24, 16);
    this.core = new Mesh(geometry, new MeshBasicMaterial({ color: COLOR.action, transparent: true, opacity: 0.92 }));
    this.glow = new Mesh(geometry, new MeshBasicMaterial({ color: COLOR.action, transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false }));
    this.label = new TextPanel({ width: LABEL_W, height: LABEL_H, pxPerMeter: 2800, padding: 10, radius: 22, align: 'center' });
    this.label.mesh.position.set(0, RADIUS + LABEL_H / 2 + 0.012, 0);
    const handlers = {
      ui: true,
      press: onPress,
      hover: (on: boolean) => {
        this.hovered = on;
        this.draw();
      },
    };
    makeInteractive(world, this.core, entity, handlers);
    makeInteractive(world, this.label.mesh, entity, handlers);
    world.createTransformEntity(this.glow, { parent: entity });
    this.draw();
  }

  /** Show what the assistant is doing; `label` replaces the usual word (a short notice). */
  set(state: OrbState, label?: string): void {
    this.state = state;
    this.core.material.color.setHex(TINT[state]);
    this.glow.material.color.setHex(TINT[state]);
    this.draw(label);
  }

  private draw(label?: string): void {
    this.label.draw([{ text: label ?? LABEL[this.state], size: 44, bold: true }], this.hovered ? CSS.buttonHover : this.state === 'idle' ? CSS.buttonBg : CSS.buttonPrimary);
  }

  /** Put the icon where the layout has room for it. `floor` is the desk's height in the anchor's frame, or null. */
  place(mode: LayoutMode, eye: Vector3, floor: number | null): void {
    if (mode === 'narrow') {
      placeFacing(this.group, eye, ...NARROW);
      return;
    }
    this.group.rotation.set(0, WIDE.yaw, 0);
    this.group.position.set(WIDE.x, floor === null ? WIDE.y : Math.max(WIDE.y, floor + RADIUS + FLOOR_MARGIN), WIDE.z);
  }

  /** Animate. `level` is how loud the speaker is, 0–1. No allocation. */
  update(dt: number, level: number): void {
    this.clock += dt;
    const breathe = this.state === 'thinking' ? 0.5 + 0.5 * Math.sin(this.clock * 6) : this.state === 'idle' ? 0.5 + 0.5 * Math.sin(this.clock * 1.6) : 0;
    const swell = this.state === 'listening' ? level : breathe * (this.state === 'thinking' ? 0.5 : 0.15);
    this.glow.scale.setScalar(1.35 + swell * 1.1);
    this.core.scale.setScalar(this.hovered ? 1.12 : 1);
  }
}
