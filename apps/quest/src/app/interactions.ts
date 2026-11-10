import { createSystem, Hovered, Pressed, RayInteractable, type Entity, type Object3D, type World } from '@iwsdk/core';

export interface InteractionHandlers {
  press?: () => void;
  hover?: (on: boolean) => void;
}

const handlers = new WeakMap<Object3D, InteractionHandlers>();
const lastPress = new WeakMap<Object3D, number>();
/** Objects whose pinch has started but not yet been released. */
const pending = new Set<Object3D>();
let enabled = true;

/** Globally suspend ray presses while a two-hand pull is in progress; pinches already started are dropped. */
export function setInteractionsEnabled(on: boolean): void {
  enabled = on;
  if (!on) pending.clear();
}

/**
 * A pinch started on an object. Nothing happens yet: the press is delivered on release, so the
 * first hand of a two-hand pull can never select, press a button, or commit a prediction.
 */
export function pressStart(obj: Object3D): void {
  if (enabled) pending.add(obj);
}

/** The pinch was released. Delivers the press unless a two-hand pull cancelled it meanwhile. */
export function pressEnd(obj: Object3D): void {
  if (pending.delete(obj)) firePress(obj);
}

/** Create a ray/pointer-interactable entity for an Object3D (works with hands, controllers, and mouse). */
export function makeInteractive(world: World, object: Object3D, parent: Entity, h: InteractionHandlers): Entity {
  const entity = world.createTransformEntity(object, { parent });
  entity.addComponent(RayInteractable);
  handlers.set(object, h);
  return entity;
}

/** Deliver a press to an interactive object right now (pressEnd and the test harness use this). */
export function firePress(obj: Object3D): void {
  if (!enabled) return;
  const now = performance.now();
  if (now - (lastPress.get(obj) ?? -Infinity) < 250) return; // debounce pinch flicker
  lastPress.set(obj, now);
  handlers.get(obj)?.press?.();
}

export function fireHover(obj: Object3D, on: boolean): void {
  handlers.get(obj)?.hover?.(on);
}

export function isInteractive(obj: Object3D): boolean {
  return handlers.has(obj);
}

/** Routes IWSDK's Pressed/Hovered tags to registered handlers. */
export class InteractionSystem extends createSystem({
  pressed: { required: [RayInteractable, Pressed] },
  hovered: { required: [RayInteractable, Hovered] },
}) {
  init(): void {
    this.queries.pressed.subscribe('qualify', (entity) => {
      if (entity.object3D) pressStart(entity.object3D);
    });
    this.queries.pressed.subscribe('disqualify', (entity) => {
      if (entity.object3D) pressEnd(entity.object3D);
    });
    this.queries.hovered.subscribe('qualify', (entity) => {
      if (entity.object3D) fireHover(entity.object3D, true);
    });
    this.queries.hovered.subscribe('disqualify', (entity) => {
      if (entity.object3D) fireHover(entity.object3D, false);
    });
  }
}
