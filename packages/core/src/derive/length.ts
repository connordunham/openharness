/**
 * Length calculation (spec §6.3):
 *
 *   length(w) = Σ bundleLength(segment) for segment in route(w)
 *             + serviceLoop.source + serviceLoop.target
 *             + terminationAllowance(source) + terminationAllowance(target)
 *
 * All values are integer micrometres internally. `wire.lengthOverride` wins
 * when set, but the computed value is still what feeds `segments` so a
 * future DRC rule can flag divergence between authored and computed length.
 *
 * SIMPLIFICATION vs. spec: `terminationAllowance` here is just
 * `WireEnd.stripLength`. The spec also mentions "a crimp-allowance constant
 * from the terminal part" — no such field exists on `TerminalPart` yet
 * (it wasn't observed in the reference exports; spec §14/§4.5 flags the
 * whole part-kind as unconfirmed), so it's omitted rather than guessed.
 */

import type { HarnessDocument, RouteResult, LengthResult, LengthResultSegment } from '../types.js';
import type { WireId } from '../ids.js';
import { toMicrometres } from '../units.js';

export function computeLengths(
  doc: HarnessDocument,
  routes: Map<WireId, RouteResult>,
): Map<WireId, LengthResult> {
  const lengths = new Map<WireId, LengthResult>();

  for (const [wireId, wire] of Object.entries(doc.wires)) {
    const route = routes.get(wireId) ?? { status: 'unplaced' as const, segments: [] };

    if (route.status === 'unplaced' || route.status === 'noRoute' || route.status === 'jumper' || route.status === 'shield') {
      lengths.set(wireId, { status: route.status, value: 0, segments: [] });
      continue;
    }

    const segments: LengthResultSegment[] = route.segments.map((bundleId) => {
      const bundle = doc.bundles[bundleId];
      const authored = bundle?.length !== undefined;
      const value = authored ? toMicrometres(bundle!.length!, 'mm') : 0; // bundle.length authored in mm (spec §6.3)
      return { bundleId, length: value, authored };
    });

    const routeSum = segments.reduce((sum, s) => sum + s.length, 0);
    const serviceLoop = wire.serviceLoop
      ? toMicrometres(wire.serviceLoop.source, doc.settings.lengthUnit) +
        toMicrometres(wire.serviceLoop.target, doc.settings.lengthUnit)
      : 0;
    const terminationAllowance =
      (wire.ends?.source.stripLength ? toMicrometres(wire.ends.source.stripLength, doc.settings.lengthUnit) : 0) +
      (wire.ends?.target.stripLength ? toMicrometres(wire.ends.target.stripLength, doc.settings.lengthUnit) : 0);

    const computedValue = routeSum + serviceLoop + terminationAllowance;

    if (wire.lengthOverride !== undefined) {
      lengths.set(wireId, {
        status: 'overridden',
        value: toMicrometres(wire.lengthOverride, doc.settings.lengthUnit),
        segments,
      });
      continue;
    }

    lengths.set(wireId, { status: route.status, value: computedValue, segments });
  }

  return lengths;
}
