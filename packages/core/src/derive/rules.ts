/**
 * Built-in DRC rules (spec §6.5). This is a fixed subset of the full table —
 * the nine rules here are the ones that need no more input than what
 * net extraction / routing / length / BOM already compute. The remainder
 * (GAUGE_TERMINAL_MISMATCH, BUNDLE_DIAMETER_EXCEEDS_COVERING,
 * SHIELD_MULTI_GROUND, SHIELD_UNGROUNDED, CAVITY_COUNT_MISMATCH,
 * UNSEALED_CAVITY, FORMBOARD_LENGTH_MISMATCH) need part-catalogue detail or
 * formboard geometry not yet exercised by any fixture — left for when a
 * concrete case exists to test against (spec §14 discipline).
 *
 * The real `Rule`/automation-authored rule interface (spec §6.5, §8.3) lands
 * with the automation host in Phase 5; this module is the built-in rule set
 * `computeDerivedModel` runs directly in the meantime.
 */

import type {
  HarnessDocument, Diagnostic, Net, RouteResult, BomLine, Part,
  ContactPart, ConnectorPart, Gauge, GaugeUnit, TerminalKind, LengthUnit,
} from '../types.js';
import { BACKSHELL_CAVITY_ID } from '../types.js';
import type { WireId, BundleId } from '../ids.js';
import { resolveComponentHost } from './routing.js';
import { sumGauges, toSquareMillimetres, toSquareMillimetresSafe, fromSquareMillimetres, compareGauge } from '../gauge.js';

export interface RuleInputs {
  doc: HarnessDocument;
  nets: Net[];
  conflicts: Map<string, string[]>;
  wireRoutes: Map<WireId, RouteResult>;
  bundleContents: Map<BundleId, WireId[]>;
  bom: BomLine[];
}

export function runBuiltInRules(inputs: RuleInputs): Diagnostic[] {
  return [
    ...noRoute(inputs),
    ...unplacedComponent(inputs),
    ...spliceUnplaced(inputs),
    ...emptyBundle(inputs),
    ...overfilledCavity(inputs),
    ...wireGaugeRange(inputs),
    ...missingPart(inputs),
    ...duplicateRefdes(inputs),
    ...floatingWire(inputs),
    ...netSignalConflict(inputs),
    ...mateValidation(inputs),
  ];
}

function noRoute({ doc, wireRoutes }: RuleInputs): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const [wireId, route] of wireRoutes) {
    if (route.status !== 'noRoute') continue;
    out.push({
      ruleId: 'NO_ROUTE',
      severity: 'warning',
      message: `${doc.wires[wireId]?.refdes ?? wireId} has no path through the layout graph`,
      targets: [{ kind: 'wire', id: wireId }],
    });
  }
  return out;
}

const LAYOUT_CAPABLE_TYPES = new Set(['connector', 'splice', 'terminal', 'resistor', 'diode', 'cable']);

function unplacedComponent({ doc }: RuleInputs): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const component of Object.values(doc.components)) {
    if (!LAYOUT_CAPABLE_TYPES.has(component.type)) continue;
    if (component.layoutPosition) continue;
    if (component.type === 'splice') continue; // covered by SPLICE_UNPLACED, which is more specific
    out.push({
      ruleId: 'UNPLACED_COMPONENT',
      severity: 'info',
      message: `${component.refdes} has no position in the Layout view`,
      targets: [{ kind: 'component', id: component.id }],
    });
  }
  return out;
}

function spliceUnplaced({ doc }: RuleInputs): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const component of Object.values(doc.components)) {
    if (component.type !== 'splice') continue;
    if (component.layoutPosition) continue;
    const host = resolveComponentHost(doc, component.id, new Set());
    if (host === undefined) {
      out.push({
        ruleId: 'SPLICE_UNPLACED',
        severity: 'info',
        message: `${component.refdes} has no layout position and its neighbours don't agree on one host`,
        targets: [{ kind: 'component', id: component.id }],
      });
    }
  }
  return out;
}

function emptyBundle({ doc, bundleContents }: RuleInputs): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const bundleId of Object.keys(doc.bundles)) {
    const wires = bundleContents.get(bundleId) ?? [];
    if (wires.length === 0) {
      out.push({
        ruleId: 'EMPTY_BUNDLE',
        severity: 'warning',
        message: `${doc.bundles[bundleId]?.refdes ?? bundleId} carries no wires`,
        targets: [{ kind: 'bundle', id: bundleId }],
      });
    }
  }
  return out;
}

/**
 * ENGINEER-CONFIRMED (2026-08-19 — see docs/DOMAIN-DECISIONS.md, D1). Two
 * wires landing in one cavity with no splice is a defect, regardless of
 * whether their combined gauge would fit the contact. `error` is the correct
 * severity and this rule should not be softened.
 *
 * It fires on `_reference_harness_export.json`, where connector "ZWfYpO" has
 * two wires on each of its two cavities — that document is using a 2-cavity
 * connector as an in-line jumper. The DOCUMENT is wrong, not the rule.
 *
 * This previously carried a comment speculating that the pattern might be
 * legitimate and the rule too strict. It isn't, and that speculation is
 * removed rather than left to mislead the next reader into relaxing a rule
 * that is doing its job.
 *
 * The backshell exemption below is separate and still correct: a backshell is
 * a shell-level ground point, not a crimp cavity, and taking several drain
 * wires at once is its normal use.
 */
function overfilledCavity({ doc }: RuleInputs): Diagnostic[] {
  const out: Diagnostic[] = [];
  const counts = new Map<string, number>();
  for (const wire of Object.values(doc.wires)) {
    for (const endpoint of [wire.source, wire.target]) {
      if (endpoint.kind !== 'cavity') continue;
      // A backshell termination is not a cavity — it's a shell-level ground
      // point, and taking several drain wires and ground straps at once is
      // its normal, correct use, not an overfill. See BACKSHELL_CAVITY_ID.
      if (endpoint.cavityId === BACKSHELL_CAVITY_ID) continue;
      const key = `${endpoint.componentId}:${endpoint.cavityId}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of counts) {
    if (count <= 1) continue;
    const [componentId, cavityId] = key.split(':');
    const component = doc.components[componentId!];
    out.push({
      ruleId: 'OVERFILLED_CAVITY',
      severity: 'error',
      message: `${component?.refdes ?? componentId} cavity ${cavityId} has ${count} wires without a splice`,
      targets: [{ kind: 'cavity', id: key }],
    });
  }
  return out;
}

/**
 * WIRE_GAUGE_RANGE: Warn when a wire (or several wires sharing one cavity)
 * is outside the gauge range of the contact it is crimped into.
 *
 * Per DOMAIN-DECISIONS.md D2: Two wires in one crimp occupy the sum of their
 * areas. Convert each to mm², add, compare the total against the contact's
 * GaugeRange. A wire with no gauge is skipped (not zero-area). Report in the
 * document's own gauge unit, never mixed or assumed.
 */
function wireGaugeRange({ doc }: RuleInputs): Diagnostic[] {
  const out: Diagnostic[] = [];

  // Build a map of cavity -> wires landing in it.
  const cavityWires = new Map<string, WireId[]>();
  for (const wire of Object.values(doc.wires)) {
    for (const endpoint of [wire.source, wire.target]) {
      if (endpoint.kind !== 'cavity') continue;
      // Backshell is excluded (same as OVERFILLED_CAVITY, D1).
      if (endpoint.cavityId === BACKSHELL_CAVITY_ID) continue;
      const key = `${endpoint.componentId}:${endpoint.cavityId}`;
      if (!cavityWires.has(key)) cavityWires.set(key, []);
      cavityWires.get(key)!.push(wire.id);
    }
  }

  // For each populated cavity, resolve contact and check gauge.
  for (const [key, wireIds] of cavityWires) {
    const [componentId, cavityId] = key.split(':');
    const component = doc.components[componentId!];
    if (!component || component.type !== 'connector') continue;

    const cavityObj = (component.cavities ?? []).find((c) => c.id === cavityId);
    if (!cavityObj) continue;

    // Resolve contact: first from cavity override, then from connector's active
    // configuration. See packet traps: "Resolve the contact through the
    // configuration, not only the cavity override, or the rule silently never
    // fires on the common case."
    let contactPartId = cavityObj.contactPartId;
    if (!contactPartId && component.partId) {
      const connectorPart = doc.parts[component.partId] as ConnectorPart | undefined;
      if (connectorPart?.kind === 'connector') {
        // The active configuration is the first one by convention (no explicit
        // "current config" tracking in the current model).
        const config = connectorPart.configurations?.[0];
        contactPartId = config?.contactPartId;
      }
    }

    if (!contactPartId) continue; // Not this rule's job — MISSING_PART handles it.

    const contactPart = doc.parts[contactPartId] as ContactPart | undefined;
    if (!contactPart || contactPart.kind !== 'contact') continue;

    // Collect gauges of all wires in this cavity. A wire whose gauge cannot be
    // converted (an AWG size outside the tabulated range) is skipped rather
    // than allowed to throw — a rule that walks every populated cavity must
    // degrade on a bad part, not crash the whole derive pipeline (B7).
    const gauges: Gauge[] = [];
    for (const wireId of wireIds) {
      const wire = doc.wires[wireId];
      if (!wire) continue;
      const wirePart = wire.partId ? (doc.parts[wire.partId]) : undefined;
      if (wirePart && 'gauge' in wirePart && wirePart.gauge) {
        if (toSquareMillimetresSafe(wirePart.gauge) !== undefined) {
          gauges.push(wirePart.gauge);
        }
      }
      // Wire with no gauge is skipped; if all wires in cavity have no gauge,
      // `gauges` stays empty and we emit nothing (a wire with no gauge is not
      // a zero-area wire).
    }

    if (gauges.length === 0) continue; // Nothing measurable in this cavity.

    // Sum gauges in mm².
    const summedMm2 = sumGauges(gauges, 'mm2');

    // Check bounds using compareGauge semantics.
    // compareGauge(a, b) returns -1 if a < b (in mm²), 0 if equal, 1 if a > b.
    // The constraint is: minGauge <= summed <= maxGauge (using compareGauge).
    const { minGauge, maxGauge } = contactPart;
    let outOfRange = false;
    let reason = '';

    // Create a test gauge in mm² to compare.
    const testGauge: Gauge = { value: summedMm2, unit: 'mm2' };

    if (minGauge !== undefined && compareGauge(testGauge, minGauge) < 0) {
      // testGauge < minGauge (in area)
      outOfRange = true;
      reason = 'below minimum';
    }

    if (!outOfRange && maxGauge !== undefined && compareGauge(testGauge, maxGauge) > 0) {
      // testGauge > maxGauge (in area)
      outOfRange = true;
      reason = 'above maximum';
    }

    if (!outOfRange) continue;

    // Format the summed gauge and contact range in the document's unit.
    const docUnit = (doc.settings.gaugeUnit ?? 'awg') as GaugeUnit;
    const summedInDocUnit = fromSquareMillimetres(summedMm2, docUnit);
    const minInDocUnit = minGauge ? fromSquareMillimetres(toSquareMillimetres(minGauge), docUnit) : null;
    const maxInDocUnit = maxGauge ? fromSquareMillimetres(toSquareMillimetres(maxGauge), docUnit) : null;

    const minStr = minInDocUnit !== null ? minInDocUnit.toFixed(2) : '—';
    const maxStr = maxInDocUnit !== null ? maxInDocUnit.toFixed(2) : '—';
    const sumStr = summedInDocUnit.toFixed(2);

    // Name the wire(s), not just the cavity — the packet requires the finding
    // to identify both the wire and the range (C4).
    const wireNames = wireIds
      .map((id) => doc.wires[id]?.refdes ?? id)
      .join(', ');

    const message = `${wireIds.length === 1 ? 'Wire' : 'Wires'} ${wireNames} in cavity ${cavityId} have total gauge ${sumStr} ${docUnit} (${reason}; contact range [${minStr}, ${maxStr}] ${docUnit})`;

    out.push({
      ruleId: 'WIRE_GAUGE_RANGE',
      severity: 'warning',
      message,
      targets: wireIds.map((id) => ({ kind: 'wire' as const, id })),
    });
  }

  return out;
}

function missingPart({ doc }: RuleInputs): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const component of Object.values(doc.components)) {
    if (component.type === 'branchPoint') continue;
    if (component.excludeFromBom) continue;
    if (!component.partId) {
      out.push({
        ruleId: 'MISSING_PART',
        severity: 'warning',
        message: `${component.refdes} has no part assigned`,
        targets: [{ kind: 'component', id: component.id }],
      });
    }
  }
  for (const wire of Object.values(doc.wires)) {
    if (!wire.partId) {
      out.push({
        ruleId: 'MISSING_PART',
        severity: 'warning',
        message: `${wire.refdes} has no wire part assigned`,
        targets: [{ kind: 'wire', id: wire.id }],
      });
    }
  }
  return out;
}

function duplicateRefdes({ doc }: RuleInputs): Diagnostic[] {
  const out: Diagnostic[] = [];
  const seen = new Map<string, { kind: 'component' | 'wire' | 'bundle'; id: string }[]>();
  const record = (refdes: string, kind: 'component' | 'wire' | 'bundle', id: string) => {
    if (!seen.has(refdes)) seen.set(refdes, []);
    seen.get(refdes)!.push({ kind, id });
  };
  for (const c of Object.values(doc.components)) record(c.refdes, 'component', c.id);
  for (const w of Object.values(doc.wires)) record(w.refdes, 'wire', w.id);
  for (const b of Object.values(doc.bundles)) record(b.refdes, 'bundle', b.id);

  for (const [refdes, targets] of seen) {
    if (targets.length <= 1) continue;
    out.push({
      ruleId: 'DUPLICATE_REFDES',
      severity: 'error',
      message: `Refdes "${refdes}" is used ${targets.length} times`,
      targets,
    });
  }
  return out;
}

function floatingWire({ doc }: RuleInputs): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const wire of Object.values(doc.wires)) {
    if (wire.source.kind === 'free' || wire.target.kind === 'free') {
      out.push({
        ruleId: 'FLOATING_WIRE',
        severity: 'warning',
        message: `${wire.refdes} has an unterminated end`,
        targets: [{ kind: 'wire', id: wire.id }],
      });
    }
  }
  return out;
}

function netSignalConflict({ conflicts }: RuleInputs): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const [netId, signals] of conflicts) {
    out.push({
      ruleId: 'NET_SIGNAL_CONFLICT',
      severity: 'error',
      message: `Net has conflicting signal names: ${signals.join(', ')}`,
      targets: [{ kind: 'net', id: netId }],
    });
  }
  return out;
}

/**
 * Mate validation (spec §6.5, Traps D3). Four rules:
 * - MATE_CAVITY_COUNT: Mated connectors must have matching cavity counts.
 *   Degraded: the mate still unions available pairs (up to the smaller count).
 * - MATE_GENDER: Both ends have parts with a gender and they are equal.
 *   An absent gender is not wrong (DOMAIN-DECISIONS D3).
 * - MATE_INCOMPATIBLE: Terminal-type pairing not allowed per spec table.
 * - MATE_SIZE: For sized components (ring, spade), size must match.
 *   An absent size is not wrong.
 */
function mateValidation({ doc }: RuleInputs): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const mate of Object.values(doc.mates ?? {})) {
    const source = doc.components[mate.sourceId];
    const target = doc.components[mate.targetId];

    // Ignore mates to non-existent components
    if (!source || !target) continue;

    // MATE_CAVITY_COUNT: connector-to-connector only
    if (source.type === 'connector' && target.type === 'connector') {
      const sourceCavityCount = source.cavities.length;
      const targetCavityCount = target.cavities.length;
      if (sourceCavityCount !== targetCavityCount) {
        out.push({
          ruleId: 'MATE_CAVITY_COUNT',
          severity: 'error',
          message: `${source.refdes} and ${target.refdes} have different cavity counts (${sourceCavityCount} vs ${targetCavityCount})`,
          targets: [
            { kind: 'component', id: mate.sourceId },
            { kind: 'component', id: mate.targetId },
          ],
        });
      }
    }

    // MATE_GENDER: both ends must have gender parts defined, and genders must differ
    const sourcePart = source.partId ? doc.parts[source.partId] : undefined;
    const targetPart = target.partId ? doc.parts[target.partId] : undefined;

    const sourceGender = getPartGender(sourcePart);
    const targetGender = getPartGender(targetPart);

    // Only fire if both have a gender defined (absence is not an error).
    // Hermaphroditic↔hermaphroditic is deliberately NOT flagged: that is the
    // *correct* pairing for a hermaphroditic gender — Anderson Powerpole and
    // similar genderless housings mate with an identical part. Flagging it
    // would be a false positive. (Engineering inference from the well-known
    // behaviour of hermaphroditic connectors; not yet a DOMAIN-DECISIONS
    // ruling — flagged for confirmation by the resident engineer.)
    if (
      sourceGender && targetGender
      && sourceGender === targetGender
      && sourceGender !== 'hermaphroditic'
    ) {
      out.push({
        ruleId: 'MATE_GENDER',
        severity: 'error',
        message: `${source.refdes} and ${target.refdes} both have gender "${sourceGender}"`,
        targets: [
          { kind: 'component', id: mate.sourceId },
          { kind: 'component', id: mate.targetId },
        ],
      });
    }

    // MATE_INCOMPATIBLE: terminal-into-cavity only
    if (source.type === 'terminal' && target.type === 'connector') {
      const terminalKind = source.terminalKind;
      if (terminalKind !== 'looseWireEnd') {
        // Check multiplicity and type compatibility
        const cavityId = mate.targetCavityId;
        if (!cavityId) continue;

        const cavity = target.cavities.find((c) => c.id === cavityId);
        if (!cavity) continue;

        // Count how many mates already land terminals in this cavity
        const existingTerminals = Object.values(doc.mates ?? {}).filter((m) => {
          if (m === mate) return false; // Skip self
          const s = doc.components[m.sourceId];
          return s?.type === 'terminal' && m.targetId === mate.targetId && m.targetCavityId === cavityId;
        }).length;

        // Ferrule limit: only one per cavity
        if (terminalKind === 'ferrule' && existingTerminals > 0) {
          out.push({
            ruleId: 'MATE_INCOMPATIBLE',
            severity: 'error',
            message: `${source.refdes} (ferrule) and another terminal are both mated into ${target.refdes} cavity ${cavity.designation}; only one ferrule per cavity allowed`,
            targets: [
              { kind: 'component', id: mate.sourceId },
              { kind: 'cavity', id: `${mate.targetId}:${cavityId}` },
            ],
          });
        }

        // Quick-connect limit: only one per cavity and gender must match
        if (
          (terminalKind === 'maleQuickConnect' || terminalKind === 'femaleQuickConnect')
          && existingTerminals > 0
        ) {
          out.push({
            ruleId: 'MATE_INCOMPATIBLE',
            severity: 'error',
            message: `${source.refdes} (${terminalKind}) and another quick-connect are both mated into ${target.refdes} cavity ${cavity.designation}; only one per cavity allowed`,
            targets: [
              { kind: 'component', id: mate.sourceId },
              { kind: 'cavity', id: `${mate.targetId}:${cavityId}` },
            ],
          });
        }
      }
    }

    // MATE_INCOMPATIBLE (terminal-to-terminal pairing table) and MATE_SIZE for
    // sized terminal kinds. The packet's compatibility table governs which
    // terminal families may mate at all:
    //   ring  ↔ ring, spade        spade ↔ spade, ring
    //   male quick-connect ↔ female quick-connect
    // Anything else (ring↔ferrule, spade↔quick-connect, ferrule↔terminal…)
    // physically cannot join and is an error — not merely a size mismatch.
    if (source.type === 'terminal' && target.type === 'terminal') {
      if (!terminalsMayMate(source.terminalKind, target.terminalKind)) {
        out.push({
          ruleId: 'MATE_INCOMPATIBLE',
          severity: 'error',
          message: `${source.refdes} (${source.terminalKind}) cannot mate with ${target.refdes} (${target.terminalKind})`,
          targets: [
            { kind: 'component', id: mate.sourceId },
            { kind: 'component', id: mate.targetId },
          ],
        });
      }

      const sourcePart_ = source.partId ? doc.parts[source.partId] : undefined;
      const targetPart_ = target.partId ? doc.parts[target.partId] : undefined;

      const sourceSize = getPartSize(sourcePart_);
      const targetSize = getPartSize(targetPart_);

      // Only compare if both sizes are defined
      if (sourceSize !== undefined && targetSize !== undefined && !sizesMatch(sourceSize, targetSize)) {
        out.push({
          ruleId: 'MATE_SIZE',
          severity: 'error',
          message: `${source.refdes} and ${target.refdes} have mismatched sizes`,
          targets: [
            { kind: 'component', id: mate.sourceId },
            { kind: 'component', id: mate.targetId },
          ],
        });
      }
    }
  }

  return out;
}

/**
 * Terminal-to-terminal mating compatibility (packet T02 table). Symmetric: a
 * ring mates with a spade exactly when a spade mates with a ring. Quick-
 * connects are the one family that crosses gender. `looseWireEnd` is not a
 * mateable terminal at all (it models an unterminated conductor), and a
 * ferrule only ever mates into a connector cavity, never another terminal.
 */
function terminalsMayMate(a: TerminalKind, b: TerminalKind): boolean {
  const pair = [a, b].sort().join('|');
  const allowed = new Set([
    'ring|ring',
    'ring|spade',
    'spade|spade',
    'femaleQuickConnect|maleQuickConnect',
  ]);
  return allowed.has(pair);
}

/** Extract gender from a part, if applicable */
function getPartGender(part: Part | undefined): string | undefined {
  if (!part) return undefined;
  // ConnectorPart, ContactPart, and TerminalPart may have gender
  if (part.kind === 'connector' || part.kind === 'contact' || part.kind === 'terminal') {
    return (part as { gender?: string }).gender;
  }
  return undefined;
}

/** Extract size from a terminal part */
function getPartSize(part: Part | undefined): unknown {
  if (!part || part.kind !== 'terminal') return undefined;
  return (part as { size?: unknown }).size; // TerminalPart.size
}

/** Multipliers to convert a `LengthUnit` quantity to millimetres. */
const LENGTH_TO_MM: Record<LengthUnit, number> = {
  mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8,
};

const GAUGE_UNITS: ReadonlySet<string> = new Set(['mm2', 'awg', 'cmil', 'kcmil']);

/**
 * Reduce a terminal `size` value to a canonical comparable number, or `null`
 * if it isn't a numeric quantity. Length-style sizes normalise to mm, gauge-
 * style sizes to mm² — the two kinds are never comparable with each other, so
 * the result carries which kind it is. Strings (e.g. a `#8` screw gauge) have
 * no numeric meaning and are handled separately by exact match.
 */
function sizeToCanonical(size: unknown): { value: number; kind: 'length' | 'gauge' } | null {
  if (typeof size !== 'object' || size === null) return null;
  const obj = size as { value?: unknown; unit?: unknown };
  if (typeof obj.value !== 'number' || typeof obj.unit !== 'string') return null;

  if (obj.unit in LENGTH_TO_MM) {
    return { value: obj.value * LENGTH_TO_MM[obj.unit as LengthUnit], kind: 'length' };
  }
  if (GAUGE_UNITS.has(obj.unit)) {
    const mm2 = toSquareMillimetresSafe({ value: obj.value, unit: obj.unit as Gauge['unit'] });
    if (mm2 === undefined) return null;
    return { value: mm2, kind: 'gauge' };
  }
  return null;
}

/**
 * Check whether two terminal sizes match.
 *
 * Numeric sizes are compared numerically after normalising to a common unit,
 * so a part catalogued in mm and one in inches compare on their real physical
 * dimension rather than being declared a mismatch purely for the unit spell-
 * ing (C3). Strings (US screw gauges like `#8`) carry no convertible dimension
 * and match only exactly. A length never matches a gauge — they are different
 * physical quantities.
 */
function sizesMatch(a: unknown, b: unknown): boolean {
  // Both strings: exact match (no numeric dimension to compare).
  if (typeof a === 'string' && typeof b === 'string') return a === b;

  const ca = sizeToCanonical(a);
  const cb = sizeToCanonical(b);
  if (!ca || !cb) return false;
  if (ca.kind !== cb.kind) return false;

  // Relative tolerance — sizes are published to a few significant figures, so
  // an exact float equality would spuriously reject equal values that were
  // converted through different units.
  const eps = 1e-9 * Math.max(1, Math.abs(ca.value), Math.abs(cb.value));
  return Math.abs(ca.value - cb.value) <= eps;
}
