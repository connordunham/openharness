/**
 * Orthogonal grid routing with 45°-mitered corners (Connor's wiring-core
 * request, modeled on the reference tool's schematic wire routing). Pure
 * geometry, no DOM — this is what turns two port anchors into the SVG path
 * a wire is actually drawn as.
 *
 * The approach, in three steps:
 *   1. Every port has an *exit direction* (which way its lead physically
 *      points — left or right, since every current component's ports are
 *      horizontal: connector cavities, cable cores, splice/resistor/diode
 *      sides, terminal points). A wire must leave its source port heading
 *      in that direction before it's allowed to turn, and must arrive at
 *      its target port heading in the *reverse* of the target's exit
 *      direction, for the same reason — mirrored at the far end.
 *   2. Between those two forced stub segments, route a simple orthogonal
 *      "Z" (or straight line, if the ports are already aligned) — at most
 *      two 90° turns. This is not a collision-avoiding autorouter; it's the
 *      same class of simple elbow routing schematic tools use, good enough
 *      to read cleanly without wires cutting through component bodies in
 *      the common case.
 *   3. Chamfer every 90° corner into two 45° cuts (a "miter"), which is the
 *      specific visual signature asked for.
 */

import type { Point } from '@openharness/core';

export type ExitDir = 'left' | 'right';

export interface RouteOptions {
  /** How far a wire must travel from a port before it's allowed to turn. */
  stub?: number;
  /** Size of the 45° corner cut. */
  miter?: number;
}

const DEFAULT_STUB = 14;
const DEFAULT_MITER = 8;

function dx(dir: ExitDir): number {
  return dir === 'right' ? 1 : -1;
}

/** The waypoints of a simple elbow route between two directed ports, before
 * any corner mitering. Exported mainly for testing — most callers want
 * `computeRoutedPath`, which mitres and serializes this in one call. */
export function computeRoutePoints(from: Point, fromDir: ExitDir, to: Point, toDir: ExitDir, opts: RouteOptions = {}): Point[] {
  const stub = opts.stub ?? DEFAULT_STUB;

  const s = { x: from.x + dx(fromDir) * stub, y: from.y };
  const t = { x: to.x + dx(toDir) * stub, y: to.y };

  const points: Point[] = [from, s];

  if (s.y === t.y) {
    // Already aligned after the stub — one straight run, no turns needed.
    if (s.x !== t.x) points.push(t);
  } else {
    const midX = (s.x + t.x) / 2;
    points.push({ x: midX, y: s.y }, { x: midX, y: t.y }, t);
  }

  points.push(to);
  return dedupeCollinear(points);
}

/** Drop points that don't change the line's direction, so mitering only
 * ever sees genuine corners. Deliberately direction-aware, not just
 * same-line: a route can legitimately travel out to a point and then
 * reverse back along the same line (that happens whenever a target's lead
 * points away from the source, so the wire must extend past the pin's own
 * "keep-out" stub before turning back into it) — collapsing that as if it
 * were a straight pass-through would route the wire into the wrong side of
 * the pin. Only merge when the incoming and outgoing segments are true
 * continuations of each other (same sign), never a reversal. */
function dedupeCollinear(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && prev.x === p.x && prev.y === p.y) continue; // exact duplicate
    if (out.length >= 2) {
      const a = out[out.length - 2]!;
      const b = out[out.length - 1]!;
      if (isStraightContinuation(a, b, p)) {
        out[out.length - 1] = p; // extend the run instead of adding a new point
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

function isStraightContinuation(a: Point, b: Point, c: Point): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const sameLine = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
  if (!sameLine) return false;
  // Same sign on whichever axis is moving (the other axis is constant/zero).
  return abx * bcx + aby * bcy >= 0;
}

/** Replace each interior 90° corner with two points offset along its
 * incoming/outgoing segments, connected by a 45° diagonal. Corners on
 * segments too short to fit the full miter are left sharp rather than
 * overlapping or reversing direction. */
export function miterCorners(points: Point[], miterSize: number): Point[] {
  if (points.length < 3 || miterSize <= 0) return points;

  const out: Point[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    const inLen = Math.hypot(b.x - a.x, b.y - a.y);
    const outLen = Math.hypot(c.x - b.x, c.y - b.y);
    const cut = Math.min(miterSize, inLen / 2, outLen / 2);
    if (cut <= 0.01) {
      out.push(b);
      continue;
    }
    out.push(lerpTo(b, a, cut), lerpTo(b, c, cut));
  }
  out.push(points[points.length - 1]!);
  return dedupeCollinear(out);
}

function lerpTo(from: Point, toward: Point, dist: number): Point {
  const len = Math.hypot(toward.x - from.x, toward.y - from.y);
  if (len === 0) return from;
  const t = dist / len;
  return { x: from.x + (toward.x - from.x) * t, y: from.y + (toward.y - from.y) * t };
}

export function pointsToPathD(points: Point[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return `M ${first!.x} ${first!.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(' ');
}

export interface RoutedPath {
  points: Point[];
  d: string;
}

/** The one function most callers want: directed elbow route + 45° miters,
 * ready to hand to an SVG `<path d="...">`. */
export function computeRoutedPath(from: Point, fromDir: ExitDir, to: Point, toDir: ExitDir, opts: RouteOptions = {}): RoutedPath {
  const raw = computeRoutePoints(from, fromDir, to, toDir, opts);
  const points = miterCorners(raw, opts.miter ?? DEFAULT_MITER);
  return { points, d: pointsToPathD(points) };
}

/** Midpoint along a routed path's total length — used to anchor the wire
 * properties popup on its trace rather than at an arbitrary endpoint. */
export function pathMidpoint(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0]!;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
    lengths.push(l);
    total += l;
  }
  let target = total / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (target <= lengths[i]!) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const t = lengths[i]! === 0 ? 0 : target / lengths[i]!;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    target -= lengths[i]!;
  }
  return points[points.length - 1]!;
}
