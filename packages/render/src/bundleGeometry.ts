/**
 * Bundle geometry for the Layout view (Phase 2a, docs/PHASE2-REFINED-DESIGN.md).
 *
 * Pure math on point arrays — no DOM types. The Phase 2 design brief sketched
 * this module around `Path2D`, but that is a DOM/canvas type and this package
 * is contractually DOM-free (see index.ts); outlines here are plain polylines
 * and the app turns them into SVG paths. Everything works in whatever
 * coordinate space the caller's polylines are in (the Layout canvas passes
 * its px space, mm × PX_PER_MM).
 *
 * Bundles in this model are routing edges between two components (spec §4.4),
 * drawn through `Bundle.waypoints`. Which wires run through a bundle, and the
 * bundle's diameter, are DERIVED (derive/bundleAnalysis.ts) — nothing here
 * re-derives or re-authors them; the scene builder consumes the derived maps.
 */

import type { Point } from '@openharness/core';

/** One drawable path, keyed so crossing detection can report back per id. */
export interface PolylinePath {
  id: string;
  points: Point[];
}

/**
 * Interior intersection point of segments a1→a2 and b1→b2, or `undefined`
 * when they don't cross. "Interior" is strict (both parameters in (0,1)):
 * endpoint touches and collinear overlaps are NOT crossings — two bundles
 * fanning out of the same component attach point share an endpoint and must
 * not flag each other, and two parallel runs sharing a line are routing in
 * company, not conflicting.
 */
export function segmentIntersection(a1: Point, a2: Point, b1: Point, b2: Point): Point | undefined {
  const rX = a2.x - a1.x;
  const rY = a2.y - a1.y;
  const sX = b2.x - b1.x;
  const sY = b2.y - b1.y;
  const denom = rX * sY - rY * sX;
  if (denom === 0) return undefined; // parallel or collinear
  const t = ((b1.x - a1.x) * sY - (b1.y - a1.y) * sX) / denom;
  const u = ((b1.x - a1.x) * rY - (b1.y - a1.y) * rX) / denom;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return undefined;
  return { x: a1.x + t * rX, y: a1.y + t * rY };
}

/**
 * Crossing detection over a set of drawn polylines — the geometry behind the
 * bundle conflict indicator (design: "red outline if wires cross"). Wires
 * inside one bundle share its path and cannot cross each other, so the
 * meaningful layout-level fact is bundle PATHS crossing each other (or a
 * bundle crossing itself on a bad route).
 *
 * Returns, per path id, the points where that path crosses something. A path
 * pair sharing a component attach point fans out from (near) the same spot;
 * intersections within `endpointExclusionRadius` of either path's first or
 * last point are node-fan geometry, not routing conflicts, and are skipped.
 * Adjacent segments of one path are skipped for self-crossing (they meet at
 * their shared vertex by construction).
 */
export function detectPathCrossings(
  paths: PolylinePath[],
  endpointExclusionRadius = 0,
): Map<string, Point[]> {
  const crossings = new Map<string, Point[]>();
  const record = (id: string, p: Point) => {
    if (!crossings.has(id)) crossings.set(id, []);
    crossings.get(id)!.push(p);
  };
  const excluded = (path: PolylinePath, p: Point): boolean => {
    if (endpointExclusionRadius <= 0) return false;
    const first = path.points[0];
    const last = path.points[path.points.length - 1];
    const r2 = endpointExclusionRadius * endpointExclusionRadius;
    const near = (q: Point | undefined) => !!q && (p.x - q.x) ** 2 + (p.y - q.y) ** 2 <= r2;
    return near(first) || near(last);
  };

  for (let i = 0; i < paths.length; i++) {
    const a = paths[i]!;
    // Crossings against later paths…
    for (let j = i + 1; j < paths.length; j++) {
      const b = paths[j]!;
      for (let si = 0; si < a.points.length - 1; si++) {
        for (let sj = 0; sj < b.points.length - 1; sj++) {
          const hit = segmentIntersection(a.points[si]!, a.points[si + 1]!, b.points[sj]!, b.points[sj + 1]!);
          if (!hit || excluded(a, hit) || excluded(b, hit)) continue;
          record(a.id, hit);
          record(b.id, hit);
        }
      }
    }
    // …and against itself (non-adjacent segments only).
    for (let si = 0; si < a.points.length - 1; si++) {
      for (let sj = si + 2; sj < a.points.length - 1; sj++) {
        const hit = segmentIntersection(a.points[si]!, a.points[si + 1]!, a.points[sj]!, a.points[sj + 1]!);
        if (!hit || excluded(a, hit)) continue;
        record(a.id, hit);
      }
    }
  }
  return crossings;
}

/** Squared distance from `p` to segment `a`→`b` (any shared coordinate space). */
export function distToSegmentSq(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return (p.x - projX) ** 2 + (p.y - projY) ** 2;
}

/**
 * Hit-test for bundle selection/hover: is `p` within `threshold` of the
 * polyline? The app layers a fat invisible SVG stroke for pointer events, but
 * the scene-level answer (tooltips, automated checks, tests) comes from here.
 */
export function hitTestPolyline(p: Point, points: Point[], threshold: number): boolean {
  if (points.length === 0) return false;
  if (points.length === 1) {
    return (p.x - points[0]!.x) ** 2 + (p.y - points[0]!.y) ** 2 <= threshold * threshold;
  }
  const t2 = threshold * threshold;
  for (let i = 0; i < points.length - 1; i++) {
    if (distToSegmentSq(p, points[i]!, points[i + 1]!) <= t2) return true;
  }
  return false;
}

/**
 * The bundle outline's stroke width for a given derived diameter — the
 * diameter indicator (design pain point 3): the drawn body is proportional to
 * the physical bundle size, so a fat multiconductor run reads as fat on
 * screen. `pxPerUnit` is the canvas scale (the Layout canvas draws mm ×
 * PX_PER_MM). Diameters at or below zero (no wire with a known outer diameter
 * in the bundle — derive reports 0, never a guess) clamp to a minimum so the
 * outline still exists; the minimum is a floor, not a fake measurement.
 */
export function bundleOutlineWidth(diameter: number, pxPerUnit: number, minWidthPx = 6): number {
  return Math.max(minWidthPx, diameter * pxPerUnit);
}

/**
 * Point (and tangent angle, radians) at arc-length fraction `t` (0..1) along
 * a polyline — where the bundle label sits (t = 0.5). Degenerate inputs fall
 * back sanely rather than dividing by zero: no points → origin, one point →
 * that point.
 */
export function pointAtFraction(points: Point[], t: number): { point: Point; angle: number } {
  if (points.length === 0) return { point: { x: 0, y: 0 }, angle: 0 };
  if (points.length === 1) return { point: points[0]!, angle: 0 };
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const d = Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
    segLens.push(d);
    total += d;
  }
  if (total === 0) return { point: points[0]!, angle: 0 };
  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < segLens.length; i++) {
    const len = segLens[i]!;
    if (target <= len || i === segLens.length - 1) {
      const frac = len > 0 ? target / len : 0;
      const a = points[i]!;
      const b = points[i + 1]!;
      return {
        point: { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac },
        angle: Math.atan2(b.y - a.y, b.x - a.x),
      };
    }
    target -= len;
  }
  return { point: points[points.length - 1]!, angle: 0 };
}
