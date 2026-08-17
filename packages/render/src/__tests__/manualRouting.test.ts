import { describe, it, expect } from 'vitest';
import {
  computeManualRoutePoints, computeManualRoutedPath, computeRoutePoints,
  nearestSegment, waypointInsertIndex,
} from '../routing.js';

const A = { x: 0, y: 0 };
const B = { x: 200, y: 60 };

describe('computeManualRoutePoints', () => {
  it('keeps the port stubs even when the user has taken over routing', () => {
    // The stubs aren't styling — a wire entering the back of a pin is a
    // wrong drawing — so manual routing must not be able to remove them.
    const pts = computeManualRoutePoints(A, 'right', B, 'left', [{ x: 100, y: 200 }], { stub: 14 });
    expect(pts[0]).toEqual(A);
    expect(pts[1]).toEqual({ x: 14, y: 0 }); // leaves the source heading right
    expect(pts[pts.length - 2]).toEqual({ x: 186, y: 60 }); // arrives from the left
    expect(pts[pts.length - 1]).toEqual(B);
  });

  it('honours a flipped port by stubbing the other way', () => {
    const pts = computeManualRoutePoints(A, 'left', B, 'right', [{ x: 50, y: 50 }], { stub: 10 });
    expect(pts[1]).toEqual({ x: -10, y: 0 });
    expect(pts[pts.length - 2]).toEqual({ x: 210, y: 60 });
  });

  it('threads the user bends between the stubs, in order', () => {
    const bends = [{ x: 40, y: 120 }, { x: 150, y: 120 }];
    const pts = computeManualRoutePoints(A, 'right', B, 'left', bends, { stub: 14 });
    expect(pts).toEqual([A, { x: 14, y: 0 }, bends[0], bends[1], { x: 186, y: 60 }, B]);
  });

  it('with no bends, produces the plain stub-to-stub path', () => {
    // Not a special case callers have to guard — this is what makes
    // "manualWaypoints.length === 0" and "auto-routed" interchangeable.
    const pts = computeManualRoutePoints(A, 'right', B, 'left', [], { stub: 14 });
    expect(pts).toEqual([A, { x: 14, y: 0 }, { x: 186, y: 60 }, B]);
  });

  it('collapses a bend dragged back onto the line it came from', () => {
    // Dragging a bend flat should cleanly remove the corner rather than
    // leaving a zero-angle artefact in the path data. With both ports and
    // the bend on y=0 the entire run is collinear, so it reduces to a single
    // straight segment — stubs included, since they lie on that same line.
    const flat = { x: 100, y: 0 };
    const pts = computeManualRoutePoints(A, 'right', { x: 200, y: 0 }, 'left', [flat], { stub: 14 });
    expect(pts).toEqual([A, { x: 200, y: 0 }]);
  });

  it('produces a path string matching its own points', () => {
    const { points, d } = computeManualRoutedPath(A, 'right', B, 'left', [{ x: 90, y: 90 }], { stub: 14 });
    expect(d.startsWith(`M ${points[0]!.x} ${points[0]!.y}`)).toBe(true);
    expect(d.split('L')).toHaveLength(points.length);
  });

  it('differs from the auto-route once a bend is placed', () => {
    const auto = computeRoutePoints(A, 'right', B, 'left');
    const manual = computeManualRoutePoints(A, 'right', B, 'left', [{ x: 100, y: 300 }]);
    expect(manual).not.toEqual(auto);
  });
});

describe('nearestSegment', () => {
  it('finds the segment a point sits closest to, not just the nearest vertex', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    // (50, 5) is nearest the middle of segment 0, though vertex (100,0) is
    // the nearest *vertex* to it along x.
    expect(nearestSegment(pts, { x: 50, y: 5 }).index).toBe(0);
    expect(nearestSegment(pts, { x: 95, y: 60 }).index).toBe(1);
  });

  it('reports the perpendicular distance, clamped to the segment ends', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(nearestSegment(pts, { x: 50, y: 8 }).distance).toBeCloseTo(8, 10);
    // Beyond the end, distance is measured to the endpoint, not to the
    // infinite line (which would report 0).
    expect(nearestSegment(pts, { x: 130, y: 0 }).distance).toBeCloseTo(30, 10);
  });
});

describe('waypointInsertIndex', () => {
  it('inserts a bend grabbed near the source ahead of every existing bend', () => {
    const bends = [{ x: 100, y: 100 }];
    const i = waypointInsertIndex(A, 'right', B, 'left', bends, { x: 20, y: 10 }, { stub: 14 });
    expect(i).toBe(0);
  });

  it('inserts a bend grabbed near the target after every existing bend', () => {
    const bends = [{ x: 100, y: 100 }];
    const i = waypointInsertIndex(A, 'right', B, 'left', bends, { x: 185, y: 62 }, { stub: 14 });
    expect(i).toBe(1);
  });

  it('inserts between the two bends a grab lands between', () => {
    // The whole reason this function exists: appending instead would make
    // the path cross itself the instant a middle segment is dragged.
    const bends = [{ x: 60, y: 100 }, { x: 160, y: 100 }];
    const i = waypointInsertIndex(A, 'right', B, 'left', bends, { x: 110, y: 100 }, { stub: 14 });
    expect(i).toBe(1);
  });

  it('never returns an index outside the array bounds', () => {
    const bends = [{ x: 60, y: 100 }];
    for (const p of [{ x: -500, y: -500 }, { x: 5000, y: 5000 }, A, B]) {
      const i = waypointInsertIndex(A, 'right', B, 'left', bends, p, { stub: 14 });
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThanOrEqual(bends.length);
    }
  });

  it('always returns 0 for a wire with no bends yet', () => {
    for (const p of [{ x: 10, y: 0 }, { x: 100, y: 30 }, { x: 190, y: 60 }]) {
      expect(waypointInsertIndex(A, 'right', B, 'left', [], p, { stub: 14 })).toBe(0);
    }
  });
});
