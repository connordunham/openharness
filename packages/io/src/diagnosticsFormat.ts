/** Formatting helpers for `openharness validate` (spec §8.6). */

import type { Diagnostic, DiagnosticSeverity } from '@openharness/core';

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = { error: 2, warning: 1, info: 0 };

export function diagnosticsToJson(diagnostics: Diagnostic[]): string {
  return JSON.stringify(diagnostics, null, 2) + '\n';
}

export function diagnosticsToText(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) return 'No diagnostics.\n';
  return diagnostics
    .map((d) => `[${d.severity.toUpperCase()}] ${d.ruleId}: ${d.message} (${d.targets.map((t) => `${t.kind}:${t.id}`).join(', ')})`)
    .join('\n') + '\n';
}

/** True if any diagnostic is at or above the given severity threshold — drives `--fail-on`. */
export function hasDiagnosticAtOrAbove(diagnostics: Diagnostic[], threshold: DiagnosticSeverity): boolean {
  const minRank = SEVERITY_RANK[threshold];
  return diagnostics.some((d) => SEVERITY_RANK[d.severity] >= minRank);
}
