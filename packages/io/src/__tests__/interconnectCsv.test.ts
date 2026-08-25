import { describe, it, expect } from 'vitest';
import { interconnectToCsv, interconnectFromCsv } from '../interconnectCsv.js';
import type { InterconnectRow, ComponentId, WireId } from '@openharness/core';

describe('interconnectToCsv', () => {
  it('writes a header row followed by one row per interconnect line for normal data', () => {
    const rows: InterconnectRow[] = [
      {
        wireId: 'w1' as WireId,
        wireRefdes: 'W1',
        fromComponentId: 'c1' as ComponentId,
        fromComponentRefdes: 'J1',
        fromDesignation: '1',
        fromSignal: 'CAN_H',
        fromDirection: 'bidirectional',
        fromImpedanceMatched: true,
        toComponentId: 'c2' as ComponentId,
        toComponentRefdes: 'J2',
        toDesignation: '1',
        toSignal: 'CAN_H',
        toDirection: 'bidirectional',
        toImpedanceMatched: true,
        resolved: 'bidirectional',
        impedanceMatched: true,
      },
    ];

    const csv = interconnectToCsv(rows);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('wireRefdes,fromComponentRefdes,fromDesignation,fromSignal,fromDirection,fromImpedanceMatched,toComponentRefdes,toDesignation,toSignal,toDirection,toImpedanceMatched,resolvedDirection,color');
    expect(lines[1]).toBe('W1,J1,1,CAN_H,bidirectional,yes,J2,1,CAN_H,bidirectional,yes,bidirectional,');
  });

  it('quotes fields containing commas per RFC 4180', () => {
    const rows: InterconnectRow[] = [
      {
        wireId: 'w1' as WireId,
        wireRefdes: 'W1',
        fromComponentRefdes: 'J1, Main',
        fromDesignation: 'A,1',
        toComponentRefdes: 'J2',
        toDesignation: 'B',
        resolved: 'bidirectional',
        impedanceMatched: false,
      },
    ];

    const csv = interconnectToCsv(rows);
    expect(csv).toContain('"J1, Main"');
    expect(csv).toContain('"A,1"');
  });

  describe('formula injection hardening (T23)', () => {
    it('neutralizes exact =cmd|\'/c calc\'!A1 payload by tab-prefixing and force-quoting', () => {
      const rows: InterconnectRow[] = [
        {
          wireId: 'w1' as WireId,
          wireRefdes: 'W1',
          fromComponentRefdes: 'J1',
          fromSignal: "=cmd|'/c calc'!A1",
          toComponentRefdes: 'J2',
          resolved: 'bidirectional',
          impedanceMatched: false,
        },
      ];

      const csv = interconnectToCsv(rows);
      expect(csv).toContain('"\t=cmd|\'/c calc\'!A1"');
    });

    it('neutralizes leading +, -, and @ trigger characters', () => {
      const rows: InterconnectRow[] = [
        {
          wireId: 'w1' as WireId,
          wireRefdes: '+W1',
          fromComponentRefdes: '-J1',
          fromDesignation: '@1',
          toComponentRefdes: '+J2',
          toDesignation: '-2',
          toSignal: '@SIG',
          resolved: 'bidirectional',
          impedanceMatched: false,
        },
      ];

      const csv = interconnectToCsv(rows);
      const line = csv.trim().split('\r\n')[1]!;
      expect(line).toContain('"\t+W1"');
      expect(line).toContain('"\t-J1"');
      expect(line).toContain('"\t@1"');
      expect(line).toContain('"\t+J2"');
      expect(line).toContain('"\t-2"');
      expect(line).toContain('"\t@SIG"');
    });

    it('neutralizes cells starting with whitespace followed by a trigger character', () => {
      const rows: InterconnectRow[] = [
        {
          wireId: 'w1' as WireId,
          wireRefdes: '  =1+1',
          fromComponentRefdes: '\t+J1',
          toComponentRefdes: '   @J2',
          resolved: 'bidirectional',
          impedanceMatched: false,
        },
      ];

      const csv = interconnectToCsv(rows);
      expect(csv).toContain('"\t  =1+1"');
      expect(csv).toContain('"\t\t+J1"');
      expect(csv).toContain('"\t   @J2"');
    });

    it('does not force-quote or tab-prefix mid-string = characters without leading triggers', () => {
      const rows: InterconnectRow[] = [
        {
          wireId: 'w1' as WireId,
          wireRefdes: 'WIRE=1',
          fromComponentRefdes: 'CONN=A',
          fromDesignation: 'PIN=1',
          fromSignal: 'SIG=CLK',
          toComponentRefdes: 'CONN=B',
          toDesignation: 'PIN=2',
          toSignal: 'SIG=DATA',
          resolved: 'bidirectional',
          impedanceMatched: false,
        },
      ];

      const csv = interconnectToCsv(rows);
      const line = csv.trim().split('\r\n')[1]!;
      expect(line).toContain('WIRE=1');
      expect(line).toContain('CONN=A');
      expect(line).toContain('PIN=1');
      expect(line).toContain('SIG=CLK');
      expect(line).not.toContain('\t');
    });

    it('quotes mid-string = cells only for RFC 4180 reasons without tab prefix', () => {
      const rows: InterconnectRow[] = [
        {
          wireId: 'w1' as WireId,
          wireRefdes: 'WIRE=1, rev 2',
          fromComponentRefdes: 'J1',
          toComponentRefdes: 'J2',
          resolved: 'bidirectional',
          impedanceMatched: false,
        },
      ];

      const csv = interconnectToCsv(rows);
      expect(csv).toContain('"WIRE=1, rev 2"');
      expect(csv).not.toContain('\tWIRE');
    });

    it('neutralizes formula injection across all attacker-controlled fields', () => {
      const rows: InterconnectRow[] = [
        {
          wireId: 'w1' as WireId,
          wireRefdes: '=W_EVIL',
          fromComponentRefdes: '+J_FROM',
          fromDesignation: '-DES_FROM',
          fromSignal: '@SIG_FROM',
          toComponentRefdes: '=J_TO',
          toDesignation: '+DES_TO',
          toSignal: '-SIG_TO',
          resolved: 'bidirectional',
          impedanceMatched: false,
        },
      ];

      const csv = interconnectToCsv(rows);
      const line = csv.trim().split('\r\n')[1]!;
      expect(line).toContain('"\t=W_EVIL"');
      expect(line).toContain('"\t+J_FROM"');
      expect(line).toContain('"\t-DES_FROM"');
      expect(line).toContain('"\t@SIG_FROM"');
      expect(line).toContain('"\t=J_TO"');
      expect(line).toContain('"\t+DES_TO"');
      expect(line).toContain('"\t-SIG_TO"');
    });
  });
});

describe('interconnectFromCsv round-trip', () => {
  it('round-trips normal interconnect data accurately', () => {
    const original: InterconnectRow[] = [
      {
        wireId: 'w1' as WireId,
        wireRefdes: 'W1',
        fromComponentRefdes: 'J1',
        fromDesignation: '1',
        fromSignal: 'CAN_H',
        fromDirection: 'bidirectional',
        fromImpedanceMatched: true,
        toComponentRefdes: 'J2',
        toDesignation: '1',
        toSignal: 'CAN_H',
        toDirection: 'bidirectional',
        toImpedanceMatched: true,
        resolved: 'bidirectional',
        impedanceMatched: true,
      },
    ];

    const csv = interconnectToCsv(original);
    const parsed = interconnectFromCsv(csv);
    expect(parsed).toEqual([
      {
        wireRefdes: 'W1',
        fromComponentRefdes: 'J1',
        fromDesignation: '1',
        fromSignal: 'CAN_H',
        fromDirection: 'bidirectional',
        fromImpedanceMatched: 'yes',
        toComponentRefdes: 'J2',
        toDesignation: '1',
        toSignal: 'CAN_H',
        toDirection: 'bidirectional',
        toImpedanceMatched: 'yes',
        color: undefined,
      },
    ]);
  });

  it('round-trips formula-hardened fields restoring intended text values', () => {
    const original: InterconnectRow[] = [
      {
        wireId: 'w1' as WireId,
        wireRefdes: '=W1',
        fromComponentRefdes: '+J1',
        fromDesignation: '-PIN1',
        fromSignal: '@SIG1',
        toComponentRefdes: '=J2',
        toDesignation: '+PIN2',
        toSignal: '-SIG2',
        resolved: 'bidirectional',
        impedanceMatched: false,
      },
    ];

    const csv = interconnectToCsv(original);
    const parsed = interconnectFromCsv(csv);
    expect(parsed).toEqual([
      {
        wireRefdes: '=W1',
        fromComponentRefdes: '+J1',
        fromDesignation: '-PIN1',
        fromSignal: '@SIG1',
        fromDirection: undefined,
        fromImpedanceMatched: undefined,
        toComponentRefdes: '=J2',
        toDesignation: '+PIN2',
        toSignal: '-SIG2',
        toDirection: undefined,
        toImpedanceMatched: undefined,
        color: undefined,
      },
    ]);
  });
});
