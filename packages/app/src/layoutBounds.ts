/**
 * Fit-to-view / fit-to-selection bounds for the Layout canvas (review B4).
 *
 * The layout pane has no scene builder — its drawn geometry is the placed
 * components' centers and the bundles' routing nodes between them (px space
 * after `toPx`; see LayoutCanvas). Everything drawn sits at or between those
 * points: bundle curves thread their waypoints, glyphs sit on their centers,
 * inline pass-throughs ride the line between two placed neighbours. So the
 * point set is a faithful bound, and `fitToBounds`'s padding absorbs the
 * glyph artwork around each point.
 */

import type { Point } from '@openharness/core';
import { pointRect, type Rect } from '@openharness/render';

/** Fit-to-view input: every placed component center plus every routing node
 * of a bundle that is actually drawn (both endpoints placed). */
export function layoutContentRects(componentCentersPx: readonly Point[], bundleWaypointsPx: readonly Point[]): Rect[] {
  return [...componentCentersPx.map(pointRect), ...bundleWaypointsPx.map(pointRect)];
}

/** Fit-to-selection input for one bundle: its full drawn path — source
 * center, routing nodes in order, target center. */
export function layoutBundleRects(sourcePx: Point, targetPx: Point, waypointsPx: readonly Point[]): Rect[] {
  return [pointRect(sourcePx), ...waypointsPx.map(pointRect), pointRect(targetPx)];
}
