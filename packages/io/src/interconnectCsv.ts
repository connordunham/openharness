/**
 * Interconnect table CSV (Connor's follow-up: "add a new type of
 * window/export format... bidirectionally convertible" with the Schematic).
 *
 * `toInterconnectCsv` is the read-only export half — same shape as
 * bomCsv.ts, just walking `DerivedModel.interconnect` (core's
 * `computeInterconnectTable`) instead of `.bom`.
 *
 * `fromInterconnectCsv` is the other half: a plain CSV parser (RFC4180-ish
 * — quoted fields, doubled-quote escaping, CRLF or LF) that hands back raw
 * string rows rather than a `HarnessDocument` mutation, because turning a
 * row into real connectors/cavities/wires is a document *edit*
 * (create-if-missing, pick a wire color, auto-place in both panes) and that
 * kind of mutation lives at the app layer next to every other editing
 * helper (packages/app/src/interconnectEdit.ts) — this module only owns the
 * text <-> rows boundary, same division bomCsv.ts already draws between
 * "format" (io) and "derive"/"edit" (core/app).
 */

import type { InterconnectRow } from '@openharness/core';

const COLUMNS = [
  'wireRefdes', 'fromComponentRefdes', 'fromDesignation', 'fromSignal', 'fromDirection', 'fromImpedanceMatched',
  'toComponentRefdes', 'toDesignation', 'toSignal', 'toDirection', 'toImpedanceMatched', 'resolvedDirection', 'color',
] as const;

export function interconnectToCsv(rows: InterconnectRow[]): string {
  const body = rows.map((r) => [
    r.wireRefdes,
    r.fromComponentRefdes,
    r.fromDesignation ?? '',
    r.fromSignal ?? '',
    r.fromDirection ?? '',
    r.fromImpedanceMatched ? 'yes' : '',
    r.toComponentRefdes,
    r.toDesignation ?? '',
    r.toSignal ?? '',
    r.toDirection ?? '',
    r.toImpedanceMatched ? 'yes' : '',
    r.resolved,
    '',
  ]);
  return [COLUMNS, ...body].map((row) => row.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

/**
 * Escapes a cell for CSV output per RFC 4180, hardened against spreadsheet
 * formula injection (CWE-1236).
 *
 * Cells starting with `=`, `+`, `-`, or `@` (after stripping leading whitespace)
 * are force-quoted and prefixed with a tab character (`\t`). Prefixing with a tab
 * neutralizes formula execution in Excel, LibreOffice, and Google Sheets by
 * forcing cell evaluation to plain text, while avoiding visible artifact characters
 * (unlike a leading single-quote `'` which can display literally in CSV viewers).
 */
function csvEscape(value: string): string {
  if (/^\s*[=+@\-]/.test(value)) {
    return `"\t${value.replace(/"/g, '""')}"`;
  }
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** One parsed CSV row, header-mapped — every field optional/string since
 * this is untrusted external input (a hand-edited or 3rd-party interconnect
 * table), not the app's own already-typed model. `interconnectEdit.ts`
 * validates/defaults each field as it applies the row. */
export interface InterconnectCsvRow {
  wireRefdes?: string;
  fromComponentRefdes: string;
  fromDesignation?: string;
  fromSignal?: string;
  fromDirection?: string;
  fromImpedanceMatched?: string;
  toComponentRefdes: string;
  toDesignation?: string;
  toSignal?: string;
  toDirection?: string;
  toImpedanceMatched?: string;
  color?: string;
}

export function interconnectFromCsv(text: string): InterconnectCsvRow[] {
  const table = parseCsv(text);
  if (table.length === 0) return [];
  const header = table[0]!.map((h) => h.trim());
  const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iWireRefdes = idx('wireRefdes');
  const iFromRefdes = idx('fromComponentRefdes');
  const iFromDes = idx('fromDesignation');
  const iFromSig = idx('fromSignal');
  const iFromDir = idx('fromDirection');
  const iFromZ = idx('fromImpedanceMatched');
  const iToRefdes = idx('toComponentRefdes');
  const iToDes = idx('toDesignation');
  const iToSig = idx('toSignal');
  const iToDir = idx('toDirection');
  const iToZ = idx('toImpedanceMatched');
  const iColor = idx('color');

  const get = (row: string[], i: number): string | undefined => (i >= 0 ? row[i]?.trim() || undefined : undefined);

  return table.slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ''))
    .map((row) => ({
      wireRefdes: get(row, iWireRefdes),
      fromComponentRefdes: get(row, iFromRefdes) ?? '',
      fromDesignation: get(row, iFromDes),
      fromSignal: get(row, iFromSig),
      fromDirection: get(row, iFromDir),
      fromImpedanceMatched: get(row, iFromZ),
      toComponentRefdes: get(row, iToRefdes) ?? '',
      toDesignation: get(row, iToDes),
      toSignal: get(row, iToSig),
      toDirection: get(row, iToDir),
      toImpedanceMatched: get(row, iToZ),
      color: get(row, iColor),
    }))
    .filter((r) => r.fromComponentRefdes && r.toComponentRefdes);
}

/** Minimal RFC4180-ish CSV parser: quoted fields, `""` escaping inside
 * quotes, CRLF or LF line endings. Good enough for round-tripping this
 * module's own export plus reasonably well-formed spreadsheet exports —
 * not a full spec implementation (no support for embedded raw newlines
 * outside quotes, which no well-formed CSV producer emits anyway). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  while (i < n) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { endField(); i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { endRow(); i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}
