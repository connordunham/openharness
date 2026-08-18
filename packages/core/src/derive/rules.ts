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

import type { HarnessDocument, Diagnostic, Net, RouteResult, BomLine } from '../types.js';
import { BACKSHELL_CAVITY_ID } from '../types.js';
import type { WireId, BundleId } from '../ids.js';
import { resolveComponentHost } from './routing.js';

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
    ...missingPart(inputs),
    ...duplicateRefdes(inputs),
    ...floatingWire(inputs),
    ...netSignalConflict(inputs),
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
 * REAL-DATA FINDING (from running this against `_reference_harness_export.json`
 * via the CLI, not caught by any hand-built test): this rule fires on that
 * real user document — connector "ZWfYpO" has two wires landing on each of
 * its two cavities with no splice between them, which reads as the user
 * using a 2-cavity connector as an in-line jumper/pass-through rather than a
 * true termination. That might be a legitimate pattern in the source tool (some
 * real-world builds do land two wires in one crimp) rather than an actual
 * error, and there's no evidence either way — the review document (R2)
 * already flagged that these DRC rules are "plausible engineering concerns,
 * not matching the original's actual guardrails." Left as `error` rather
 * than downgraded, since getting it wrong loud (a false-positive error you
 * can see and dismiss) is safer than getting it wrong quiet (a real crimp
 * problem silently passing as a warning) — but this is exactly the kind of
 * thing worth checking against the live app's own validation UI next time
 * it's open, rather than guessing further from here.
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
