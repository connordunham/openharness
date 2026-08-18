/**
 * In-place migrations for fields whose shape changed after documents were
 * already being written to disk.
 *
 * This is deliberately NOT a `formatVersion` bump. A formatVersion bump is
 * for changes that make an old file unreadable by a new build; every
 * migration here is additive or renaming, so an un-migrated document still
 * loads and still typechecks — it just renders with a stale default. The
 * bar for bumping the version (and writing a real up/down migration chain)
 * is a change that would *lose* or *misread* data, and none of these do.
 *
 * Call this once at the load boundary (`parseDocument`, and the
 * vendor-JSON importer's output) rather than defensively at every read
 * site. Reading legacy shapes in the renderer forever is how a codebase ends
 * up with two sources of truth for one field, which is exactly what the
 * orphaned `schematicWaypoint` had already started doing.
 */

import type { HarnessDocument, PartParameter, Point } from './types.js';

/** Shapes this file knows how to read but the type model no longer declares.
 * Kept local: nothing outside migration should ever see these. */
interface LegacyWire {
  schematicWaypoint?: Point;
}
interface LegacyPart {
  maxRating?: { value: number; unit: string };
}

export function migrateLegacyFields(doc: HarnessDocument): HarnessDocument {
  migrateWireWaypoints(doc);
  migratePartMaxRating(doc);
  migrateWireGroupTwisted(doc);
  return doc;
}

/**
 * `Wire.schematicWaypoint?: Point` (a single manual bend) became
 * `schematicWaypoints?: Point[]` when drag-to-bend was reimplemented with
 * support for an arbitrary number of bends. A document written by the build
 * that had the singular field keeps its bend.
 */
function migrateWireWaypoints(doc: HarnessDocument): void {
  for (const wire of Object.values(doc.wires)) {
    const legacy = (wire as unknown as LegacyWire).schematicWaypoint;
    if (!legacy) continue;
    if (!wire.schematicWaypoints || wire.schematicWaypoints.length === 0) {
      wire.schematicWaypoints = [legacy];
    }
    delete (wire as unknown as LegacyWire).schematicWaypoint;
  }
}

/**
 * `PartBase.maxRating?: { value, unit }` became the repeatable
 * `parameters: PartParameter[]`. The old field was always a maximum of some
 * single quantity, so it converts exactly: one parameter, qualifier 'max'.
 * The name is generic ("Max rating") because the old shape genuinely didn't
 * record which quantity it was — the unit was the only hint, and inferring
 * "V means voltage rating" would be putting words in the document's mouth.
 */
function migratePartMaxRating(doc: HarnessDocument): void {
  for (const part of Object.values(doc.parts)) {
    const legacy = (part as unknown as LegacyPart).maxRating;
    if (!legacy) continue;
    const migrated: PartParameter = {
      id: `migrated-maxrating-${part.id}`,
      name: 'Max rating',
      qualifier: 'max',
      value: legacy.value,
      unit: legacy.unit,
    };
    part.parameters = [migrated, ...(part.parameters ?? [])];
    delete (part as unknown as LegacyPart).maxRating;
  }
}

/**
 * The twisted *visual* used to be implied by `WireGroup.kind === 'twist'`;
 * it's now the explicit `twisted` flag. Seeding it from `kind` means every
 * pre-existing document draws exactly as it did before, and only diverges
 * once the user actually toggles the new checkbox.
 */
function migrateWireGroupTwisted(doc: HarnessDocument): void {
  for (const group of Object.values(doc.wireGroups)) {
    if (group.twisted === undefined) group.twisted = group.kind === 'twist';
  }
}
