import { describe, it, expect } from 'vitest';
import { extractNets } from '../derive/netExtraction.js';
import {
  doc, withEntities, connector, cavity, splice, twoTerminal, cable,
  wire, cavityEndpoint, spliceEndpoint, twoTerminalEndpoint, cableCoreEndpoint,
} from './helpers.js';

describe('extractNets', () => {
  it('joins two cavities connected by one wire into a single net', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')]),
        connector('c2', 'C2', [cavity('b')]),
      ],
      wires: [wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'))],
    });

    const { nets, netIdByVertex } = extractNets(d);
    expect(nets).toHaveLength(1);
    expect(netIdByVertex.get('cavity:c1:a')).toBe(netIdByVertex.get('cavity:c2:b'));
  });

  it('treats a splice as one n-ary hyper-node for every wire attached to it', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')]),
        connector('c2', 'C2', [cavity('b')]),
        connector('c3', 'C3', [cavity('c')]),
        splice('s1', 'S1'),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), spliceEndpoint('s1')),
        wire('w2', 'W2', cavityEndpoint('c2', 'b'), spliceEndpoint('s1')),
        wire('w3', 'W3', cavityEndpoint('c3', 'c'), spliceEndpoint('s1')),
      ],
    });

    const { nets } = extractNets(d);
    expect(nets).toHaveLength(1);
    expect(nets[0]!.memberIds).toHaveLength(4); // 3 cavities + 1 splice vertex
  });

  it('does NOT connect the two sides of a resistor/diode — they separate nets', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')]),
        connector('c2', 'C2', [cavity('b')]),
        twoTerminal('r1', 'R1', 'resistor'),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), twoTerminalEndpoint('r1', 'Left')),
        wire('w2', 'W2', cavityEndpoint('c2', 'b'), twoTerminalEndpoint('r1', 'Right')),
      ],
    });

    const { nets } = extractNets(d);
    // Two separate nets: (C1.a, R1.Left) and (C2.b, R1.Right).
    expect(nets).toHaveLength(2);
    for (const net of nets) expect(net.memberIds).toHaveLength(2);
  });

  it('merges cavities with the same global signal even with no wire between them', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a', { signal: 'GND', global: true })]),
        connector('c2', 'C2', [cavity('b', { signal: 'GND', global: true })]),
      ],
    });

    const { nets } = extractNets(d);
    expect(nets).toHaveLength(1);
    expect(nets[0]!.signal).toBe('GND');
  });

  it('flags conflicting explicit signal names on the same net', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a', { signal: 'foo' })]),
        connector('c2', 'C2', [cavity('b', { signal: 'bar' })]),
      ],
      wires: [wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'))],
    });

    const { conflicts, nets } = extractNets(d);
    expect(conflicts.size).toBe(1);
    const [signals] = [...conflicts.values()];
    expect(signals).toEqual(expect.arrayContaining(['foo', 'bar']));
    expect(nets).toHaveLength(1);
  });

  it('respects noPropagate — a stopped cavity does not donate its signal to the net', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a', { signal: 'stopped', noPropagate: true })]),
        connector('c2', 'C2', [cavity('b')]),
      ],
      wires: [wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'))],
    });

    const { nets } = extractNets(d);
    expect(nets[0]!.signal).toBeUndefined();
  });

  it('treats cable cores and the shield as independent vertices, connectable like cavities', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')]),
        cable('cb1', 'CB1', {
          cores: [{ id: 'core1', color: 'Red' }],
          shield: { id: 'shield1', color: 'Shield' },
        }),
      ],
      wires: [wire('w1', 'W1', cavityEndpoint('c1', 'a'), cableCoreEndpoint('cb1', 'core1'))],
    });

    const { nets, netIdByVertex } = extractNets(d);
    // core1's net includes c1.a; shield1 is its own singleton net (unwired).
    expect(netIdByVertex.get('cableCore:cb1:core1')).toBe(netIdByVertex.get('cavity:c1:a'));
    expect(nets.find((n) => n.memberIds.includes('cableCore:cb1:shield1'))?.memberIds).toEqual([
      'cableCore:cb1:shield1',
    ]);
  });
});
