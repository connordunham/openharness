#!/usr/bin/env node
/**
 * openharness CLI entry point (spec §8.6):
 *   openharness validate  <file> --format json --fail-on error
 *   openharness export    <file> --bom bom.csv --wiring wiring.xlsx --schematic sch.pdf --layout lay.pdf
 *   openharness run       <file> --automation <id> --command <cmd> --write
 *   openharness query     <file> --jq '<expr>'
 *   openharness import    <file> --from vendor-json|kicad --merge -o out.ohd
 *   openharness diff      <a> <b> --semantic
 *   openharness doctor    <file>
 *
 * SCAFFOLDING — command parsing and dispatch land with Phase 1 (spec §12).
 * This entry point exists so `openharness --help` resolves once the package
 * is built and linked, but no subcommands are implemented yet.
 */

const [, , command] = process.argv;

const KNOWN_COMMANDS = ['validate', 'export', 'run', 'query', 'import', 'diff', 'doctor'] as const;

function main(): void {
  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }
  if (!(KNOWN_COMMANDS as readonly string[]).includes(command)) {
    console.error(`Unknown command: ${command}\n`);
    printHelp();
    process.exitCode = 1;
    return;
  }
  console.error(`'${command}' is not implemented yet — see HARNESS-DESIGNER-SPEC.md §8.6 and §12 (Phase 1).`);
  process.exitCode = 1;
}

function printHelp(): void {
  console.log(`openharness <command> [options]\n\nCommands:\n  ${KNOWN_COMMANDS.join('\n  ')}\n\nSee HARNESS-DESIGNER-SPEC.md §8.6 for the full command reference.`);
}

main();
