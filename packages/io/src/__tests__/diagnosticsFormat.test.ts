import { describe, it, expect } from 'vitest';
import { diagnosticsToJson, diagnosticsToText, hasDiagnosticAtOrAbove } from '../diagnosticsFormat.js';
import type { Diagnostic } from '@openharness/core';

const diagnostics: Diagnostic[] = [
  { ruleId: 'NO_ROUTE', severity: 'warning', message: 'W1 has no path', targets: [{ kind: 'wire', id: 'w1' }] },
  { ruleId: 'DUPLICATE_REFDES', severity: 'error', message: 'C1 used twice', targets: [{ kind: 'component', id: 'c1' }] },
];

describe('diagnostics formatting', () => {
  it('formats as valid, parseable JSON', () => {
    expect(JSON.parse(diagnosticsToJson(diagnostics))).toEqual(diagnostics);
  });

  it('formats as readable text with severity prefixes', () => {
    const text = diagnosticsToText(diagnostics);
    expect(text).toContain('[WARNING] NO_ROUTE');
    expect(text).toContain('[ERROR] DUPLICATE_REFDES');
  });

  it('reports "no diagnostics" for an empty list', () => {
    expect(diagnosticsToText([])).toBe('No diagnostics.\n');
  });

  it('--fail-on error only trips on error, not warning', () => {
    expect(hasDiagnosticAtOrAbove(diagnostics, 'error')).toBe(true);
    expect(hasDiagnosticAtOrAbove([diagnostics[0]!], 'error')).toBe(false);
  });

  it('--fail-on warning trips on both warning and error', () => {
    expect(hasDiagnosticAtOrAbove([diagnostics[0]!], 'warning')).toBe(true);
    expect(hasDiagnosticAtOrAbove([diagnostics[1]!], 'warning')).toBe(true);
  });
});
