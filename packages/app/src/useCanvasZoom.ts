import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { fitView, nextWheelZoom, zoomViewAboutCursor, type Rect } from '@openharness/render';

/**
 * Shared per-pane zoom state, wheel-zoom handler, and fit-to-bounds entry
 * point for the Schematic and Layout canvases.
 *
 * Why this exists (review C6): the wheel-zoom logic used to be copied
 * verbatim into both canvas components, which is exactly how B2 got fixed in
 * one canvas and missed in the other. There is now one copy, here.
 *
 * Division of labour with `useCanvasPan` (review B3): `useCanvasPan` owns
 * the ONE wheel listener on the scroll container and classifies each event —
 * zoom events are delegated to `onWheelZoom` below, pan events scroll the
 * container there. One listener making one decision is what a pinch can no
 * longer zoom and pan simultaneously, and what makes a plain mouse wheel
 * zoom instead of pan.
 *
 * Zoom is a view concern (T04 contract): the state lives here in the
 * component tree, never in the document, and never passes through
 * `store.transact`.
 *
 * The anchor math itself lives in `zoomViewAboutCursor`
 * (@openharness/render/zoomGeometry) — including the B8 scroll term and the
 * pan/scroll split that keeps pan non-negative. This hook is the DOM glue:
 * it reads the container's rect/scroll/size, and it applies the scroll half
 * of the result via `pendingScroll` in a layout effect, because the same
 * commit resizes the inner content div (`maxX * scale`) — writing
 * `scrollLeft` before that resize would be clamped against the old size.
 */

interface CanvasView {
  /** Percentage, clamped to 10–800 by nextWheelZoom. */
  zoom: number;
  /** Translate part of the canvas transform, screen px, always ≥ 0 (B8). */
  panX: number;
  panY: number;
}

export interface CanvasZoom {
  zoom: number;
  panX: number;
  panY: number;
  /** zoom / 100 — what the transform and every pixel-delta drag divides by. */
  scale: number;
  /**
   * Register the canvas content extent in canvas units. The canvases call
   * this whenever their maxX/maxY change; the zoom clamp needs it and cannot
   * derive it from the DOM reliably.
   */
  setContentSize: (width: number, height: number) => void;
  /** Handle a wheel event already classified as a zoom event (B3). */
  onWheelZoom: (e: WheelEvent) => void;
  /**
   * Fit a set of canvas-space rects into the viewport (review B4): the
   * fit-to-view / fit-to-selection entry point. The rects come from
   * `schematicContentRects`/`schematicSelectionRects` (Schematic) or the
   * layout's placed positions (Layout); the scale+pan+scroll solve is
   * `fitView` in zoomGeometry. Empty rects reset to the default view.
   * Like wheel zoom, this is a pure view mutation — no document, no
   * `store.transact`.
   */
  fitTo: (rects: Rect[], padding?: number) => void;
}

export function useCanvasZoom(scrollRef: React.RefObject<HTMLDivElement>): CanvasZoom {
  const [view, setView] = useState<CanvasView>({ zoom: 100, panX: 0, panY: 0 });

  // The wheel handler is attached once (stable identity), so it reads the
  // current view through a ref instead of closing over it. The layout effect
  // keeps the ref in step synchronously after commit, before any further
  // input event can fire.
  const viewRef = useRef(view);
  useLayoutEffect(() => {
    viewRef.current = view;
  }, [view]);

  const contentSize = useRef({ width: 0, height: 0 });
  const setContentSize = useCallback((width: number, height: number) => {
    contentSize.current = { width, height };
  }, []);

  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const pending = pendingScroll.current;
    if (!el || !pending) return;
    pendingScroll.current = null;
    el.scrollLeft = pending.left;
    el.scrollTop = pending.top;
  });

  const onWheelZoom = useCallback(
    (e: WheelEvent) => {
      const el = scrollRef.current;
      if (!el) return;
      if (e.deltaY === 0) {
        // Pinch gestures sometimes emit zero-delta events — nothing to zoom.
        // A pure horizontal delta still pans horizontally, as it did before
        // zoom existed; swallowing it would regress shift-wheel/two-finger
        // horizontal scrolling.
        if (e.deltaX !== 0) el.scrollLeft += e.deltaX;
        return;
      }
      const prev = viewRef.current;
      const newZoom = nextWheelZoom(prev.zoom, e.deltaY, e.deltaMode);
      if (newZoom === prev.zoom) return; // clamped at the 10/800 boundary
      const rect = el.getBoundingClientRect();
      const next = zoomViewAboutCursor({
        cursorX: e.clientX - rect.left,
        cursorY: e.clientY - rect.top,
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
        panX: prev.panX,
        panY: prev.panY,
        scale: prev.zoom / 100,
        newScale: newZoom / 100,
        contentWidth: contentSize.current.width,
        contentHeight: contentSize.current.height,
        // clientWidth/Height exclude scrollbars — the true content viewport.
        viewportWidth: el.clientWidth,
        viewportHeight: el.clientHeight,
      });
      pendingScroll.current = { left: next.scrollLeft, top: next.scrollTop };
      const nextView = { zoom: newZoom, panX: next.panX, panY: next.panY };
      // Update the ref immediately, not just in the post-commit layout
      // effect: a trackpad pinch fires wheel events faster than React
      // re-renders, and each one must chain from the last computed view, not
      // from whatever was committed when the gesture started.
      viewRef.current = nextView;
      setView(nextView);
    },
    [scrollRef],
  );

  const fitTo = useCallback(
    (rects: Rect[], padding?: number) => {
      const el = scrollRef.current;
      // A zero-sized viewport (pane collapsed / window minimised) has no
      // meaningful fit; skip rather than solve against a degenerate box.
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
      const next = fitView({
        rects,
        contentWidth: contentSize.current.width,
        contentHeight: contentSize.current.height,
        // clientWidth/Height exclude scrollbars — the true content viewport,
        // same frame the wheel handler uses.
        viewportWidth: el.clientWidth,
        viewportHeight: el.clientHeight,
        padding,
      });
      // Same two-step apply as wheel zoom: the scroll half is written after
      // commit (pendingScroll), because this commit resizes the inner
      // content div and a scrollLeft written now would clamp against the old
      // size.
      pendingScroll.current = { left: next.scrollLeft, top: next.scrollTop };
      const nextView = { zoom: next.zoom, panX: next.panX, panY: next.panY };
      viewRef.current = nextView;
      setView(nextView);
    },
    [scrollRef],
  );

  return {
    zoom: view.zoom,
    panX: view.panX,
    panY: view.panY,
    scale: view.zoom / 100,
    setContentSize,
    onWheelZoom,
    fitTo,
  };
}
