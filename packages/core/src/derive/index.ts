/**
 * Derived model computation (spec §6): net extraction → routing → length →
 * bundle analysis → BOM → DRC, in that dependency order. Each stage is its
 * own module so it can be tested and golden-fixtured independently (spec
 * §12, §13).
 *
 * PERFORMANCE NOTE (review R9): this recomputes everything on every call,
 * with no dependency tracking between a patch and the derived slices it can
 * possibly affect. That's fine at pilot scale (the store already caches the
 * result and only recomputes when the document actually changes — see
 * `HarnessStore.derived`) but is exactly the thing flagged as needing a
 * real invalidation contract before the document gets large. Left as-is
 * deliberately rather than guessing at an invalidation scheme with no real
 * usage data yet.
 */

import type { HarnessDocument, DerivedModel } from '../types.js';
import { extractNets } from './netExtraction.js';
import { computeRoutes } from './routing.js';
import { computeLengths } from './length.js';
import { computeBundleContents, computeBundleDiameters } from './bundleAnalysis.js';
import { computeBom } from './bom.js';
import { runBuiltInRules } from './rules.js';
import { computeInterconnectTable } from './interconnect.js';

export function computeDerivedModel(doc: HarnessDocument): DerivedModel {
  const { nets, conflicts } = extractNets(doc);
  const wireRoutes = computeRoutes(doc);
  const wireLengths = computeLengths(doc, wireRoutes);
  const bundleContents = computeBundleContents(wireRoutes);
  const bundleDiameters = computeBundleDiameters(doc, bundleContents);
  const bom = computeBom(doc, wireLengths);
  const diagnostics = runBuiltInRules({ doc, nets, conflicts, wireRoutes, bundleContents, bom });
  const interconnect = computeInterconnectTable(doc);

  // Array-valued outputs are sorted into a deterministic order before being
  // returned. Internally they're built by walking `Object.entries(doc.*)`,
  // whose order depends on incidental JS object key-insertion order — which
  // itself depends on things like `.ohd` serialisation choosing to sort
  // keys alphabetically (spec §10) for clean git diffs. Without this, the
  // *same document* could produce a differently-ordered BOM/diagnostics list
  // depending on how it was loaded, which would make golden-file tests
  // (spec §13) and exported CSVs non-reproducible for no functional reason.
  bom.sort((a, b) => (a.partId ?? `${a.partNumber}:${a.unit}`).localeCompare(b.partId ?? `${b.partNumber}:${b.unit}`));
  diagnostics.sort((a, b) => {
    const ka = `${a.ruleId}:${a.targets.map((t) => t.id).join(',')}`;
    const kb = `${b.ruleId}:${b.targets.map((t) => t.id).join(',')}`;
    return ka.localeCompare(kb);
  });
  nets.sort((a, b) => a.id.localeCompare(b.id));

  interconnect.sort((a, b) => a.wireRefdes.localeCompare(b.wireRefdes));

  return { nets, wireRoutes, wireLengths, bundleContents, bundleDiameters, bom, diagnostics, interconnect };
}
