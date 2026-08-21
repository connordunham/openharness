/**
 * Gauge unit conversion module.
 *
 * Provides a single, canonical conversion layer so nothing else compares two
 * gauges by their raw `.value`. Every comparison and sum happens in mm² — the
 * canonical internal unit — then converts back to the requested unit for display.
 *
 * AWG is a lookup table per ASTM B258 (the American Wire Gauge standard — the
 * standard that actually publishes AWG conductor dimensions; IEC 60228 is the
 * metric conductor standard and does not define AWG sizes). It covers every
 * integer size from 30 AWG to 4/0, odd sizes included, with the large gauges
 * 1/0…4/0 represented as 0, −1, −2, −3 as published.
 *
 * cmil and kcmil are definitional:
 *   1 cmil = area of a circle 0.001 in (0.0254 mm) in diameter
 *          = π/4 × 0.0254² mm²
 *          ≈ 5.067074e-4 mm²
 *   1 kcmil = 1000 cmil
 */

import type { Gauge, GaugeRange, GaugeUnit } from './types.js';

/**
 * AWG conductor areas in mm² per ASTM B258.
 *
 * Keys are the AWG number, with the four largest sizes written the way the
 * standard does: 1/0 → 0, 2/0 → −1, 3/0 → −2, 4/0 → −3. Every integer size
 * from 30 down to 4/0 is present — odd gauges included — because a document
 * that names a legitimate odd-size wire (21 AWG is common in some catalogs)
 * must convert, not crash the derive pipeline. Values are the nominal
 * cross-sectional areas published for solid conductors; adjacent sizes follow
 * the standard's geometric progression (≈×1.259 per step, ×10 per 10 steps).
 */
const AWG_TO_MM2: Record<number, number> = {
  '-3': 107.2,  // 4/0
  '-2': 85.03,  // 3/0
  '-1': 67.43,  // 2/0
  '0': 53.48,   // 1/0
  '1': 42.41,
  '2': 33.62,
  '3': 26.67,
  '4': 21.15,
  '5': 16.77,
  '6': 13.30,
  '7': 10.55,
  '8': 8.367,
  '9': 6.634,
  '10': 5.261,
  '11': 4.172,
  '12': 3.309,
  '13': 2.624,
  '14': 2.081,
  '15': 1.650,
  '16': 1.309,
  '17': 1.038,
  '18': 0.8230,
  '19': 0.6527,
  '20': 0.5189,
  '21': 0.4116,
  '22': 0.3261,
  '23': 0.2586,
  '24': 0.2052,
  '25': 0.1627,
  '26': 0.1293,
  '27': 0.1024,
  '28': 0.0810,
  '29': 0.0647,
  '30': 0.0506,
};

/** Derived constant: 1 cmil = π/4 × 0.0254² mm² */
const CMIL_TO_MM2 = Math.PI / 4 * 0.0254 * 0.0254;

/**
 * Convert a gauge to mm², returning `undefined` for a value that cannot be
 * represented — currently only an AWG size outside the tabulated 30…4/0 range.
 *
 * This is the "degrade, don't crash" entry point. A DRC rule that walks every
 * wire in an arbitrary document must not throw the whole derive pipeline just
 * because one part names a gauge the table doesn't cover; it needs to skip
 * that wire and keep going. `toSquareMillimetres` below is the strict version
 * for callers that already know the gauge is valid.
 */
export function toSquareMillimetresSafe(g: Gauge): number | undefined {
  switch (g.unit) {
    case 'mm2':
      return g.value;

    case 'awg':
      return AWG_TO_MM2[g.value];

    case 'cmil':
      return g.value * CMIL_TO_MM2;

    case 'kcmil':
      return g.value * 1000 * CMIL_TO_MM2;

    default:
      return undefined;
  }
}

/** Canonical unit. Every comparison and sum happens here. */
export function toSquareMillimetres(g: Gauge): number {
  const mm2 = toSquareMillimetresSafe(g);
  if (mm2 === undefined) {
    throw new Error(`AWG ${g.value} not in lookup table`);
  }
  return mm2;
}

/** Round-trip out of canonical form for display. */
export function fromSquareMillimetres(mm2: number, unit: GaugeUnit): number {
  switch (unit) {
    case 'mm2':
      return mm2;

    case 'awg': {
      // Find the nearest tabulated AWG size.
      let nearest: number | null = null;
      let minDifference = Infinity;

      for (const [awgStr, awgMm2] of Object.entries(AWG_TO_MM2)) {
        const difference = Math.abs(awgMm2 - mm2);
        if (difference < minDifference) {
          minDifference = difference;
          nearest = Number(awgStr);
        }
      }

      if (nearest === null) {
        throw new Error('No AWG sizes in lookup table');
      }
      return nearest;
    }

    case 'cmil':
      return mm2 / CMIL_TO_MM2;

    case 'kcmil':
      return mm2 / (1000 * CMIL_TO_MM2);

    default:
      throw new Error(`Unknown gauge unit: ${unit}`);
  }
}

/**
 * Negative / zero / equal, for range checks.
 * Never compares `.value` directly — always converts to canonical form.
 *
 * Returns: −1 if a < b, 0 if a === b, 1 if a > b.
 */
export function compareGauge(a: Gauge, b: Gauge): number {
  const aMm2 = toSquareMillimetres(a);
  const bMm2 = toSquareMillimetres(b);

  if (aMm2 < bMm2) return -1;
  if (aMm2 > bMm2) return 1;
  return 0;
}

/**
 * True when `g` falls inside the range.
 * An absent bound is unconstrained, NOT zero.
 * An entirely absent range accepts everything.
 */
export function gaugeWithinRange(g: Gauge, range: GaugeRange): boolean {
  if (range.minGauge !== undefined && compareGauge(g, range.minGauge) < 0) {
    return false;
  }
  if (range.maxGauge !== undefined && compareGauge(g, range.maxGauge) > 0) {
    return false;
  }
  return true;
}

/**
 * Sum of several conductors sharing one cavity, in `unit`.
 * This is the operation the overfill rule needs: convert each to mm², add,
 * convert the total back — never add AWG numbers.
 *
 * Per DOMAIN-DECISIONS.md D2: summing by cross-sectional area is the correct
 * physical model.
 */
export function sumGauges(gauges: Gauge[], unit: GaugeUnit): number {
  const sumMm2 = gauges.reduce((sum, g) => sum + toSquareMillimetres(g), 0);
  return fromSquareMillimetres(sumMm2, unit);
}
