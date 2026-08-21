import { describe, it, expect } from 'vitest';
import {
  toSquareMillimetres,
  toSquareMillimetresSafe,
  fromSquareMillimetres,
  compareGauge,
  gaugeWithinRange,
  sumGauges,
} from '../gauge.js';
import type { Gauge } from '../types.js';

describe('gauge conversion', () => {
  describe('toSquareMillimetres', () => {
    it('passes through mm² unchanged', () => {
      expect(toSquareMillimetres({ value: 0.5, unit: 'mm2' })).toBe(0.5);
      expect(toSquareMillimetres({ value: 100, unit: 'mm2' })).toBe(100);
    });

    it('converts 18 AWG to ≈0.823 mm² per ASTM B258', () => {
      // ASTM B258 publishes 18 AWG as 0.8230 mm²
      const result = toSquareMillimetres({ value: 18, unit: 'awg' });
      expect(result).toBeCloseTo(0.8230, 4);
    });

    it('converts 20 AWG to ≈0.5189 mm² per ASTM B258', () => {
      const result = toSquareMillimetres({ value: 20, unit: 'awg' });
      expect(result).toBeCloseTo(0.5189, 4);
    });

    it('converts odd AWG sizes (21 AWG) — the table is complete, not even-only', () => {
      // B7: a legitimate odd-gauge wire part must convert, not crash.
      const result = toSquareMillimetres({ value: 21, unit: 'awg' });
      expect(result).toBeCloseTo(0.4116, 4);
    });

    it('returns a value for every integer AWG size from 30 down to 4/0', () => {
      // 30..1 are positive AWG numbers; 1/0..4/0 are 0..-3.
      for (let awg = 30; awg >= -3; awg--) {
        expect(toSquareMillimetresSafe({ value: awg, unit: 'awg' }), `AWG ${awg}`).toBeDefined();
      }
    });

    it('areas decrease monotonically as the AWG number increases', () => {
      // Larger AWG number = smaller conductor (the inversion this module exists for).
      for (let awg = 30; awg > -3; awg--) {
        const smaller = toSquareMillimetres({ value: awg, unit: 'awg' });
        const larger = toSquareMillimetres({ value: awg - 1, unit: 'awg' });
        expect(larger, `AWG ${awg - 1} vs ${awg}`).toBeGreaterThan(smaller);
      }
    });

    it('supports large AWG gauges represented as 0…−3', () => {
      // 1/0 = 0
      expect(toSquareMillimetres({ value: 0, unit: 'awg' })).toBeCloseTo(53.48, 2);
      // 2/0 = -1
      expect(toSquareMillimetres({ value: -1, unit: 'awg' })).toBeCloseTo(67.43, 2);
      // 3/0 = -2
      expect(toSquareMillimetres({ value: -2, unit: 'awg' })).toBeCloseTo(85.03, 2);
      // 4/0 = -3
      expect(toSquareMillimetres({ value: -3, unit: 'awg' })).toBeCloseTo(107.2, 1);
    });

    it('converts cmil to mm² using the definition: 1 cmil = π/4 × 0.0254² mm²', () => {
      // 1 cmil should be π/4 × 0.0254² ≈ 5.067074e-4 mm²
      const oneCoil = toSquareMillimetres({ value: 1, unit: 'cmil' });
      expect(oneCoil).toBeCloseTo(5.067074e-4, 8);
    });

    it('converts kcmil to mm² using 1 kcmil = 1000 cmil', () => {
      // 500 kcmil = 500000 cmil ≈ 253.35 mm²
      const result = toSquareMillimetres({ value: 500, unit: 'kcmil' });
      expect(result).toBeCloseTo(253.35, 1);
    });

    it('throws on unknown AWG size', () => {
      expect(() => toSquareMillimetres({ value: 999, unit: 'awg' })).toThrow();
    });

    it('toSquareMillimetresSafe returns undefined (not throw) on untabulated AWG', () => {
      // B7: the derive pipeline must degrade, not crash, on an untabulated gauge.
      expect(toSquareMillimetresSafe({ value: 999, unit: 'awg' })).toBeUndefined();
      expect(toSquareMillimetresSafe({ value: 31, unit: 'awg' })).toBeUndefined();
    });

    it('toSquareMillimetresSafe converts valid gauges like the strict version', () => {
      expect(toSquareMillimetresSafe({ value: 18, unit: 'awg' }))
        .toBeCloseTo(toSquareMillimetres({ value: 18, unit: 'awg' }), 6);
      expect(toSquareMillimetresSafe({ value: 0.5, unit: 'mm2' })).toBe(0.5);
    });
  });

  describe('fromSquareMillimetres', () => {
    it('passes through mm² unchanged', () => {
      expect(fromSquareMillimetres(0.5, 'mm2')).toBe(0.5);
      expect(fromSquareMillimetres(100, 'mm2')).toBe(100);
    });

    it('converts mm² back to AWG, returning nearest tabulated size', () => {
      // Convert 18 AWG to mm², then back to AWG
      const mm2 = toSquareMillimetres({ value: 18, unit: 'awg' });
      const back = fromSquareMillimetres(mm2, 'awg');
      expect(back).toBe(18);
    });

    it('converts mm² back to cmil', () => {
      const mm2 = toSquareMillimetres({ value: 100, unit: 'cmil' });
      const back = fromSquareMillimetres(mm2, 'cmil');
      expect(back).toBeCloseTo(100, 6);
    });

    it('converts mm² back to kcmil', () => {
      const mm2 = toSquareMillimetres({ value: 500, unit: 'kcmil' });
      const back = fromSquareMillimetres(mm2, 'kcmil');
      expect(back).toBeCloseTo(500, 6);
    });

    it('treats fractional AWG conversions as lossy — returns nearest size', () => {
      // There is no 18.5 AWG. Request a value a quarter of the way from 18
      // toward 20 — closer to 18 than to any other tabulated size (the table
      // is now complete, so 19 AWG exists between them and must not be picked).
      const mm2_18 = toSquareMillimetres({ value: 18, unit: 'awg' });
      const mm2_20 = toSquareMillimetres({ value: 20, unit: 'awg' });
      const closerTo18 = mm2_18 + (mm2_20 - mm2_18) * 0.25;
      const result = fromSquareMillimetres(closerTo18, 'awg');
      // A tabulated integer (18 here), never a fractional AWG.
      expect(result).toBe(18);
    });
  });

  describe('compareGauge', () => {
    it('returns negative when first gauge is smaller', () => {
      const g1 = { value: 20, unit: 'awg' as const };
      const g2 = { value: 18, unit: 'awg' as const };
      // 20 AWG is smaller than 18 AWG (larger number = smaller conductor)
      expect(compareGauge(g1, g2)).toBe(-1);
    });

    it('returns positive when first gauge is larger', () => {
      const g1 = { value: 18, unit: 'awg' as const };
      const g2 = { value: 20, unit: 'awg' as const };
      expect(compareGauge(g1, g2)).toBe(1);
    });

    it('returns zero when gauges are equal', () => {
      const g1 = { value: 18, unit: 'awg' as const };
      const g2 = { value: 18, unit: 'awg' as const };
      expect(compareGauge(g1, g2)).toBe(0);
    });

    it('compares across units by converting to mm² first', () => {
      // 18 AWG (≈0.823 mm²) vs 1 kcmil (≈0.5067 mm²)
      const awg18 = { value: 18, unit: 'awg' as const };
      const oneKcmil = { value: 1, unit: 'kcmil' as const };
      // 18 AWG is larger than 1 kcmil
      expect(compareGauge(awg18, oneKcmil)).toBe(1);
    });

    it('never compares .value directly — handles AWG inversion correctly', () => {
      // The trap: AWG has backwards numbering. 20 < 18 numerically, but 20 AWG < 18 AWG in size.
      const g20 = { value: 20, unit: 'awg' as const };
      const g18 = { value: 18, unit: 'awg' as const };
      // 20 AWG is physically smaller, so it should compare as less-than
      expect(compareGauge(g20, g18)).toBe(-1);
    });
  });

  describe('gaugeWithinRange', () => {
    it('accepts anything when both bounds are absent', () => {
      const g = { value: 18, unit: 'awg' as const };
      const range = {};
      expect(gaugeWithinRange(g, range)).toBe(true);
    });

    it('accepts anything when range is entirely undefined', () => {
      const g = { value: 999, unit: 'awg' as const };
      const range = { minGauge: undefined, maxGauge: undefined };
      expect(gaugeWithinRange(g, range)).toBe(true);
    });

    it('rejects gauge below minimum', () => {
      const g = { value: 20, unit: 'awg' as const };
      const range = {
        minGauge: { value: 18, unit: 'awg' as const },
      };
      expect(gaugeWithinRange(g, range)).toBe(false);
    });

    it('accepts gauge at minimum', () => {
      const g = { value: 18, unit: 'awg' as const };
      const range = {
        minGauge: { value: 18, unit: 'awg' as const },
      };
      expect(gaugeWithinRange(g, range)).toBe(true);
    });

    it('rejects gauge above maximum', () => {
      const g = { value: 16, unit: 'awg' as const };
      const range = {
        maxGauge: { value: 18, unit: 'awg' as const },
      };
      expect(gaugeWithinRange(g, range)).toBe(false);
    });

    it('accepts gauge at maximum', () => {
      const g = { value: 18, unit: 'awg' as const };
      const range = {
        maxGauge: { value: 18, unit: 'awg' as const },
      };
      expect(gaugeWithinRange(g, range)).toBe(true);
    });

    it('treats a one-sided range as unbounded in the other direction', () => {
      const g = { value: 12, unit: 'awg' as const };
      const minOnly = {
        minGauge: { value: 18, unit: 'awg' as const },
      };
      // 12 AWG is larger than 18 AWG (smaller number = larger conductor)
      expect(gaugeWithinRange(g, minOnly)).toBe(true);
    });

    it('specifically does NOT treat missing bound as zero', () => {
      const g = { value: 18, unit: 'awg' as const };
      const minOnly = {
        minGauge: { value: 20, unit: 'awg' as const },
      };
      // If missing max bound were treated as zero, this would fail
      // (18 AWG > 0). Instead it should pass (no upper bound).
      expect(gaugeWithinRange(g, minOnly)).toBe(true);
    });

    it('works across different units', () => {
      const g = { value: 50, unit: 'kcmil' as const };
      const range = {
        minGauge: { value: 10, unit: 'awg' as const },
        maxGauge: { value: 2, unit: 'awg' as const },
      };
      // 50 kcmil ≈ 25.3 mm²
      // 10 AWG ≈ 5.3 mm²
      // 2 AWG ≈ 33.6 mm²
      // So 50 kcmil should be within [10 AWG, 2 AWG]
      expect(gaugeWithinRange(g, range)).toBe(true);
    });
  });

  describe('sumGauges', () => {
    it('sums three 20 AWG conductors and returns the total in mm²', () => {
      const wires: Gauge[] = [
        { value: 20, unit: 'awg' },
        { value: 20, unit: 'awg' },
        { value: 20, unit: 'awg' },
      ];
      const result = sumGauges(wires, 'mm2');

      // 3 × 0.5189 ≈ 1.557 mm²
      const oneWire = toSquareMillimetres({ value: 20, unit: 'awg' });
      expect(result).toBeCloseTo(oneWire * 3, 2);
    });

    it('sums multiple gauges and is meaningfully larger than one', () => {
      const wires: Gauge[] = [
        { value: 20, unit: 'awg' },
        { value: 20, unit: 'awg' },
        { value: 20, unit: 'awg' },
      ];
      const sumMm2 = sumGauges(wires, 'mm2');
      const oneMm2 = toSquareMillimetres({ value: 20, unit: 'awg' });

      // Sum should be significantly larger than one wire
      expect(sumMm2).toBeGreaterThan(oneMm2 * 2);
    });

    it('converts result to requested unit', () => {
      const wires: Gauge[] = [
        { value: 18, unit: 'awg' },
        { value: 18, unit: 'awg' },
      ];
      const resultMm2 = sumGauges(wires, 'mm2');
      const resultAwg = sumGauges(wires, 'awg');
      const resultKcmil = sumGauges(wires, 'kcmil');

      // All should represent the same total area in different units.
      // mm2 and cmil/kcmil are precise; AWG is lossy (nearest tabulated size).
      const mm2Val = toSquareMillimetres({ value: resultMm2, unit: 'mm2' });
      const awgVal = toSquareMillimetres({ value: resultAwg, unit: 'awg' });
      const kcmilVal = toSquareMillimetres({ value: resultKcmil, unit: 'kcmil' });

      // mm2 and kcmil should agree precisely
      expect(mm2Val).toBeCloseTo(kcmilVal, 2);
      // AWG is a lossy conversion, but the round-trip through the nearest
      // AWG size should still represent the same order of magnitude
      expect(Math.abs(mm2Val - awgVal) / mm2Val).toBeLessThan(0.25);
    });

    it('works with mixed units', () => {
      const wires: Gauge[] = [
        { value: 18, unit: 'awg' },
        { value: 100, unit: 'kcmil' },
        { value: 5, unit: 'mm2' },
      ];
      const resultMm2 = sumGauges(wires, 'mm2');

      const totalMm2 =
        toSquareMillimetres({ value: 18, unit: 'awg' }) +
        toSquareMillimetres({ value: 100, unit: 'kcmil' }) +
        toSquareMillimetres({ value: 5, unit: 'mm2' });

      expect(resultMm2).toBeCloseTo(totalMm2, 2);
    });

    it('never adds AWG numbers directly — converts through mm² first', () => {
      const wires: Gauge[] = [
        { value: 18, unit: 'awg' },
        { value: 20, unit: 'awg' },
      ];
      const resultAwg = sumGauges(wires, 'awg');

      // If we naively added 18 + 20 = 38, that would be nonsensical.
      // The result should be a meaningful AWG value representing the sum.
      expect(resultAwg).toBeLessThan(18);
      expect(resultAwg).toBeGreaterThan(-3);
    });
  });

  describe('round-trip conversions', () => {
    it('round-trips mm² → awg → mm² within tolerance', () => {
      const original = 0.5;
      const toAwg = fromSquareMillimetres(original, 'awg');
      const back = toSquareMillimetres({ value: toAwg, unit: 'awg' });
      // AWG conversion is lossy: rounds to nearest tabulated size.
      // 0.5 mm² is between 20 AWG (0.5189) and 22 AWG (0.3261), so nearest is 20 AWG.
      // Round-trip back through 20 AWG table value (0.5189) gives a 3.8% error.
      expect(back).toBeCloseTo(original, 1);
    });

    it('round-trips mm² → cmil → mm² within tolerance', () => {
      const original = 10;
      const toCmil = fromSquareMillimetres(original, 'cmil');
      const back = toSquareMillimetres({ value: toCmil, unit: 'cmil' });
      expect(back).toBeCloseTo(original, 6);
    });

    it('round-trips mm² → kcmil → mm² within tolerance', () => {
      const original = 50;
      const toKcmil = fromSquareMillimetres(original, 'kcmil');
      const back = toSquareMillimetres({ value: toKcmil, unit: 'kcmil' });
      expect(back).toBeCloseTo(original, 6);
    });

    it('round-trips each unit through itself', () => {
      const testCases: Array<{ value: number; unit: 'mm2' | 'awg' | 'cmil' | 'kcmil' }> = [
        { value: 0.5, unit: 'mm2' },
        { value: 18, unit: 'awg' },
        { value: 100, unit: 'cmil' },
        { value: 50, unit: 'kcmil' },
      ];

      for (const test of testCases) {
        const toMm2 = toSquareMillimetres({ value: test.value, unit: test.unit });
        const back = fromSquareMillimetres(toMm2, test.unit);
        expect(back).toBeCloseTo(test.value, test.unit === 'awg' ? 0 : 6);
      }
    });
  });
});
