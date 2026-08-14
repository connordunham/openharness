import { describe, it, expect } from 'vitest';
import { computeRoutes } from '../derive/routing.js';
import {
  doc, withEntities, connector, cavity, splice, cable,
  wire, bundle, cavityEndpoint, spliceEndpoint, cableCoreEndpoint,
} from './helpers.js';

describe('computeRoutes', () => {
  it('routes a wire across a bundle with an authored length as "exact"', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 } }),
        connector('c2', 'C2', [cavity('b')], { layoutPosition: { x: 100, y: 0 } }),
      ],
      wires: [wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'))],
      bundles: [bundle('b1', 'B1', 'c1', 'c2', { length: 250 })],
    });

    const routes = computeRoutes(d);
    expect(routes.get('w1')).toEqual({ status: 'exact', segments: ['b1'] });
  });

  it('routes as "lowerBound" when the bundle has no authored length', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 } }),
        connector('c2', 'C2', [cavity('b')], { layoutPosition: { x: 100, y: 0 } }),
      ],
      wires: [wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'))],
      bundles: [bundle('b1', 'B1', 'c1', 'c2')],
    });

    expect(computeRoutes(d).get('w1')?.status).toBe('lowerBound');
  });

  it('reports "noRoute" when there is no path through the layout graph', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 } }),
        connector('c2', 'C2', [cavity('b')], { layoutPosition: { x: 100, y: 0 } }),
      ],
      wires: [wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'))],
      // No bundle at all between them.
    });

    expect(computeRoutes(d).get('w1')).toEqual({ status: 'noRoute', segments: [] });
  });

  it('reports "unplaced" when a component has no layout position', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 } }),
        connector('c2', 'C2', [cavity('b')]), // no layoutPosition
      ],
      wires: [wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'))],
    });

    expect(computeRoutes(d).get('w1')?.status).toBe('unplaced');
  });

  it('a wire between two cavities on the same connector needs no route ("exact", zero segments)', () => {
    const d = withEntities(doc(), {
      components: [connector('c1', 'C1', [cavity('a'), cavity('b')], { layoutPosition: { x: 0, y: 0 } })],
      wires: [wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c1', 'b'))],
    });

    expect(computeRoutes(d).get('w1')).toEqual({ status: 'exact', segments: [] });
  });

  it('picks the shortest path across multiple bundles, tie-broken deterministically', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 } }),
        connector('c2', 'C2', [cavity('b')], { layoutPosition: { x: 300, y: 0 } }),
        connector('mid', 'M1', [], { layoutPosition: { x: 150, y: 0 } }),
      ],
      wires: [wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'))],
      bundles: [
        bundle('direct', 'B1', 'c1', 'c2', { length: 500 }), // longer direct path
        bundle('leg1', 'B2', 'c1', 'mid', { length: 100 }),
        bundle('leg2', 'B3', 'mid', 'c2', { length: 100 }), // shorter via mid: 200 total
      ],
    });

    expect(computeRoutes(d).get('w1')).toEqual({ status: 'exact', segments: ['leg1', 'leg2'] });
  });

  it('a cable core never gets a route status — it is "jumper"', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 } }),
        cable('cb1', 'CB1', { cores: [{ id: 'core1', color: 'Red' }] }),
      ],
      wires: [wire('w1', 'W1', cavityEndpoint('c1', 'a'), cableCoreEndpoint('cb1', 'core1'))],
    });

    expect(computeRoutes(d).get('w1')).toEqual({ status: 'jumper', segments: [] });
  });

  it('a cable shield gets "shield", not "jumper"', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 } }),
        cable('cb1', 'CB1', { cores: [{ id: 'core1', color: 'Red' }], shield: { id: 'shield1', color: 'Shield' } }),
      ],
      wires: [wire('w1', 'W1', cavityEndpoint('c1', 'a'), cableCoreEndpoint('cb1', 'shield1'))],
    });

    expect(computeRoutes(d).get('w1')).toEqual({ status: 'shield', segments: [] });
  });

  it('R12: resolves a chain of two unplaced splices, each wire routing through its actual neighbour', () => {
    // c1 (placed) -- w1 -- s1 (unplaced) -- w2 -- s2 (unplaced) -- w3 -- c2 (placed)
    //
    // The subtlety this fixture exists to test (review R12): when resolving
    // *which* wire is being routed, that wire must be excluded from its own
    // splice's neighbour vote (spec §6.2's pseudocode: "excluding the wire
    // being routed"). Get that wrong and every splice looks ambiguous —
    // e.g. resolving w2's s1 end would count w1 (host c1) AND w2 itself
    // (which recurses to s2 -> c2) as two different votes for s1's host,
    // when w2 is the thing being resolved and shouldn't vote on itself.
    // With the exclusion applied correctly: s1's only *other* wire is w1
    // (host c1) — unambiguous. s2's only *other* wire is w3 (host c2) —
    // unambiguous. So each of the three wires routes cleanly across the one
    // real bundle between the two placed connectors.
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 } }),
        connector('c2', 'C2', [cavity('b')], { layoutPosition: { x: 200, y: 0 } }),
        splice('s1', 'S1'), // no layoutPosition
        splice('s2', 'S2'), // no layoutPosition
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), spliceEndpoint('s1')),
        wire('w2', 'W2', spliceEndpoint('s1'), spliceEndpoint('s2')),
        wire('w3', 'W3', spliceEndpoint('s2'), cavityEndpoint('c2', 'b')),
      ],
      bundles: [bundle('b1', 'B1', 'c1', 'c2', { length: 200 })],
    });

    const routes = computeRoutes(d);
    expect(routes.get('w1')).toEqual({ status: 'exact', segments: ['b1'] });
    expect(routes.get('w2')).toEqual({ status: 'exact', segments: ['b1'] });
    expect(routes.get('w3')).toEqual({ status: 'exact', segments: ['b1'] });
  });

  it('a splice with genuinely ambiguous neighbours (three real branches) is unplaced', () => {
    // s1 sits between three *different* placed connectors with no layout
    // position of its own — there is no single host to collapse it to.
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 } }),
        connector('c2', 'C2', [cavity('b')], { layoutPosition: { x: 100, y: 0 } }),
        connector('c3', 'C3', [cavity('c')], { layoutPosition: { x: 200, y: 0 } }),
        splice('s1', 'S1'),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), spliceEndpoint('s1')),
        wire('w2', 'W2', cavityEndpoint('c2', 'b'), spliceEndpoint('s1')),
        wire('w3', 'W3', cavityEndpoint('c3', 'c'), spliceEndpoint('s1')),
      ],
    });

    expect(computeRoutes(d).get('w1')?.status).toBe('unplaced');
  });

  it('resolves a single unplaced splice transparently when it has exactly one distinct host', () => {
    // c1 (placed) -- w1 -- s1 (unplaced) -- w2 -- s1 -- w3 -- c1 (same connector, different cavity)
    // Simpler, unambiguous case: s1's only wires both lead back to c1 -> resolves to c1.
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a'), cavity('b')], { layoutPosition: { x: 0, y: 0 } }),
        connector('c2', 'C2', [cavity('x')], { layoutPosition: { x: 100, y: 0 } }),
        splice('s1', 'S1'),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), spliceEndpoint('s1')),
        wire('w2', 'W2', spliceEndpoint('s1'), cavityEndpoint('c1', 'b')),
        wire('w3', 'W3', spliceEndpoint('s1'), cavityEndpoint('c2', 'x')),
      ],
      bundles: [bundle('b1', 'B1', 'c1', 'c2', { length: 100 })],
    });

    // w3 connects s1 (host resolves to c1, its only *other* neighbour besides w3 itself) to c2.
    expect(computeRoutes(d).get('w3')).toEqual({ status: 'exact', segments: ['b1'] });
  });
});
