import { describe, it, expect } from 'vitest';
import { extractNets } from '../derive/netExtraction.js';
import { computeDerivedModel } from '../derive/index.js';
import type { HarnessDocument, Mate } from '../types.js';
import {
  doc, withEntities, connector, cavity, terminal, wire,
  cavityEndpoint, terminalEndpoint,
} from './helpers.js';

/** Add mates to a document */
function withMates(
  d: HarnessDocument,
  mates: (Omit<Mate, 'id' | 'custom'> & { id?: string })[],
): HarnessDocument {
  if (!d.mates) d.mates = {};
  for (let i = 0; i < mates.length; i++) {
    const m = mates[i]!;
    d.mates[m.id ?? `mate:${i}`] = {
      id: m.id ?? `mate:${i}`,
      sourceId: m.sourceId,
      targetId: m.targetId,
      targetCavityId: m.targetCavityId,
      cavityMap: m.cavityMap,
      custom: {},
    };
  }
  return d;
}

describe('Mates — net extraction', () => {
  it('two mated 4-cavity connectors put cavity n of each on one net', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [
          cavity('a0'), cavity('a1'), cavity('a2'), cavity('a3'),
        ]),
        connector('c2', 'C2', [
          cavity('b0'), cavity('b1'), cavity('b2'), cavity('b3'),
        ]),
      ],
    });
    withMates(d, [{ sourceId: 'c1', targetId: 'c2' }]);

    const { nets, netIdByVertex } = extractNets(d);

    // Should have 4 nets (one per matched pair)
    expect(nets).toHaveLength(4);

    // Each net should pair c1.nth with c2.nth
    for (let i = 0; i < 4; i++) {
      const c1Key = `cavity:c1:a${i}`;
      const c2Key = `cavity:c2:b${i}`;
      expect(netIdByVertex.get(c1Key)).toBe(netIdByVertex.get(c2Key));
    }
  });

  it('explicit cavityMap overrides positional pairing entirely', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [
          cavity('a0'), cavity('a1'), cavity('a2'), cavity('a3'),
        ]),
        connector('c2', 'C2', [
          cavity('b0'), cavity('b1'), cavity('b2'), cavity('b3'),
        ]),
      ],
    });

    // Explicit map: a0↔b3, a1↔b2 (cross-wired)
    withMates(d, [{
      sourceId: 'c1',
      targetId: 'c2',
      cavityMap: [
        { sourceCavityId: 'a0', targetCavityId: 'b3' },
        { sourceCavityId: 'a1', targetCavityId: 'b2' },
      ],
    }]);

    const { nets, netIdByVertex } = extractNets(d);

    // 6 nets: 2 paired (explicit), 4 unpaired (a2, a3, b0, b1)
    expect(nets).toHaveLength(6);

    // Check the explicit pairs
    expect(netIdByVertex.get('cavity:c1:a0')).toBe(netIdByVertex.get('cavity:c2:b3'));
    expect(netIdByVertex.get('cavity:c1:a1')).toBe(netIdByVertex.get('cavity:c2:b2'));

    // Unpaired cavities are on separate nets
    expect(netIdByVertex.get('cavity:c1:a2')).not.toBe(netIdByVertex.get('cavity:c2:b0'));
    expect(netIdByVertex.get('cavity:c1:a2')).not.toBe(netIdByVertex.get('cavity:c2:b1'));
  });

  it('a cavityMap naming 2 of 4 cavities leaves the rest unpaired', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a0'), cavity('a1'), cavity('a2'), cavity('a3')]),
        connector('c2', 'C2', [cavity('b0'), cavity('b1'), cavity('b2'), cavity('b3')]),
      ],
    });

    // Partial map: only pair a0↔b0, a1↔b1
    withMates(d, [{
      sourceId: 'c1',
      targetId: 'c2',
      cavityMap: [
        { sourceCavityId: 'a0', targetCavityId: 'b0' },
        { sourceCavityId: 'a1', targetCavityId: 'b1' },
      ],
    }]);

    const { nets, netIdByVertex } = extractNets(d);

    // 6 nets: 2 paired, 4 unpaired
    expect(nets).toHaveLength(6);

    // Verify explicit pairs are together
    expect(netIdByVertex.get('cavity:c1:a0')).toBe(netIdByVertex.get('cavity:c2:b0'));
    expect(netIdByVertex.get('cavity:c1:a1')).toBe(netIdByVertex.get('cavity:c2:b1'));

    // Verify unpaired are separate
    const a2Net = netIdByVertex.get('cavity:c1:a2');
    const a3Net = netIdByVertex.get('cavity:c1:a3');
    const b2Net = netIdByVertex.get('cavity:c2:b2');
    const b3Net = netIdByVertex.get('cavity:c2:b3');

    expect(a2Net).not.toBe(a3Net);
    expect(a2Net).not.toBe(b2Net);
    expect(a3Net).not.toBe(b3Net);
  });

  it('a signal on one side propagates across the mate to the other', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a', { signal: 'GND' })]),
        connector('c2', 'C2', [cavity('b')]),
      ],
    });
    withMates(d, [{ sourceId: 'c1', targetId: 'c2' }]);

    const { nets } = extractNets(d);
    expect(nets).toHaveLength(1);
    expect(nets[0]!.signal).toBe('GND');
  });

  it('terminal into cavity mate unions the terminal with the cavity', () => {
    const d = withEntities(doc(), {
      components: [
        terminal('t1', 'T1', 'ring'),
        connector('c1', 'C1', [cavity('a', { signal: 'POWER' })]),
      ],
    });
    withMates(d, [{
      sourceId: 't1',
      targetId: 'c1',
      targetCavityId: 'a',
    }]);

    const { nets } = extractNets(d);
    // One net containing both the terminal and the cavity
    expect(nets).toHaveLength(1);
    expect(nets[0]!.memberIds).toContain('terminalPoint:t1');
    expect(nets[0]!.memberIds).toContain('cavity:c1:a');
    expect(nets[0]!.signal).toBe('POWER');
  });

  it('terminal-to-terminal mate unions the two terminals electrically', () => {
    // B6: a ring-to-ring mate (the exact case MATE_SIZE validates) must join
    // the two terminals onto one net — the mate validates AND connects.
    const d = withEntities(doc(), {
      components: [
        terminal('t1', 'T1', 'ring'),
        terminal('t2', 'T2', 'ring'),
      ],
    });
    withMates(d, [{ sourceId: 't1', targetId: 't2' }]);

    const { nets } = extractNets(d);
    expect(nets).toHaveLength(1);
    expect(nets[0]!.memberIds).toContain('terminalPoint:t1');
    expect(nets[0]!.memberIds).toContain('terminalPoint:t2');
  });

  it('a signal on one terminal propagates across a terminal-to-terminal mate', () => {
    // Put a signal source on t1's net via a wire to a signalled cavity, then
    // confirm it reaches t2 through the mate.
    const d = withEntities(doc(), {
      components: [
        terminal('t1', 'T1', 'ring'),
        terminal('t2', 'T2', 'ring'),
        connector('c1', 'C1', [cavity('a', { signal: 'POWER' })]),
      ],
      wires: [
        wire('w1', 'W1', terminalEndpoint('t1'), cavityEndpoint('c1', 'a'), {}),
      ],
    });
    withMates(d, [{ sourceId: 't1', targetId: 't2' }]);

    const { nets } = extractNets(d);
    // t1, t2 and c1.a are all on one net carrying POWER.
    expect(nets).toHaveLength(1);
    expect(nets[0]!.signal).toBe('POWER');
    expect(nets[0]!.memberIds).toContain('terminalPoint:t2');
  });

  it('a mate to a deleted component is ignored', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')]),
        connector('c2', 'C2', [cavity('b')]),
      ],
    });
    withMates(d, [{ sourceId: 'c1', targetId: 'NONEXISTENT' }]);

    // Should not crash; extract should ignore the bad mate
    const { nets } = extractNets(d);
    expect(nets).toHaveLength(2); // c1.a and c2.b separate (no mate applied)
  });
});

describe('Mates — validation rules', () => {
  function diagnosticsByRule(d: HarnessDocument, ruleId: string) {
    return computeDerivedModel(d).diagnostics.filter((diag) => diag.ruleId === ruleId);
  }

  it('MATE_CAVITY_COUNT when mated connectors have different cavity counts', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a0'), cavity('a1'), cavity('a2'), cavity('a3')]),
        connector('c2', 'C2', [cavity('b0'), cavity('b1'), cavity('b2'), cavity('b3'), cavity('b4'), cavity('b5')]),
      ],
    });
    withMates(d, [{ sourceId: 'c1', targetId: 'c2' }]);

    const diags = diagnosticsByRule(d, 'MATE_CAVITY_COUNT');
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain('4 vs 6');
  });

  it('a bad mate (cavity count mismatch) still unions available pairs', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a0', { signal: 'A' }), cavity('a1')]),
        connector('c2', 'C2', [
          cavity('b0', { signal: 'B' }),
          cavity('b1'),
          cavity('b2'),
        ]),
      ],
    });
    withMates(d, [{ sourceId: 'c1', targetId: 'c2' }]);

    // Should have error but still union what it can
    const { nets } = extractNets(d);
    // c1.a0↔c2.b0, c1.a1↔c2.b1, c2.b2 alone = 3 nets
    expect(nets).toHaveLength(3);
  });

  it('MATE_GENDER when both ends have matching gender', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [], { partId: 'p1' }),
        connector('c2', 'C2', [], { partId: 'p2' }),
      ],
    });
    d.parts['p1'] = {
      id: 'p1', kind: 'connector', numberOfCavities: 0, designationTemplate: { kind: 'numbers' },
      configurations: [], gender: 'male', custom: {},
    };
    d.parts['p2'] = {
      id: 'p2', kind: 'connector', numberOfCavities: 0, designationTemplate: { kind: 'numbers' },
      configurations: [], gender: 'male', custom: {},
    };
    withMates(d, [{ sourceId: 'c1', targetId: 'c2' }]);

    const diags = diagnosticsByRule(d, 'MATE_GENDER');
    expect(diags).toHaveLength(1);
  });

  it('MATE_GENDER does not fire when one end has no gender', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [], { partId: 'p1' }),
        connector('c2', 'C2', []),
      ],
    });
    d.parts['p1'] = {
      id: 'p1', kind: 'connector', numberOfCavities: 0, designationTemplate: { kind: 'numbers' },
      configurations: [], gender: 'male', custom: {},
    };
    withMates(d, [{ sourceId: 'c1', targetId: 'c2' }]);

    const diags = diagnosticsByRule(d, 'MATE_GENDER');
    expect(diags).toHaveLength(0); // No error when one side lacks gender
  });

  it('MATE_GENDER does not fire for male-to-female', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [], { partId: 'p1' }),
        connector('c2', 'C2', [], { partId: 'p2' }),
      ],
    });
    d.parts['p1'] = {
      id: 'p1', kind: 'connector', numberOfCavities: 0, designationTemplate: { kind: 'numbers' },
      configurations: [], gender: 'male', custom: {},
    };
    d.parts['p2'] = {
      id: 'p2', kind: 'connector', numberOfCavities: 0, designationTemplate: { kind: 'numbers' },
      configurations: [], gender: 'female', custom: {},
    };
    withMates(d, [{ sourceId: 'c1', targetId: 'c2' }]);

    const diags = diagnosticsByRule(d, 'MATE_GENDER');
    expect(diags).toHaveLength(0);
  });

  it('MATE_GENDER does not fire for hermaphroditic-to-hermaphroditic (correct pairing)', () => {
    // C2: genderless/hermaphroditic housings (Anderson Powerpole style) mate
    // with an identical part, so equal hermaphroditic genders are NOT a defect.
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [], { partId: 'p1' }),
        connector('c2', 'C2', [], { partId: 'p2' }),
      ],
    });
    d.parts['p1'] = {
      id: 'p1', kind: 'connector', numberOfCavities: 0, designationTemplate: { kind: 'numbers' },
      configurations: [], gender: 'hermaphroditic', custom: {},
    };
    d.parts['p2'] = {
      id: 'p2', kind: 'connector', numberOfCavities: 0, designationTemplate: { kind: 'numbers' },
      configurations: [], gender: 'hermaphroditic', custom: {},
    };
    withMates(d, [{ sourceId: 'c1', targetId: 'c2' }]);

    const diags = diagnosticsByRule(d, 'MATE_GENDER');
    expect(diags).toHaveLength(0);
  });

  it('ferrule into cavity is allowed, but second ferrule in same cavity raises MATE_INCOMPATIBLE', () => {
    const d = withEntities(doc(), {
      components: [
        terminal('t1', 'T1', 'ferrule'),
        terminal('t2', 'T2', 'ferrule'),
        connector('c1', 'C1', [cavity('a')]),
      ],
    });
    withMates(d, [
      { sourceId: 't1', targetId: 'c1', targetCavityId: 'a' },
      { sourceId: 't2', targetId: 'c1', targetCavityId: 'a' },
    ]);

    const diags = diagnosticsByRule(d, 'MATE_INCOMPATIBLE');
    // Both t1 and t2 are in violation (each sees the other)
    expect(diags.length).toBeGreaterThan(0);
  });

  // C1: the terminal-to-terminal pairing table. Physically incompatible
  // families must raise MATE_INCOMPATIBLE, not pass silently.
  it('ring-to-ferrule raises MATE_INCOMPATIBLE', () => {
    const d = withEntities(doc(), {
      components: [
        terminal('t1', 'T1', 'ring'),
        terminal('t2', 'T2', 'ferrule'),
      ],
    });
    withMates(d, [{ sourceId: 't1', targetId: 't2' }]);
    expect(diagnosticsByRule(d, 'MATE_INCOMPATIBLE')).toHaveLength(1);
  });

  it('spade-to-quick-connect raises MATE_INCOMPATIBLE', () => {
    const d = withEntities(doc(), {
      components: [
        terminal('t1', 'T1', 'spade'),
        terminal('t2', 'T2', 'maleQuickConnect'),
      ],
    });
    withMates(d, [{ sourceId: 't1', targetId: 't2' }]);
    expect(diagnosticsByRule(d, 'MATE_INCOMPATIBLE')).toHaveLength(1);
  });

  it('male-to-male quick-connect raises MATE_INCOMPATIBLE', () => {
    const d = withEntities(doc(), {
      components: [
        terminal('t1', 'T1', 'maleQuickConnect'),
        terminal('t2', 'T2', 'maleQuickConnect'),
      ],
    });
    withMates(d, [{ sourceId: 't1', targetId: 't2' }]);
    expect(diagnosticsByRule(d, 'MATE_INCOMPATIBLE')).toHaveLength(1);
  });

  it('ring-to-spade is an allowed pairing', () => {
    const d = withEntities(doc(), {
      components: [
        terminal('t1', 'T1', 'ring'),
        terminal('t2', 'T2', 'spade'),
      ],
    });
    withMates(d, [{ sourceId: 't1', targetId: 't2' }]);
    expect(diagnosticsByRule(d, 'MATE_INCOMPATIBLE')).toHaveLength(0);
  });

  it('male-to-female quick-connect is an allowed pairing', () => {
    const d = withEntities(doc(), {
      components: [
        terminal('t1', 'T1', 'maleQuickConnect'),
        terminal('t2', 'T2', 'femaleQuickConnect'),
      ],
    });
    withMates(d, [{ sourceId: 't1', targetId: 't2' }]);
    expect(diagnosticsByRule(d, 'MATE_INCOMPATIBLE')).toHaveLength(0);
  });

  it('ring-to-ring with equal sizes passes', () => {
    const d = withEntities(doc(), {
      components: [
        terminal('t1', 'T1', 'ring', { partId: 'pt1' }),
        terminal('t2', 'T2', 'ring', { partId: 'pt2' }),
      ],
    });
    d.parts['pt1'] = {
      id: 'pt1', kind: 'terminal', terminalKind: 'ring', size: { value: 6, unit: 'mm' }, custom: {},
    };
    d.parts['pt2'] = {
      id: 'pt2', kind: 'terminal', terminalKind: 'ring', size: { value: 6, unit: 'mm' }, custom: {},
    };
    withMates(d, [{ sourceId: 't1', targetId: 't2' }]);

    const diags = diagnosticsByRule(d, 'MATE_SIZE');
    expect(diags).toHaveLength(0);
  });

  it('ring-to-ring with differing sizes raises MATE_SIZE', () => {
    const d = withEntities(doc(), {
      components: [
        terminal('t1', 'T1', 'ring', { partId: 'pt1' }),
        terminal('t2', 'T2', 'ring', { partId: 'pt2' }),
      ],
    });
    d.parts['pt1'] = {
      id: 'pt1', kind: 'terminal', terminalKind: 'ring', size: { value: 6, unit: 'mm' }, custom: {},
    };
    d.parts['pt2'] = {
      id: 'pt2', kind: 'terminal', terminalKind: 'ring', size: { value: 8, unit: 'mm' }, custom: {},
    };
    withMates(d, [{ sourceId: 't1', targetId: 't2' }]);

    const diags = diagnosticsByRule(d, 'MATE_SIZE');
    expect(diags).toHaveLength(1);
  });

  it('ring-to-ring with one size absent raises no error', () => {
    const d = withEntities(doc(), {
      components: [
        terminal('t1', 'T1', 'ring', { partId: 'pt1' }),
        terminal('t2', 'T2', 'ring'),
      ],
    });
    d.parts['pt1'] = {
      id: 'pt1', kind: 'terminal', terminalKind: 'ring', size: { value: 6, unit: 'mm' }, custom: {},
    };
    withMates(d, [{ sourceId: 't1', targetId: 't2' }]);

    const diags = diagnosticsByRule(d, 'MATE_SIZE');
    expect(diags).toHaveLength(0); // No error when one lacks size
  });

  it('sizes given in different length units compare by real dimension (C3)', () => {
    // 25.4 mm and 1 in are the same physical size — must NOT be a mismatch.
    const equal = withEntities(doc(), {
      components: [
        terminal('t1', 'T1', 'ring', { partId: 'pt1' }),
        terminal('t2', 'T2', 'ring', { partId: 'pt2' }),
      ],
    });
    equal.parts['pt1'] = { id: 'pt1', kind: 'terminal', terminalKind: 'ring', size: { value: 25.4, unit: 'mm' }, custom: {} };
    equal.parts['pt2'] = { id: 'pt2', kind: 'terminal', terminalKind: 'ring', size: { value: 1, unit: 'in' }, custom: {} };
    withMates(equal, [{ sourceId: 't1', targetId: 't2' }]);
    expect(diagnosticsByRule(equal, 'MATE_SIZE')).toHaveLength(0);

    // 6 mm and 1/4 in (6.35 mm) are different sizes — still a mismatch.
    const different = withEntities(doc(), {
      components: [
        terminal('t1', 'T1', 'ring', { partId: 'pt1' }),
        terminal('t2', 'T2', 'ring', { partId: 'pt2' }),
      ],
    });
    different.parts['pt1'] = { id: 'pt1', kind: 'terminal', terminalKind: 'ring', size: { value: 6, unit: 'mm' }, custom: {} };
    different.parts['pt2'] = { id: 'pt2', kind: 'terminal', terminalKind: 'ring', size: { value: 0.25, unit: 'in' }, custom: {} };
    withMates(different, [{ sourceId: 't1', targetId: 't2' }]);
    expect(diagnosticsByRule(different, 'MATE_SIZE')).toHaveLength(1);
  });

  it('a mate naming a deleted component is ignored and raises no error', () => {
    const d = withEntities(doc(), {
      components: [connector('c1', 'C1', [])],
    });
    withMates(d, [{ sourceId: 'c1', targetId: 'NONEXISTENT' }]);

    const diags = computeDerivedModel(d).diagnostics.filter((diag) => diag.ruleId.startsWith('MATE_'));
    expect(diags).toHaveLength(0); // No mate-related errors
  });
});

describe('Mates — document handling', () => {
  it('doc.mates is optional; absent is treated as empty', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')]),
        connector('c2', 'C2', [cavity('b')]),
      ],
    });
    // Do NOT call withMates

    const { nets } = extractNets(d);
    expect(nets).toHaveLength(2); // No union across mates (none exist)
  });

  it('mates do not appear in wires list', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')]),
        connector('c2', 'C2', [cavity('b')]),
      ],
    });
    withMates(d, [{ sourceId: 'c1', targetId: 'c2' }]);

    // Mates should be completely separate from the wires list
    expect(Object.keys(d.wires)).not.toContain('mate:0');
  });

  it('mates do not reach the BOM', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { partId: 'p1' }),
        connector('c2', 'C2', [cavity('b')], { partId: 'p2' }),
      ],
    });
    d.parts['p1'] = {
      id: 'p1', kind: 'connector', numberOfCavities: 1, designationTemplate: { kind: 'numbers' },
      configurations: [], custom: {},
    };
    d.parts['p2'] = {
      id: 'p2', kind: 'connector', numberOfCavities: 1, designationTemplate: { kind: 'numbers' },
      configurations: [], custom: {},
    };
    withMates(d, [{ sourceId: 'c1', targetId: 'c2' }]);

    const { bom } = computeDerivedModel(d);
    // BOM should have two lines: one for each connector part
    expect(bom).toHaveLength(2);
    // Verify the parts are from connectors, not from mates
    expect(bom.map((line) => line.partId).sort()).toEqual(['p1', 'p2']);
  });
});
