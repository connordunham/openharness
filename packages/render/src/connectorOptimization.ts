/**
 * Connector-orientation optimizer (Phase 2b, docs/PHASE2-REFINED-DESIGN.md
 * §3 "Connector Orientation"): pick the stored rotation for one connector
 * that leaves the layout's bundle paths with the fewest crossings.
 *
 * The model: a connector's stored `rotation` offsets its auto-oriented glyph
 * in 90° steps (see layoutOrientation.ts), which moves the attach point of
 * every bundle plugged into it — so the very same bundle graph crosses more
 * or less depending on which way the connector faces. "Wire crossings" here
 * are bundle-path crossings in the Layout view (detectPathCrossings's exact
 * definition, endpoint fan-out excluded): the schematic view has no physical
 * rotation — its connector boxes route horizontally — so there is no
 * schematic scene to score.
 *
 * [inferred] Minimising drawn bundle crossings is a routing-quality heuristic
 * requested by the Phase 2 design brief ("try all 4 rotations, pick the one
 * with fewest wire crossings"), not a requirement from any published harness
 * standard.
 */

import type { Connector, HarnessDocument } from '@openharness/core';
import { bundlePolyline, computeNodeAutoAngles, nodeFacingAngle } from './layoutOrientation.js';
import { countPathCrossings, type PolylinePath } from './bundleGeometry.js';

/** The four reachable stored rotations, in deterministic evaluation order. */
export const ROTATION_STEPS = [0, 90, 180, 270] as const;

/** Normalise any authored angle into [0, 360) — unset reads as 0 everywhere
 * a rotation is consumed, and a full circle of R presses lands back on 0
 * rather than accumulating to 360. */
export function normalizeRotationDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Count bundle-path crossings for the whole layout if `connector` carried
 * stored rotation `rotationDeg` — everything else keeps its own stored
 * rotation. Only bundles plugged into the connector change shape; all other
 * polylines are identical to the current render.
 *
 * `pxPerMm` / `endpointExclusionRadius` / `branchRadiusPx` must match the
 * Layout canvas's own crossing-detection parameters, so the optimizer and
 * the canvas's conflict indicator apply the same definition of a crossing.
 *
 * Inline pass-throughs are an accepted approximation — scoring does NOT
 * always match the drawn pixels: absorbed bundles are scored on their two
 * constituent polylines, which anchor at the pass-through's stub attach
 * point derived from its stored layoutPosition, while the canvas draws one
 * merged skeleton that drops those attach points entirely and places the
 * glyph at its inlineT arc-length fraction (layoutPosition is ignored for
 * rendering while inline). Absorbed bundles are also included in this count
 * although the canvas excludes them from its conflict display. The
 * optimizer still picks the rotation with the fewest crossings; the
 * discrepancy is confined to the geometry around the pass-through.
 */
export function countWireCrossings(
  connector: Connector,
  rotationDeg: number,
  doc: HarnessDocument,
  pxPerMm: number,
  endpointExclusionRadius = 0,
  branchRadiusPx = 0,
): number {
  const auto = computeNodeAutoAngles(doc, pxPerMm);
  const facing = new Map<string, number>();
  for (const c of Object.values(doc.components)) {
    if (!c.layoutPosition || c.type === 'branchPoint') continue;
    const stored = c.id === connector.id ? rotationDeg : c.rotation;
    facing.set(c.id, nodeFacingAngle(auto.get(c.id) ?? 0, stored));
  }
  const paths: PolylinePath[] = [];
  for (const b of Object.values(doc.bundles)) {
    const points = bundlePolyline(doc, b, facing, pxPerMm, branchRadiusPx);
    if (points && points.length >= 2) paths.push({ id: b.id, points });
  }
  return countPathCrossings(paths, endpointExclusionRadius);
}

/**
 * The stored rotation (0, 90, 180, 270) for `connector` that minimises
 * layout bundle crossings.
 *
 * Deterministic: candidates are evaluated in ROTATION_STEPS order. On a tie
 * the connector's CURRENT rotation wins when it is among the tied best —
 * auto-optimize must not churn the document (and the undo stack) when it
 * cannot improve it — otherwise the earliest tied candidate wins.
 */
export function findOptimalRotation(
  connector: Connector,
  doc: HarnessDocument,
  pxPerMm: number,
  endpointExclusionRadius = 0,
  branchRadiusPx = 0,
): number {
  const scored = ROTATION_STEPS.map((candidate) => ({
    candidate,
    count: countWireCrossings(connector, candidate, doc, pxPerMm, endpointExclusionRadius, branchRadiusPx),
  }));
  const best = Math.min(...scored.map((s) => s.count));
  const tied = scored.filter((s) => s.count === best);
  // Read the live copy from the document: the caller's object may be a stale
  // render snapshot, and the tie-break cares about the stored value.
  const current = normalizeRotationDegrees(doc.components[connector.id]?.rotation ?? 0);
  const keep = tied.find((s) => s.candidate === current);
  return (keep ?? tied[0]!).candidate;
}
