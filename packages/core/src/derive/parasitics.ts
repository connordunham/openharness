/**
 * Per-wire parasitic totals (spec follow-up: parasitics on components, and
 * per-unit-length resistance/capacitance on wire parts).
 *
 * The interesting part of this stage is the unit bookkeeping, and it's worth
 * being explicit about because getting it wrong produces numbers that look
 * plausible and are off by three orders of magnitude:
 *
 *   - `LengthResult.value` is integer MICROMETRES (spec §6.3 — the whole
 *     length pipeline is integer µm so repeated summation can't drift).
 *   - `WirePart.resistancePerLength` is Ω per the DOCUMENT'S `lengthUnit`,
 *     because that's the unit the wire's length is authored and BOM-reported
 *     in, so the multiply is against a number the user can actually see.
 *
 * So the conversion is µm → document length unit → multiply. `fromMicrometres`
 * is the single place that mapping lives, shared with the BOM.
 *
 * A wire with no route has no length to multiply. Rather than reporting a
 * confident 0 Ω — which reads as "ideal conductor" rather than "unknown" —
 * the result carries `lengthKnown: false` and the UI is expected to say so.
 */

import type { HarnessDocument, LengthResult, WireParasitics, WirePart } from '../types.js';
import type { WireId } from '../ids.js';
import { fromMicrometres } from '../units.js';

export function computeWireParasitics(
  doc: HarnessDocument,
  lengths: Map<WireId, LengthResult>,
): Map<WireId, WireParasitics> {
  const out = new Map<WireId, WireParasitics>();

  for (const [wireId, wire] of Object.entries(doc.wires)) {
    const result = lengths.get(wireId);
    const status = result?.status ?? 'unplaced';
    // 'jumper' and 'shield' are real, known lengths of zero (a cable core or
    // shield short-circuit, see derive/routing.ts) — not missing data. Only
    // noRoute/unplaced mean "we genuinely don't know how long this is".
    const lengthKnown = !!result && status !== 'noRoute' && status !== 'unplaced';
    const length = lengthKnown ? fromMicrometres(result.value, doc.settings.lengthUnit) : 0;

    const part = wire.partId ? doc.parts[wire.partId] : undefined;
    const wirePart = part?.kind === 'wire' ? (part as WirePart) : undefined;

    out.set(wireId, {
      resistanceOhms: length * (wirePart?.resistancePerLength ?? 0),
      capacitanceFarads: length * (wirePart?.capacitancePerLength ?? 0),
      lengthKnown,
    });
  }

  return out;
}

/**
 * Sum of every authored component parasitic in the document. Not part of
 * `DerivedModel` — it's a whole-document rollup a UI asks for on demand
 * (the Overview pane), not an input to any other derive stage, and stuffing
 * it into the derived model would mean recomputing it on every transaction
 * for something usually not on screen.
 */
export function totalComponentParasitics(doc: HarnessDocument): {
  resistanceOhms: number;
  capacitanceFarads: number;
  inductanceHenries: number;
  componentCount: number;
} {
  let resistanceOhms = 0;
  let capacitanceFarads = 0;
  let inductanceHenries = 0;
  let componentCount = 0;
  for (const component of Object.values(doc.components)) {
    const p = component.parasitics;
    if (!p) continue;
    if (p.resistanceOhms === undefined && p.capacitanceFarads === undefined && p.inductanceHenries === undefined) continue;
    componentCount++;
    resistanceOhms += p.resistanceOhms ?? 0;
    capacitanceFarads += p.capacitanceFarads ?? 0;
    inductanceHenries += p.inductanceHenries ?? 0;
  }
  return { resistanceOhms, capacitanceFarads, inductanceHenries, componentCount };
}
