/**
 * Wire routing with true 45°-diagonal lane offsets (Connor's wiring-core
 * request, modeled on the reference tool's schematic wire routing — and
 * corrected per his follow-up: the offset itself must be a single 45°
 * diagonal jog, not a 90° elbow with its corners lightly chamfered). Pure
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
 *   2. Between those two forced stub segments, if the ports land on
 *      different rows, jog sideways with a single diagonal run at exactly
 *      45° (equal dx/dy) — flat, diagonal, flat, the "staircase" look in
 *      the reference app — rather than a right-angle turn. When there's
 *      more horizontal room than the vertical offset needs, the diagonal
 *      is centered in the run with flat leads on both sides; when there
 *      isn't enough room (or the target sits behind the source), the flat
 *      lead-in shrinks to zero and the diagonal starts immediately after
 *      the source stub, with the run continuing (forwards or backwards, as
 *      needed) into the target stub afterward. Every segment produced this
 *      way is either perfectly horizontal or a true 45° diagonal — there
 *      are no 90° corners left to chamfer.
 *   3. Collapse any waypoints that don't actually change direction (a
 *      flat lead that ends up zero-length, for instance) so the path only
 *      contains real corners.
 */

import type { Point } from '@openharness/core';

export type ExitDir = 'left' | 'right';

export interface RouteOptions {
  /** How far a wire must travel from a port before it's allowed to turn. */
  stub?: number;
}

const DEFAULT_STUB = 14;

function dx(dir: ExitDir): number {
  return dir === 'right' ? 1 : -1;
}

/** The waypoints of a 45°-diagonal-jog route between two directed ports.
 * Exported mainly for testing — most callers want `computeRoutedPath`,
 * which also serializes this to an SVG path in one call. */
export function computeRoutePoints(from: Point, fromDir: ExitDir, to: Point, toDir: ExitDir, opts: RouteOptions = {}): Point[] {
  const stub = opts.stub ?? DEFAULT_STUB;

  const s = { x: from.x + dx(fromDir) * stub, y: from.y };
  const t = { x: to.x + dx(toDir) * stub, y: to.y };

  const points: Point[] = [from, s];

  const dy = t.y - s.y;
  if (dy === 0) {
    // Already aligned after the stub — one straight run, no jog needed.
    if (s.x !== t.x) points.push(t);
  } else {
    const dyAbs = Math.abs(dy);
    const dxAvail = t.x - s.x;
    // Which way the diagonal leans — generally "forward" (toward t), but
    // when the target is behind the source after stubbing out, lean the
    // same way the source stub already committed to rather than doubling
    // back immediately.
    const dirSign = dxAvail !== 0 ? Math.sign(dxAvail) : dx(fromDir);
    // Room left over once the diagonal's own horizontal footprint (equal
    // to its vertical footprint, at 45°) is accounted for. Split evenly
    // into a flat lead-in and lead-out so the jog sits centered in the
    // run, matching the reference app's look. Clamped to zero rather than
    // negative — when there isn't enough room the diagonal simply starts
    // right after the stub, and the trailing flat segment absorbs
    // whatever's left (including running backwards, if the target is
    // behind the source — still all flat/45° segments, no verticals).
    const extra = Math.max(0, Math.abs(dxAvail) - dyAbs);
    const leadIn = extra / 2;

    const x1 = s.x + dirSign * leadIn;
    const x2 = x1 + dirSign * dyAbs;

    if (leadIn > 0.01) points.push({ x: x1, y: s.y });
    points.push({ x: x2, y: t.y }); // the 45° diagonal: (x1,s.y) -> (x2,t.y)
    if (x2 !== t.x) points.push(t);
  }

  points.push(to);
  return dedupeCollinear(points);
}

/** Drop points that don't change the line's direction. Deliberately
 * direction-aware, not just same-line: a route can legitimately travel out
 * to a point and then reverse back along the same line (that happens
 * whenever a target's lead points away from the source, so the wire must
 * extend past the pin's own "keep-out" stub before turning back into it)
 * — collapsing that as if it were a straight pass-through would route the
 * wire into the wrong side of the pin. Only merge when the incoming and
 * outgoing segments are true continuations of each other (same direction,
 * same slope), never a reversal. */
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
  // Same line: either both segments are horizontal/vertical along the same
  // axis, or both are diagonal with matching slope (45° in either
  // direction).
  const sameOrthogonalLine = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
  const sameDiagonalLine = Math.abs(abx) === Math.abs(aby) && Math.abs(bcx) === Math.abs(bcy)
    && abx !== 0 && bcx !== 0 && abx * bcy === aby * bcx;
  if (!sameOrthogonalLine && !sameDiagonalLine) return false;
  // Same sign on whichever axis is moving (the other axis is constant/zero
  // for an orthogonal run; both move together for a diagonal run).
  return abx * bcx + aby * bcy >= 0;
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

/** The one function most callers want: directed route with 45°-diagonal
 * lane offsets, ready to hand to an SVG `<path d="...">`. */
export function computeRoutedPath(from: Point, fromDir: ExitDir, to: Point, toDir: ExitDir, opts: RouteOptions = {}): RoutedPath {
  const points = computeRoutePoints(from, fromDir, to, toDir, opts);
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
