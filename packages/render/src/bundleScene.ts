/**
 * Bundle scene emission for the Layout view (Phase 2a,
 * docs/PHASE2-REFINED-DESIGN.md): turns the document + derived model + the
 * canvas-resolved bundle polylines into one `SceneBundle` per drawable
 * bundle — everything the Layout canvas needs to draw the outline, the
 * label (wire count, gauge range, diameter), and the conflict indicator,
 * computed once per render instead of inline in the component.
 *
 * Division of labour: the CANVAS owns where a bundle's line runs (endpoint
 * glyph attach points, waypoints, px conversion — see LayoutCanvas), and
 * hands those polylines in here; this module owns everything derived FROM
 * the polyline plus the document: membership counts and gauge labels (the
 * derived `bundleContents`), the diameter (the derived `bundleDiameters`,
 * spec §6.5 — never re-authored), the outline width, the label placement,
 * and crossing detection. `computeLayoutScene` (a full layout scene builder,
 * index.ts TODO) will subsume this when it lands; until then this is the
 * bundle slice of it.
 */

import type { BundleId } from '@openharness/core';
import type { Gauge, HarnessDocument, Point, WirePart } from '@openharness/core';
import {
  DEFAULT_BUNDLE_COLOR,
  formatGaugeValue,
  gaugeUnitSuffix,
  fromSquareMillimetres,
  toSquareMillimetresSafe,
} from '@openharness/core';
import {
  bundleOutlineWidth,
  detectPathCrossings,
  pointAtFraction,
  type PolylinePath,
} from './bundleGeometry.js';

/** One bundle's drawn path, resolved by the canvas. */
export interface BundlePathInput {
  bundleId: BundleId;
  /** The drawn polyline, source-attach → waypoints → target-attach, in the
   * canvas's px space. Fewer than two points emits nothing (no path, no
   * scene entry) — a bundle cannot be drawn without both ends placed. */
  points: Point[];
}

export interface SceneBundle {
  id: BundleId;
  refdes: string;
  /** Authored user label, if any (Bundle.label). */
  label?: string;
  /** Bundle.color, or DEFAULT_BUNDLE_COLOR when unset. */
  color: string;
  /** Distinct wires whose routes pass through this bundle (derived). */
  wireCount: number;
  wireIds: string[];
  wireRefdes: string[];
  /** Gauge range of the member wires in the document's gauge unit — e.g.
   * "18–22 AWG" or "0.5–2.5 mm²" — or undefined when no member wire has a
   * resolvable gauge. Smallest conductor first, ascending by cross-section. */
  gaugeLabel?: string;
  /** Derived diameter estimate in mm (spec §6.5); 0 when nothing in the
   * bundle has a known outer diameter. */
  diameterMm: number;
  /** Stroke width for the bundle body — the diameter indicator. */
  outlineWidthPx: number;
  /** Echo of the input polyline, for the canvas and for hit-tests. */
  polyline: Point[];
  /** Where the label sits: the polyline's arc-length midpoint. */
  labelPosition: Point;
  /** Composed label text: `BND1 · 3 wires · 18–22 AWG · Ø 4 mm`. */
  labelText: string;
  /** Points where this bundle's path crosses another bundle's (or its own). */
  crossings: Point[];
  hasCrossing: boolean;
}

/**
 * The gauge a bundle label speaks for: the wire's own authored gauge if it
 * has one (the schematic's wire editor writes `Wire.gauge`), else its wire
 * part's gauge (the purchased spec). Wires with neither — or with a gauge
 * the conversion table can't represent — are left out, same degrade-don't-
 * crash discipline as the WIRE_GAUGE_RANGE rule: a label skips a wire rather
 * than asserting a number for it. [inferred resolution order — the model
 * doesn't state precedence; instance-over-part matches how every other
 * instance field in this document overrides its part.]
 */
function wireEffectiveGauge(doc: HarnessDocument, wireId: string): Gauge | undefined {
  const wire = doc.wires[wireId];
  if (!wire) return undefined;
  const instance = wire.gauge;
  if (instance && toSquareMillimetresSafe(instance) !== undefined) return instance;
  const part = wire.partId ? (doc.parts[wire.partId] as WirePart | undefined) : undefined;
  const partGauge = part?.kind === 'wire' ? part.gauge : undefined;
  if (partGauge && toSquareMillimetresSafe(partGauge) !== undefined) return partGauge;
  return undefined;
}

/** See SceneBundle.gaugeLabel. */
export function bundleGaugeLabel(doc: HarnessDocument, wireIds: readonly string[]): string | undefined {
  const areas: number[] = [];
  for (const wireId of wireIds) {
    const g = wireEffectiveGauge(doc, wireId);
    if (!g) continue;
    const mm2 = toSquareMillimetresSafe(g);
    if (mm2 !== undefined) areas.push(mm2);
  }
  if (areas.length === 0) return undefined;

  const unit = doc.settings.gaugeUnit;
  const min = fromSquareMillimetres(Math.min(...areas), unit);
  const max = fromSquareMillimetres(Math.max(...areas), unit);
  const minStr = formatGaugeValue(min, unit);
  const maxStr = formatGaugeValue(max, unit);
  // Two genuinely different gauges can round to the same display value in the
  // document's unit (two metric sizes both nearest-20-AWG); don't print "20–20".
  return minStr === maxStr ? `${minStr}${gaugeUnitSuffix(unit)}` : `${minStr}–${maxStr}${gaugeUnitSuffix(unit)}`;
}

/**
 * Emit scene data for every bundle the canvas can draw. Order follows
 * `paths`, so the canvas's own draw order is unchanged.
 *
 * `pxPerMm` is the canvas's physical scale (LayoutCanvas PX_PER_MM) — the
 * diameter indicator maps physical mm to screen px through it.
 * `endpointExclusionRadius` is passed to crossing detection: intersections
 * that close to a path's attach points are component fan-out, not conflicts.
 *
 * Polyline-vs-spline note: crossing detection here — and extraction-handle
 * placement in LayoutCanvas — runs on the control polyline the canvas hands
 * in, not on the drawn Catmull-Rom spline (LayoutCanvas smoothBundlePath).
 * For straight two-point bundles the two coincide; with waypoints the spline
 * may deviate slightly from the polyline near sharp bends. This is an
 * accepted approximation: the deviation is cosmetic and small, and the
 * endpoint exclusion radius (14 px in LayoutCanvas) already absorbs similar
 * magnitudes at the attach points.
 */
export function emitBundleGeometry(
  doc: HarnessDocument,
  derived: {
    bundleContents: Map<BundleId, string[]>;
    bundleDiameters: Map<BundleId, number>;
  },
  paths: BundlePathInput[],
  pxPerMm: number,
  endpointExclusionRadius = 0,
): SceneBundle[] {
  const drawable = paths.filter((p) => p.points.length >= 2 && doc.bundles[p.bundleId]);
  const crossingsById = detectPathCrossings(
    drawable.map((p): PolylinePath => ({ id: p.bundleId, points: p.points })),
    endpointExclusionRadius,
  );

  return drawable.map((path) => {
    const bundle = doc.bundles[path.bundleId]!;
    const wireIds = [...new Set(derived.bundleContents.get(bundle.id) ?? [])];
    const wireRefdes = wireIds.map((id) => doc.wires[id]?.refdes ?? id).sort();
    const gaugeLabel = bundleGaugeLabel(doc, wireIds);
    const diameterMm = derived.bundleDiameters.get(bundle.id) ?? 0;
    const labelTextParts = [
      bundle.label ? `${bundle.refdes} “${bundle.label}”` : bundle.refdes,
      wireIds.length === 0 ? 'no wires' : `${wireIds.length} ${wireIds.length === 1 ? 'wire' : 'wires'}`,
    ];
    if (gaugeLabel) labelTextParts.push(gaugeLabel);
    // Diameter is an estimate with two significant figures at best
    // (bundleAnalysis says so explicitly) — print it that way. Ø 0 means
    // nothing in the bundle has a known outer diameter: omit, don't print 0.
    if (diameterMm > 0) labelTextParts.push(`Ø ${Number(diameterMm.toPrecision(2))} mm`);

    return {
      id: bundle.id,
      refdes: bundle.refdes,
      label: bundle.label,
      color: bundle.color ?? DEFAULT_BUNDLE_COLOR,
      wireCount: wireIds.length,
      wireIds,
      wireRefdes,
      gaugeLabel,
      diameterMm,
      outlineWidthPx: bundleOutlineWidth(diameterMm, pxPerMm),
      polyline: path.points,
      labelPosition: pointAtFraction(path.points, 0.5).point,
      labelText: labelTextParts.join(' · '),
      crossings: crossingsById.get(bundle.id) ?? [],
      hasCrossing: (crossingsById.get(bundle.id)?.length ?? 0) > 0,
    };
  });
}
