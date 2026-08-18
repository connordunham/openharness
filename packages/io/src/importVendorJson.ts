/**
 * Import a vendor wire-format (v0.8) export into an OpenHarness
 * document (spec §11). Every step below is numbered to match the migration
 * steps listed in HARNESS-DESIGNER-SPEC.md §11.
 */

import {
  createEmptyDocument,
  type HarnessDocument, type Connector, type Splice, type Terminal,
  type BranchPoint, type TwoTerminal, type Cable, type Wire, type Bundle, type Note,
  type Endpoint, type Cavity, type TerminalKind, type ConnectorPart, type ResistorPart,
  type CoveringPart,
} from '@openharness/core';
import type {
  RawHarnessDocument, RawEndpoint, RawWire, RawCable,
} from './vendorRawFormat.js';

export interface ImportReport {
  warnings: string[];
}

export interface ImportResult {
  document: HarnessDocument;
  report: ImportReport;
}

const TERMINAL_KIND_MAP: Record<string, TerminalKind> = {
  Ferrule: 'ferrule',
  Ring: 'ring',
  Spade: 'spade',
  MaleQuickConnect: 'maleQuickConnect',
  FemaleQuickConnect: 'femaleQuickConnect',
  LooseWireEnd: 'looseWireEnd',
};

const COVERING_TYPE_MAP: Record<string, CoveringPart['coveringType']> = {
  HeatShrink: 'heatShrink',
  Tape: 'tape',
  CorrugatedTubing: 'corrugatedTubing',
  SpiralWrap: 'spiralWrap',
  Tubing: 'tubing',
  BraidedSleeve: 'braidedSleeve',
};

export function importVendorJson(raw: RawHarnessDocument, name = 'Imported Harness'): ImportResult {
  const warnings: string[] = [];
  const doc = createEmptyDocument(name);
  doc.settings.lengthUnit = (raw.lengthUnit as HarnessDocument['settings']['lengthUnit']) ?? 'mm';

  if (raw.version !== 0.8) {
    warnings.push(`Unrecognised format version ${raw.version} (expected 0.8) — attempting import anyway.`);
  }

  // 2. Flatten per-type arrays into `components`, adding `type` + synthesised refdes (step 5).
  type RawComponentKind = 'connector' | 'splice' | 'terminal' | 'cable' | 'resistor';
  const kindByRawId = new Map<string, RawComponentKind>();
  const cablesByRawId = new Map<string, RawCable>();

  let connectorN = 0, spliceN = 0, terminalN = 0, resistorN = 0, cableN = 0, branchN = 0, wireN = 0, bundleN = 0;

  for (const rc of raw.connectors ?? []) {
    connectorN += 1;
    kindByRawId.set(rc.id, 'connector');
    const cavities: Cavity[] = rc.cavities.map((rcav, index) => ({
      id: rcav.id,
      // 6. Synthesise designation: no designation field in the source format — 1-based index.
      designation: String(index + 1),
      signal: rcav.signal,
      global: rcav.global,
      custom: {},
    }));
    const connector: Connector = {
      id: rc.id,
      type: 'connector',
      refdes: `${doc.settings.refdesPrefixes.connector ?? 'C'}${connectorN}`,
      label: rc.label,
      partId: rc.partId,
      cavities,
      layoutPosition: toPoint(rc.layoutPosition),
      schematicPosition: toPoint(rc.schematicPosition),
      // 7. coveringIds move across directly — same structural shape.
      coveringIds: rc.coveringIds,
      custom: {},
    };
    doc.components[connector.id] = connector;
  }

  for (const rs of raw.splices ?? []) {
    spliceN += 1;
    kindByRawId.set(rs.id, 'splice');
    const splice: Splice = {
      id: rs.id,
      type: 'splice',
      refdes: `${doc.settings.refdesPrefixes.splice ?? 'S'}${spliceN}`,
      layoutPosition: toPoint(rs.layoutPosition),
      schematicPosition: toPoint(rs.schematicPosition),
      custom: {},
    };
    doc.components[splice.id] = splice;
  }

  for (const rr of raw.resistors ?? []) {
    resistorN += 1;
    kindByRawId.set(rr.id, 'resistor');
    const resistor: TwoTerminal = {
      id: rr.id,
      type: 'resistor',
      refdes: `${doc.settings.refdesPrefixes.resistor ?? 'R'}${resistorN}`,
      partId: rr.partId,
      layoutPosition: toPoint(rr.layoutPosition),
      schematicPosition: toPoint(rr.schematicPosition),
      custom: {},
    };
    doc.components[resistor.id] = resistor;
  }

  for (const rt of raw.terminals ?? []) {
    terminalN += 1;
    kindByRawId.set(rt.id, 'terminal');
    const kind = TERMINAL_KIND_MAP[rt.type];
    if (!kind) warnings.push(`Terminal ${rt.id}: unrecognised terminal type "${rt.type}", defaulting to "ring".`);
    const terminal: Terminal = {
      id: rt.id,
      type: 'terminal',
      refdes: `${doc.settings.refdesPrefixes.terminal ?? 'T'}${terminalN}`,
      terminalKind: kind ?? 'ring',
      layoutPosition: toPoint(rt.layoutPosition),
      schematicPosition: toPoint(rt.schematicPosition),
      custom: {},
    };
    doc.components[terminal.id] = terminal;
  }

  for (const rcable of raw.cables ?? []) {
    cableN += 1;
    kindByRawId.set(rcable.id, 'cable');
    cablesByRawId.set(rcable.id, rcable);
    const cable: Cable = {
      id: rcable.id,
      type: 'cable',
      refdes: `${doc.settings.refdesPrefixes.cable ?? 'CB'}${cableN}`,
      partId: rcable.partId,
      schematicPosition: toPoint(rcable.schematicPosition),
      cores: rcable.cores.map((c) => ({ id: c.id, color: c.color, signal: c.signal })),
      shield: rcable.shield ? { id: rcable.shield.id, color: rcable.shield.color, signal: rcable.shield.signal, designation: 'SHIELD' } : undefined,
      custom: {},
    };
    doc.components[cable.id] = cable;
  }

  for (const rb of raw.branchPoints ?? []) {
    branchN += 1;
    const branchPoint: BranchPoint = {
      id: rb.id,
      type: 'branchPoint',
      refdes: `${doc.settings.refdesPrefixes.branchPoint ?? 'B'}${branchN}`,
      layoutPosition: toPoint(rb.layoutPosition),
      custom: {},
    };
    doc.components[branchPoint.id] = branchPoint;
  }

  for (const rn of raw.schematicNotes ?? []) {
    const note: Note = { id: rn.id, schematicPosition: toPoint(rn.schematicPosition)!, text: rn.text };
    doc.notes[note.id] = note;
  }

  // 3. Flatten twistedWires[].wires into top-level wires, tagging twistGroupId.
  const flattenedWires: { raw: RawWire; twistGroupId?: string }[] = [
    ...(raw.wires ?? []).map((w) => ({ raw: w })),
    ...(raw.twistedWires ?? []).flatMap((tw) => tw.wires.map((w) => ({ raw: w, twistGroupId: tw.id }))),
  ];

  for (const { raw: rw, twistGroupId } of flattenedWires) {
    wireN += 1;
    const source = resolveEndpoint(rw.source, kindByRawId, cablesByRawId, warnings);
    const target = resolveEndpoint(rw.target, kindByRawId, cablesByRawId, warnings);
    const wire: Wire = {
      id: rw.id,
      refdes: `W${wireN}`,
      source,
      target,
      color: rw.color,
      stripeColor: rw.stripeColor,
      twistGroupId,
      custom: {},
    };
    doc.wires[wire.id] = wire;
  }

  for (const rBundle of raw.bundles ?? []) {
    bundleN += 1;
    const bundle: Bundle = {
      id: rBundle.id,
      refdes: `B${bundleN}`,
      sourceId: rBundle.sourceId,
      targetId: rBundle.targetId,
      length: rBundle.length,
      custom: {},
    };
    doc.bundles[bundle.id] = bundle;
  }

  // 8. Parts: connectorParts / resistorParts / coveringParts -> `parts`, tagged with `kind`.
  for (const rp of raw.connectorParts ?? []) {
    const part: ConnectorPart = {
      id: rp.id,
      kind: 'connector',
      partNumber: rp.partNumber,
      manufacturer: rp.manufacturer,
      numberOfCavities: rp.numberOfCavities ?? 0,
      designationTemplate: { kind: 'numbers' },
      configurations: (rp.configurations ?? []).map((c) => ({ id: c.id, name: c.name ?? 'Default' })),
      custom: {},
    };
    doc.parts[part.id] = part;
  }

  for (const rp of raw.resistorParts ?? []) {
    const part: ResistorPart = { id: rp.id, kind: 'resistor', partNumber: rp.partNumber, manufacturer: rp.manufacturer, custom: {} };
    doc.parts[part.id] = part;
  }

  for (const rp of raw.coveringParts ?? []) {
    const coveringType = COVERING_TYPE_MAP[rp.type];
    if (!coveringType) warnings.push(`Covering part ${rp.id}: unrecognised covering type "${rp.type}", defaulting to "heatShrink".`);
    const part: CoveringPart = {
      id: rp.id,
      kind: 'covering',
      coveringType: coveringType ?? 'heatShrink',
      partNumber: rp.partNumber,
      manufacturer: rp.manufacturer,
      custom: {},
    };
    doc.parts[part.id] = part;
  }

  // 9. Anything with no home gets a warning rather than silently vanishing.
  if (Object.keys(doc.components).length === 0 && Object.keys(doc.wires).length === 0) {
    warnings.push('Document produced no components and no wires — check that the input has the expected top-level arrays.');
  }

  return { document: doc, report: { warnings } };
}

function toPoint(p?: { x: number; y: number }): { x: number; y: number } | undefined {
  return p ? { x: p.x, y: p.y } : undefined;
}

/**
 * 4. Endpoint conversion: `{id, handle}` -> tagged `Endpoint`.
 *   - handle "Splice" -> splice
 *   - handle "Left"/"Right" -> twoTerminalSide
 *   - otherwise: handle is a cavity/core id — resolved by looking up what
 *     kind of component `id` refers to (connector cavity, cable core/shield,
 *     or terminal point).
 */
function resolveEndpoint(
  raw: RawEndpoint,
  kindByRawId: Map<string, 'connector' | 'splice' | 'terminal' | 'cable' | 'resistor'>,
  cablesByRawId: Map<string, RawCable>,
  warnings: string[],
): Endpoint {
  if (raw.handle === 'Splice') return { kind: 'splice', componentId: raw.id };
  if (raw.handle === 'Left' || raw.handle === 'Right') {
    return { kind: 'twoTerminalSide', componentId: raw.id, side: raw.handle };
  }

  const kind = kindByRawId.get(raw.id);
  if (kind === 'cable') {
    return { kind: 'cableCore', componentId: raw.id, coreId: raw.handle };
  }
  if (kind === 'terminal') {
    return { kind: 'terminalPoint', componentId: raw.id };
  }
  if (kind === undefined) {
    warnings.push(`Wire endpoint references unknown component id "${raw.id}" — assuming a connector cavity.`);
  }
  return { kind: 'cavity', componentId: raw.id, cavityId: raw.handle };
}
