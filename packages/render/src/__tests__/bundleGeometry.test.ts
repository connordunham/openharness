/**
 * Phase 2a — pure bundle geometry helpers. Every case here exercises behaviour
 * that did not exist before bundleGeometry.ts: crossing detection, polyline
 * hit-testing, the diameter→outline-width mapping, and arc-length label
 * placement.
 */
import { describe, it, expect } from 'vitest';
import {
  segmentIntersection,
  detectPathCrossings,
  distToSegmentSq,
  hitTestPolyline,
  bundleOutlineWidth,
  pointAtFraction,
} from '../bundleGeometry.js';

describe('segmentIntersection', () => {
  it('returns the crossing point of two proper crossings', () => {
    const hit = segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 });
    expect(hit).toEqual({ x: 5, y: 5 });
  });

  it('returns undefined for parallel segments', () => {
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBeUndefined();
  });

  it('returns undefined for collinear overlapping segments — shared runs are not conflicts', () => {
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 15, y: 0 })).toBeUndefined();
  });

  it('returns undefined when segments only touch at an endpoint', () => {
    // Two bundles fanning out of the same attach point meet exactly there —
    // that is node geometry, not a crossing.
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 10, y: -5 }, { x: 0, y: 0 }, { x: 10, y: 5 })).toBeUndefined();
  });

  it('returns undefined when the segments would only cross if extended', () => {
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 6, y: 0 }, { x: 10, y: 4 })).toBeUndefined();
  });
});

describe('detectPathCrossings', () => {
  it('flags both paths at the crossing point', () => {
    const crossings = detectPathCrossings([
      { id: 'A', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      { id: 'B', points: [{ x: 50, y: -50 }, { x: 50, y: 50 }] },
    ]);
    expect(crossings.get('A')).toEqual([{ x: 50, y: 0 }]);
    expect(crossings.get('B')).toEqual([{ x: 50, y: 0 }]);
  });

  it('leaves parallel paths unflagged', () => {
    const crossings = detectPathCrossings([
      { id: 'A', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      { id: 'B', points: [{ x: 0, y: 10 }, { x: 100, y: 10 }] },
    ]);
    expect(crossings.size).toBe(0);
  });

  it('does not flag paths that only share an attach point (component fan-out)', () => {
    // Both paths start at the same point and diverge — the strict-interior
    // test alone already refuses this; the endpoint exclusion radius also
    // covers near-shared attach points (e.g. branch-point circle clips).
    const fan = [
      { id: 'A', points: [{ x: 0, y: 0 }, { x: 60, y: -40 }] },
      { id: 'B', points: [{ x: 0, y: 0 }, { x: 60, y: 40 }] },
    ];
    expect(detectPathCrossings(fan).size).toBe(0);
    const nearFan = [
      { id: 'A', points: [{ x: 0, y: -3 }, { x: 60, y: -40 }] },
      { id: 'B', points: [{ x: 0, y: 3 }, { x: 60, y: 40 }] },
    ];
    expect(detectPathCrossings(nearFan, 14).size).toBe(0);
  });

  it('intersections inside the endpoint exclusion radius are ignored', () => {
    const crossings = detectPathCrossings(
      [
        { id: 'A', points: [{ x: 0, y: 0 }, { x: 40, y: 0 }] },
        { id: 'B', points: [{ x: 5, y: -20 }, { x: 5, y: 20 }] },
      ],
      10, // crossing at (5,0) is 5px from A's start → excluded
    );
    expect(crossings.size).toBe(0);
  });

  it('flags a path that crosses itself (a route that loops back)', () => {
    const crossings = detectPathCrossings([
      { id: 'A', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 50, y: -10 }] },
    ]);
    // The last segment (0,100)→(50,-10) crosses the first (0,0)→(100,0).
    expect(crossings.get('A')?.length).toBe(1);
  });

  it('adjacent segments of one path never flag each other', () => {
    const crossings = detectPathCrossings([
      { id: 'A', points: [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }] },
    ]);
    expect(crossings.size).toBe(0);
  });
});

describe('hitTestPolyline / distToSegmentSq', () => {
  const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

  it('hits a point within threshold of the polyline', () => {
    expect(hitTestPolyline({ x: 50, y: 4 }, line, 6)).toBe(true);
  });

  it('misses a point beyond the threshold', () => {
    expect(hitTestPolyline({ x: 50, y: 10 }, line, 6)).toBe(false);
  });

  it('a single-point polyline hits within a radius', () => {
    expect(hitTestPolyline({ x: 3, y: 4 }, [{ x: 0, y: 0 }], 5)).toBe(true);
    expect(hitTestPolyline({ x: 3, y: 4 }, [{ x: 0, y: 0 }], 4.9)).toBe(false);
  });

  it('an empty polyline never hits', () => {
    expect(hitTestPolyline({ x: 0, y: 0 }, [], 100)).toBe(false);
  });

  it('distToSegmentSq measures perpendicular distance mid-segment', () => {
    expect(distToSegmentSq({ x: 50, y: 7 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(49);
  });

  it('distToSegmentSq clamps to the nearer endpoint past the ends', () => {
    expect(distToSegmentSq({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(25);
  });
});

describe('bundleOutlineWidth (diameter indicator)', () => {
  it('scales the outline with the derived diameter', () => {
    // Layout canvas: 4 px per mm → a 3 mm bundle draws 12 px wide.
    expect(bundleOutlineWidth(3, 4)).toBe(12);
  });

  it('clamps to the minimum when nothing in the bundle has a known diameter', () => {
    // derive reports 0 (never a guess); the outline still exists.
    expect(bundleOutlineWidth(0, 4)).toBe(6);
  });

  it('honours a custom minimum', () => {
    expect(bundleOutlineWidth(0.5, 4, 10)).toBe(10);
  });
});

describe('pointAtFraction (label placement)', () => {
  it('places the midpoint of a straight run at its middle', () => {
    const { point, angle } = pointAtFraction([{ x: 0, y: 0 }, { x: 100, y: 0 }], 0.5);
    expect(point).toEqual({ x: 50, y: 0 });
    expect(angle).toBe(0);
  });

  it('walks bends by arc length, not by segment index', () => {
    // 100 right, then 100 down: t=0.75 is 150 along → 50 into the second leg.
    const { point } = pointAtFraction([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 0.75);
    expect(point.x).toBeCloseTo(100);
    expect(point.y).toBeCloseTo(50);
  });

  it('degenerate inputs fall back sanely', () => {
    expect(pointAtFraction([], 0.5).point).toEqual({ x: 0, y: 0 });
    expect(pointAtFraction([{ x: 7, y: 9 }], 0.5).point).toEqual({ x: 7, y: 9 });
    // All points coincident — zero length must not divide by zero.
    expect(pointAtFraction([{ x: 5, y: 5 }, { x: 5, y: 5 }], 0.5).point).toEqual({ x: 5, y: 5 });
  });
});
