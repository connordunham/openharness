#!/usr/bin/env node
/**
 * openharness CLI entry point (spec §8.6).
 *
 * Implemented:
 *   openharness import <file> -o <out.ohd> [--name "My Harness"]
 *   openharness validate <file> [--format json|text] [--fail-on error|warning|info]
 *   openharness export <file> --bom <bom.csv>
 *
 * Not yet implemented (spec §12 Phase 5/6): run (automation host), query
 * (needs a jq-like expression evaluator), diff --semantic, doctor,
 * --schematic/--layout/--wiring on export (Phase 6 PDF/XLSX exporters).
 */

import { pathToFileURL } from 'node:url';
import type { DiagnosticSeverity } from '@openharness/core';
import { parseArgs, stringFlag } from './args.js';
import { runImportCommand } from './commands/import.js';
import { runValidateCommand } from './commands/validate.js';
import { runExportCommand } from './commands/export.js';

const KNOWN_COMMANDS = ['validate', 'export', 'run', 'query', 'import', 'diff', 'doctor'] as const;
const NOT_YET_IMPLEMENTED = new Set<string>(['run', 'query', 'diff', 'doctor']);

export function main(argv: string[] = process.argv.slice(2)): number {
  const [command, ...rest] = argv;

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return 0;
  }

  if (!(KNOWN_COMMANDS as readonly string[]).includes(command)) {
    console.error(`Unknown command: ${command}\n`);
    printHelp();
    return 1;
  }

  if (NOT_YET_IMPLEMENTED.has(command)) {
    console.error(`'${command}' is not implemented yet — see HARNESS-DESIGNER-SPEC.md §8.6 and §12.`);
    return 1;
  }

  const { positional, flags } = parseArgs(rest);
  const inputPath = positional[0];
  if (!inputPath) {
    console.error(`'${command}' requires a file path.`);
    return 1;
  }

  try {
    switch (command) {
      case 'import': {
        const outputPath = stringFlag(flags, 'o') ?? stringFlag(flags, 'output');
        if (!outputPath) throw new Error('import requires -o <out.ohd>');
        const result = runImportCommand({ inputPath, outputPath, name: stringFlag(flags, 'name') });
        for (const warning of result.warnings) console.warn(`warning: ${warning}`);
        console.log(`Wrote ${result.outputPath}`);
        return 0;
      }
      case 'validate': {
        const format = stringFlag(flags, 'format', 'text') as 'json' | 'text';
        const failOn = stringFlag(flags, 'fail-on') as DiagnosticSeverity | undefined;
        const result = runValidateCommand({ inputPath, format, failOn });
        process.stdout.write(result.output);
        return result.exitCode;
      }
      case 'export': {
        const bomPath = stringFlag(flags, 'bom');
        if (!bomPath) throw new Error('export requires at least one of: --bom <path>');
        const result = runExportCommand({ inputPath, bomPath });
        for (const path of result.written) console.log(`Wrote ${path}`);
        return 0;
      }
      default:
        return 1;
    }
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

function printHelp(): void {
  console.log(
    [
      'openharness <command> [options]',
      '',
      'Commands:',
      '  import <file.json> -o <out.ohd> [--name "..."]   Import a vendor JSON export',
      '  validate <file.ohd> [--format json|text] [--fail-on error|warning|info]',
      '  export <file.ohd> --bom <bom.csv>',
      '',
      `Not yet implemented: ${[...NOT_YET_IMPLEMENTED].join(', ')}`,
      '',
      'See HARNESS-DESIGNER-SPEC.md §8.6 for the full command reference.',
    ].join('\n'),
  );
}

// Only run when executed directly (not when imported by tests). Comparing
// raw strings (`file://${process.argv[1]}` vs `import.meta.url`) breaks on
// Windows — argv[1] is a native path with backslashes and no leading slash
// before the drive letter, so it never matches the properly-formed
// `file:///C:/...` URL. `pathToFileURL` builds the same kind of URL
// `import.meta.url` already is, so the comparison works on every platform.
// (Caught by actually running the built CLI as a subprocess on Windows,
// not by the unit tests — they import `main` directly and never exercise
// this branch at all.)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
