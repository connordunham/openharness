import { describe, it, expect } from 'vitest';
import { formatSi, formatParameter } from '../index.js';

describe('formatSi', () => {
  it('prints a plain zero rather than running it through the prefix logic', () => {
    // log10(0) is -Infinity; without this case the prefix maths produces
    // nonsense for the most common value a blank parasitic field yields.
    expect(formatSi(0, 'Ω')).toBe('0 Ω');
  });

  it('uses engineering prefixes so small values stay readable', () => {
    expect(formatSi(0.047, 'Ω')).toBe('47 mΩ');
    expect(formatSi(4.7e-11, 'F')).toBe('47 pF');
    expect(formatSi(1.5e-6, 'F')).toBe('1.5 µF');
  });

  it('leaves values in the 1–999 range unprefixed', () => {
    expect(formatSi(250, 'V')).toBe('250 V');
    expect(formatSi(1, 'Ω')).toBe('1 Ω');
  });

  it('steps up to k/M for large values', () => {
    expect(formatSi(4700, 'Ω')).toBe('4.7 kΩ');
    expect(formatSi(2.2e6, 'Ω')).toBe('2.2 MΩ');
  });

  it('keeps three significant figures, not floating-point noise', () => {
    // 0.1 + 0.2 style drift is exactly what a length multiply produces.
    expect(formatSi(0.30000000000000004, 'Ω')).toBe('300 mΩ');
  });

  it('handles negatives without losing the sign', () => {
    expect(formatSi(-0.047, 'Ω')).toBe('-47 mΩ');
  });

  it('does not fall off the end of the prefix table for extreme values', () => {
    expect(formatSi(1e30, 'Ω')).toMatch(/Ω$/);
    expect(formatSi(1e-30, 'F')).toMatch(/F$/);
  });
});

describe('formatParameter', () => {
  it('renders name, qualifier, value and unit in one line', () => {
    expect(formatParameter({ id: 'a', name: 'Voltage rating', qualifier: 'max', value: 600, unit: 'V' }))
      .toBe('Voltage rating: max 600 V');
  });

  it('falls back to a generic name rather than leaving a leading colon', () => {
    expect(formatParameter({ id: 'a', name: '   ', qualifier: 'nom', value: 1, unit: 'A' }))
      .toBe('Parameter: nom 1 A');
  });

  it('omits the trailing space when a parameter has no unit', () => {
    expect(formatParameter({ id: 'a', name: 'Mating cycles', qualifier: 'min', value: 500, unit: '' }))
      .toBe('Mating cycles: min 500');
  });
});
