/**
 * Work-around for a pointer state bug in IWSDK 1.0.1 (`@iwsdk/xr-input` MultiPointer).
 *
 * Its ray pointer goes hover → select when a pinch starts on a target, but only returns
 * select → hover if the ray is still on a target when the pinch ends. Release a pinch while the
 * ray is on nothing (which is how nearly every drag of the model ends) and that hand's pointer
 * stays in `select`: its next pinch is ignored, and only the one after works.
 *
 * So each frame, for a hand that is not pinching: if its ray pointer still says `select`, release
 * the button and return it to `normal`, from where IWSDK moves it back to hover by itself.
 *
 * This reaches into private fields, so it checks every one and does nothing if the shape differs
 * (the version is pinned; see CLAUDE.md). It allocates only when it actually fixes something.
 */
interface RayPointerLike {
  getButtonsDown?: () => { has(button: number): boolean };
  up?: (event: { button: number; timeStamp: number }) => void;
}
interface MultiPointerLike {
  pointerStates?: { get(kind: string): string | undefined; set(kind: string, state: string): unknown };
  ray?: { pointer?: RayPointerLike };
}

const SELECT_BUTTON = 0;

/** Returns true when it had to release a stuck pointer. */
export function unstickRayPointer(multiPointer: unknown, selecting: boolean, timeStampMs: number): boolean {
  if (selecting || !multiPointer) return false;
  const mp = multiPointer as MultiPointerLike;
  const states = mp.pointerStates;
  if (!states || typeof states.get !== 'function' || states.get('ray') !== 'select') return false;
  const pointer = mp.ray?.pointer;
  if (pointer?.getButtonsDown?.().has(SELECT_BUTTON)) pointer.up?.({ button: SELECT_BUTTON, timeStamp: timeStampMs });
  states.set('ray', 'normal');
  return true;
}
