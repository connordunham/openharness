import { describe, it, expect } from 'vitest';
import { bomToCsv } from '../bomCsv.js';
import type { BomLine } from '@openharness/core';

describe('bomToCsv', () => {
  it('writes a header row followed by one row per BOM line', () => {
    const bom: BomLine[] = [
      {
        partId: 'p1', partNumber: 'MX-1', manufacturer: 'Molex', vendorPartNumber: 'DK-MX-1', description: 'Connector',
        quantity: 2, unit: 'ea', unitPrice: 2.5, extendedPrice: 5, url: 'https://example.com/mx-1',
        parameters: [{ id: 'q1', name: 'Voltage rating', qualifier: 'max', value: 250, unit: 'V' }],
        refdes: ['C1', 'C2'], warnings: [],
      },
    ];
    const csv = bomToCsv(bom);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('partNumber,manufacturer,vendorPartNumber,description,quantity,unit,unitPrice,extendedPrice,url,parameters,refdes,warnings');
    expect(lines[1]).toBe('MX-1,Molex,DK-MX-1,Connector,2,ea,2.5,5,https://example.com/mx-1,Voltage rating: max 250 V,C1; C2,');
  });

  it('joins several parameters into the one column, and quotes it when needed', () => {
    // The separator is '; ', same as refdes/warnings — and a comma anywhere
    // in a parameter name must not break the column count.
    const bom: BomLine[] = [
      {
        partNumber: 'W-1', manufacturer: '', description: '', quantity: 1, unit: 'm',
        parameters: [
          { id: 'a', name: 'Voltage rating', qualifier: 'max', value: 600, unit: 'V' },
          { id: 'b', name: 'Operating temp, ambient', qualifier: 'min', value: -40, unit: '°C' },
        ],
        refdes: ['W1'], warnings: [],
      },
    ];
    const csv = bomToCsv(bom);
    expect(csv).toContain('"Voltage rating: max 600 V; Operating temp, ambient: min -40 °C"');
    expect(csv.trim().split('\r\n')[1]!.split(',').length).toBeGreaterThan(0);
  });

  it('quotes fields containing commas', () => {
    const bom: BomLine[] = [
      {
        partNumber: 'X', manufacturer: 'Acme, Inc.', description: '', quantity: 1, unit: 'ea',
        refdes: ['C1'], warnings: [],
      },
    ];
    const csv = bomToCsv(bom);
    expect(csv).toContain('"Acme, Inc."');
  });

  describe('formula injection hardening (T23)', () => {
    it('neutralizes exact =cmd|\'/c calc\'!A1 payload by tab-prefixing and force-quoting', () => {
      const bom: BomLine[] = [
        {
          partNumber: 'P1',
          manufacturer: "=cmd|'/c calc'!A1",
          description: 'Test part',
          quantity: 1,
          unit: 'ea',
          refdes: ['C1'],
          warnings: [],
        },
      ];
      const csv = bomToCsv(bom);
      expect(csv).toContain('"\t=cmd|\'/c calc\'!A1"');
    });

    it('neutralizes leading +, -, and @ trigger characters', () => {
      const bom: BomLine[] = [
        {
          partNumber: '+12345',
          manufacturer: '-DDE-EXEC',
          vendorPartNumber: '@SUM(A1:A10)',
          description: '+HYPERLINK("https://evil.com")',
          quantity: 1,
          unit: 'ea',
          refdes: ['C1'],
          warnings: [],
        },
      ];
      const csv = bomToCsv(bom);
      const row = csv.trim().split('\r\n')[1]!;
      expect(row).toContain('"\t+12345"');
      expect(row).toContain('"\t-DDE-EXEC"');
      expect(row).toContain('"\t@SUM(A1:A10)"');
      expect(row).toContain('"\t+HYPERLINK(""https://evil.com"")"');
    });

    it('neutralizes cells starting with whitespace followed by a trigger character', () => {
      const bom: BomLine[] = [
        {
          partNumber: '  =1+1',
          manufacturer: '\t+2+3',
          description: '   @SUM(1,2)',
          quantity: 1,
          unit: 'ea',
          refdes: ['C1'],
          warnings: [],
        },
      ];
      const csv = bomToCsv(bom);
      expect(csv).toContain('"\t  =1+1"');
      expect(csv).toContain('"\t\t+2+3"');
      expect(csv).toContain('"\t   @SUM(1,2)"');
    });

    it('does not force-quote or tab-prefix mid-string = characters without leading triggers', () => {
      const bom: BomLine[] = [
        {
          partNumber: 'Molex 43025=4',
          manufacturer: 'Molex',
          description: 'Pin count=4',
          quantity: 1,
          unit: 'ea',
          refdes: ['C1'],
          warnings: [],
        },
      ];
      const csv = bomToCsv(bom);
      const row = csv.trim().split('\r\n')[1]!;
      expect(row).toContain('Molex 43025=4');
      expect(row).toContain('Pin count=4');
      expect(row).not.toContain('\t');
    });

    it('quotes mid-string = cells only for RFC 4180 reasons without tab prefix', () => {
      const bom: BomLine[] = [
        {
          partNumber: 'Molex 43025=4, rev B',
          manufacturer: 'Molex',
          description: 'Standard connector',
          quantity: 1,
          unit: 'ea',
          refdes: ['C1'],
          warnings: [],
        },
      ];
      const csv = bomToCsv(bom);
      expect(csv).toContain('"Molex 43025=4, rev B"');
      expect(csv).not.toContain('\tMolex');
    });

    it('neutralizes formula injection across all attacker-controlled fields', () => {
      const bom: BomLine[] = [
        {
          partNumber: '=EVIL_PN',
          manufacturer: '+EVIL_MANF',
          vendorPartNumber: '-EVIL_VPN',
          description: '@EVIL_DESC',
          quantity: 1,
          unit: 'ea',
          url: '=cmd|evil_url',
          parameters: [{ id: 'p1', name: '=param', qualifier: 'max', value: 10, unit: 'V' }],
          refdes: ['=C1', 'C2'],
          warnings: [],
        },
      ];
      const csv = bomToCsv(bom);
      const row = csv.trim().split('\r\n')[1]!;
      expect(row).toContain('"\t=EVIL_PN"');
      expect(row).toContain('"\t+EVIL_MANF"');
      expect(row).toContain('"\t-EVIL_VPN"');
      expect(row).toContain('"\t@EVIL_DESC"');
      expect(row).toContain('"\t=cmd|evil_url"');
      expect(row).toContain('"\t=param: max 10 V"');
      expect(row).toContain('"\t=C1; C2"');
    });
  });
});
