/**
 * Overlay geometry for the Schematic canvas: twisted-pair crossover glyphs
 * and shield termination marks.
 *
 * These live here, in the pure-geometry package, rather than inside
 * SchematicCanvas.tsx where they started, for the same reason the wire
 * router does: they are functions from a scene to a set of points, they have
 * no business touching React, and they are the only part of the shield/twist
 * features that can be meaningfully unit-tested. SchematicCanvas is left with
 * the job of turning the returned geometry into SVG elements.
 */

import type { Point } from '@openharness/core';
import type { SceneWire } from './schematicScene.js';

/** Length (px, along each wire's own route) of the twisted-pair crossover
 * glyph at each connector exit — kept short so it always fits between the
 * connector face and a shield mark on the same wire (Connor: "as short as
 * possible so it fits between the shield and the connector"). */
export const TWIST_ZONE_LEN = 16;

/**
 * Point at cumulative arc length `targetLen` along a polyline, starting from
 * `points[0]`. Clamps to the last point when the polyline is shorter than
 * `targetLen` (a very short run between adjacent components).
 */
export function pointAtArcLength(points: readonly Point[], targetLen: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0]!;
  let remaining = targetLen;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen === 0) continue;
    if (remaining <= segLen) {
      const t = remaining / segLen;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= segLen;
  }
  return points[points.length - 1]!;
}

/** Total arc length of a polyline. */
export function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Twisted pair
// ---------------------------------------------------------------------------

/**
 * Twisted-pair crossover glyph at one end of a group's run.
 *
 * NOTE ON THE TWO STYLES: `settings.twistedPairStyle` picks between an
 * IEEE Std 315-1975 and an IEC 60617-3 flavour of this glyph. The two
 * renderings here differ in the way the standards' published symbols differ
 * in *character* — IEEE 315's twisted-pair mark reads as a single crossing
 * of the two conductors, IEC 60617-3's as a repeated braid — but they are
 * drawn from that description, not traced from the standards' own artwork,
 * which is not reproduced in this repository. Connor referenced a screenshot
 * comparing the two; if the exact loop count or curvature matters for a
 * drawing package that has to pass review, this is the function to correct
 * against that image, and correcting it is a change to these few lines and
 * nothing else.
 *
 * Both styles share the same contract: the glyph occupies the first
 * `TWIST_ZONE_LEN` px of each member's route from `end`, and rejoins each
 * wire exactly where its real, un-perturbed trace resumes — the underlying
 * trace and hit-target are never modified. Only draws for 2+ members: a lone
 * wire can't twist around itself.
 */
export type TwistedPairStyleName = 'ieee315' | 'iec60617';

export function twistCrossoverPaths(
  members: readonly SceneWire[],
  end: 'from' | 'to',
  style: TwistedPairStyleName = 'ieee315',
): string[] {
  if (members.length < 2) return [];
  const anchors = members.map((m) => {
    const pts = end === 'from' ? m.routePoints : [...m.routePoints].reverse();
    return { pin: pts[0]!, zoneEnd: pointAtArcLength(pts, TWIST_ZONE_LEN), points: pts };
  });
  // Order by lateral (row) position so adjacent-in-space members cross with
  // each other, not with whichever member happens to be next in the array.
  const order = anchors
    .map((a, i) => ({ i, key: a.pin.y }))
    .sort((a, b) => a.key - b.key)
    .map((o) => o.i);

  const paths: string[] = [];
  for (let k = 0; k < order.length - 1; k++) {
    const a = anchors[order[k]!]!;
    const b = anchors[order[k + 1]!]!;
    if (style === 'iec60617') {
      paths.push(...braidPair(a, b, 3));
    } else {
      // Single crossing: `a` swings over to where `b` straightens out, and
      // vice versa — each back on its own row by TWIST_ZONE_LEN out.
      paths.push(`M ${a.pin.x} ${a.pin.y} L ${b.zoneEnd.x} ${b.zoneEnd.y}`);
      paths.push(`M ${b.pin.x} ${b.pin.y} L ${a.zoneEnd.x} ${a.zoneEnd.y}`);
    }
  }
  return paths;
}

interface TwistAnchor {
  pin: Point;
  zoneEnd: Point;
  points: Point[];
}

/**
 * `crossings` alternating swaps between two conductors across the twist
 * zone, so the pair reads as a braid rather than a single X. Each conductor
 * is sampled at evenly-spaced arc lengths along its OWN route (not linearly
 * interpolated between pin and zone end) so the braid still follows a wire
 * that bends inside the zone.
 */
function braidPair(a: TwistAnchor, b: TwistAnchor, crossings: number): string[] {
  const step = TWIST_ZONE_LEN / crossings;
  const aPts: Point[] = [];
  const bPts: Point[] = [];
  for (let i = 0; i <= crossings; i++) {
    aPts.push(pointAtArcLength(a.points, i * step));
    bPts.push(pointAtArcLength(b.points, i * step));
  }
  // Conductor 1 walks a→b→a→…, conductor 2 walks the complement, so they
  // swap sides at every sample and land back on their own rows iff
  // `crossings` is even — with an odd count the last hop is drawn back to
  // the true zone end, keeping both conductors on their own trace.
  const walk = (startOnA: boolean): string => {
    const pts: Point[] = [];
    for (let i = 0; i <= crossings; i++) {
      const onA = startOnA === (i % 2 === 0);
      pts.push(onA ? aPts[i]! : bPts[i]!);
    }
    pts[pts.length - 1] = startOnA ? a.zoneEnd : b.zoneEnd;
    return `M ${pts.map((p, i) => (i === 0 ? `${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ')}`;
  };
  return [walk(true), walk(false)];
}

// ---------------------------------------------------------------------------
// Shield termination marks
// ---------------------------------------------------------------------------

/** One shield termination mark — a dashed ellipse encircling the group's
 * member wires at one end of the run, plus the point its label sits at. */
export interface ShieldTerminationMark {
  /** Which physical end of the run this mark sits at, so the render pass can
   * look up that end's own termination style (a shield can pigtail at one
   * connector and land on a 360° backshell at the other). */
  end: 'source' | 'target';
  center: Point;
  rx: number;
  ry: number;
  labelPoint: Point;
  /** Which way the mark is inset from its connector face (+1/-1 along x) —
   * orients the termination-style glyph so it points outward, away from the
   * open wire span. */
  dir: 1 | -1;
  /** Where a drain/pigtail wire attaches, when the shield has a termination
   * node. Sits on the outward edge of the ellipse, i.e. on the connector
   * side, which is where a real drain breaks out. */
  nodePoint: Point;
}

/**
 * Shield termination marks — one at each end of a shielded group's run.
 *
 * `position` is a fraction of each member wire's own routed length,
 * measured inward from that end (Connor: "user-controlled position along the
 * wire run (wrapping at the connector)"). Measuring along arc length rather
 * than insetting a fixed number of x-pixels, as the first version did, is
 * what makes the control behave predictably: 0.5 lands at mid-span on both a
 * 60px stub and a 600px run, and a mark on a wire that bends immediately out
 * of the connector follows the bend instead of floating off the trace.
 *
 * Clamped to [0, 0.49] so the two marks can never cross over each other and
 * swap ends, which would silently mislabel which connector terminates how.
 */
export function shieldTerminationMarks(
  members: readonly SceneWire[],
  position: number,
): ShieldTerminationMark[] {
  if (members.length === 0) return [];
  const frac = Math.max(0, Math.min(0.49, position));

  const build = (end: 'source' | 'target'): ShieldTerminationMark => {
    const pts = members.map((m) => {
      const route = end === 'source' ? m.routePoints : [...m.routePoints].reverse();
      return pointAtArcLength(route, polylineLength(route) * frac);
    });
    // The far end of each member, used only to decide which way is "inward"
    // so the style glyph points at the connector rather than down the span.
    const others = members.map((m) => (end === 'source' ? m.to : m.from));

    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const avgX = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const avgOtherX = others.reduce((s, p) => s + p.x, 0) / others.length;
    const avgY = (minY + maxY) / 2;
    // `dir` points AWAY from the rest of the run — i.e. back toward this
    // end's own connector.
    const dir: 1 | -1 = avgOtherX >= avgX ? -1 : 1;
    const rx = 15;
    return {
      end,
      center: { x: avgX, y: avgY },
      rx,
      ry: Math.max(16, (maxY - minY) / 2 + 9),
      labelPoint: { x: avgX, y: minY - 12 },
      dir,
      nodePoint: { x: avgX + dir * rx, y: avgY },
    };
  };

  return [build('source'), build('target')];
}
