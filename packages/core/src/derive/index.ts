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

export function computeDerivedModel(doc: HarnessDocument): DerivedModel {
  const { nets, conflicts } = extractNets(doc);
  const wireRoutes = computeRoutes(doc);
  const wireLengths = computeLengths(doc, wireRoutes);
  const bundleContents = computeBundleContents(wireRoutes);
  const bundleDiameters = computeBundleDiameters(doc, bundleContents);
  const bom = computeBom(doc, wireLengths);
  const diagnostics = runBuiltInRules({ doc, nets, conflicts, wireRoutes, bundleContents, bom });

  return { nets, wireRoutes, wireLengths, bundleContents, bundleDiameters, bom, diagnostics };
}
