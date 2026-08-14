import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createEmptyDocument, computeDerivedModel } from '@openharness/core';
import { serializeDocument, parseDocument } from '../ohdFormat.js';
import { importVendorJson } from '../importVendorJson.js';
import type { RawHarnessDocument } from '../vendorRawFormat.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function sortedEntries<K, V>(map: Map<K, V>): [K, V][] {
  return [...map.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)));
}

describe('ohdFormat', () => {
  it('round-trips an empty document', () => {
    const doc = createEmptyDocument('Round Trip Test');
    const parsed = parseDocument(serializeDocument(doc));
    expect(parsed).toEqual(doc);
  });

  it('round-trips the imported real reference document, and the derived model matches before/after', () => {
    const raw: RawHarnessDocument = JSON.parse(
      readFileSync(join(__dirname, 'fixtures', 'reference-harness.json'), 'utf-8'),
    );
    const { document: original } = importVendorJson(raw);
    const roundTripped = parseDocument(serializeDocument(original));

    expect(roundTripped).toEqual(original);
    // Compare Map-bearing fields as sorted [key, value] pairs — Map equality
    // in vitest is iteration-order sensitive, but `.ohd` serialisation
    // deliberately reorders object keys (that's the whole point, spec §10),
    // which reorders `Object.entries(doc.wires)` and therefore the order
    // routes/lengths/etc. get inserted into their Maps. That's a cosmetic
    // difference, not a correctness one — nothing should ever rely on Map
    // iteration order here, only on `.get(key)`.
    const a = computeDerivedModel(original);
    const b = computeDerivedModel(roundTripped);
    // Map iteration order is not something anything should rely on (only
    // `.get(key)` is), so compare as sorted entries rather than via Map
    // equality, which is order-sensitive. Array-valued outputs
    // (nets/bom/diagnostics) are sorted deterministically by
    // `computeDerivedModel` itself, so a plain `toEqual` is enough for them.
    expect(sortedEntries(a.wireRoutes)).toEqual(sortedEntries(b.wireRoutes));
    expect(sortedEntries(a.wireLengths)).toEqual(sortedEntries(b.wireLengths));
    expect(sortedEntries(a.bundleContents)).toEqual(sortedEntries(b.bundleContents));
    expect(sortedEntries(a.bundleDiameters)).toEqual(sortedEntries(b.bundleDiameters));
    expect(a.nets).toEqual(b.nets);
    expect(a.bom).toEqual(b.bom);
    expect(a.diagnostics).toEqual(b.diagnostics);
  });

  it('produces stable, alphabetically-sorted keys at every level', () => {
    const doc = createEmptyDocument('Z Document');
    const json = serializeDocument(doc);
    // "components" (c) must appear before "meta" (m) must appear before "settings" (s),
    // regardless of the order fields were assigned in createEmptyDocument.
    expect(json.indexOf('"components"')).toBeLessThan(json.indexOf('"meta"'));
    expect(json.indexOf('"meta"')).toBeLessThan(json.indexOf('"settings"'));
  });

  it('rejects a document with the wrong formatVersion', () => {
    expect(() => parseDocument(JSON.stringify({ formatVersion: 99 }))).toThrow(/formatVersion/);
  });

  it('rejects non-object JSON', () => {
    expect(() => parseDocument(JSON.stringify([1, 2, 3]))).toThrow(/valid \.ohd document/);
  });
});
