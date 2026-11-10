import { describe, expect, it } from 'vitest';
import { unstickRayPointer } from '../src/app/pointer-unstick.ts';

/** The parts of IWSDK 1.0.1's MultiPointer that the work-around touches. */
function fakeMultiPointer(rayState: string, buttonDown: boolean) {
  const buttons = new Set<number>(buttonDown ? [0] : []);
  const ups: Array<{ button: number; timeStamp: number }> = [];
  return {
    ups,
    buttons,
    pointerStates: new Map([['ray', rayState], ['touch', 'normal'], ['grab', 'disabled']]),
    ray: {
      pointer: {
        getButtonsDown: () => buttons,
        up(e: { button: number; timeStamp: number }) {
          ups.push({ ...e });
          buttons.delete(e.button);
        },
      },
    },
  };
}

describe('IWSDK stuck ray pointer work-around', () => {
  it('releases a pointer left in select by a pinch that ended on nothing', () => {
    const mp = fakeMultiPointer('select', true);
    expect(unstickRayPointer(mp, false, 1234)).toBe(true);
    expect(mp.pointerStates.get('ray')).toBe('normal');
    expect(mp.ups).toEqual([{ button: 0, timeStamp: 1234 }]);
    expect(mp.buttons.has(0)).toBe(false);
    expect(unstickRayPointer(mp, false, 1250)).toBe(false); // nothing left to fix
  });

  it('leaves a pinch in progress alone', () => {
    const mp = fakeMultiPointer('select', true);
    expect(unstickRayPointer(mp, true, 1)).toBe(false);
    expect(mp.pointerStates.get('ray')).toBe('select');
    expect(mp.ups).toEqual([]);
  });

  it('leaves healthy pointers alone', () => {
    for (const state of ['hover', 'normal', 'disabled']) {
      const mp = fakeMultiPointer(state, false);
      expect(unstickRayPointer(mp, false, 1)).toBe(false);
      expect(mp.pointerStates.get('ray')).toBe(state);
    }
  });

  it('resets the state even if the button was already released', () => {
    const mp = fakeMultiPointer('select', false);
    expect(unstickRayPointer(mp, false, 1)).toBe(true);
    expect(mp.ups).toEqual([]);
    expect(mp.pointerStates.get('ray')).toBe('normal');
  });

  it('does nothing when the SDK does not have the expected shape', () => {
    expect(unstickRayPointer(undefined, false, 1)).toBe(false);
    expect(unstickRayPointer({}, false, 1)).toBe(false);
    expect(unstickRayPointer({ pointerStates: 'nope' }, false, 1)).toBe(false);
    expect(unstickRayPointer({ pointerStates: new Map([['ray', 'select']]) }, false, 1)).toBe(true); // no pointer object: still resets
  });
});
