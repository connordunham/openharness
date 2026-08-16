/** BOM CSV export (spec §9): partNumber, manufacturer, vendorPartNumber,
 * description, quantity, unit, unitPrice, extendedPrice, url, maxRating,
 * refdes, warnings. vendorPartNumber/url/maxRating added per Connor's
 * follow-up ("manf PN, vendor PN, link, cost, max rating ... should
 * translate to the parts library and BOM automatically"). */

import type { BomLine } from '@openharness/core';

const COLUMNS = [
  'partNumber', 'manufacturer', 'vendorPartNumber', 'description', 'quantity', 'unit',
  'unitPrice', 'extendedPrice', 'url', 'maxRating', 'refdes', 'warnings',
] as const;

export function bomToCsv(bom: BomLine[]): string {
  const rows = bom.map((line) => [
    line.partNumber,
    line.manufacturer,
    line.vendorPartNumber ?? '',
    line.description,
    String(line.quantity),
    line.unit,
    line.unitPrice !== undefined ? String(line.unitPrice) : '',
    line.extendedPrice !== undefined ? String(line.extendedPrice) : '',
    line.url ?? '',
    line.maxRating ? `${line.maxRating.value} ${line.maxRating.unit}` : '',
    line.refdes.join('; '),
    line.warnings.join('; '),
  ]);
  return [COLUMNS, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
