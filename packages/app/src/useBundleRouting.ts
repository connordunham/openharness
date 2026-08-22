/**
 * React wiring around bundleRouting.ts for the Layout canvas (Phase 2a).
 * All gesture math and document mutations live in bundleRouting.ts — this
 * hook only owns the transient drag STATE (which is view state, never the
 * document) and routes commits through store.transact, so one bundle drag is
 * one undoable action and automation and GUI take the same path (AGENTS.md).
 *
 * The drag preview deliberately needs no document writes: while a bundle
 * drag is below the threshold nothing moves, and a wire extraction writes
 * only once, on release. Mid-drag waypoint commits use a stable transaction
 * label + target so the store's coalescing folds a drag into as few undo
 * entries as the coalesce window allows — same behaviour as the existing
 * component/waypoint drags in LayoutCanvas.
 */

import { useCallback, useState } from 'react';
import type { Point } from '@openharness/core';
import type { BundleId, WireId } from '@openharness/core';
import type { HarnessStore } from '@openharness/core';
import {
  applyBundleWaypoints,
  extractWireFromBundle,
  startBundleDrag,
  startWireExtract,
  updateBundleDrag,
  type BundleDragState,
} from './bundleRouting.js';

export type BundleDragResult =
  | { gesture: 'bundle-moved'; bundleId: BundleId }
  | { gesture: 'wire-extracted'; wireId: WireId; bundleId: BundleId }
  | { gesture: 'wire-extract-blocked'; wireId: WireId; bundleId: BundleId }
  | { gesture: 'click' }
  | null;

export interface BundleRoutingControls {
  /** Active drag, if any — drives ghost-fade / preview rendering. */
  drag: BundleDragState | null;
  /** Last pointer position in CANVAS px during an active drag, for the
   * wire-extraction ghost handle. */
  dragPointer: Point | null;
  startBundleDrag(bundleId: BundleId, clientX: number, clientY: number, waypointsStartMm: Point[]): void;
  startWireExtract(wireId: WireId, bundleId: BundleId, clientX: number, clientY: number): void;
  /** Feed a mousemove; returns true when an active drag consumed it. */
  updateDrag(clientX: number, clientY: number, canvasPoint: Point): boolean;
  /** End the gesture; reports what happened so the canvas can react
   * (insert a routing node on a bundle click, notice a blocked extraction). */
  endDrag(): BundleDragResult;
  /** Click-to-extract (the inspector's per-wire action). */
  extractWire(wireId: WireId, bundleId: BundleId): boolean;
}

export function useBundleRouting(store: HarnessStore, scale: number, pxPerMm: number): BundleRoutingControls {
  const [drag, setDrag] = useState<BundleDragState | null>(null);
  const [dragPointer, setDragPointer] = useState<Point | null>(null);

  const beginBundleDrag = useCallback(
    (bundleId: BundleId, clientX: number, clientY: number, waypointsStartMm: Point[]) => {
      setDrag(startBundleDrag(bundleId, clientX, clientY, waypointsStartMm));
      setDragPointer(null);
    },
    [],
  );

  const beginWireExtract = useCallback(
    (wireId: WireId, bundleId: BundleId, clientX: number, clientY: number) => {
      setDrag(startWireExtract(wireId, bundleId, clientX, clientY));
      setDragPointer(null);
    },
    [],
  );

  const updateDrag = useCallback(
    (clientX: number, clientY: number, canvasPoint: Point): boolean => {
      if (!drag) return false;
      const { state, waypoints } = updateBundleDrag(drag, clientX, clientY, scale, pxPerMm);
      setDrag(state);
      setDragPointer(canvasPoint);
      if (waypoints) {
        store.transact('Move bundle (layout)', (draft) => {
          applyBundleWaypoints(draft, state.bundleId, waypoints);
        });
      }
      return true;
    },
    [drag, scale, pxPerMm, store],
  );

  const endDrag = useCallback((): BundleDragResult => {
    if (!drag) return null;
    const finished = drag;
    setDrag(null);
    setDragPointer(null);
    if (!finished.moved) return { gesture: 'click' };
    if (finished.kind === 'bundle') return { gesture: 'bundle-moved', bundleId: finished.bundleId };
    const extracted = extractWireFromBundle(store, finished.wireId!, finished.bundleId);
    return extracted
      ? { gesture: 'wire-extracted', wireId: finished.wireId!, bundleId: finished.bundleId }
      : { gesture: 'wire-extract-blocked', wireId: finished.wireId!, bundleId: finished.bundleId };
  }, [drag, store]);

  const extractWire = useCallback(
    (wireId: WireId, bundleId: BundleId) => extractWireFromBundle(store, wireId, bundleId),
    [store],
  );

  return {
    drag,
    dragPointer,
    startBundleDrag: beginBundleDrag,
    startWireExtract: beginWireExtract,
    updateDrag,
    endDrag,
    extractWire,
  };
}
