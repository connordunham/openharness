/**
 * BOM CSV export (spec §9): partNumber, manufacturer, vendorPartNumber,
 * description, quantity, unit, unitPrice, extendedPrice, url, parameters,
 * refdes, warnings. vendorPartNumber/url added per Connor's follow-up
 * ("manf PN, vendor PN, link, cost ... should translate to the parts library
 * and BOM automatically").
 *
 * The `parameters` column replaces the former single `maxRating` column. It
 * stays ONE column, semicolon-joined, rather than fanning out to a column
 * per parameter name: parameter names are user-defined and vary per part, so
 * a column-per-name layout would produce a CSV whose column set changes
 * depending on which parts happen to be in this harness — not a stable
 * export, and not diffable between revisions of the same design. The
 * separator matches the `refdes` and `warnings` columns, which already join
 * lists the same way.
 */

import type { BomLine } from '@openharness/core';
import { formatParameter } from '@openharness/core';

const COLUMNS = [
  'partNumber', 'manufacturer', 'vendorPartNumber', 'description', 'quantity', 'unit',
  'unitPrice', 'extendedPrice', 'url', 'parameters', 'refdes', 'warnings',
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
    (line.parameters ?? []).map(formatParameter).join('; '),
    line.refdes.join('; '),
    line.warnings.join('; '),
  ]);
  return [COLUMNS, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
