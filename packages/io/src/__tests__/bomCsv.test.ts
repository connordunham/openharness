import { describe, it, expect } from 'vitest';
import { bomToCsv } from '../bomCsv.js';
import type { BomLine } from '@openharness/core';

describe('bomToCsv', () => {
  it('writes a header row followed by one row per BOM line', () => {
    const bom: BomLine[] = [
      {
        partId: 'p1', partNumber: 'MX-1', manufacturer: 'Molex', vendorPartNumber: 'DK-MX-1', description: 'Connector',
        quantity: 2, unit: 'ea', unitPrice: 2.5, extendedPrice: 5, url: 'https://example.com/mx-1',
        maxRating: { value: 250, unit: 'V' }, refdes: ['C1', 'C2'], warnings: [],
      },
    ];
    const csv = bomToCsv(bom);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('partNumber,manufacturer,vendorPartNumber,description,quantity,unit,unitPrice,extendedPrice,url,maxRating,refdes,warnings');
    expect(lines[1]).toBe('MX-1,Molex,DK-MX-1,Connector,2,ea,2.5,5,https://example.com/mx-1,250 V,C1; C2,');
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
});
