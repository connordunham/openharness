import { readFileSync, writeFileSync } from 'node:fs';
import { computeDerivedModel } from '@openharness/core';
import { parseDocument, bomToCsv } from '@openharness/io';

export interface ExportCommandOptions {
  inputPath: string;
  bomPath?: string;
  // schematicPath / layoutPath / wiringPath are Phase 6 exports (spec §9,
  // §12) — not implemented yet, so not accepted here rather than silently
  // ignored.
}

export interface ExportCommandResult {
  written: string[];
}

/** `openharness export <file> --bom bom.csv` (spec §8.6). Only --bom is implemented so far. */
export function runExportCommand(opts: ExportCommandOptions): ExportCommandResult {
  const doc = parseDocument(readFileSync(opts.inputPath, 'utf-8'));
  const { bom } = computeDerivedModel(doc);
  const written: string[] = [];

  if (opts.bomPath) {
    writeFileSync(opts.bomPath, bomToCsv(bom), 'utf-8');
    written.push(opts.bomPath);
  }

  return { written };
}
