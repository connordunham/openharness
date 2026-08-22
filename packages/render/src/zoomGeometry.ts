/**
 * Zoom geometry utilities for coordinate transformations and viewport fitting.
 *
 * This module provides screen↔canvas coordinate conversions for zoomed canvases,
 * fit-to-bounds calculations, and helpers for zoom-about-cursor behavior.
 *
 * All zoom is expressed as a scale from 0.1 (10%) to 8.0 (800%). Pan offsets
 * are in screen pixels.
 */

import type { Point } from '@openharness/core';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ZoomFitResult {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const MAX_ZOOM = 8.0; // 800%

/**
 * Convert screen coordinates to canvas coordinates.
 *
 * When a zoom transform is applied to the canvas, screen-space pixel coordinates
 * must be converted back to canvas space by accounting for both scale and pan offset.
 * This is the inverse of canvasToScreen.
 */
export function screenToCanvas(
  screenX: number,
  screenY: number,
  scale: number,
  offsetX: number,
  offsetY: number,
): Point {
  return {
    x: (screenX - offsetX) / scale,
    y: (screenY - offsetY) / scale,
  };
}

/**
 * Convert canvas coordinates to screen coordinates.
 *
 * Used for rendering and positioning UI elements relative to canvas content.
 */
export function canvasToScreen(
  canvasX: number,
  canvasY: number,
  scale: number,
  offsetX: number,
  offsetY: number,
): Point {
  return {
    x: canvasX * scale + offsetX,
    y: canvasY * scale + offsetY,
  };
}

/**
 * Client (pointer) point → canvas user units, via the canvas element's own
 * *transformed* bounding rect.
 *
 * Zoom is applied as a CSS `translate(pan) scale(s)` on the canvas element
 * itself, so `getBoundingClientRect()` returns post-transform bounds:
 * `rect.left`/`rect.top` already include the pan offset, and every distance
 * is already multiplied by `s`. Subtracting the rect origin therefore
 * cancels the pan — but what remains is *scaled* screen pixels, and the
 * division by `s` is what recovers canvas user units. Omitting that division
 * is the characteristic zoom bug: at 200% zoom a pointer 200 px from the
 * canvas origin reads as canvas point 200 instead of 100, so every
 * absolute-position interaction (wire bend insert, bend drag, lasso) lands
 * scale-times off.
 *
 * Contrast with `screenToCanvas`, which subtracts an explicit pan offset
 * against a *fixed* viewport origin — the frame the wheel handler uses with
 * the scroller's rect, which does not move when the canvas pans.
 */
export function clientPointToCanvas(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number },
  scale: number,
): Point {
  return {
    x: (clientX - rect.left) / scale,
    y: (clientY - rect.top) / scale,
  };
}

/**
 * Whether pointer travel of (`dxCanvas`, `dyCanvas`) canvas units is a drag
 * rather than a click, at zoom `scale`.
 *
 * The threshold is a screen-pixel budget: it exists to absorb hand jitter
 * between mousedown and mouseup, and the pointing device reports that jitter
 * in screen pixels, so the gesture must feel the same size at every zoom.
 * Pointer positions arrive as canvas units (see `clientPointToCanvas`), so
 * the deltas have to be scaled back to screen pixels before the comparison.
 * Comparing canvas units against the budget directly is review concern C9:
 * at 25% zoom one px of jitter is four canvas units and crossed a threshold
 * of three, inserting a spurious bend on a plain click of a wire; at 400%
 * the same bug demanded twelve screen px of travel before a real drag
 * registered at all.
 *
 * Per-axis comparison — either axis crossing the budget is enough — matching
 * the canvases' click-vs-drag discrimination. Exactly at the threshold is
 * NOT a drag (strict >), so `!exceedsDragThreshold(...)` is the matching
 * click test.
 */
export function exceedsDragThreshold(
  dxCanvas: number,
  dyCanvas: number,
  scale: number,
  thresholdPx: number,
): boolean {
  return Math.abs(dxCanvas) * scale > thresholdPx || Math.abs(dyCanvas) * scale > thresholdPx;
}

/**
 * Fit a set of bounding rectangles into the viewport.
 *
 * Calculates the zoom level and pan offset needed to display all rectangles
 * within the viewport while respecting zoom bounds (10%–800%) and adding padding.
 *
 * Edge case: point-like items (width/height ≈ 0) receive a sensible default
 * zoom level (100%) and are centered, rather than attempting division by zero.
 */
export function fitToBounds(
  rects: Rect[],
  viewportWidth: number,
  viewportHeight: number,
  padding: number = 40,
): ZoomFitResult {
  if (rects.length === 0) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }

  // Find bounding box across all rectangles
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    maxX = Math.max(maxX, rect.x + rect.width);
    minY = Math.min(minY, rect.y);
    maxY = Math.max(maxY, rect.y + rect.height);
  }

  const width = maxX - minX;
  const height = maxY - minY;

  // Edge case: point-like items (width and height both near zero).
  // Use 100% zoom and just center the point.
  if (width < 1 && height < 1) {
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    return {
      scale: 1,
      offsetX: viewportWidth / 2 - centerX,
      offsetY: viewportHeight / 2 - centerY,
    };
  }

  // Calculate the maximum scale that fits the content with padding
  const availableWidth = Math.max(1, viewportWidth - 2 * padding);
  const availableHeight = Math.max(1, viewportHeight - 2 * padding);
  const scaleX = availableWidth / (width || 1);
  const scaleY = availableHeight / (height || 1);
  let scale = Math.min(scaleX, scaleY, MAX_ZOOM);

  // Clamp to valid zoom range and convert back to 0–8 scale
  scale = clampZoom(scale * 100) / 100;

  // Center the content in the viewport
  const contentWidth = width * scale;
  const contentHeight = height * scale;
  const offsetX = (viewportWidth - contentWidth) / 2 - minX * scale;
  const offsetY = (viewportHeight - contentHeight) / 2 - minY * scale;

  return { scale, offsetX, offsetY };
}

/**
 * Clamp a zoom percentage to the allowed range: 10%–800%.
 */
export function clampZoom(zoom: number): number {
  return Math.max(10, Math.min(800, zoom));
}

/**
 * Calculate pan offset when zooming about a cursor position.
 *
 * When the user zooms in or out, we want the canvas point that was under
 * the cursor to remain under the cursor (zoom toward/away from cursor, not
 * the origin). This function calculates the new pan offset to achieve that.
 *
 * Algorithm:
 * - The cursor is at screen position (screenX, screenY)
 * - There is a canvas point (canvasX, canvasY) under the cursor
 * - We want to zoom to newScale
 * - Calculate the pan offset so the same canvas point lands at the cursor again
 *
 * The formula is: newOffset = cursor - (canvasPoint * newScale)
 */
export function zoomAboutPoint(
  screenX: number,
  screenY: number,
  canvasX: number,
  canvasY: number,
  newScale: number,
): { offsetX: number; offsetY: number } {
  return {
    offsetX: screenX - canvasX * newScale,
    offsetY: screenY - canvasY * newScale,
  };
}

/** One full mouse-wheel notch (≈100 px of deltaY) multiplies the zoom by this. */
const ZOOM_NOTCH_FACTOR = 1.1;
/**
 * Per-event exponent cap. Some wheel drivers emit deltas in the thousands;
 * without a cap a single event could jump the zoom by orders of magnitude.
 */
const ZOOM_MAX_EVENT_EXPONENT = 4;
/** Assumed line/page heights for deltaMode normalisation (see nextWheelZoom). */
const LINE_DELTA_PX = 40;
const PAGE_DELTA_PX = 800;

/**
 * Next zoom percentage for a wheel-zoom event.
 *
 * Proportional, not flat: a trackpad pinch arrives as dozens of small-delta
 * wheel events, and a flat per-event step (the original ±10 points) let one
 * gesture blow through the entire 10–800% range. Here the factor is
 * exponential in the delta, so one full mouse notch (≈100 px) multiplies the
 * zoom by ZOOM_NOTCH_FACTOR while each pinch event contributes in proportion
 * to its own small delta — a whole pinch gesture typically lands around
 * 10–20% (unvalidated UX tuning, not a standards claim).
 *
 * deltaMode normalisation: Firefox reports mouse wheels in lines
 * (deltaMode 1), where one notch is deltaY ≈ 3 rather than ≈ 100 px;
 * multiplying by an assumed line height puts both modes on the same scale.
 *
 * Sign convention matches the canvases' original handler: deltaY > 0
 * (wheel down / pinch fingers together) zooms out. deltaY === 0 is a no-op —
 * pinch gestures sometimes emit zero-delta events.
 */
export function nextWheelZoom(currentZoomPercent: number, deltaY: number, deltaMode: number): number {
  if (deltaY === 0) return currentZoomPercent;
  const deltaPx =
    deltaMode === 1 ? deltaY * LINE_DELTA_PX
    : deltaMode === 2 ? deltaY * PAGE_DELTA_PX
    : deltaY;
  const exponent = Math.max(-ZOOM_MAX_EVENT_EXPONENT, Math.min(ZOOM_MAX_EVENT_EXPONENT, -deltaPx / 100));
  return clampZoom(currentZoomPercent * Math.pow(ZOOM_NOTCH_FACTOR, exponent));
}

/** A zero-extent rect at a point. `fitToBounds` recognises point-like input
 * (width and height both < 1) and centers it at the default 100% zoom rather
 * than dividing by zero — the packet's named edge case for fitting a single
 * point-like selection. */
export function pointRect(p: Point): Rect {
  return { x: p.x, y: p.y, width: 0, height: 0 };
}

export interface FitViewResult {
  /** Zoom percentage, already clamped to the 10–800 contract range. */
  zoom: number;
  panX: number;
  panY: number;
  scrollLeft: number;
  scrollTop: number;
}

/**
 * Split one axis of a fit offset into the pan/scroll pair the canvases' view
 * model is built from.
 *
 * The frame relation (same one `zoomViewAboutCursor` documents) is
 *
 *     clientOffsetFromContainer = canvas·scale + pan − scroll
 *
 * while `fitToBounds` solves for a single offset with
 * `screen = canvas·scale + offset`. Realising that offset therefore needs
 * `pan − scroll = offset`, and the split is dictated by the invariants:
 *
 * - pan ≥ 0 — a negative translate parks content where no scroll position can
 *   ever reach it (the B8 stranding bug);
 * - scroll stays inside the container's own range [0, content·scale − viewport].
 *
 * A positive offset (the fitted content is smaller than the viewport and gets
 * centered) can only be produced by pan, so pan absorbs it; a negative one
 * (content larger than the viewport, or a region away from the origin) is
 * handed to scroll. When even max scroll can't cover the offset — a selection
 * near the content's far edge at a scale clamped to 10% — scroll saturates and
 * the fit lands as close as the container allows.
 */
export function splitFitAxis(offset: number, scaledContentSize: number, viewportSize: number): { pan: number; scroll: number } {
  if (offset >= 0) return { pan: offset, scroll: 0 };
  const maxScroll = Math.max(0, scaledContentSize - viewportSize);
  return { pan: 0, scroll: Math.min(-offset, maxScroll) };
}

/**
 * Fit a set of canvas-space rects into a scroll+pan+scale canvas view — the
 * composition of `fitToBounds` (which solves scale and the total offset) with
 * `splitFitAxis` (which realises that offset in the view's pan and scroll).
 * This is what fit-to-view and fit-to-selection call (review B4): the canvases
 * collect the rects for the whole scene or the current selection, and apply
 * the four numbers to their zoom state and scroll container.
 *
 * Empty `rects` resets to the default view (100%, no pan, no scroll) — that
 * is `fitToBounds`'s own empty-list answer, which is also the only sensible
 * fit for a canvas with nothing drawn yet.
 */
export function fitView(opts: {
  rects: Rect[];
  /** Whole-canvas extent, canvas units (the canvases' maxX/maxY) — needed to
   * bound the scroll split, exactly as for `zoomViewAboutCursor`. */
  contentWidth: number;
  contentHeight: number;
  /** Container client size, screen px. */
  viewportWidth: number;
  viewportHeight: number;
  padding?: number;
}): FitViewResult {
  const fit = fitToBounds(opts.rects, opts.viewportWidth, opts.viewportHeight, opts.padding);
  const x = splitFitAxis(fit.offsetX, opts.contentWidth * fit.scale, opts.viewportWidth);
  const y = splitFitAxis(fit.offsetY, opts.contentHeight * fit.scale, opts.viewportHeight);
  return {
    zoom: fit.scale * 100,
    panX: x.pan,
    panY: y.pan,
    scrollLeft: x.scroll,
    scrollTop: y.scroll,
  };
}

export interface WheelZoomResult {
  panX: number;
  panY: number;
  scrollLeft: number;
  scrollTop: number;
}

/**
 * Solve the pan *and* scroll offsets for one wheel-zoom step about the
 * cursor, for a canvas whose position is the composition of a container
 * scroll and a `translate(pan) scale(s)` transform.
 *
 * The full relation between frames (per axis) is
 *
 *     clientOffsetFromContainer = canvas·scale + pan − scroll
 *
 * so recovering the canvas point under the cursor needs the scroll term:
 * canvas = (cursor + scroll − pan) / scale. Omitting `scroll` is review
 * blocker B8 — with the container scrolled 800 px, every zoom step misplaced
 * the anchor by 800·(newScale/scale − 1) px.
 *
 * Keeping that canvas point under the cursor after the zoom fixes only the
 * *difference* pan − scroll ( = cursor − canvas·newScale ); the split
 * between the two is this function's choice, and it is dictated by the
 * other half of B8: the scroll container cannot scroll negative, so a
 * negative translate parks content where no scroll position can ever reach
 * it (zooming in about any point away from the origin routinely solves to a
 * negative pan, stranding everything above-left of it). Therefore:
 *
 * - pan is clamped to [0, M] — the packet's clamp, with
 *   M = max(0, content·newScale − viewport), the same bound the scroll
 *   container itself has at the new scale;
 * - whatever the clamp removes is handed to scroll, which stays in [0, M].
 *
 * When |cursor − canvas·newScale| > M (content smaller than the viewport,
 * or a cursor beyond the content's far edge) no exact split exists; both
 * values saturate and the anchor slides as little as the bounds allow.
 */
export function zoomViewAboutCursor(opts: {
  /** Pointer position relative to the container's rect (viewport frame). */
  cursorX: number;
  cursorY: number;
  /** Container scroll before the zoom, screen px. */
  scrollLeft: number;
  scrollTop: number;
  /** Translate part of the canvas transform before the zoom, screen px. */
  panX: number;
  panY: number;
  /** Scale before the zoom, and the scale being zoomed to. */
  scale: number;
  newScale: number;
  /** Canvas content extent, canvas units. */
  contentWidth: number;
  contentHeight: number;
  /** Container client size, screen px. */
  viewportWidth: number;
  viewportHeight: number;
}): WheelZoomResult {
  const axis = (cursor: number, scroll: number, pan: number, content: number, viewport: number) => {
    const canvas = (cursor + scroll - pan) / opts.scale;
    const required = cursor - canvas * opts.newScale;
    const max = Math.max(0, content * opts.newScale - viewport);
    return {
      pan: Math.max(0, Math.min(required, max)),
      scroll: Math.max(0, Math.min(-required, max)),
    };
  };
  const x = axis(opts.cursorX, opts.scrollLeft, opts.panX, opts.contentWidth, opts.viewportWidth);
  const y = axis(opts.cursorY, opts.scrollTop, opts.panY, opts.contentHeight, opts.viewportHeight);
  return { panX: x.pan, panY: y.pan, scrollLeft: x.scroll, scrollTop: y.scroll };
}
