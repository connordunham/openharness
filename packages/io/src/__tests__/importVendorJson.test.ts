import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeDerivedModel } from '@openharness/core';
import { importVendorJson } from '../importVendorJson.js';
import type { RawHarnessDocument } from '../vendorRawFormat.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): RawHarnessDocument {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8'));
}

describe('importVendorJson — real reference export', () => {
  const raw = loadFixture('reference-harness.json');
  const { document: doc, report } = importVendorJson(raw, 'Reference Harness');

  it('produces no warnings on a well-formed real export', () => {
    expect(report.warnings).toEqual([]);
  });

  it('imports every connector, splice, and resistor with a synthesised refdes', () => {
    const connectors = Object.values(doc.components).filter((c) => c.type === 'connector');
    const splices = Object.values(doc.components).filter((c) => c.type === 'splice');
    const resistors = Object.values(doc.components).filter((c) => c.type === 'resistor');
    expect(connectors).toHaveLength(3);
    expect(splices).toHaveLength(1);
    expect(resistors).toHaveLength(1);
    expect(connectors.map((c) => c.refdes).sort()).toEqual(['C1', 'C2', 'C3']);
  });

  it('flattens twistedWires into top-level wires with a twistGroupId', () => {
    const twisted = Object.values(doc.wires).filter((w) => w.twistGroupId === 'aZffdH');
    expect(twisted).toHaveLength(2);
  });

  it('resolves the "Splice" magic handle to a splice endpoint', () => {
    const spliceWire = doc.wires['M0ImL7'];
    expect(spliceWire?.target).toEqual({ kind: 'splice', componentId: 'YXRkBA' });
  });

  it('resolves the "Right" magic handle to a twoTerminalSide endpoint on the resistor', () => {
    const resistorWire = doc.wires['gFmdpt'];
    expect(resistorWire?.source).toEqual({ kind: 'twoTerminalSide', componentId: 'wuPGQg', side: 'Right' });
  });

  it('resolves an ordinary handle to a cavity endpoint', () => {
    const wire = doc.wires['mwFnjo'];
    expect(wire?.source).toEqual({ kind: 'cavity', componentId: 'Lznc2V', cavityId: 'p-IS2b' });
    expect(wire?.target).toEqual({ kind: 'cavity', componentId: 'gjuazh', cavityId: 'nDk1xl' });
  });

  it('imports the connector part with its configuration', () => {
    const part = doc.parts['tjU7wROfiqJTnS2LJStUw'];
    expect(part?.kind).toBe('connector');
    if (part?.kind === 'connector') {
      expect(part.partNumber).toBe('501646120');
      expect(part.configurations).toHaveLength(1);
    }
  });

  it('carries the global signal through to net extraction — the derived model runs end to end on real data', () => {
    const derived = computeDerivedModel(doc);
    // haEYec (global: true, signal: "sddsfgshg") is a singleton — nothing
    // else in this document shares that signal — so it's still its own net,
    // but net extraction should not throw and should preserve the signal.
    const net = derived.nets.find((n) => n.memberIds.includes('cavity:Lznc2V:haEYec'));
    expect(net?.signal).toBe('sddsfgshg');
    // The whole derive pipeline (routing/length/BOM/diagnostics) should run
    // without throwing on real, evidence-based data.
    expect(derived.diagnostics).toBeInstanceOf(Array);
  });
});

describe('importVendorJson — kitchen-sink export', () => {
  const raw = loadFixture('kitchen-sink.json');
  const { document: doc, report } = importVendorJson(raw, 'Kitchen Sink');

  it('produces no warnings on a well-formed synthetic export', () => {
    expect(report.warnings).toEqual([]);
  });

  it('imports the cable with cores and shield, shield designation synthesised as SHIELD', () => {
    const cable = Object.values(doc.components).find((c) => c.type === 'cable');
    expect(cable?.type).toBe('cable');
    if (cable?.type === 'cable') {
      expect(cable.cores).toHaveLength(2);
      expect(cable.shield?.id).toBe('8U5vCT');
      expect(cable.shield?.designation).toBe('SHIELD');
    }
  });

  it('imports the terminal with its terminalKind mapped from the PascalCase source type', () => {
    const terminal = Object.values(doc.components).find((c) => c.type === 'terminal');
    expect(terminal?.type).toBe('terminal');
    if (terminal?.type === 'terminal') expect(terminal.terminalKind).toBe('ring');
  });

  it('imports the branch point as layout-only (no schematicPosition)', () => {
    const branchPoint = Object.values(doc.components).find((c) => c.type === 'branchPoint');
    expect(branchPoint?.layoutPosition).toEqual({ x: 210, y: 450 });
    expect(branchPoint?.schematicPosition).toBeUndefined();
  });

  it('imports the schematic note', () => {
    expect(Object.values(doc.notes)).toHaveLength(1);
    expect(Object.values(doc.notes)[0]?.text).toBe('Kitchen sink test note');
  });

  it('carries coveringIds across on the connector unchanged', () => {
    const connector = Object.values(doc.components).find((c) => c.type === 'connector');
    expect(connector?.coveringIds).toEqual(['pKkzjEdd7TVUvddJ31uLc']);
  });

  it('imports the covering part with its coveringType mapped from the PascalCase source type', () => {
    const part = doc.parts['pKkzjEdd7TVUvddJ31uLc'];
    expect(part?.kind).toBe('covering');
    if (part?.kind === 'covering') expect(part.coveringType).toBe('heatShrink');
  });

  it('the derive pipeline runs end to end without throwing', () => {
    expect(() => computeDerivedModel(doc)).not.toThrow();
  });
});
