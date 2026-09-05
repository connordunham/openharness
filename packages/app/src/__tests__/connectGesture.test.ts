import { describe, expect, it } from 'vitest';
import {
  CONNECT_DRAG_THRESHOLD_PX,
  cancelConnect,
  movePointer,
  pressPort,
  releasePort,
  shouldDrawPreview,
  type ConnectState,
} from '../connectGesture.js';

/** Ports are opaque to the gesture; a string is enough to test with. */
const same = (a: string, b: string) => a === b;
const at = (x: number, y: number) => ({ x, y });

const idle: ConnectState<string> = { phase: 'idle' };

/** Arm from idle by pressing `port` at the given screen origin. */
function arm(port = 'A', clientX = 100, clientY = 100) {
  return pressPort(idle, port, at(0, 0), clientX, clientY, same).state;
}

describe('connect gesture — drag idiom', () => {
  it('press, drag past the threshold, release over a target connects', () => {
    let state = arm('A');
    expect(state.phase).toBe('armed');

    state = movePointer(state, 100 + CONNECT_DRAG_THRESHOLD_PX + 1, 100, at(50, 0)).state;
    expect(state).toMatchObject({ moved: true, pressActive: true });

    const { state: after, action } = releasePort(state, 'B', same);
    expect(action).toEqual({ kind: 'connect', from: 'A', to: 'B' });
    expect(after.phase).toBe('idle');
  });

  it('releasing over empty space cancels', () => {
    let state = arm('A');
    state = movePointer(state, 200, 200, at(50, 50)).state;

    const { state: after, action } = releasePort(state, null, same);
    expect(action).toEqual({ kind: 'cancel' });
    expect(after.phase).toBe('idle');
  });

  it('dragging back to the source and releasing there cancels', () => {
    let state = arm('A');
    state = movePointer(state, 200, 200, at(50, 50)).state;

    expect(releasePort(state, 'A', same).action).toEqual({ kind: 'cancel' });
  });

  it('a drag onto an invalid target cancels rather than leaving it armed', () => {
    let state = arm('A');
    state = movePointer(state, 200, 200, at(50, 50)).state;

    const never = () => false;
    const { state: after, action } = releasePort(state, 'B', same, never);
    expect(action).toEqual({ kind: 'cancel' });
    expect(after.phase).toBe('idle');
  });
});

describe('connect gesture — click idiom', () => {
  it('press and release without moving stays armed, then a second press connects', () => {
    let state = arm('A');

    // The mouseup that ends the arming click must NOT complete or cancel.
    const released = releasePort(state, 'A', same);
    expect(released.action).toEqual({ kind: 'update' });
    state = released.state;
    expect(state).toMatchObject({ phase: 'armed', pressActive: false });

    const { state: after, action } = pressPort(state, 'B', at(9, 9), 300, 300, same);
    expect(action).toEqual({ kind: 'connect', from: 'A', to: 'B' });
    expect(after.phase).toBe('idle');
  });

  it('pressing the source again cancels', () => {
    let state = releasePort(arm('A'), 'A', same).state;

    const { state: after, action } = pressPort(state, 'A', at(0, 0), 100, 100, same);
    expect(action).toEqual({ kind: 'cancel' });
    expect(after.phase).toBe('idle');
  });

  it('pressing an invalid target keeps the gesture armed so the source is not lost', () => {
    const state = releasePort(arm('A'), 'A', same).state;

    const never = () => false;
    const { state: after, action } = pressPort(state, 'B', at(9, 9), 300, 300, same, never);
    expect(action).toEqual({ kind: 'update' });
    expect(after).toMatchObject({ phase: 'armed' });
    expect(after.phase === 'armed' && after.source.port).toBe('A');
  });

  it('the mouseup after a completing click is inert', () => {
    // pressPort already returned to idle; the trailing mouseup must not be
    // read as a second gesture.
    expect(releasePort(idle, 'B', same).action).toEqual({ kind: 'none' });
  });
});

describe('connect gesture — cancellation and preview', () => {
  it('Escape cancels an armed gesture and is inert when idle', () => {
    expect(cancelConnect(arm('A')).action).toEqual({ kind: 'cancel' });
    expect(cancelConnect(idle).action).toEqual({ kind: 'none' });
  });

  it('movement below the threshold is not a drag', () => {
    const state = movePointer(arm('A'), 100 + CONNECT_DRAG_THRESHOLD_PX - 1, 100, at(1, 0)).state;
    expect(state).toMatchObject({ moved: false });
  });

  it('once past the threshold, coming back under it stays a drag', () => {
    let state = movePointer(arm('A'), 200, 200, at(50, 50)).state;
    state = movePointer(state, 100, 100, at(0, 0)).state;
    expect(state).toMatchObject({ moved: true });
  });

  it('moves are ignored while idle so the caller can fall through to hover', () => {
    expect(movePointer(idle, 10, 10, at(1, 1)).action).toEqual({ kind: 'none' });
  });

  it('no preview until the gesture is legible as in-progress', () => {
    const armed = arm('A');
    // Button still down, nothing moved yet — a zero-length line would be noise.
    expect(shouldDrawPreview(armed)).toBe(false);
    expect(shouldDrawPreview(movePointer(armed, 200, 200, at(50, 50)).state)).toBe(true);
    // Click-to-connect: the line following the cursor is the only affordance
    // telling the user a second click is expected, so it must show.
    expect(shouldDrawPreview(releasePort(armed, 'A', same).state)).toBe(true);
    expect(shouldDrawPreview(idle)).toBe(false);
  });

  it('tracks the pointer for the preview line’s loose end', () => {
    const state = movePointer(arm('A'), 200, 200, at(42, 17)).state;
    expect(state.phase === 'armed' && state.pointer).toEqual(at(42, 17));
  });
});
