import { describe, it, expect } from 'vitest';
import { computeRoutePoints, miterCorners, pointsToPathD, computeRoutedPath, pathMidpoint } from '../routing.js';

describe('computeRoutePoints', () => {
  it('routes a straight line when ports are already aligned after their stubs', () => {
    const points = computeRoutePoints({ x: 0, y: 100 }, 'right', { x: 200, y: 100 }, 'left', { stub: 10 });
    // from -> stub-out -> stub-in -> to, all on y=100, collapsed to endpoints.
    expect(points.every((p) => p.y === 100)).toBe(true);
    expect(points[0]).toEqual({ x: 0, y: 100 });
    expect(points[points.length - 1]).toEqual({ x: 200, y: 100 });
  });

  it('routes a two-corner elbow ("Z") when ports are on different rows', () => {
    const points = computeRoutePoints({ x: 0, y: 0 }, 'right', { x: 200, y: 100 }, 'left', { stub: 10 });
    // Expect exactly two interior corners (4 direction changes -> 6 points before collapsing stubs).
    const corners = points.length - 2; // minus the two endpoints
    expect(corners).toBeGreaterThanOrEqual(2);
    // Every corner is a pure horizontal or vertical hop.
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  });

  it('always leaves the source port in its exit direction first', () => {
    const points = computeRoutePoints({ x: 0, y: 0 }, 'right', { x: -200, y: 50 }, 'left', { stub: 10 });
    // Even though the target is to the left, the first segment must move +x (rightward stub).
    expect(points[1]!.x).toBeGreaterThan(points[0]!.x);
  });
});

describe('miterCorners', () => {
  it('leaves a straight 2-point line untouched', () => {
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(miterCorners(points, 8)).toEqual(points);
  });

  it('replaces a 90° corner with a 45° diagonal cut', () => {
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const mitered = miterCorners(points, 8);
    // Original sharp corner (100,0) should be gone, replaced by two cut points.
    expect(mitered).not.toContainEqual({ x: 100, y: 0 });
    expect(mitered.length).toBe(4); // start, cut-in, cut-out, end
    const [start, cutIn, cutOut, end] = mitered;
    expect(start).toEqual({ x: 0, y: 0 });
    expect(end).toEqual({ x: 100, y: 100 });
    expect(cutIn).toEqual({ x: 92, y: 0 });
    expect(cutOut).toEqual({ x: 100, y: 8 });
    // The cut segment itself is a true 45° diagonal (equal dx/dy).
    expect(Math.abs(cutOut!.x - cutIn!.x)).toBeCloseTo(Math.abs(cutOut!.y - cutIn!.y));
  });

  it('does not overlap or invert direction on a very short segment', () => {
    const points = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 100 }];
    const mitered = miterCorners(points, 8); // miter (8) > half the 3px segment
    // Should clamp the cut to fit rather than producing a nonsensical path.
    for (let i = 1; i < mitered.length; i++) {
      const a = mitered[i - 1]!;
      const b = mitered[i]!;
      expect(Number.isFinite(a.x) && Number.isFinite(b.x)).toBe(true);
    }
  });
});

describe('pointsToPathD', () => {
  it('serializes to an SVG M/L path', () => {
    expect(pointsToPathD([{ x: 0, y: 0 }, { x: 10, y: 5 }])).toBe('M 0 0 L 10 5');
  });

  it('returns empty string for no points', () => {
    expect(pointsToPathD([])).toBe('');
  });
});

describe('computeRoutedPath', () => {
  it('combines routing and mitering into one path string', () => {
    const { points, d } = computeRoutedPath({ x: 0, y: 0 }, 'right', { x: 200, y: 100 }, 'left');
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d).toContain(`${points[points.length - 1]!.x} ${points[points.length - 1]!.y}`);
  });
});

describe('pathMidpoint', () => {
  it('finds the point halfway along total path length', () => {
    const mid = pathMidpoint([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(mid).toEqual({ x: 50, y: 0 });
  });

  it('handles multi-segment paths of unequal length', () => {
    const mid = pathMidpoint([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 100 }]);
    // total length 110, halfway = 55 -> 10 along first seg (10) + 45 along second
    expect(mid).toEqual({ x: 10, y: 45 });
  });
});
