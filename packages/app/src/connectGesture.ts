/**
 * The connect gesture — one state machine behind every "join two things"
 * interaction in the app: drawing a wire between two cavities in Schematic,
 * and drawing a bundle between two nodes in Layout.
 *
 * ## Why this exists
 *
 * Both panes previously implemented the same interaction independently, and
 * both implemented only half of it. Schematic's `pendingWire` and Layout's
 * `pendingBundleFrom` were click-source-then-click-target, with the pending
 * state announced only as a sentence of grey text in the toolbar: no line
 * followed the cursor, so you could not see what you were about to create;
 * dragging from a port did nothing, which is the gesture every node editor
 * has trained people to try first; and Escape did not cancel, so a
 * mis-started wire could only be undone by remembering which port you had
 * clicked and clicking it again.
 *
 * ## The model
 *
 * One gesture supports BOTH idioms without the user choosing between them,
 * which is the whole point — press-drag-release and click-then-click are the
 * same state machine differing only in whether the pointer moved while the
 * button was down:
 *
 *   press A ─(move past threshold)─ release over B   → connect      (drag)
 *   press A ─ release over A (no move) ─ press B     → connect      (click)
 *   press A ─ release over A ─ press A               → cancel
 *   press A ─ drag ─ release over empty space        → cancel
 *   Escape, at any point                             → cancel
 *
 * `pressActive` is what separates the two: it is true only between the
 * mousedown that armed the gesture and its matching mouseup. A release while
 * it is set and nothing has moved is the tail of the arming click, so the
 * gesture stays armed and waits for a second click; a release while it is set
 * and the pointer HAS moved is a completed drag.
 *
 * ## Scope
 *
 * Pure: no React, no DOM, no document writes. The caller owns hit-testing
 * (it decides what port the pointer is over), validity (`canConnect`), and
 * what "connect" actually means — this module only decides, from the gesture
 * alone, whether a connect/cancel/arm should happen. That keeps it testable
 * without a canvas, the same split `bundleRouting.ts` already uses against
 * `useBundleRouting.ts`.
 *
 * Ports are generic (`P`) because Schematic's port is a cavity/row within a
 * component and Layout's is a whole node; the gesture does not care, it just
 * needs an equality function.
 */

import type { Point } from '@openharness/core';

/**
 * Pointer travel (in SCREEN px, before the canvas zoom divide) past which a
 * press is a drag rather than a click. Matches the drag thresholds already
 * used by the canvases' own move gestures so all three feel the same, and is
 * deliberately compared in screen space: a threshold in canvas units would
 * demand a longer physical mouse movement as the user zooms out (T04's C9
 * fix made the same correction for component drags).
 */
export const CONNECT_DRAG_THRESHOLD_PX = 4;

export interface ConnectSource<P> {
  port: P;
  /** Where on the canvas the source sits, for drawing the preview line's
   * fixed end. Canvas units — the caller's own coordinate space. */
  anchor: Point;
  /** Screen-space press origin, used only for the drag-threshold test. */
  originClientX: number;
  originClientY: number;
}

export type ConnectState<P> =
  | { phase: 'idle' }
  | {
      phase: 'armed';
      source: ConnectSource<P>;
      /** Latest pointer position in canvas units — the preview line's loose
       * end. Starts at the source anchor so a freshly armed gesture draws a
       * zero-length line rather than a line to the origin. */
      pointer: Point;
      /** Has the pointer travelled past the threshold since the press? */
      moved: boolean;
      /** Is the arming mousedown still held? See the file header. */
      pressActive: boolean;
    };

export const IDLE: ConnectState<never> = { phase: 'idle' };

/** What the caller should do in response to a press or release. */
export type ConnectAction<P> =
  /** Create the connection. `from`/`to` are in gesture order (source first). */
  | { kind: 'connect'; from: P; to: P }
  /** Gesture ended with nothing created. */
  | { kind: 'cancel' }
  /** State changed (armed, or preview moved) but nothing else should happen. */
  | { kind: 'update' }
  /** Not our event — the caller should fall through to its other handlers. */
  | { kind: 'none' };

export interface ConnectResult<P> {
  state: ConnectState<P>;
  action: ConnectAction<P>;
}

/**
 * A press on `port`. Arms the gesture, completes it, or cancels it — see the
 * transition table in the file header.
 *
 * `canConnect` is consulted before completing so an invalid pair (a cavity to
 * itself, a bundle between two components already bundled) leaves the gesture
 * armed rather than silently doing nothing or creating a bad edge: the user
 * keeps their source and can pick a different target. Returning `update` for
 * that case is what lets the caller show *why* via its own validity styling,
 * which it already computes for target highlighting.
 */
export function pressPort<P>(
  state: ConnectState<P>,
  port: P,
  anchor: Point,
  clientX: number,
  clientY: number,
  samePort: (a: P, b: P) => boolean,
  canConnect?: (from: P, to: P) => boolean,
): ConnectResult<P> {
  if (state.phase === 'idle') {
    return {
      state: {
        phase: 'armed',
        source: { port, anchor, originClientX: clientX, originClientY: clientY },
        pointer: anchor,
        moved: false,
        pressActive: true,
      },
      action: { kind: 'update' },
    };
  }

  // Pressing the source again is the documented way to back out.
  if (samePort(state.source.port, port)) {
    return { state: { phase: 'idle' }, action: { kind: 'cancel' } };
  }

  if (canConnect && !canConnect(state.source.port, port)) {
    return { state, action: { kind: 'update' } };
  }

  return {
    state: { phase: 'idle' },
    action: { kind: 'connect', from: state.source.port, to: port },
  };
}

/**
 * Feed a pointer move. `canvasPoint` drives the preview line; the client
 * coordinates decide whether the threshold has been crossed.
 *
 * Returns `none` when idle so the caller can cheaply tell whether the gesture
 * consumed the move and skip its own hover work.
 */
export function movePointer<P>(
  state: ConnectState<P>,
  clientX: number,
  clientY: number,
  canvasPoint: Point,
): ConnectResult<P> {
  if (state.phase !== 'armed') return { state, action: { kind: 'none' } };

  const dx = clientX - state.source.originClientX;
  const dy = clientY - state.source.originClientY;
  const moved =
    state.moved || Math.hypot(dx, dy) > CONNECT_DRAG_THRESHOLD_PX;

  return {
    state: { ...state, pointer: canvasPoint, moved },
    action: { kind: 'update' },
  };
}

/**
 * A pointer release over `port` (or `null` for empty canvas).
 *
 * This is where the two idioms diverge — see the file header. A release that
 * merely ends the arming click keeps the gesture armed so click-then-click
 * still works; a release that ends a real drag completes or cancels.
 */
export function releasePort<P>(
  state: ConnectState<P>,
  port: P | null,
  samePort: (a: P, b: P) => boolean,
  canConnect?: (from: P, to: P) => boolean,
): ConnectResult<P> {
  if (state.phase !== 'armed') return { state, action: { kind: 'none' } };

  // Tail of the arming click: stay armed, drop the press flag so a later
  // press on any port is read as the second click rather than a new arm.
  if (state.pressActive && !state.moved) {
    return { state: { ...state, pressActive: false }, action: { kind: 'update' } };
  }

  // Only a genuine drag can complete on release. A release with pressActive
  // already false is the mouseup of the completing click, which pressPort has
  // handled — there is nothing left to do.
  if (!state.pressActive) return { state, action: { kind: 'none' } };

  if (port === null || samePort(state.source.port, port)) {
    return { state: { phase: 'idle' }, action: { kind: 'cancel' } };
  }

  if (canConnect && !canConnect(state.source.port, port)) {
    // Dropping on an invalid target ends the drag rather than leaving a
    // gesture armed that the user thinks they finished.
    return { state: { phase: 'idle' }, action: { kind: 'cancel' } };
  }

  return {
    state: { phase: 'idle' },
    action: { kind: 'connect', from: state.source.port, to: port },
  };
}

/** Escape, a click on empty background, or any external interruption. */
export function cancelConnect<P>(state: ConnectState<P>): ConnectResult<P> {
  if (state.phase === 'idle') return { state, action: { kind: 'none' } };
  return { state: { phase: 'idle' }, action: { kind: 'cancel' } };
}

/**
 * Should the preview line be drawn? A freshly armed gesture that has not yet
 * moved would draw a zero-length line at the source, which reads as a visual
 * artifact rather than as feedback, so it is suppressed until either the
 * pointer moves or the arming press is released (click-to-connect, where the
 * line following the cursor IS the affordance that tells the user the app is
 * waiting for a second click).
 */
export function shouldDrawPreview<P>(state: ConnectState<P>): state is Extract<
  ConnectState<P>,
  { phase: 'armed' }
> {
  return state.phase === 'armed' && (state.moved || !state.pressActive);
}
