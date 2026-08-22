import { describe, it, expect } from 'vitest';
import {
  screenToCanvas,
  canvasToScreen,
  clientPointToCanvas,
  exceedsDragThreshold,
  fitToBounds,
  fitView,
  splitFitAxis,
  pointRect,
  clampZoom,
  zoomAboutPoint,
  nextWheelZoom,
  zoomViewAboutCursor,
  type Rect,
} from '../zoomGeometry.js';

describe('zoomGeometry', () => {
  describe('screenToCanvas', () => {
    it('converts screen coords to canvas coords at 100% zoom with no offset', () => {
      expect(screenToCanvas(100, 200, 1, 0, 0)).toEqual({ x: 100, y: 200 });
    });

    it('accounts for zoom scale', () => {
      expect(screenToCanvas(100, 200, 2, 0, 0)).toEqual({ x: 50, y: 100 });
    });

    it('accounts for zoom scale at 50%', () => {
      expect(screenToCanvas(100, 200, 0.5, 0, 0)).toEqual({ x: 200, y: 400 });
    });

    it('accounts for pan offset', () => {
      expect(screenToCanvas(100, 200, 1, 50, 100)).toEqual({ x: 50, y: 100 });
    });

    it('handles combined scale and offset', () => {
      const result = screenToCanvas(200, 300, 2, 50, 50);
      expect(result.x).toBeCloseTo(75); // (200 - 50) / 2 = 75
      expect(result.y).toBeCloseTo(125); // (300 - 50) / 2 = 125
    });

    it('handles negative offsets', () => {
      expect(screenToCanvas(0, 0, 1, -100, -100)).toEqual({ x: 100, y: 100 });
    });
  });

  describe('canvasToScreen', () => {
    it('converts canvas coords to screen coords at 100% zoom', () => {
      expect(canvasToScreen(100, 200, 1, 0, 0)).toEqual({ x: 100, y: 200 });
    });

    it('accounts for zoom scale', () => {
      expect(canvasToScreen(100, 200, 2, 0, 0)).toEqual({ x: 200, y: 400 });
    });

    it('accounts for zoom scale at 50%', () => {
      expect(canvasToScreen(100, 200, 0.5, 0, 0)).toEqual({ x: 50, y: 100 });
    });

    it('accounts for pan offset', () => {
      expect(canvasToScreen(100, 200, 1, 50, 100)).toEqual({ x: 150, y: 300 });
    });

    it('handles combined scale and offset', () => {
      const result = canvasToScreen(100, 200, 2, 50, 50);
      expect(result.x).toBe(250); // 100 * 2 + 50 = 250
      expect(result.y).toBe(450); // 200 * 2 + 50 = 450
    });
  });

  describe('clientPointToCanvas', () => {
    // The rect of a zoom-transformed canvas element: its origin is where the
    // canvas (0,0) lands on screen (layout position + pan), and its size is
    // the canvas size times the scale.
    const rect = { left: 100, top: 50 };

    it('is the identity at 100% zoom', () => {
      expect(clientPointToCanvas(300, 250, rect, 1)).toEqual({ x: 200, y: 200 });
    });

    it('divides the offset by scale at 200% zoom', () => {
      // The B2 case: 200 screen px right / down of the canvas origin is
      // 100 canvas units at scale 2 — reading it as 200 (no division) is
      // exactly the bug that broke bend insert, bend drag and lasso.
      expect(clientPointToCanvas(300, 250, rect, 2)).toEqual({ x: 100, y: 100 });
    });

    it('divides the offset by scale at 50% zoom', () => {
      expect(clientPointToCanvas(200, 150, rect, 0.5)).toEqual({ x: 200, y: 200 });
    });

    it('recovers the canvas point regardless of pan, because the transformed rect origin already includes it', () => {
      // Simulate the real transform: element panned by (25, 10) inside a
      // container at (60, 30), canvas point (80, 40) at scale 1.5. The
      // pointer lands at rectOrigin + canvas * scale; converting back must
      // yield the canvas point for any pan.
      const scale = 1.5;
      const canvas = { x: 80, y: 40 };
      const pans: [number, number][] = [[0, 0], [25, 10], [-300, 120]];
      for (const [panX, panY] of pans) {
        const movedRect = { left: 60 + panX, top: 30 + panY };
        const clientX = movedRect.left + canvas.x * scale;
        const clientY = movedRect.top + canvas.y * scale;
        expect(clientPointToCanvas(clientX, clientY, movedRect, scale)).toEqual(canvas);
      }
    });

    it('inverts canvasToScreen anchored at the rect origin', () => {
      const scale = 2.5;
      const canvas = { x: 37, y: 91 };
      const screen = canvasToScreen(canvas.x, canvas.y, scale, rect.left, rect.top);
      expect(clientPointToCanvas(screen.x, screen.y, rect, scale)).toEqual(canvas);
    });
  });

  describe('exceedsDragThreshold', () => {
    // The canvases' DRAG_THRESHOLD: 3 screen px.
    const T = 3;

    it('at 100% zoom behaves like the original canvas-unit comparison', () => {
      // scale 1 keeps the pre-C9 behaviour exactly, so the fix changes
      // nothing for unzoomed panes.
      expect(exceedsDragThreshold(2, 0, 1, T)).toBe(false);
      expect(exceedsDragThreshold(4, 0, 1, T)).toBe(true);
      expect(exceedsDragThreshold(0, 4, 1, T)).toBe(true);
      expect(exceedsDragThreshold(2, 2, 1, T)).toBe(false);
    });

    it('C9: at 25% zoom, one screen px of hand jitter is not a drag', () => {
      // 1 px of screen jitter is 4 canvas units at scale 0.25. The old
      // canvas-unit comparison read that as 4 > 3 and inserted a spurious
      // bend on a plain click of a wire.
      expect(exceedsDragThreshold(4, 0, 0.25, T)).toBe(false);
      expect(exceedsDragThreshold(0, 4, 0.25, T)).toBe(false);
      expect(exceedsDragThreshold(4, 4, 0.25, T)).toBe(false);
    });

    it('C9: at 400% zoom, a few screen px of real travel is a drag', () => {
      // 1 canvas unit at scale 4 is 4 screen px. The old comparison needed
      // 3 canvas units — 12 screen px — before a drag registered at all.
      expect(exceedsDragThreshold(1, 0, 4, T)).toBe(true);
      expect(exceedsDragThreshold(0, -1, 4, T)).toBe(true);
    });

    it('treats the threshold as a screen-pixel budget at every zoom', () => {
      // The invariant C9 is about: the same physical travel has the same
      // meaning at any zoom. 2 px of travel is a click everywhere; 4 px of
      // travel is a drag everywhere.
      for (const scale of [0.1, 0.25, 0.5, 1, 2, 4, 8]) {
        const clickDelta = 2 / scale; // canvas units that are 2 px on screen
        const dragDelta = 4 / scale; // canvas units that are 4 px on screen
        expect(exceedsDragThreshold(clickDelta, 0, scale, T), `2 px click @ ${scale}x`).toBe(false);
        expect(exceedsDragThreshold(0, clickDelta, scale, T), `2 px click @ ${scale}x`).toBe(false);
        expect(exceedsDragThreshold(dragDelta, 0, scale, T), `4 px drag @ ${scale}x`).toBe(true);
        expect(exceedsDragThreshold(0, dragDelta, scale, T), `4 px drag @ ${scale}x`).toBe(true);
      }
    });

    it('exactly at the threshold is still a click (strict comparison)', () => {
      // Preserves the pre-C9 boundary: travel must EXCEED the budget.
      expect(exceedsDragThreshold(3, 3, 1, T)).toBe(false);
      // 12 canvas units at 25% are exactly 3 screen px.
      expect(exceedsDragThreshold(12, 12, 0.25, T)).toBe(false);
    });

    it('measures travel magnitude regardless of direction', () => {
      expect(exceedsDragThreshold(-4, 0, 1, T)).toBe(true);
      expect(exceedsDragThreshold(0, -4, 1, T)).toBe(true);
      expect(exceedsDragThreshold(-2, -2, 1, T)).toBe(false);
    });

    it('makes the lasso click test zoom-independent too', () => {
      // The marquee side of C9: `!exceedsDragThreshold(w, h, ...)` is the
      // "never actually opened" test. An 8x8 canvas-unit marquee at 25%
      // zoom is 2x2 px on screen — jitter, not a selection. The old
      // canvas-unit test (8 < 3 -> false) ran a selection on it instead of
      // deselecting.
      expect(exceedsDragThreshold(8, 8, 0.25, T)).toBe(false);
      // A genuinely opened marquee stays one at any zoom (4 screen px).
      expect(exceedsDragThreshold(16, 16, 0.25, T)).toBe(true);
      expect(exceedsDragThreshold(4, 4, 1, T)).toBe(true);
    });
  });

  describe('Round-trip conversion', () => {
    it('screenToCanvas then canvasToScreen returns original point', () => {
      const original = { x: 123.456, y: 789.012 };
      const canvas = screenToCanvas(original.x, original.y, 1.5, 100, 200);
      const screen = canvasToScreen(canvas.x, canvas.y, 1.5, 100, 200);
      expect(screen.x).toBeCloseTo(original.x);
      expect(screen.y).toBeCloseTo(original.y);
    });

    it('works at extreme zoom levels', () => {
      const original = { x: 50, y: 75 };
      for (const scale of [0.1, 0.25, 0.5, 1, 2, 4, 8]) {
        const canvas = screenToCanvas(original.x, original.y, scale, 0, 0);
        const screen = canvasToScreen(canvas.x, canvas.y, scale, 0, 0);
        expect(screen.x).toBeCloseTo(original.x);
        expect(screen.y).toBeCloseTo(original.y);
      }
    });

    it('works with various offsets', () => {
      const original = { x: 250, y: 350 };
      const canvas = screenToCanvas(original.x, original.y, 2, 150, 200);
      const screen = canvasToScreen(canvas.x, canvas.y, 2, 150, 200);
      expect(screen.x).toBeCloseTo(original.x);
      expect(screen.y).toBeCloseTo(original.y);
    });
  });

  describe('fitToBounds', () => {
    it('returns scale 1 with zero offset for empty list', () => {
      const result = fitToBounds([], 1000, 1000);
      expect(result).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
    });

    it('centers a single rect in the viewport', () => {
      const rects: Rect[] = [{ x: 100, y: 100, width: 100, height: 100 }];
      const result = fitToBounds(rects, 1000, 1000, 40);
      // Content width/height: 100x100
      // Available: 1000 - 80 = 920x920
      // Scale: 920/100 = 9.2, but clamped at 8.0
      expect(result.scale).toBeLessThanOrEqual(8); // Clamped to max 800%
      expect(result.scale).toBeGreaterThan(0);
    });

    it('handles point-like items without divide-by-zero', () => {
      const rects: Rect[] = [{ x: 100, y: 100, width: 0, height: 0 }];
      const result = fitToBounds(rects, 1000, 1000);
      expect(result.scale).toBe(1); // Default zoom 100%
      // Center: (1000 / 2) - 100 = 400
      expect(result.offsetX).toBeCloseTo(400);
      expect(result.offsetY).toBeCloseTo(400);
    });

    it('scales multiple rects to fit', () => {
      const rects: Rect[] = [
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 100, y: 100, width: 100, height: 100 },
      ];
      const result = fitToBounds(rects, 1000, 1000, 40);
      expect(result.scale).toBeGreaterThan(0);
      expect(result.scale).toBeLessThanOrEqual(8); // Clamped to max 800%
    });

    it('clamps zoom to 800% maximum', () => {
      // Very tiny content should not zoom beyond 800%
      const rects: Rect[] = [{ x: 0, y: 0, width: 1, height: 1 }];
      const result = fitToBounds(rects, 10000, 10000, 10);
      expect(result.scale).toBeLessThanOrEqual(8);
    });

    it('clamps zoom to 10% minimum', () => {
      // Very large content should not zoom below 10%
      const rects: Rect[] = [{ x: 0, y: 0, width: 100000, height: 100000 }];
      const result = fitToBounds(rects, 1000, 1000, 40);
      expect(result.scale).toBeGreaterThanOrEqual(0.1);
    });

    it('respects padding parameter', () => {
      const rects: Rect[] = [{ x: 0, y: 0, width: 100, height: 100 }];
      const noPadding = fitToBounds(rects, 1000, 1000, 0);
      const withPadding = fitToBounds(rects, 1000, 1000, 100);
      // With padding, scale should be smaller (less room available)
      expect(withPadding.scale).toBeLessThanOrEqual(noPadding.scale);
    });
  });

  describe('pointRect', () => {
    it('builds a zero-extent rect at the point', () => {
      expect(pointRect({ x: 12, y: -7 })).toEqual({ x: 12, y: -7, width: 0, height: 0 });
    });
  });

  describe('splitFitAxis', () => {
    it('realises a positive offset with pan (content smaller than the viewport is centered)', () => {
      expect(splitFitAxis(120, 800, 1000)).toEqual({ pan: 120, scroll: 0 });
    });

    it('realises a negative offset with scroll, keeping pan at zero', () => {
      expect(splitFitAxis(-350, 4000, 1000)).toEqual({ pan: 0, scroll: 350 });
    });

    it('never emits a negative pan — the B8 stranding invariant', () => {
      for (const offset of [-10000, -1, 0, 1, 10000]) {
        expect(splitFitAxis(offset, 5000, 1000).pan).toBeGreaterThanOrEqual(0);
        expect(splitFitAxis(offset, 5000, 1000).scroll).toBeGreaterThanOrEqual(0);
      }
    });

    it('saturates scroll at the container range when the offset outruns it', () => {
      // maxScroll = max(0, 4000 - 1000) = 3000; the requested 5000 clamps.
      expect(splitFitAxis(-5000, 4000, 1000)).toEqual({ pan: 0, scroll: 3000 });
    });

    it('zero offset needs neither pan nor scroll', () => {
      expect(splitFitAxis(0, 4000, 1000)).toEqual({ pan: 0, scroll: 0 });
    });
  });

  describe('fitView', () => {
    it('resets to the default view for an empty rect list', () => {
      expect(
        fitView({ rects: [], contentWidth: 5000, contentHeight: 4000, viewportWidth: 1000, viewportHeight: 800 }),
      ).toEqual({ zoom: 100, panX: 0, panY: 0, scrollLeft: 0, scrollTop: 0 });
    });

    it('fits whole-canvas content smaller than the viewport with pan centering and no scroll', () => {
      const r = fitView({
        rects: [{ x: 0, y: 0, width: 2000, height: 1000 }],
        contentWidth: 2000, contentHeight: 1000,
        viewportWidth: 1000, viewportHeight: 800,
        padding: 40,
      });
      // scale = min(920/2000, 720/1000) = 0.46
      expect(r.zoom).toBeCloseTo(46);
      expect(r.scrollLeft).toBe(0);
      expect(r.scrollTop).toBe(0);
      expect(r.panX).toBeCloseTo((1000 - 2000 * 0.46) / 2);
      expect(r.panY).toBeCloseTo((800 - 1000 * 0.46) / 2);
    });

    it('fits a region of a larger canvas via scroll, keeping pan at zero', () => {
      const r = fitView({
        rects: [{ x: 2000, y: 1000, width: 500, height: 400 }],
        contentWidth: 5000, contentHeight: 4000,
        viewportWidth: 1000, viewportHeight: 800,
        padding: 40,
      });
      // scale = min(920/500, 720/400) = 1.8
      expect(r.zoom).toBeCloseTo(180);
      expect(r.panX).toBe(0);
      expect(r.panY).toBe(0);
      expect(r.scrollLeft).toBeCloseTo(2000 * 1.8 - (1000 - 500 * 1.8) / 2);
      expect(r.scrollTop).toBeCloseTo(1000 * 1.8 - (800 - 400 * 1.8) / 2);
    });

    it('centers a point-like rect at the default 100% zoom instead of dividing by zero', () => {
      const r = fitView({
        rects: [pointRect({ x: 3000, y: 2000 })],
        contentWidth: 5000, contentHeight: 4000,
        viewportWidth: 1000, viewportHeight: 800,
      });
      expect(r.zoom).toBe(100);
      expect(r.panX).toBe(0);
      expect(r.panY).toBe(0);
      // The point lands at the viewport center: offset = 500 - 3000.
      expect(r.scrollLeft).toBeCloseTo(3000 - 500);
      expect(r.scrollTop).toBeCloseTo(2000 - 400);
    });

    it('lands the fitted bounds at the viewport center when nothing clamps', () => {
      const r = fitView({
        rects: [{ x: 400, y: 300, width: 800, height: 500 }],
        contentWidth: 4000, contentHeight: 3000,
        viewportWidth: 1200, viewportHeight: 900,
        padding: 40,
      });
      const scale = r.zoom / 100;
      // Bounds center in the container frame: canvas*scale + pan - scroll.
      const cx = (400 + 400) * scale + r.panX - r.scrollLeft;
      const cy = (300 + 250) * scale + r.panY - r.scrollTop;
      expect(cx).toBeCloseTo(600);
      expect(cy).toBeCloseTo(450);
    });

    it('saturates scroll at the container limit when the fit target outruns it', () => {
      const r = fitView({
        rects: [{ x: 9000, y: 0, width: 2000, height: 100 }],
        contentWidth: 10000, contentHeight: 1000,
        viewportWidth: 1000, viewportHeight: 800,
        padding: 40,
      });
      // scale = min(920/2000, 720/100) = 0.46; needed scroll 4100 > max 3600.
      expect(r.zoom).toBeCloseTo(46);
      expect(r.panX).toBe(0);
      expect(r.scrollLeft).toBeCloseTo(10000 * 0.46 - 1000);
    });

    it('keeps the fitted zoom inside the 10-800% contract range', () => {
      const tiny = fitView({
        rects: [{ x: 0, y: 0, width: 10, height: 10 }],
        contentWidth: 10, contentHeight: 10, viewportWidth: 1000, viewportHeight: 800,
      });
      expect(tiny.zoom).toBe(800);
      const huge = fitView({
        rects: [{ x: 0, y: 0, width: 100000, height: 100000 }],
        contentWidth: 100000, contentHeight: 100000, viewportWidth: 1000, viewportHeight: 800,
      });
      expect(huge.zoom).toBe(10);
    });
  });

  describe('clampZoom', () => {
    it('clamps below 10% to 10%', () => {
      expect(clampZoom(5)).toBe(10);
      expect(clampZoom(0)).toBe(10);
      expect(clampZoom(-100)).toBe(10);
    });

    it('clamps above 800% to 800%', () => {
      expect(clampZoom(900)).toBe(800);
      expect(clampZoom(1000)).toBe(800);
      expect(clampZoom(99999)).toBe(800);
    });

    it('passes through values in range', () => {
      expect(clampZoom(10)).toBe(10);
      expect(clampZoom(50)).toBe(50);
      expect(clampZoom(100)).toBe(100);
      expect(clampZoom(500)).toBe(500);
      expect(clampZoom(800)).toBe(800);
    });

    it('handles decimal values', () => {
      expect(clampZoom(15.5)).toBe(15.5);
      expect(clampZoom(799.9)).toBe(799.9);
    });
  });

  describe('zoomAboutPoint', () => {
    it('keeps canvas point under cursor when zooming in from 100% to 200%', () => {
      // Cursor at (100, 100), canvas point (50, 50) underneath
      // Zoom from 1x to 2x
      // New offset should keep (50, 50) under cursor at (100, 100)
      const result = zoomAboutPoint(100, 100, 50, 50, 2);
      // Expected: 100 - 50 * 2 = 0
      expect(result.offsetX).toBe(0);
      expect(result.offsetY).toBe(0);

      // Verify: convert canvas point back to screen
      const screenPoint = canvasToScreen(50, 50, 2, result.offsetX, result.offsetY);
      expect(screenPoint.x).toBe(100);
      expect(screenPoint.y).toBe(100);
    });

    it('keeps canvas point under cursor when zooming out from 200% to 100%', () => {
      // Cursor at (200, 200), canvas point (100, 100) underneath
      // Zoom from 2x to 1x
      const result = zoomAboutPoint(200, 200, 100, 100, 1);
      // Expected: 200 - 100 * 1 = 100
      expect(result.offsetX).toBe(100);
      expect(result.offsetY).toBe(100);

      // Verify
      const screenPoint = canvasToScreen(100, 100, 1, result.offsetX, result.offsetY);
      expect(screenPoint.x).toBe(200);
      expect(screenPoint.y).toBe(200);
    });

    it('works at various zoom levels', () => {
      for (const newScale of [0.1, 0.5, 1, 2, 4, 8]) {
        const result = zoomAboutPoint(300, 400, 150, 200, newScale);
        const screenPoint = canvasToScreen(150, 200, newScale, result.offsetX, result.offsetY);
        expect(screenPoint.x).toBeCloseTo(300);
        expect(screenPoint.y).toBeCloseTo(400);
      }
    });

    it('handles cursor at origin', () => {
      const result = zoomAboutPoint(0, 0, 100, 200, 2);
      const screenPoint = canvasToScreen(100, 200, 2, result.offsetX, result.offsetY);
      expect(screenPoint.x).toBeCloseTo(0);
      expect(screenPoint.y).toBeCloseTo(0);
    });

    it('handles canvas point at origin', () => {
      const result = zoomAboutPoint(500, 600, 0, 0, 2);
      const screenPoint = canvasToScreen(0, 0, 2, result.offsetX, result.offsetY);
      expect(screenPoint.x).toBeCloseTo(500);
      expect(screenPoint.y).toBeCloseTo(600);
    });
  });

  describe('nextWheelZoom', () => {
    it('is a no-op for zero deltaY (pinch events sometimes carry no delta)', () => {
      expect(nextWheelZoom(100, 0, 0)).toBe(100);
      expect(nextWheelZoom(350, 0, 0)).toBe(350);
    });

    it('zooms by one proportional notch per full mouse-wheel step', () => {
      // Wheel up (deltaY < 0) zooms in, wheel down zooms out — the sign
      // convention of the original handler, kept.
      expect(nextWheelZoom(100, -100, 0)).toBeCloseTo(110);
      expect(nextWheelZoom(100, 100, 0)).toBeCloseTo(100 / 1.1);
    });

    it('scales the step by delta magnitude, not a flat ±10 points', () => {
      // Half a notch is half the exponent, not half of a flat 10 points.
      expect(nextWheelZoom(100, -50, 0)).toBeCloseTo(100 * Math.pow(1.1, 0.5));
      expect(nextWheelZoom(200, -10, 0)).toBeCloseTo(200 * Math.pow(1.1, 0.1));
    });

    it('a whole trackpad pinch gesture moves the zoom ~10-20%, not across the whole range', () => {
      // Regression for the flat-step bug: a pinch arrives as dozens of
      // small-delta events. Forty events of deltaY -5 summed 40 * -5 = -200
      // px of delta, i.e. two notches: 1.1^2 = 21%. The old flat ±10 step
      // would have done 40 * 10 = 400 points — 100% to 500%.
      let zoom = 100;
      for (let i = 0; i < 40; i++) zoom = nextWheelZoom(zoom, -5, 0);
      expect(zoom).toBeCloseTo(121, 0);
      expect(zoom).toBeLessThan(140);
    });

    it('normalises line-mode deltas (Firefox mouse wheels report deltaMode 1)', () => {
      // One Firefox notch is deltaY -3 lines; with the flat step that was
      // barely visible, and /100-proportional it would be nothing at all.
      expect(nextWheelZoom(100, -3, 1)).toBeCloseTo(100 * Math.pow(1.1, 1.2));
    });

    it('clamps to the 10-800% range', () => {
      expect(nextWheelZoom(795, -100, 0)).toBe(800);
      expect(nextWheelZoom(11, 100, 0)).toBe(10);
      expect(nextWheelZoom(800, -100000, 0)).toBeLessThanOrEqual(800);
      expect(nextWheelZoom(10, 100000, 0)).toBeGreaterThanOrEqual(10);
    });

    it('caps a single pathological delta so one event cannot jump orders of magnitude', () => {
      // Some drivers emit deltas in the thousands; the exponent is capped.
      expect(nextWheelZoom(100, -1000000, 0)).toBeCloseTo(100 * Math.pow(1.1, 4));
      expect(nextWheelZoom(100, 1000000, 0)).toBeCloseTo(100 * Math.pow(1.1, -4));
    });
  });

  describe('zoomViewAboutCursor', () => {
    it('B8 regression: includes the container scroll in the anchor math', () => {
      // Scrolled 800 px right via drag, zoom 100% -> 110% about the cursor.
      // The canvas point under the cursor is (cursor + scroll - pan)/scale =
      // 400 + 800 = 1200, NOT 400. Omitting the scroll term (the old code)
      // misplaced the anchor by scroll * (newScale/scale - 1) = 80 px here.
      const r = zoomViewAboutCursor({
        cursorX: 400, cursorY: 300,
        scrollLeft: 800, scrollTop: 0,
        panX: 0, panY: 0,
        scale: 1, newScale: 1.1,
        contentWidth: 3000, contentHeight: 2000,
        viewportWidth: 1000, viewportHeight: 800,
      });
      // The point that was under the cursor must still be under the cursor:
      // clientOffset = canvas*newScale + pan - scroll.
      expect(1200 * 1.1 + r.panX - r.scrollLeft).toBeCloseTo(400);
      expect(300 * 1.1 + r.panY - r.scrollTop).toBeCloseTo(300);
      // Exact split: required offset -920 fits the scroll bound (2300), so
      // pan stays 0 and scroll absorbs it.
      expect(r.panX).toBe(0);
      expect(r.scrollLeft).toBeCloseTo(920);
      expect(r.panY).toBe(0);
      expect(r.scrollTop).toBeCloseTo(30);
    });

    it('B8 regression: zooming in never strands the view with negative pan', () => {
      // The old solver returned pan = cursor - canvas*newScale = -300/-200
      // here; the scroll container cannot scroll negative, so everything
      // above-left of the cursor became unreachable. Pan must stay >= 0 and
      // the remainder goes to scroll.
      const r = zoomViewAboutCursor({
        cursorX: 300, cursorY: 200,
        scrollLeft: 0, scrollTop: 0,
        panX: 0, panY: 0,
        scale: 1, newScale: 2,
        contentWidth: 2000, contentHeight: 2000,
        viewportWidth: 1000, viewportHeight: 800,
      });
      expect(r.panX).toBe(0);
      expect(r.panY).toBe(0);
      expect(r.scrollLeft).toBeCloseTo(300);
      expect(r.scrollTop).toBeCloseTo(200);
      // Anchor still exact.
      expect(300 * 2 + r.panX - r.scrollLeft).toBeCloseTo(300);
      expect(200 * 2 + r.panY - r.scrollTop).toBeCloseTo(200);
    });

    it('zooming out keeps the anchor with positive pan and untouched scroll', () => {
      const r = zoomViewAboutCursor({
        cursorX: 300, cursorY: 200,
        scrollLeft: 0, scrollTop: 0,
        panX: 0, panY: 0,
        scale: 2, newScale: 1,
        contentWidth: 2000, contentHeight: 2000,
        viewportWidth: 1000, viewportHeight: 800,
      });
      // canvas point under cursor at scale 2 is (150, 100); at scale 1 it
      // needs pan 150/100 to stay put.
      expect(r.panX).toBeCloseTo(150);
      expect(r.panY).toBeCloseTo(100);
      expect(r.scrollLeft).toBe(0);
      expect(r.scrollTop).toBe(0);
    });

    it('clamps to zero when the content is smaller than the viewport', () => {
      // M = max(0, content*newScale - viewport) = 0, so neither pan nor
      // scroll can move; the anchor slides because no exact split exists.
      const r = zoomViewAboutCursor({
        cursorX: 100, cursorY: 100,
        scrollLeft: 0, scrollTop: 0,
        panX: 0, panY: 0,
        scale: 1, newScale: 0.5,
        contentWidth: 400, contentHeight: 300,
        viewportWidth: 1000, viewportHeight: 800,
      });
      expect(r).toEqual({ panX: 0, panY: 0, scrollLeft: 0, scrollTop: 0 });
    });

    it('keeps the cursor point fixed across a range of configurations', () => {
      const viewport = { w: 1000, h: 800 };
      const cases = [
        { scale: 1, newScale: 2, scrollLeft: 1000, scrollTop: 500, cursorX: 250, cursorY: 300 },
        { scale: 2, newScale: 1, scrollLeft: 1500, scrollTop: 700, cursorX: 400, cursorY: 300 },
        { scale: 1, newScale: 0.5, scrollLeft: 0, scrollTop: 0, cursorX: 400, cursorY: 300 },
        { scale: 0.5, newScale: 0.75, scrollLeft: 200, scrollTop: 100, cursorX: 700, cursorY: 600 },
        { scale: 4, newScale: 3, scrollLeft: 3000, scrollTop: 2000, cursorX: 500, cursorY: 400 },
      ];
      for (const c of cases) {
        const r = zoomViewAboutCursor({
          cursorX: c.cursorX, cursorY: c.cursorY,
          scrollLeft: c.scrollLeft, scrollTop: c.scrollTop,
          panX: 0, panY: 0,
          scale: c.scale, newScale: c.newScale,
          contentWidth: 4000, contentHeight: 4000,
          viewportWidth: viewport.w, viewportHeight: viewport.h,
        });
        const canvasX = (c.cursorX + c.scrollLeft) / c.scale;
        const canvasY = (c.cursorY + c.scrollTop) / c.scale;
        expect(canvasX * c.newScale + r.panX - r.scrollLeft, `x @ ${c.scale}->${c.newScale}`).toBeCloseTo(c.cursorX);
        expect(canvasY * c.newScale + r.panY - r.scrollTop, `y @ ${c.scale}->${c.newScale}`).toBeCloseTo(c.cursorY);
        // Pan never negative — the stranding invariant.
        expect(r.panX).toBeGreaterThanOrEqual(0);
        expect(r.panY).toBeGreaterThanOrEqual(0);
        expect(r.scrollLeft).toBeGreaterThanOrEqual(0);
        expect(r.scrollTop).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
