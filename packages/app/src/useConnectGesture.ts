/**
 * React wiring around connectGesture.ts, shared by SchematicCanvas (wires)
 * and LayoutCanvas (bundles). All gesture logic lives in the pure module —
 * this hook owns only the transient state (never the document) and the
 * window-level listeners that make a drag survive leaving the canvas.
 *
 * Two listeners are attached at the WINDOW rather than on the SVG:
 *
 *   - `mouseup`, so a drag released outside the pane still resolves. Without
 *     it, dragging off the canvas and letting go leaves the gesture armed and
 *     the preview line stuck to the cursor, with no way to tell it ended.
 *   - `keydown` for Escape, which needs to work regardless of focus — the
 *     canvas is an SVG and rarely holds focus during a drag.
 *
 * The canvas still owns hit-testing: it passes the port under the pointer to
 * `release`, because only it knows what its own geometry contains.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Point } from '@openharness/core';
import {
  cancelConnect,
  movePointer,
  pressPort,
  releasePort,
  shouldDrawPreview,
  type ConnectState,
} from './connectGesture.js';

export interface ConnectGestureOptions<P> {
  /** Identity for ports — the gesture has no idea what a port is. */
  samePort: (a: P, b: P) => boolean;
  /** Called when the gesture resolves to a real connection. */
  onConnect: (from: P, to: P) => void;
  /**
   * Optional validity check. Used both to gate completion and, via
   * `isValidTarget` below, to drive the canvas's target highlighting — one
   * predicate for both so what lights up and what actually connects can
   * never disagree.
   */
  canConnect?: (from: P, to: P) => boolean;
}

export interface ConnectGestureControls<P> {
  state: ConnectState<P>;
  /** The armed source port, or null. Convenience for render code. */
  sourcePort: P | null;
  /** Anchor + live pointer for the preview line, or null when it should not
   * be drawn (see shouldDrawPreview). */
  preview: { from: Point; to: Point } | null;
  /** True while a gesture is in progress — canvases use this to suppress
   * competing interactions (panning, lasso) and to swap their hint text. */
  active: boolean;
  press: (port: P, anchor: Point, clientX: number, clientY: number) => void;
  /** Feed a mousemove. Returns true when the gesture consumed it. */
  move: (clientX: number, clientY: number, canvasPoint: Point) => boolean;
  release: (port: P | null) => void;
  cancel: () => void;
  /** Would connecting the armed source to `port` be allowed? False when no
   * gesture is armed, so callers can use it directly as a highlight test. */
  isValidTarget: (port: P) => boolean;
}

export function useConnectGesture<P>(options: ConnectGestureOptions<P>): ConnectGestureControls<P> {
  const [state, setState] = useState<ConnectState<P>>({ phase: 'idle' });

  /* The window listeners below are attached once and must not be torn down
   * and rebuilt on every pointer move, so they read the live state and
   * callbacks through refs rather than closing over them. */
  const stateRef = useRef(state);
  stateRef.current = state;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const press = useCallback((port: P, anchor: Point, clientX: number, clientY: number) => {
    const { samePort, canConnect, onConnect } = optionsRef.current;
    const { state: next, action } = pressPort(
      stateRef.current, port, anchor, clientX, clientY, samePort, canConnect,
    );
    stateRef.current = next;
    setState(next);
    if (action.kind === 'connect') onConnect(action.from, action.to);
  }, []);

  const move = useCallback((clientX: number, clientY: number, canvasPoint: Point): boolean => {
    const { state: next, action } = movePointer(stateRef.current, clientX, clientY, canvasPoint);
    if (action.kind === 'none') return false;
    stateRef.current = next;
    setState(next);
    return true;
  }, []);

  const release = useCallback((port: P | null) => {
    const { samePort, canConnect, onConnect } = optionsRef.current;
    const { state: next, action } = releasePort(stateRef.current, port, samePort, canConnect);
    if (action.kind === 'none') return;
    stateRef.current = next;
    setState(next);
    if (action.kind === 'connect') onConnect(action.from, action.to);
  }, []);

  const cancel = useCallback(() => {
    const { state: next, action } = cancelConnect(stateRef.current);
    if (action.kind === 'none') return;
    stateRef.current = next;
    setState(next);
  }, []);

  /* A mouseup anywhere ends a drag. The canvas's own handlers call `release`
   * with the port under the pointer and stop propagation; this only fires for
   * releases the canvas did not claim, which by definition are over nothing. */
  useEffect(() => {
    const onWindowMouseUp = () => { release(null); };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stateRef.current.phase === 'armed') {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener('mouseup', onWindowMouseUp);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mouseup', onWindowMouseUp);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [release, cancel]);

  /* Deliberately NOT memoized. It is called once per node during render to
   * decide highlighting, so it has to see the current `state` — memoizing it
   * would mean choosing a dependency list that is either stale (missing
   * `state`) or pointless (changing on every gesture tick anyway). A plain
   * closure over the render's own `state` is both cheaper and obviously
   * correct. */
  const isValidTarget = (port: P): boolean => {
    if (state.phase !== 'armed') return false;
    const { samePort, canConnect } = options;
    if (samePort(state.source.port, port)) return false;
    return canConnect ? canConnect(state.source.port, port) : true;
  };

  return {
    state,
    sourcePort: state.phase === 'armed' ? state.source.port : null,
    preview: shouldDrawPreview(state) ? { from: state.source.anchor, to: state.pointer } : null,
    active: state.phase === 'armed',
    press,
    move,
    release,
    cancel,
    isValidTarget,
  };
}
