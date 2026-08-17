/**
 * The `.ohd` file format: our own document, serialised as JSON with stable,
 * recursively-sorted object keys (spec §4.1 / §10 — "stable key order,
 * git-diffable"). Two documents differing in only one field should produce
 * a one-line diff, not a reordered blob.
 *
 * SCOPE NOTE: this is the single-file JSON form. Spec §10 (and review R11)
 * call for a *directory* format for real multi-file git merges — that's a
 * deliberate later step once there's an actual multi-entity-touching
 * automation to motivate it; single-file is the right amount of format for
 * where the project is now (import → validate → BOM), and it's what the
 * round-trip test in `ohdFormat.test.ts` exercises.
 */

import type { HarnessDocument } from '@openharness/core';
import { migrateLegacyFields } from '@openharness/core';

const CURRENT_FORMAT_VERSION = 1;

export function serializeDocument(doc: HarnessDocument): string {
  return JSON.stringify(sortKeysDeep(doc), null, 2) + '\n';
}

export function parseDocument(json: string): HarnessDocument {
  const parsed: unknown = JSON.parse(json);
  if (!isPlainObject(parsed)) {
    throw new Error('Not a valid .ohd document: expected a JSON object at the top level.');
  }
  if (parsed.formatVersion !== CURRENT_FORMAT_VERSION) {
    throw new Error(
      `Unrecognised .ohd formatVersion ${JSON.stringify(parsed.formatVersion)} — expected ${CURRENT_FORMAT_VERSION}. ` +
        'No migrations exist yet for older formatVersions.',
    );
  }
  // Structural trust boundary: this does not deep-validate the document
  // against the type model (that's what `validate` / the DRC rules are
  // for). It only confirms the file is well-formed JSON with the field this
  // whole format is versioned on.
  //
  // The load boundary is also where legacy field shapes are normalised, so
  // nothing downstream ever has to know two spellings of the same field —
  // see migrateLegacyFields for why these don't warrant a formatVersion bump.
  return migrateLegacyFields(parsed as unknown as HarnessDocument);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeysDeep(value[key]);
    return sorted;
  }
  return value;
}
