import { describe, it, expect } from 'vitest';
import {
  computeDerivedModel, createEmptyDocument, totalComponentParasitics,
  type Connector, type Wire, type WirePart, type Bundle,
} from '../index.js';
/**
 * Two connectors 1000 mm apart on one bundle, wired pin-to-pin. The point of
 * building a real routed document rather than stubbing a length is that the
 * unit conversion (integer µm → the document's length unit) is exactly the
 * part that's easy to get wrong by three orders of magnitude, and only a
 * real route exercises it.
 */
function routedDoc() {
  const doc = createEmptyDocument('P');
  const mk = (id: string, refdes: string, x: number): Connector => ({
    id, type: 'connector', refdes,
    cavities: [{ id: `${id}-1`, designation: '1', custom: {} }],
    schematicPosition: { x, y: 0 },
    layoutPosition: { x, y: 0 },
    custom: {},
  });
  doc.components['c1'] = mk('c1', 'C1', 0);
  doc.components['c2'] = mk('c2', 'C2', 1000);
  const bundle: Bundle = { id: 'b1', refdes: 'B1', sourceId: 'c1', targetId: 'c2', length: 1000, custom: {} };
  doc.bundles['b1'] = bundle;
  const wire: Wire = {
    id: 'w1', refdes: 'W1', color: 'Red', custom: {},
    source: { kind: 'cavity', componentId: 'c1', cavityId: 'c1-1' },
    target: { kind: 'cavity', componentId: 'c2', cavityId: 'c2-1' },
  };
  doc.wires['w1'] = wire;
  return doc;
}

describe('computeWireParasitics', () => {
  it('multiplies the wire part per-length figures by the routed length in the document unit', () => {
    const doc = routedDoc();
    const part: WirePart = {
      id: 'p1', kind: 'wire', gauge: { value: 0.5, unit: 'mm2' }, custom: {},
      // 0.0001 Ω/mm over 1000 mm = 0.1 Ω; 1e-13 F/mm over 1000 mm = 1e-10 F.
      resistancePerLength: 0.0001,
      capacitancePerLength: 1e-13,
    };
    doc.parts['p1'] = part;
    doc.wires['w1']!.partId = 'p1';

    const derived = computeDerivedModel(doc);
    const par = derived.wireParasitics.get('w1')!;

    expect(par.lengthKnown).toBe(true);
    expect(par.resistanceOhms).toBeCloseTo(0.1, 10);
    expect(par.capacitanceFarads).toBeCloseTo(1e-10, 20);
  });

  it('reports zeros with lengthKnown: false when the wire has no route', () => {
    // The distinction matters: 0 Ω on an unrouted wire would read as "ideal
    // conductor" rather than "we don't know yet".
    const doc = routedDoc();
    delete doc.bundles['b1'];
    doc.parts['p1'] = {
      id: 'p1', kind: 'wire', gauge: { value: 0.5, unit: 'mm2' }, custom: {}, resistancePerLength: 1,
    } as WirePart;
    doc.wires['w1']!.partId = 'p1';

    const par = computeDerivedModel(doc).wireParasitics.get('w1')!;

    expect(par.lengthKnown).toBe(false);
    expect(par.resistanceOhms).toBe(0);
  });

  it('yields zeros for a wire with no part, without throwing', () => {
    const par = computeDerivedModel(routedDoc()).wireParasitics.get('w1')!;
    expect(par).toEqual({ resistanceOhms: 0, capacitanceFarads: 0, lengthKnown: true });
  });

  it('gives every wire an entry, so callers never have to null-check the map', () => {
    const doc = routedDoc();
    expect([...computeDerivedModel(doc).wireParasitics.keys()]).toEqual(Object.keys(doc.wires));
  });
});

describe('totalComponentParasitics', () => {
  it('sums authored component parasitics and counts only characterised components', () => {
    const doc = routedDoc();
    doc.components['c1']!.parasitics = { resistanceOhms: 0.01, inductanceHenries: 1e-9 };
    doc.components['c2']!.parasitics = { resistanceOhms: 0.02 };

    const total = totalComponentParasitics(doc);

    expect(total.resistanceOhms).toBeCloseTo(0.03, 12);
    expect(total.inductanceHenries).toBeCloseTo(1e-9, 15);
    expect(total.capacitanceFarads).toBe(0);
    expect(total.componentCount).toBe(2);
  });

  it('ignores a component whose parasitics object exists but is entirely blank', () => {
    // An empty object is what a Properties panel leaves behind if every
    // field is cleared; counting it would overstate how much of the harness
    // has actually been characterised.
    const doc = routedDoc();
    doc.components['c1']!.parasitics = {};

    expect(totalComponentParasitics(doc).componentCount).toBe(0);
  });
});
