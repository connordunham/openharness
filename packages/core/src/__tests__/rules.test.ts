import { describe, it, expect } from 'vitest';
import { computeDerivedModel } from '../derive/index.js';
import {
  doc, withEntities, connector, cavity, wire, bundle,
  cavityEndpoint, freeEndpoint,
} from './helpers.js';

function diagnosticIds(d: ReturnType<typeof doc>) {
  return computeDerivedModel(d).diagnostics.map((diag) => diag.ruleId);
}

describe('built-in DRC rules', () => {
  it('NO_ROUTE for a wire with no path through the layout', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 } }),
        connector('c2', 'C2', [cavity('b')], { layoutPosition: { x: 100, y: 0 } }),
      ],
      wires: [wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'))],
    });
    expect(diagnosticIds(d)).toContain('NO_ROUTE');
  });

  it('EMPTY_BUNDLE for a bundle with zero routed wires', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [], { layoutPosition: { x: 0, y: 0 } }),
        connector('c2', 'C2', [], { layoutPosition: { x: 100, y: 0 } }),
      ],
      bundles: [bundle('b1', 'B1', 'c1', 'c2', { length: 100 })],
    });
    expect(diagnosticIds(d)).toContain('EMPTY_BUNDLE');
  });

  it('OVERFILLED_CAVITY when two wires land in the same cavity with no splice', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 } }),
        connector('c2', 'C2', [cavity('b')], { layoutPosition: { x: 100, y: 0 } }),
        connector('c3', 'C3', [cavity('c')], { layoutPosition: { x: 200, y: 0 } }),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b')),
        wire('w2', 'W2', cavityEndpoint('c1', 'a'), cavityEndpoint('c3', 'c')), // c1.a used twice
      ],
    });
    expect(diagnosticIds(d)).toContain('OVERFILLED_CAVITY');
  });

  it('DUPLICATE_REFDES when two components share a refdes', () => {
    const d = withEntities(doc(), {
      components: [connector('c1', 'C1', []), connector('c2', 'C1', [])],
    });
    expect(diagnosticIds(d)).toContain('DUPLICATE_REFDES');
  });

  it('FLOATING_WIRE for an unterminated wire end', () => {
    const d = withEntities(doc(), {
      components: [connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 } })],
      wires: [wire('w1', 'W1', cavityEndpoint('c1', 'a'), freeEndpoint())],
    });
    expect(diagnosticIds(d)).toContain('FLOATING_WIRE');
  });

  it('NET_SIGNAL_CONFLICT when a net has two different explicit signal names', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a', { signal: 'foo' })]),
        connector('c2', 'C2', [cavity('b', { signal: 'bar' })]),
      ],
      wires: [wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'))],
    });
    expect(diagnosticIds(d)).toContain('NET_SIGNAL_CONFLICT');
  });

  it('MISSING_PART for a component with no partId', () => {
    const d = withEntities(doc(), { components: [connector('c1', 'C1', [])] });
    expect(diagnosticIds(d)).toContain('MISSING_PART');
  });

  it('a fully-specified, fully-routed document has no diagnostics', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 }, partId: 'p1' }),
        connector('c2', 'C2', [cavity('b')], { layoutPosition: { x: 100, y: 0 }, partId: 'p1' }),
      ],
      wires: [wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'), { partId: 'pw' })],
      bundles: [bundle('b1', 'B1', 'c1', 'c2', { length: 100 })],
    });
    d.parts['p1'] = {
      id: 'p1', kind: 'connector', numberOfCavities: 1,
      designationTemplate: { kind: 'numbers' }, configurations: [], custom: {},
    };
    d.parts['pw'] = { id: 'pw', kind: 'wire', gauge: { value: 0.5, unit: 'mm2' }, custom: {} };

    expect(computeDerivedModel(d).diagnostics).toEqual([]);
  });

  it('BOM/diagnostics/nets order is deterministic — independent of object key insertion order', () => {
    // Two documents with identical content but components/wires inserted in
    // a different order (simulating, e.g., one loaded fresh vs. one
    // round-tripped through .ohd's alphabetically-sorted serialisation —
    // see packages/io's ohdFormat.test.ts, which is what surfaced this).
    const build = (order: 'forward' | 'reverse') => {
      const components = [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 }, partId: 'p1' }),
        connector('c2', 'C2', [cavity('b')], { layoutPosition: { x: 100, y: 0 }, partId: 'p1' }),
      ];
      const wires = [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), freeEndpoint()),
        wire('w2', 'W2', cavityEndpoint('c2', 'b'), freeEndpoint()),
      ];
      const d = doc();
      for (const c of order === 'forward' ? components : [...components].reverse()) d.components[c.id] = c;
      for (const w of order === 'forward' ? wires : [...wires].reverse()) d.wires[w.id] = w;
      d.parts['p1'] = {
        id: 'p1', kind: 'connector', numberOfCavities: 1,
        designationTemplate: { kind: 'numbers' }, configurations: [], custom: {},
      };
      return d;
    };

    const forward = computeDerivedModel(build('forward'));
    const reverse = computeDerivedModel(build('reverse'));
    expect(forward.bom).toEqual(reverse.bom);
    expect(forward.diagnostics).toEqual(reverse.diagnostics);
    expect(forward.nets).toEqual(reverse.nets);
  });
});
