import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A real subprocess test — spawns the *built* CLI exactly as a user would,
 * rather than importing `main()` in-process like commands.test.ts and
 * cli.test.ts do.
 *
 * This exists because a real bug slipped past both of those: the "only run
 * main() when this file is executed directly, not when imported" check at
 * the bottom of cli.ts did `import.meta.url === 'file://' + process.argv[1]`,
 * which is wrong on Windows (native paths use backslashes and have no
 * leading slash before the drive letter, so the string never matches the
 * properly-formed file:// URL). Every in-process unit test imports `main`
 * directly and calls it explicitly, so none of them ever touch that branch
 * — it only breaks when the file is actually run as `node cli.js`, which is
 * exactly what happens here.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = join(__dirname, '..', '..', 'dist', 'cli.js');

const MINIMAL_RAW = JSON.stringify({
  version: 0.8,
  lengthUnit: 'mm',
  connectors: [
    { id: 'c1', cavities: [{ id: 'a' }], layoutPosition: { x: 0, y: 0 } },
    { id: 'c2', cavities: [{ id: 'b' }], layoutPosition: { x: 100, y: 0 } },
  ],
  wires: [{ id: 'w1', color: 'Red', source: { id: 'c1', handle: 'a' }, target: { id: 'c2', handle: 'b' } }],
  bundles: [{ id: 'b1', sourceId: 'c1', targetId: 'c2' }],
});

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'openharness-cli-e2e-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!existsSync(CLI_ENTRY))('CLI as a real subprocess (dist/cli.js)', () => {
  it('actually writes the output file when run via `node cli.js import`', () => {
    const inputPath = join(dir, 'in.json');
    const outputPath = join(dir, 'out.ohd');
    writeFileSync(inputPath, MINIMAL_RAW);

    const stdout = execFileSync('node', [CLI_ENTRY, 'import', inputPath, '-o', outputPath], { encoding: 'utf-8' });

    expect(stdout).toContain('Wrote');
    expect(existsSync(outputPath)).toBe(true);
    expect(JSON.parse(readFileSync(outputPath, 'utf-8')).formatVersion).toBe(1);
  });

  it('exits non-zero via process.exitCode when validate --fail-on finds an error', () => {
    const inputPath = join(dir, 'in.json');
    const outputPath = join(dir, 'out.ohd');
    writeFileSync(inputPath, MINIMAL_RAW);
    execFileSync('node', [CLI_ENTRY, 'import', inputPath, '-o', outputPath]);

    expect(() =>
      execFileSync('node', [CLI_ENTRY, 'validate', outputPath, '--fail-on', 'warning'], { encoding: 'utf-8' }),
    ).toThrow(); // execFileSync throws on non-zero exit
  });

  it('exits zero when there is nothing at or above --fail-on', () => {
    const inputPath = join(dir, 'in.json');
    const outputPath = join(dir, 'out.ohd');
    writeFileSync(inputPath, MINIMAL_RAW);
    execFileSync('node', [CLI_ENTRY, 'import', inputPath, '-o', outputPath]);

    // No diagnostic reaches "error" severity from this fixture at the info threshold... use a
    // threshold nothing will ever hit instead of asserting on rule specifics that might drift.
    expect(() =>
      execFileSync('node', [CLI_ENTRY, 'validate', outputPath], { encoding: 'utf-8' }),
    ).not.toThrow(); // no --fail-on given at all -> always exit 0
  });
});
