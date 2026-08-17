/**
 * Interconnect table (Connor's follow-up: "the schematic [should be]
 * bidirectionally convertible to an interconnect table... captures where
 * each signal goes, to and from, if directionality is defined for each
 * signal").
 *
 * This module is the Schematic -> Table half of that bidirectional sync,
 * and it's trivial by construction: the table is nothing but a derived view
 * over `doc.wires`/`doc.components`, exactly like the BOM (bom.ts) or the
 * bundle-hover tooltips in LayoutCanvas.tsx — there is no separate table
 * storage to drift out of sync, so editing the Schematic always
 * instantly "auto-populates" the table (spec §6-style derived-model
 * pattern, same as everything else in this directory).
 *
 * The Table -> Schematic half (import a CSV, or add a row in the Table pane,
 * and have the Schematic gain the connectors/cavities/wires it describes)
 * is deliberately NOT here — it's a document *mutation*, not a pure
 * derivation, so it lives at the app layer next to every other editing
 * helper (see packages/app/src/interconnectEdit.ts), the same split this
 * codebase already draws between "derive" (read-only, core) and "edit"
 * (mutates via store.transact, app).
 */

import type {
  HarnessDocument, Endpoint, InterconnectRow, SignalDirection, Component,
} from '../types.js';
import { BACKSHELL_CAVITY_ID } from '../types.js';

interface EndpointDescriptor {
  componentId?: string;
  componentRefdes: string;
  designation?: string;
  signal?: string;
  direction?: SignalDirection;
  impedanceMatched?: boolean;
}

function describeEndpoint(doc: HarnessDocument, ep: Endpoint): EndpointDescriptor {
  if (ep.kind === 'free') return { componentRefdes: '(free end)' };

  // A shield termination node belongs to a WireGroup, not a Component, so it
  // has no componentId to report — but it does have a name worth showing,
  // since "SH1 shield" in the interconnect table is exactly what tells a
  // reader that this row is the drain wire.
  if (ep.kind === 'shieldNode') {
    const group = doc.wireGroups[ep.groupId];
    return { componentRefdes: `${group?.refdes ?? ep.groupId} shield`, designation: 'SHLD' };
  }

  const component: Component | undefined = doc.components[ep.componentId];
  const componentRefdes = component?.refdes ?? ep.componentId;

  if (ep.kind === 'cavity' && component?.type === 'connector' && ep.cavityId === BACKSHELL_CAVITY_ID) {
    // Backshell termination — a real endpoint, but not one of the housing's
    // cavities, so the cavity lookup below would find nothing and report a
    // blank designation. Name it explicitly instead.
    return { componentId: ep.componentId, componentRefdes, designation: 'BS' };
  }

  if (ep.kind === 'cavity' && component?.type === 'connector') {
    const cavity = component.cavities.find((c) => c.id === ep.cavityId);
    return {
      componentId: ep.componentId, componentRefdes,
      designation: cavity?.designation, signal: cavity?.signal,
      direction: cavity?.direction, impedanceMatched: cavity?.impedanceMatched,
    };
  }
  if (ep.kind === 'cableCore' && component?.type === 'cable') {
    const all = [...component.cores, ...(component.shield ? [component.shield] : [])];
    const core = all.find((c) => c.id === ep.coreId);
    return {
      componentId: ep.componentId, componentRefdes,
      designation: core?.designation, signal: core?.signal,
      direction: core?.direction, impedanceMatched: core?.impedanceMatched,
    };
  }
  if (ep.kind === 'twoTerminalSide') {
    return { componentId: ep.componentId, componentRefdes, designation: ep.side };
  }
  // splice / terminalPoint — n-ary or single-port, no designation/signal of their own.
  return { componentId: ep.componentId, componentRefdes };
}

/** Folds two independently-authored `SignalDirection`s into one answer for
 * the pair — see InterconnectRow's doc comment (types.ts) for what each
 * outcome means. Unset/'bidirectional' on either end never conflicts. */
function resolveDirection(from?: SignalDirection, to?: SignalDirection): InterconnectRow['resolved'] {
  const f = from ?? 'bidirectional';
  const t = to ?? 'bidirectional';
  if (f === 'bidirectional' && t === 'bidirectional') return 'bidirectional';
  if (f === 'output' && t === 'output') return 'conflict';
  if (f === 'input' && t === 'input') return 'conflict';
  if (f === 'output' || t === 'input') return 'sourceToTarget';
  if (f === 'input' || t === 'output') return 'targetToSource';
  return 'bidirectional';
}

export function computeInterconnectTable(doc: HarnessDocument): InterconnectRow[] {
  const rows: InterconnectRow[] = Object.values(doc.wires).map((wire) => {
    const from = describeEndpoint(doc, wire.source);
    const to = describeEndpoint(doc, wire.target);
    return {
      wireId: wire.id,
      wireRefdes: wire.refdes,
      fromComponentId: from.componentId,
      fromComponentRefdes: from.componentRefdes,
      fromDesignation: from.designation,
      fromSignal: from.signal,
      fromDirection: from.direction,
      fromImpedanceMatched: from.impedanceMatched,
      toComponentId: to.componentId,
      toComponentRefdes: to.componentRefdes,
      toDesignation: to.designation,
      toSignal: to.signal,
      toDirection: to.direction,
      toImpedanceMatched: to.impedanceMatched,
      resolved: resolveDirection(from.direction, to.direction),
      impedanceMatched: !!(from.impedanceMatched || to.impedanceMatched),
    };
  });
  rows.sort((a, b) => a.wireRefdes.localeCompare(b.wireRefdes));
  return rows;
}
