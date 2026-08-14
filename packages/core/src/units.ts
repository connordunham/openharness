import type { LengthUnit } from './types.js';

/**
 * Lengths are stored internally as integer micrometres (spec §6.3): floating
 * point summation of many bundle segments drifts, and the drift is
 * order-dependent, which breaks golden-file tests with phantom diffs.
 * Convert only at UI/export/API boundaries.
 */
const UM_PER_UNIT: Record<LengthUnit, number> = {
  mm: 1000,
  cm: 10000,
  m: 1000000,
  in: 25400,
  ft: 304800,
};

export function toMicrometres(value: number, unit: LengthUnit): number {
  return Math.round(value * UM_PER_UNIT[unit]);
}

export function fromMicrometres(um: number, unit: LengthUnit): number {
  return um / UM_PER_UNIT[unit];
}
