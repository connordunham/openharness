/**
 * Bundle contents (which wires' routes pass through each bundle) and an
 * estimated bundle diameter via the standard circle-packing approximation
 * (spec §6.5): D ≈ 1.15 · √(Σ dᵢ²). Explicitly an estimate — good enough for
 * sleeve/covering selection, not a substitute for a real fill calculation.
 */

import type { HarnessDocument, RouteResult, WirePart } from '../types.js';
import type { WireId, BundleId } from '../ids.js';

export function computeBundleContents(routes: Map<WireId, RouteResult>): Map<BundleId, WireId[]> {
  const contents = new Map<BundleId, WireId[]>();
  for (const [wireId, route] of routes) {
    for (const bundleId of route.segments) {
      if (!contents.has(bundleId)) contents.set(bundleId, []);
      contents.get(bundleId)!.push(wireId);
    }
  }
  return contents;
}

export function computeBundleDiameters(
  doc: HarnessDocument,
  bundleContents: Map<BundleId, WireId[]>,
): Map<BundleId, number> {
  const diameters = new Map<BundleId, number>();
  for (const [bundleId, wireIds] of bundleContents) {
    const sumSquares = wireIds.reduce((sum, wireId) => {
      const wire = doc.wires[wireId];
      const part = wire?.partId ? (doc.parts[wire.partId] as WirePart | undefined) : undefined;
      const od = part?.outerDiameter ?? 0;
      return sum + od * od;
    }, 0);
    diameters.set(bundleId, 1.15 * Math.sqrt(sumSquares));
  }
  return diameters;
}
