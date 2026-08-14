import { readFileSync } from 'node:fs';
import { computeDerivedModel, type DiagnosticSeverity } from '@openharness/core';
import { parseDocument, diagnosticsToJson, diagnosticsToText, hasDiagnosticAtOrAbove } from '@openharness/io';

export interface ValidateCommandOptions {
  inputPath: string;
  format?: 'json' | 'text';
  failOn?: DiagnosticSeverity;
}

export interface ValidateCommandResult {
  output: string;
  /** 1 if a diagnostic at or above `--fail-on` was found, else 0 — for `openharness validate ... --fail-on error` in CI (spec §11). */
  exitCode: 0 | 1;
}

/** `openharness validate <file> --format json --fail-on error` (spec §8.6). */
export function runValidateCommand(opts: ValidateCommandOptions): ValidateCommandResult {
  const doc = parseDocument(readFileSync(opts.inputPath, 'utf-8'));
  const { diagnostics } = computeDerivedModel(doc);
  const output = opts.format === 'json' ? diagnosticsToJson(diagnostics) : diagnosticsToText(diagnostics);
  const exitCode = opts.failOn && hasDiagnosticAtOrAbove(diagnostics, opts.failOn) ? 1 : 0;
  return { output, exitCode };
}
