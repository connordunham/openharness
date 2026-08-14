import { describe, it, expect } from 'vitest';
import { computeRoutes } from '../derive/routing.js';
import { computeLengths } from '../derive/length.js';
import { doc, withEntities, connector, cavity, wire, bundle, cavityEndpoint } from './helpers.js';

function lengthsFor(d: ReturnType<typeof doc>) {
  return computeLengths(d, computeRoutes(d));
}

describe('computeLengths', () => {
  it('sums authored bundle lengths (mm) into integer micrometres', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 } }),
        connector('mid', 'M1', [], { layoutPosition: { x: 100, y: 0 } }),
        connector('c2', 'C2', [cavity('b')], { layoutPosition: { x: 200, y: 0 } }),
      ],
      wires: [wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'))],
      bundles: [
        bundle('b1', 'B1', 'c1', 'mid', { length: 150.5 }),
        bundle('b2', 'B2', 'mid', 'c2', { length: 49.5 }),
      ],
    });

    const result = lengthsFor(d).get('w1')!;
    expect(result.status).toBe('exact');
    expect(result.value).toBe(200000); // 200mm in µm
  });

  it('adds service loop and strip-length allowances on top of the routed length', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 } }),
        connector('c2', 'C2', [cavity('b')], { layoutPosition: { x: 100, y: 0 } }),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'), {
          serviceLoop: { source: 10, target: 5 },
          ends: { source: { stripLength: 8 }, target: { stripLength: 8 } },
        }),
      ],
      bundles: [bundle('b1', 'B1', 'c1', 'c2', { length: 100 })],
    });

    const result = lengthsFor(d).get('w1')!;
    // 100mm route + 10+5mm service loop + 8+8mm strip = 131mm
    expect(result.value).toBe(131000);
  });

  it('lengthOverride wins over the computed value and reports status "overridden"', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 } }),
        connector('c2', 'C2', [cavity('b')], { layoutPosition: { x: 100, y: 0 } }),
      ],
      wires: [wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'), { lengthOverride: 500 })],
      bundles: [bundle('b1', 'B1', 'c1', 'c2', { length: 100 })],
    });

    const result = lengthsFor(d).get('w1')!;
    expect(result.status).toBe('overridden');
    expect(result.value).toBe(500000);
  });

  it('a noRoute wire has zero length and no segments', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 } }),
        connector('c2', 'C2', [cavity('b')], { layoutPosition: { x: 100, y: 0 } }),
      ],
      wires: [wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'))],
    });

    const result = lengthsFor(d).get('w1')!;
    expect(result).toEqual({ status: 'noRoute', value: 0, segments: [] });
  });
});
