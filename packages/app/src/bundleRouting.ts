/**
 * Bundle drag / wire-extraction logic for the Layout canvas (Phase 2a,
 * docs/PHASE2-REFINED-DESIGN.md), split out of LayoutCanvas so the gesture
 * math and the document mutations are testable without a DOM — the repo has
 * no DOM test environment (see schematicMateRender.test.tsx's header for the
 * same constraint), so everything with a brain lives here and the React hook
 * (useBundleRouting.ts) is thin wiring.
 *
 * THE GESTURE MODEL — click and drag share one hit target (the bundle's
 * line) and are told apart by pointer travel, never by a modifier key, per
 * the house interaction rules (HANDOFF.md). For a bundle that HAS routing
 * nodes: press-and-move past the threshold translates every waypoint
 * together (bundle-level waypoint editing — the design's pain point 1),
 * while a plain click still inserts one routing node, exactly as before this
 * work landed. A bundle with NO waypoints has no shape to translate, so it
 * keeps the legacy gesture outright (press inserts a node and drags it).
 *
 * Dragging a wire's extraction handle past the threshold extracts that wire
 * from the bundle: it gets a frozen `Wire.route` around the bundle
 * (computeRouteAvoidingBundle, core/derive/routing.ts), which computeRoutes
 * then honours — that is the whole of "leaving the bundle" in a model where
 * membership is derived from routes, not authored. When no alternate route
 * exists the extraction is impossible and the document is left untouched;
 * callers surface that rather than pretending.
 */

import type { HarnessDocument, Point } from '@openharness/core';
import type { BundleId, WireId } from '@openharness/core';
import { computeRouteAvoidingBundle, type HarnessStore } from '@openharness/core';
import { exceedsDragThreshold } from '@openharness/render';

/** 3 screen px — the same budget as SchematicCanvas's click-vs-drag
 * discrimination (review C9); a shared render helper does the scale-aware
 * comparison. */
export const BUNDLE_DRAG_THRESHOLD = 3;

export type BundleDragKind = 'bundle' | 'wire';

export interface BundleDragState {
  kind: BundleDragKind;
  bundleId: BundleId;
  /** The wire being extracted; present exactly when kind === 'wire'. */
  wireId?: WireId;
  /** Pointer position at press time, SCREEN client px (the drag threshold
   * is a screen-pixel budget — C9). */
  pointerStartX: number;
  pointerStartY: number;
  /** The bundle's waypoints at press time, mm. Translating these (rather
   * than re-reading the live document each move) keeps one drag a pure
   * offset, immune to anything else mutating mid-gesture. */
  waypointsStart: Point[];
  /** True once travel has crossed BUNDLE_DRAG_THRESHOLD. */
  moved: boolean;
}

export function startBundleDrag(
  bundleId: BundleId,
  pointerStartX: number,
  pointerStartY: number,
  waypointsStart: Point[],
): BundleDragState {
  return { kind: 'bundle', bundleId, pointerStartX, pointerStartY, waypointsStart, moved: false };
}

export function startWireExtract(
  wireId: WireId,
  bundleId: BundleId,
  pointerStartX: number,
  pointerStartY: number,
): BundleDragState {
  return { kind: 'wire', bundleId, wireId, pointerStartX, pointerStartY, waypointsStart: [], moved: false };
}

export interface BundleDragUpdate {
  state: BundleDragState;
  /** Present exactly when a bundle drag is active: the waypoints to commit
   * (already translated). The caller wraps these in store.transact. */
  waypoints?: Point[];
}

/**
 * Advance a drag with a new pointer position. `scale` is the zoom factor
 * (client px → canvas px) and `pxPerMm` the canvas's physical scale — the
 * two conversions between a screen-pixel gesture and a millimetre offset.
 * Pure: returns the next state plus what to commit; commits nothing itself.
 */
export function updateBundleDrag(
  state: BundleDragState,
  pointerX: number,
  pointerY: number,
  scale: number,
  pxPerMm: number,
): BundleDragUpdate {
  const dxCanvas = (pointerX - state.pointerStartX) / scale;
  const dyCanvas = (pointerY - state.pointerStartY) / scale;
  const moved =
    state.moved || exceedsDragThreshold(dxCanvas, dyCanvas, scale, BUNDLE_DRAG_THRESHOLD);
  if (state.kind !== 'bundle') {
    return { state: { ...state, moved } };
  }
  if (!moved) return { state };
  const dxMm = dxCanvas / pxPerMm;
  const dyMm = dyCanvas / pxPerMm;
  return {
    state: { ...state, moved },
    waypoints: state.waypointsStart.map((wp) => ({ x: wp.x + dxMm, y: wp.y + dyMm })),
  };
}

/** The transaction body for a bundle move: replace the waypoint list wholesale. */
export function applyBundleWaypoints(draft: HarnessDocument, bundleId: BundleId, waypoints: Point[]): void {
  const b = draft.bundles[bundleId];
  if (b) b.waypoints = waypoints;
}

/**
 * Extract one wire from one bundle: give the wire a frozen route that avoids
 * the bundle, which the derive pipeline then honours (the wire disappears
 * from `bundleContents` for that bundle). Returns false — document untouched
 * — when the wire doesn't actually route through the bundle or when the
 * bundle is its only way across (no alternate path in the layout graph).
 */
export function extractWireFromBundle(store: HarnessStore, wireId: WireId, bundleId: BundleId): boolean {
  const route = store.derived.wireRoutes.get(wireId);
  if (!route || !route.segments.includes(bundleId)) return false;
  const alternate = computeRouteAvoidingBundle(store.doc, wireId, bundleId);
  if (!alternate || alternate.length === 0) return false;
  store.transact('Extract wire from bundle', (draft) => {
    const w = draft.wires[wireId];
    if (w) w.route = alternate;
  });
  return true;
}
