/**
 * Display formatting shared by the UI and any exporter — pure string
 * helpers with no dependency on the document model, kept in core so the
 * app, the CLI and future exporters all render the same value identically.
 */

import type { GaugeUnit } from './types.js';

/**
 * One gauge value as a human reads it, in its own unit — the NUMBER only,
 * without the unit suffix, so callers can compose ranges like "18–22 AWG"
 * with a single trailing unit (see gaugeUnitSuffix).
 *
 * AWG sizes 0, −1, −2, −3 are the standard's 1/0…4/0 — printing "-1" would
 * be machine output, so they render the way the table publishes them
 * (ASTM B258 writes the sizes this way; see gauge.ts). mm² keeps at most
 * three significant figures (catalog precision); circular mils are whole
 * numbers in practice.
 */
export function formatGaugeValue(value: number, unit: GaugeUnit): string {
  switch (unit) {
    case 'awg':
      if (value === 0) return '1/0';
      if (value === -1) return '2/0';
      if (value === -2) return '3/0';
      if (value === -3) return '4/0';
      return `${value}`;
    case 'mm2':
      return `${Number(value.toPrecision(3))}`;
    case 'cmil':
    case 'kcmil':
      return `${Math.round(value)}`;
    default:
      return `${value}`;
  }
}

/** The trailing unit label for a gauge display value. */
export function gaugeUnitSuffix(unit: GaugeUnit): string {
  switch (unit) {
    case 'awg': return ' AWG';
    case 'mm2': return ' mm²';
    case 'cmil': return ' cmil';
    case 'kcmil': return ' kcmil';
    default: return '';
  }
}


/**
 * Engineering-notation formatter for the derived parasitic readouts.
 *
 * Parasitics span an absurd dynamic range — a wire is milliohms and
 * picofarads — and printing `0.000000000047 F` is unreadable while
 * `Number.toExponential` reads as machine output. Engineering notation (SI
 * prefixes, exponents in multiples of three) is what an engineer expects on
 * a value with a unit.
 *
 * Exactly zero is returned as a plain "0 <unit>": running it through the
 * prefix logic would print "0.00 " with whatever prefix happened to fall out
 * of log(0), and zero has no magnitude to qualify.
 */
export function formatSi(value: number, unit: string): string {
  if (value === 0) return `0 ${unit}`;
  const prefixes = [
    { exp: -12, p: 'p' }, { exp: -9, p: 'n' }, { exp: -6, p: 'µ' }, { exp: -3, p: 'm' },
    { exp: 0, p: '' }, { exp: 3, p: 'k' }, { exp: 6, p: 'M' }, { exp: 9, p: 'G' },
  ];
  const magnitude = Math.floor(Math.log10(Math.abs(value)) / 3) * 3;
  const chosen = prefixes.find((x) => x.exp === magnitude) ?? prefixes[Math.abs(value) < 1 ? 0 : prefixes.length - 1]!;
  const scaled = value / 10 ** chosen.exp;
  // Three significant figures is the precision a datasheet gives; more just
  // exposes floating-point noise from the length multiply.
  return `${Number(scaled.toPrecision(3))} ${chosen.p}${unit}`;
}
