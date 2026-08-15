import { describe, it, expect } from 'vitest';
import { computeRoutePoints, pointsToPathD, computeRoutedPath, pathMidpoint } from '../routing.js';

describe('computeRoutePoints', () => {
  it('routes a straight line when ports are already aligned after their stubs', () => {
    const points = computeRoutePoints({ x: 0, y: 100 }, 'right', { x: 200, y: 100 }, 'left', { stub: 10 });
    // from -> stub-out -> stub-in -> to, all on y=100, collapsed to endpoints.
    expect(points.every((p) => p.y === 100)).toBe(true);
    expect(points[0]).toEqual({ x: 0, y: 100 });
    expect(points[points.length - 1]).toEqual({ x: 200, y: 100 });
  });

  it('jogs sideways with a single true 45° diagonal when ports are on different rows', () => {
    const points = computeRoutePoints({ x: 0, y: 0 }, 'right', { x: 200, y: 100 }, 'left', { stub: 10 });
    // Every hop is either flat (horizontal) or a true 45° diagonal (equal
    // abs(dx) and abs(dy)) — never a vertical-only hop, and never a 90°
    // corner between two orthogonal segments.
    let sawDiagonal = false;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const ddx = b.x - a.x;
      const ddy = b.y - a.y;
      const isFlat = ddy === 0;
      const isDiagonal = Math.abs(ddx) === Math.abs(ddy) && ddx !== 0;
      expect(isFlat || isDiagonal).toBe(true);
      if (isDiagonal) sawDiagonal = true;
    }
    expect(sawDiagonal).toBe(true);
  });

  it('centers the diagonal jog when there is room, with flat leads on both sides', () => {
    // 200px of horizontal room (after stubs), 100px of vertical offset ->
    // 100px of leftover room split into two 50px flat leads. The flat lead
    // out of the source (and the final stub into the target) collapse into
    // their neighboring flat run since they're collinear continuations, so
    // the simplified path is just: start, diagonal-start, diagonal-end, end.
    const points = computeRoutePoints({ x: 0, y: 0 }, 'right', { x: 220, y: 100 }, 'left', { stub: 10 });
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 160, y: 100 },
      { x: 220, y: 100 },
    ]);
  });

  it('always leaves the source port in its exit direction first', () => {
    const points = computeRoutePoints({ x: 0, y: 0 }, 'right', { x: -200, y: 50 }, 'left', { stub: 10 });
    // Even though the target is to the left, the first segment must move +x (rightward stub).
    expect(points[1]!.x).toBeGreaterThan(points[0]!.x);
  });

  it('still only uses flat/45° segments when there is not enough horizontal room for a full diagonal', () => {
    // Vertical offset (100) far exceeds the available horizontal room, so
    // the trailing flat segment has to run backwards to reach the target —
    // still no vertical-only hops.
    const points = computeRoutePoints({ x: 0, y: 0 }, 'right', { x: 20, y: 100 }, 'left', { stub: 10 });
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const ddx = b.x - a.x;
      const ddy = b.y - a.y;
      const isFlat = ddy === 0;
      const isDiagonal = Math.abs(ddx) === Math.abs(ddy) && ddx !== 0;
      expect(isFlat || isDiagonal).toBe(true);
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
  it('combines routing and serialization into one path string', () => {
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
