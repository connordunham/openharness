import { describe, it, expect } from 'vitest';
import { computeRoutes } from '../derive/routing.js';
import { computeLengths } from '../derive/length.js';
import { computeBom } from '../derive/bom.js';
import { doc, withEntities, connector, cavity, wire, bundle, cavityEndpoint } from './helpers.js';
import type { ConnectorPart, WirePart } from '../types.js';

function bomFor(d: ReturnType<typeof doc>) {
  return computeBom(d, computeLengths(d, computeRoutes(d)));
}

describe('computeBom', () => {
  it('produces one line per connector part, grouped and counted across instances', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [], { partId: 'p-conn' }),
        connector('c2', 'C2', [], { partId: 'p-conn' }),
      ],
    });
    d.parts['p-conn'] = {
      id: 'p-conn', kind: 'connector', partNumber: 'MX-1', manufacturer: 'Molex',
      numberOfCavities: 0, designationTemplate: { kind: 'numbers' }, configurations: [],
      custom: {}, price: 2.5,
    } as ConnectorPart;

    const bom = bomFor(d);
    const line = bom.find((l) => l.partId === 'p-conn')!;
    expect(line.quantity).toBe(2);
    expect(line.refdes).toEqual(['C1', 'C2']);
    expect(line.extendedPrice).toBe(5);
  });

  it('a component with no part assigned produces an "unassigned" warning line', () => {
    const d = withEntities(doc(), { components: [connector('c1', 'C1', [])] });
    const bom = bomFor(d);
    const line = bom.find((l) => l.refdes.includes('C1'))!;
    expect(line.partId).toBeUndefined();
    expect(line.warnings).toContain('no part assigned');
  });

  it('sums wire length in the document length unit, grouped by wire part', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 } }),
        connector('c2', 'C2', [cavity('b')], { layoutPosition: { x: 100, y: 0 } }),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'), { partId: 'p-wire' }),
      ],
      bundles: [bundle('b1', 'B1', 'c1', 'c2', { length: 250 })],
    });
    d.parts['p-wire'] = {
      id: 'p-wire', kind: 'wire', gauge: { value: 0.5, unit: 'mm2' }, custom: {},
    } as WirePart;

    const bom = bomFor(d);
    const line = bom.find((l) => l.partId === 'p-wire')!;
    expect(line.quantity).toBe(250);
    expect(line.unit).toBe('mm');
  });

  it('excludes NO_ROUTE wire length from the BOM quantity but still reports it', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 } }),
        connector('c2', 'C2', [cavity('b')], { layoutPosition: { x: 100, y: 0 } }),
      ],
      wires: [wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'), { partId: 'p-wire' })],
      // no bundle -> noRoute
    });
    d.parts['p-wire'] = { id: 'p-wire', kind: 'wire', gauge: { value: 0.5, unit: 'mm2' }, custom: {} } as WirePart;

    const bom = bomFor(d);
    const line = bom.find((l) => l.partId === 'p-wire')!;
    expect(line.quantity).toBe(0);
    expect(line.warnings).toContain('no route — length excluded from total');
  });

  it('excludes a component flagged excludeFromBom', () => {
    const d = withEntities(doc(), {
      components: [connector('c1', 'C1', [], { partId: 'p1', excludeFromBom: true })],
    });
    expect(bomFor(d)).toHaveLength(0);
  });
});
