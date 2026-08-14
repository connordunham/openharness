import { readFileSync, writeFileSync } from 'node:fs';
import { importVendorJson, serializeDocument, type RawHarnessDocument } from '@openharness/io';

export interface ImportCommandOptions {
  inputPath: string;
  outputPath: string;
  name?: string;
}

export interface ImportCommandResult {
  warnings: string[];
  outputPath: string;
}

/** `openharness import <file> --from vendor-json -o out.ohd` (spec §8.6). */
export function runImportCommand(opts: ImportCommandOptions): ImportCommandResult {
  const raw: RawHarnessDocument = JSON.parse(readFileSync(opts.inputPath, 'utf-8'));
  const { document, report } = importVendorJson(raw, opts.name ?? opts.inputPath);
  writeFileSync(opts.outputPath, serializeDocument(document), 'utf-8');
  return { warnings: report.warnings, outputPath: opts.outputPath };
}
