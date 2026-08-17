import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyDocument } from '@openharness/core';
import { serializeDocument } from '@openharness/io';
import { runImportCommand } from '../commands/import.js';
import { runValidateCommand } from '../commands/validate.js';
import { runExportCommand } from '../commands/export.js';

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
  dir = mkdtempSync(join(tmpdir(), 'openharness-cli-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('runImportCommand', () => {
  it('imports a raw JSON export and writes a valid .ohd file', () => {
    const inputPath = join(dir, 'in.json');
    const outputPath = join(dir, 'out.ohd');
    writeFileSync(inputPath, MINIMAL_RAW);

    const result = runImportCommand({ inputPath, outputPath });

    expect(result.warnings).toEqual([]);
    const written = readFileSync(outputPath, 'utf-8');
    expect(JSON.parse(written).formatVersion).toBe(1);
    expect(Object.keys(JSON.parse(written).components)).toHaveLength(2);
  });
});

describe('runValidateCommand', () => {
  it('reports MISSING_PART as text by default (the fixture has no parts assigned)', () => {
    const inputPath = join(dir, 'doc.ohd');
    writeFileSync(inputPath, MINIMAL_RAW);
    const importedPath = join(dir, 'imported.ohd');
    runImportCommand({ inputPath, outputPath: importedPath });

    const result = runValidateCommand({ inputPath: importedPath });
    expect(result.output).toContain('[WARNING] MISSING_PART');
    expect(result.exitCode).toBe(0); // no --fail-on given
  });

  it('exits 1 when --fail-on matches a present diagnostic severity', () => {
    const inputPath = join(dir, 'doc.ohd');
    writeFileSync(inputPath, MINIMAL_RAW);
    const importedPath = join(dir, 'imported.ohd');
    runImportCommand({ inputPath, outputPath: importedPath });

    const result = runValidateCommand({ inputPath: importedPath, failOn: 'warning' });
    expect(result.exitCode).toBe(1);
  });

  it('outputs valid JSON when --format json is given', () => {
    const doc = createEmptyDocument('Empty');
    const path = join(dir, 'empty.ohd');
    writeFileSync(path, serializeDocument(doc));

    const result = runValidateCommand({ inputPath: path, format: 'json' });
    expect(JSON.parse(result.output)).toEqual([]);
  });
});

describe('runExportCommand', () => {
  it('writes a BOM CSV', () => {
    const inputPath = join(dir, 'doc.ohd');
    writeFileSync(inputPath, MINIMAL_RAW);
    const importedPath = join(dir, 'imported.ohd');
    runImportCommand({ inputPath, outputPath: importedPath });

    const bomPath = join(dir, 'bom.csv');
    const result = runExportCommand({ inputPath: importedPath, bomPath });

    expect(result.written).toEqual([bomPath]);
    const csv = readFileSync(bomPath, 'utf-8');
    expect(csv.split('\r\n')[0]).toBe('partNumber,manufacturer,vendorPartNumber,description,quantity,unit,unitPrice,extendedPrice,url,parameters,refdes,warnings');
  });
});
