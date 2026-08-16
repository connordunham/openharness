/**
 * Shared authored-length resolution for a Bundle, used by both routing.ts
 * (graph edge weights, for shortest-path tie-breaking) and length.ts (the
 * exact figure that rolls up into wire lengths / BOM). Kept in one place so
 * the two stay consistent — before this existed, both files read
 * `bundle.length` independently, which is exactly the kind of duplication
 * that made adding `segmentLengths` here (Connor: "dimensions between each
 * routing point should be able to be recorded, every single point") a
 * one-file change instead of a two-file one.
 *
 * `segmentLengths[i]` is the authored length between path point `i` and
 * `i+1` of `[source, ...waypoints, target]`. When present and sized to match
 * the bundle's current waypoint count, it takes priority over the older
 * whole-bundle `length` field (which still works unchanged for any bundle
 * that has never had per-segment lengths recorded — most existing/imported
 * documents). A bundle can be *partially* measured (some segments filled
 * in, some not): `valueMm` still sums whatever IS recorded (better than the
 * old all-or-nothing behavior, which contributed 0 until every segment was
 * known), but `authored` only comes back true when every expected segment
 * has a value — matching the existing "authored means the whole bundle is a
 * real number, not a guess" contract that `LengthStatus`'s 'exact' vs.
 * 'lowerBound' split relies on.
 */

import type { Bundle } from '../types.js';

export interface BundleAuthoredLength {
  valueMm: number;
  authored: boolean;
}

export function bundleAuthoredLength(
  bundle: Pick<Bundle, 'length' | 'segmentLengths' | 'waypoints'>,
): BundleAuthoredLength {
  const expectedSegments = (bundle.waypoints?.length ?? 0) + 1;
  const segs = bundle.segmentLengths;
  if (segs && segs.length === expectedSegments) {
    let sum = 0;
    let allSet = true;
    for (const v of segs) {
      if (v !== undefined) sum += v;
      else allSet = false;
    }
    return { valueMm: sum, authored: allSet };
  }
  if (bundle.length !== undefined) return { valueMm: bundle.length, authored: true };
  return { valueMm: 0, authored: false };
}
