import { describe, it, expect } from 'vitest';
import {
  computeDerivedModel, createEmptyDocument, BACKSHELL_CAVITY_ID, DEFAULT_EXIT_STUB,
  type Connector, type Wire, type WireGroup, type ShieldPart,
} from '../index.js';

function shieldedDoc(): ReturnType<typeof createEmptyDocument> {
  const doc = createEmptyDocument('SH');
  const mk = (id: string, refdes: string, x: number): Connector => ({
    id, type: 'connector', refdes,
    cavities: [
      { id: `${id}-1`, designation: '1', custom: {} },
      { id: `${id}-2`, designation: '2', custom: {} },
    ],
    schematicPosition: { x, y: 0 }, layoutPosition: { x, y: 0 }, custom: {},
  });
  doc.components['c1'] = mk('c1', 'C1', 0);
  doc.components['c2'] = mk('c2', 'C2', 500);
  doc.bundles['b1'] = { id: 'b1', refdes: 'B1', sourceId: 'c1', targetId: 'c2', length: 500, custom: {} };
  for (const i of [1, 2]) {
    const wire: Wire = {
      id: `w${i}`, refdes: `W${i}`, color: 'Red', custom: {}, twistGroupId: 'g1',
      source: { kind: 'cavity', componentId: 'c1', cavityId: `c1-${i}` },
      target: { kind: 'cavity', componentId: 'c2', cavityId: `c2-${i}` },
    };
    doc.wires[wire.id] = wire;
  }
  const shieldPart: ShieldPart = { id: 'sp', kind: 'shield', shieldType: 'braid', partNumber: 'BRD-1', custom: {} };
  doc.parts['sp'] = shieldPart;
  const group: WireGroup = {
    id: 'g1', kind: 'twist', refdes: 'SH1', twisted: true,
    memberWireIds: ['w1', 'w2'], memberGroupIds: [],
    shield: { partId: 'sp' }, custom: {},
  };
  doc.wireGroups['g1'] = group;
  return doc;
}

const shieldLine = (doc: ReturnType<typeof createEmptyDocument>) =>
  computeDerivedModel(doc).bom.find((l) => l.partId === 'sp');

describe('shield model and the BOM', () => {
  it('rolls a standalone-part shield up as its own BOM line', () => {
    const doc = shieldedDoc();
    expect(shieldLine(doc)?.quantity).toBe(1);
  });

  it('treats an unset model as standalonePart, so nothing changes for old documents', () => {
    const doc = shieldedDoc();
    doc.wireGroups['g1']!.shield!.model = undefined;
    expect(shieldLine(doc)).toBeDefined();
  });

  it('suppresses the BOM line for an IPC-620 wire+termination shield', () => {
    // IPC/WHMA-A-620 documents the braid against the conductor, not as a
    // separate purchased item — emitting a line anyway would put a phantom
    // part on a purchase order.
    const doc = shieldedDoc();
    doc.wireGroups['g1']!.shield!.model = 'ipc620WireTermination';
    expect(shieldLine(doc)).toBeUndefined();
  });

  it('suppresses the BOM line for a custom-modelled shield', () => {
    const doc = shieldedDoc();
    doc.wireGroups['g1']!.shield!.model = 'custom';
    expect(shieldLine(doc)).toBeUndefined();
  });

  it('does not emit an "(unassigned)" line in place of a suppressed shield', () => {
    // The failure mode worth guarding: skipping the part id but still
    // calling add() would produce a mystery unassigned row.
    const doc = shieldedDoc();
    doc.wireGroups['g1']!.shield!.model = 'custom';
    const bom = computeDerivedModel(doc).bom;
    expect(bom.some((l) => l.refdes.includes('SH1'))).toBe(false);
  });

  it('carries a part’s parameter list through to its BOM line', () => {
    const doc = shieldedDoc();
    (doc.parts['sp'] as ShieldPart).parameters = [
      { id: 'q', name: 'Coverage', qualifier: 'min', value: 85, unit: '%' },
    ];
    expect(shieldLine(doc)?.parameters).toEqual([
      { id: 'q', name: 'Coverage', qualifier: 'min', value: 85, unit: '%' },
    ]);
  });
});

describe('shield termination nodes in the electrical graph', () => {
  function withDrain(): ReturnType<typeof createEmptyDocument> {
    const doc = shieldedDoc();
    doc.wireGroups['g1']!.shield!.terminationNode = true;
    const drain: Wire = {
      id: 'drain', refdes: 'DRAIN', color: 'Green', custom: {},
      source: { kind: 'shieldNode', groupId: 'g1' },
      target: { kind: 'cavity', componentId: 'c2', cavityId: 'c2-2' },
    };
    doc.wires['drain'] = drain;
    return doc;
  }

  it('puts the shield node and whatever it grounds to on one net', () => {
    const nets = computeDerivedModel(withDrain()).nets;
    const net = nets.find((n) => n.memberIds.includes('shieldNode:g1'))!;
    expect(net.memberIds).toContain('cavity:c2:c2-2');
  });

  it('gives an unwired shield node its own singleton net rather than no net at all', () => {
    const doc = shieldedDoc();
    doc.wireGroups['g1']!.shield!.terminationNode = true;
    const nets = computeDerivedModel(doc).nets;
    expect(nets.some((n) => n.memberIds.includes('shieldNode:g1'))).toBe(true);
  });

  it('registers no vertex for a shield that has not asked for a node', () => {
    const nets = computeDerivedModel(shieldedDoc()).nets;
    expect(nets.some((n) => n.memberIds.includes('shieldNode:g1'))).toBe(false);
  });

  it('routes a drain wire as a shield short-circuit, never as noRoute', () => {
    // A drain runs alongside the wires it shields; it has no independent
    // path through the bundle graph, and reporting noRoute would surface a
    // DRC error for a perfectly correct harness.
    const route = computeDerivedModel(withDrain()).wireRoutes.get('drain')!;
    expect(route.status).toBe('shield');
    expect(route.segments).toEqual([]);
  });

  it('names the shield end in the interconnect table instead of leaving it blank', () => {
    const row = computeDerivedModel(withDrain()).interconnect.find((r) => r.wireId === 'drain')!;
    expect(row.fromComponentRefdes).toBe('SH1 shield');
    expect(row.fromDesignation).toBe('SHLD');
  });

  it('produces no NO_ROUTE diagnostic for the drain', () => {
    const diags = computeDerivedModel(withDrain()).diagnostics;
    expect(diags.some((d) => d.ruleId === 'NO_ROUTE' && d.targets.some((t) => t.id === 'drain'))).toBe(false);
  });
});

describe('backshell terminations and the overfilled-cavity rule', () => {
  it('does not flag several wires landing on one backshell', () => {
    // A backshell legitimately takes multiple drain wires and ground straps
    // at once — it is not a crimp cavity.
    const doc = shieldedDoc();
    (doc.components['c1'] as Connector).backshellTermination = true;
    // Free far ends, so the only shared endpoint in this document is the
    // backshell itself — otherwise the rule would fire on the cavity at the
    // other end and the test would pass or fail for the wrong reason.
    for (const i of [1, 2]) {
      doc.wires[`bs${i}`] = {
        id: `bs${i}`, refdes: `BS${i}`, color: 'Green', custom: {},
        source: { kind: 'cavity', componentId: 'c1', cavityId: BACKSHELL_CAVITY_ID },
        target: { kind: 'free', point: { x: 900, y: i * 40 } },
      };
    }
    const diags = computeDerivedModel(doc).diagnostics;
    expect(diags.some((d) => d.ruleId === 'OVERFILLED_CAVITY')).toBe(false);
  });

  it('still flags two wires sharing a real cavity', () => {
    // The exemption must be narrow — it would be easy to skip the whole
    // rule rather than just the backshell id.
    const doc = shieldedDoc();
    doc.wires['extra'] = {
      id: 'extra', refdes: 'WX', color: 'Blue', custom: {},
      source: { kind: 'cavity', componentId: 'c1', cavityId: 'c1-1' },
      target: { kind: 'cavity', componentId: 'c2', cavityId: 'c2-2' },
    };
    const diags = computeDerivedModel(doc).diagnostics;
    expect(diags.some((d) => d.ruleId === 'OVERFILLED_CAVITY')).toBe(true);
  });

  it('names the backshell end BS in the interconnect table', () => {
    const doc = shieldedDoc();
    (doc.components['c1'] as Connector).backshellTermination = true;
    doc.wires['bs'] = {
      id: 'bs', refdes: 'BSW', color: 'Green', custom: {},
      source: { kind: 'cavity', componentId: 'c1', cavityId: BACKSHELL_CAVITY_ID },
      target: { kind: 'cavity', componentId: 'c2', cavityId: 'c2-1' },
    };
    const row = computeDerivedModel(doc).interconnect.find((r) => r.wireId === 'bs')!;
    expect(row.fromDesignation).toBe('BS');
    expect(row.fromComponentRefdes).toBe('C1');
  });
});

describe('document defaults', () => {
  it('states the new settings explicitly on a fresh document', () => {
    const doc = createEmptyDocument('D');
    expect(doc.settings.twistedPairStyle).toBe('ieee315');
    expect(doc.settings.showParasitics).toBe(false);
    expect(doc.settings.schematicExitStub).toBe(DEFAULT_EXIT_STUB);
  });
});
