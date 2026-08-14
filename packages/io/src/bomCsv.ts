/** BOM CSV export (spec §9): partNumber, manufacturer, description, quantity, unit, unitPrice, extendedPrice, refdes, warnings. */

import type { BomLine } from '@openharness/core';

const COLUMNS = [
  'partNumber', 'manufacturer', 'description', 'quantity', 'unit',
  'unitPrice', 'extendedPrice', 'refdes', 'warnings',
] as const;

export function bomToCsv(bom: BomLine[]): string {
  const rows = bom.map((line) => [
    line.partNumber,
    line.manufacturer,
    line.description,
    String(line.quantity),
    line.unit,
    line.unitPrice !== undefined ? String(line.unitPrice) : '',
    line.extendedPrice !== undefined ? String(line.extendedPrice) : '',
    line.refdes.join('; '),
    line.warnings.join('; '),
  ]);
  return [COLUMNS, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
