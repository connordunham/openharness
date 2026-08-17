import { describe, it, expect } from 'vitest';
import { createEmptyDocument, migrateLegacyFields, type Wire, type WireGroup, type WirePart } from '../index.js';

/**
 * These tests deliberately build the LEGACY shapes by casting, because the
 * whole point of the migration is that those field names no longer exist on
 * the type model. If a future refactor makes these casts unnecessary, the
 * migration has stopped being a migration.
 */
describe('migrateLegacyFields', () => {
  it('converts a single schematicWaypoint into the waypoint array', () => {
    const doc = createEmptyDocument('m');
    const wire = {
      id: 'w1', refdes: 'W1', color: 'Red', custom: {},
      source: { kind: 'free', point: { x: 0, y: 0 } },
      target: { kind: 'free', point: { x: 10, y: 10 } },
      schematicWaypoint: { x: 5, y: 40 },
    } as unknown as Wire;
    doc.wires['w1'] = wire;

    migrateLegacyFields(doc);

    expect(doc.wires['w1']!.schematicWaypoints).toEqual([{ x: 5, y: 40 }]);
    expect((doc.wires['w1'] as unknown as Record<string, unknown>)['schematicWaypoint']).toBeUndefined();
  });

  it('leaves an already-migrated waypoint array alone rather than prepending to it', () => {
    // A document written by the new build and then somehow round-tripped
    // through the old field must not end up with the legacy bend inserted
    // into a list the user has since edited.
    const doc = createEmptyDocument('m');
    doc.wires['w1'] = {
      id: 'w1', refdes: 'W1', color: 'Red', custom: {},
      source: { kind: 'free', point: { x: 0, y: 0 } },
      target: { kind: 'free', point: { x: 10, y: 10 } },
      schematicWaypoints: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
      schematicWaypoint: { x: 99, y: 99 },
    } as unknown as Wire;

    migrateLegacyFields(doc);

    expect(doc.wires['w1']!.schematicWaypoints).toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }]);
  });

  it('converts a legacy maxRating into one max-qualified parameter, keeping its unit', () => {
    const doc = createEmptyDocument('m');
    doc.parts['p1'] = {
      id: 'p1', kind: 'wire', gauge: { value: 0.5, unit: 'mm2' }, custom: {},
      maxRating: { value: 600, unit: 'V' },
    } as unknown as WirePart;

    migrateLegacyFields(doc);

    expect(doc.parts['p1']!.parameters).toEqual([
      { id: 'migrated-maxrating-p1', name: 'Max rating', qualifier: 'max', value: 600, unit: 'V' },
    ]);
    expect((doc.parts['p1'] as unknown as Record<string, unknown>)['maxRating']).toBeUndefined();
  });

  it('puts the migrated rating first, ahead of any parameters already present', () => {
    const doc = createEmptyDocument('m');
    doc.parts['p1'] = {
      id: 'p1', kind: 'generic', custom: {},
      parameters: [{ id: 'x', name: 'Mating cycles', qualifier: 'min', value: 500, unit: 'cycles' }],
      maxRating: { value: 5, unit: 'A' },
    } as unknown as WirePart;

    migrateLegacyFields(doc);

    expect(doc.parts['p1']!.parameters!.map((p) => p.name)).toEqual(['Max rating', 'Mating cycles']);
  });

  it('seeds WireGroup.twisted from kind so existing documents look unchanged', () => {
    const doc = createEmptyDocument('m');
    doc.wireGroups['g1'] = { id: 'g1', kind: 'twist', memberWireIds: [], memberGroupIds: [], custom: {} } as WireGroup;
    doc.wireGroups['g2'] = { id: 'g2', kind: 'cable', memberWireIds: [], memberGroupIds: [], custom: {} } as WireGroup;

    migrateLegacyFields(doc);

    expect(doc.wireGroups['g1']!.twisted).toBe(true);
    expect(doc.wireGroups['g2']!.twisted).toBe(false);
  });

  it('never overwrites an explicit twisted flag', () => {
    // The decoupling is the point: a cable the user has explicitly marked
    // twisted must not be un-twisted by a later load.
    const doc = createEmptyDocument('m');
    doc.wireGroups['g1'] = {
      id: 'g1', kind: 'cable', twisted: true, memberWireIds: [], memberGroupIds: [], custom: {},
    } as WireGroup;

    migrateLegacyFields(doc);

    expect(doc.wireGroups['g1']!.twisted).toBe(true);
  });

  it('is idempotent — running it twice changes nothing further', () => {
    const doc = createEmptyDocument('m');
    doc.parts['p1'] = {
      id: 'p1', kind: 'generic', custom: {}, maxRating: { value: 1, unit: 'A' },
    } as unknown as WirePart;

    migrateLegacyFields(doc);
    const afterFirst = JSON.stringify(doc);
    migrateLegacyFields(doc);

    expect(JSON.stringify(doc)).toBe(afterFirst);
  });
});
