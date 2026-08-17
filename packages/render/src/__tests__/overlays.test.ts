import { describe, it, expect } from 'vitest';
import {
  pointAtArcLength, polylineLength, shieldTerminationMarks, twistCrossoverPaths, TWIST_ZONE_LEN,
} from '../overlays.js';
import type { SceneWire } from '../schematicScene.js';

/** A horizontal SceneWire from (0,y) to (len,y) — enough for the overlay
 * geometry, which only reads `routePoints`, `from` and `to`. */
function wire(y: number, len = 200, id = `w${y}`): SceneWire {
  const from = { x: 0, y };
  const to = { x: len, y };
  return {
    wireId: id, refdes: id.toUpperCase(), color: 'Red',
    from, to, fromDir: 'right', toDir: 'left', degraded: false,
    routePoints: [from, to], path: `M 0 ${y} L ${len} ${y}`, midpoint: { x: len / 2, y },
    manualWaypoints: [],
  };
}

describe('pointAtArcLength', () => {
  it('walks across segment boundaries rather than treating each segment separately', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(pointAtArcLength(pts, 15)).toEqual({ x: 10, y: 5 });
  });

  it('clamps to the final point when asked for more length than the polyline has', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(pointAtArcLength(pts, 999)).toEqual({ x: 10, y: 0 });
  });

  it('agrees with polylineLength at the far end', () => {
    const pts = [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 14 }];
    expect(polylineLength(pts)).toBe(15);
    expect(pointAtArcLength(pts, 15)).toEqual({ x: 3, y: 14 });
  });
});

describe('shieldTerminationMarks', () => {
  it('produces one mark per end, tagged so each can carry its own termination', () => {
    const marks = shieldTerminationMarks([wire(0), wire(20)], 0.1);
    expect(marks.map((m) => m.end)).toEqual(['source', 'target']);
  });

  it('positions each mark by FRACTION of the run, not a fixed pixel inset', () => {
    // This is the behaviour the `position` control depends on: the same
    // fraction has to land proportionally on runs of different lengths.
    const short = shieldTerminationMarks([wire(0, 100)], 0.25);
    const long = shieldTerminationMarks([wire(0, 1000)], 0.25);
    expect(short[0]!.center.x).toBeCloseTo(25, 6);
    expect(long[0]!.center.x).toBeCloseTo(250, 6);
  });

  it('measures the target-end mark inward from the TARGET end', () => {
    const marks = shieldTerminationMarks([wire(0, 400)], 0.25);
    expect(marks[0]!.center.x).toBeCloseTo(100, 6);
    expect(marks[1]!.center.x).toBeCloseTo(300, 6);
  });

  it('clamps position so the two marks can never cross and swap ends', () => {
    // Without the clamp a position past 0.5 would put the "source" mark
    // beyond the "target" one, silently mislabelling which connector
    // terminates how.
    const marks = shieldTerminationMarks([wire(0, 400)], 0.9);
    expect(marks[0]!.center.x).toBeLessThan(marks[1]!.center.x);
  });

  it('encircles every member wire vertically', () => {
    const marks = shieldTerminationMarks([wire(0), wire(60)], 0.1);
    // ry has to reach from the centre out past the outermost member.
    expect(marks[0]!.center.y).toBe(30);
    expect(marks[0]!.ry).toBeGreaterThanOrEqual(30);
  });

  it('points each mark outward, back toward its own connector', () => {
    const marks = shieldTerminationMarks([wire(0, 400)], 0.2);
    expect(marks[0]!.dir).toBe(-1); // source mark points back toward x=0
    expect(marks[1]!.dir).toBe(1); // target mark points on toward x=400
  });

  it('puts the termination node on the outward edge of the ellipse', () => {
    const marks = shieldTerminationMarks([wire(0, 400)], 0.2);
    expect(marks[0]!.nodePoint.x).toBeCloseTo(marks[0]!.center.x - marks[0]!.rx, 6);
  });

  it('returns nothing for a group with no placed members', () => {
    expect(shieldTerminationMarks([], 0.1)).toEqual([]);
  });
});

describe('twistCrossoverPaths', () => {
  it('draws nothing for a single wire — one conductor cannot twist around itself', () => {
    expect(twistCrossoverPaths([wire(0)], 'from')).toEqual([]);
  });

  it('draws one crossing pair per adjacent member', () => {
    // Three conductors give two adjacent pairs, two paths each.
    expect(twistCrossoverPaths([wire(0), wire(20), wire(40)], 'from', 'ieee315')).toHaveLength(4);
  });

  it('pairs members by their lateral position, not by array order', () => {
    // Passing them out of order must produce the same glyph as in order,
    // otherwise the crossover connects wires that aren't adjacent on screen.
    const inOrder = twistCrossoverPaths([wire(0), wire(20), wire(40)], 'from', 'ieee315');
    const shuffled = twistCrossoverPaths([wire(40), wire(0), wire(20)], 'from', 'ieee315');
    expect(new Set(shuffled)).toEqual(new Set(inOrder));
  });

  it('gives IEC 60617-3 more crossings than IEEE 315 over the same zone', () => {
    const ieee = twistCrossoverPaths([wire(0), wire(20)], 'from', 'ieee315');
    const iec = twistCrossoverPaths([wire(0), wire(20)], 'from', 'iec60617');
    const segments = (paths: string[]) => paths.join(' ').split(/[ML]/).length;
    expect(segments(iec)).toBeGreaterThan(segments(ieee));
  });

  it('starts each glyph at the pin and stays within the twist zone', () => {
    // The glyph must not run down the whole wire: it's a localized cue at
    // the termination, and it has to fit between the connector and a shield
    // mark on the same run.
    const paths = twistCrossoverPaths([wire(0, 400), wire(20, 400)], 'from', 'ieee315');
    // Every command is "<M|L> <x> <y>", so take the x of each coordinate pair.
    const xs = paths
      .flatMap((p) => [...p.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)])
      .map((m) => Number(m[1]));
    expect(Math.max(...xs)).toBeLessThanOrEqual(TWIST_ZONE_LEN + 1);
  });

  it('anchors the "to" glyph at the far end instead of the near one', () => {
    const paths = twistCrossoverPaths([wire(0, 400), wire(20, 400)], 'to', 'ieee315');
    expect(paths.every((p) => p.startsWith('M 400 '))).toBe(true);
  });
});
