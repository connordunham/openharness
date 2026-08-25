import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  openPartsDatabase,
  PartsDatabase,
  replayPartRevisions,
  areValuesEqual,
  computeDiffs,
  CONNECTOR_FIELDS,
  WIRE_SPEC_FIELDS,
} from '../index.js';

describe('T17 — Part Versioning and Revision Log (@openharness/parts)', () => {
  let db: PartsDatabase;

  beforeEach(() => {
    db = openPartsDatabase(':memory:');
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // already closed
    }
  });

  // Acceptance test 1: edit one field → version 1→2, exactly one log row, correct old and new
  it('editing one field bumps version 1->2, writes exactly one log row with correct old and new', () => {
    const conn = db.createConnector({
      part_number: 'CONN-T17-01',
      cavity_count: 2,
      temp_max: 105,
      version: 1,
    });
    expect(conn.version).toBe(1);

    const updated = db.updateConnector(
      'CONN-T17-01',
      { temp_max: 125 },
      'alice',
    );

    expect(updated.version).toBe(2);
    expect(updated.temp_max).toBe(125);

    const logs = db.getPartRevisionLogs('CONN-T17-01', 'connector');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual({
      id: expect.any(Number),
      part_number: 'CONN-T17-01',
      part_type: 'connector',
      version: 2,
      field_name: 'temp_max',
      old_value: '105',
      new_value: '125',
      changed_date: expect.any(String),
      changed_by: 'alice',
    });
  });

  // Acceptance test 2: edit three fields in one call → one version bump, three rows, same version
  it('editing three fields in one call bumps version once and writes three rows sharing the new version', () => {
    db.createConnector({
      part_number: 'CONN-T17-02',
      cavity_count: 4,
      gender: 'plug',
      ratings: '10A, 12V',
      temp_min: -40,
      version: 1,
    });

    const updated = db.updateConnector(
      'CONN-T17-02',
      {
        gender: 'receptacle',
        ratings: '15A, 24V',
        temp_min: -50,
      },
      'bob',
    );

    expect(updated.version).toBe(2);
    expect(updated.gender).toBe('receptacle');
    expect(updated.ratings).toBe('15A, 24V');
    expect(updated.temp_min).toBe(-50);

    const logs = db.getPartRevisionLogs('CONN-T17-02', 'connector');
    expect(logs).toHaveLength(3);
    for (const log of logs) {
      expect(log.version).toBe(2);
      expect(log.changed_by).toBe('bob');
    }

    const fieldsChanged = logs.map(l => l.field_name).sort();
    expect(fieldsChanged).toEqual(['gender', 'ratings', 'temp_min']);

    const genderLog = logs.find(l => l.field_name === 'gender');
    expect(genderLog?.old_value).toBe('plug');
    expect(genderLog?.new_value).toBe('receptacle');

    const ratingsLog = logs.find(l => l.field_name === 'ratings');
    expect(ratingsLog?.old_value).toBe('10A, 12V');
    expect(ratingsLog?.new_value).toBe('15A, 24V');

    const tempLog = logs.find(l => l.field_name === 'temp_min');
    expect(tempLog?.old_value).toBe('-40');
    expect(tempLog?.new_value).toBe('-50');
  });

  // Acceptance test 3: save with no changes → version unchanged, zero rows, last_modified_date unchanged
  it('saving with no changes keeps version and last_modified_date unchanged, and writes zero log rows', () => {
    const initialDate = '2026-08-20T10:00:00.000Z';
    db.createConnector({
      part_number: 'CONN-T17-03',
      cavity_count: 6,
      gender: 'receptacle',
      temp_min: -40,
      temp_max: 125,
      last_modified_date: initialDate,
    });

    // Save with identical values
    const resultSameValues = db.updateConnector('CONN-T17-03', {
      cavity_count: 6,
      gender: 'receptacle',
      temp_min: -40,
      temp_max: 125,
      last_modified_date: '2026-08-25T12:00:00.000Z',
    });

    expect(resultSameValues.version).toBe(1);
    expect(resultSameValues.last_modified_date).toBe(initialDate);

    // Save with empty update
    const resultEmpty = db.updateConnector('CONN-T17-03', {});
    expect(resultEmpty.version).toBe(1);
    expect(resultEmpty.last_modified_date).toBe(initialDate);

    // Verify row in DB directly
    const stored = db.getConnectorByPartNumber('CONN-T17-03');
    expect(stored?.version).toBe(1);
    expect(stored?.last_modified_date).toBe(initialDate);

    // Verify zero revision rows
    const logs = db.getPartRevisionLogs('CONN-T17-03');
    expect(logs).toHaveLength(0);
  });

  // Acceptance test 4: a field going from unset to a value logs old_value null, not "undefined"
  it('logs old_value null (not "undefined") when a field goes from unset to a value', () => {
    db.createContact({
      part_number: 'CONT-T17-04',
      manufacturer_part_number: null,
      termination_type: null,
    });

    db.updateContact(
      'CONT-T17-04',
      { manufacturer_part_number: 'M39029/4-110' },
      'carol',
    );

    const logs = db.getPartRevisionLogs('CONT-T17-04', 'contact');
    expect(logs).toHaveLength(1);
    const [firstLog] = logs;
    expect(firstLog).toBeDefined();
    expect(firstLog?.field_name).toBe('manufacturer_part_number');
    expect(firstLog?.old_value).toBeNull();
    expect(firstLog?.old_value).not.toBe('undefined');
    expect(firstLog?.new_value).toBe('M39029/4-110');
  });

  // Acceptance test 5: a field going from a value to unset logs new_value null
  it('logs new_value null when a field goes from a value to unset', () => {
    db.createBackshell({
      part_number: 'BS-T17-05',
      description: 'Aluminum backshell 90 deg',
    });

    db.updateBackshell(
      'BS-T17-05',
      { description: null },
      'dave',
    );

    const logs = db.getPartRevisionLogs('BS-T17-05', 'backshell');
    expect(logs).toHaveLength(1);
    const [firstLog] = logs;
    expect(firstLog).toBeDefined();
    expect(firstLog?.field_name).toBe('description');
    expect(firstLog?.old_value).toBe('Aluminum backshell 90 deg');
    expect(firstLog?.new_value).toBeNull();
  });

  // Acceptance test 6: replaying the log backwards from version N reconstructs version 1 exactly
  it('replaying the log backwards from version N reconstructs version 1 exactly', () => {
    const v1 = db.createConnector({
      part_number: 'CONN-T17-06',
      cavity_count: 8,
      gender: 'plug',
      ratings: '10A, 50V',
      temp_min: -40,
      temp_max: 105,
      manufacturer_part_number: null,
      keying: 'A',
      mounting: 'panel',
      image_ref: null,
    });

    // Revision 2: update temp_max and ratings
    db.updateConnector(
      'CONN-T17-06',
      {
        temp_max: 125,
        ratings: '13A, 250V',
      },
      'engineer-1',
    );

    // Revision 3: update temp_min, manufacturer_part_number, keying
    db.updateConnector(
      'CONN-T17-06',
      {
        temp_min: -55,
        manufacturer_part_number: 'MFG-CONN-06',
        keying: 'B',
      },
      'engineer-2',
    );

    // Revision 4: update gender and ratings
    const v4 = db.updateConnector(
      'CONN-T17-06',
      {
        gender: 'receptacle',
        ratings: '15A, 300V',
      },
      'engineer-3',
    );

    expect(v4.version).toBe(4);

    const allLogs = db.getPartRevisionLogs('CONN-T17-06', 'connector');
    expect(allLogs.length).toBeGreaterThan(0);

    // Replay backwards to version 1
    const reconstructedV1 = db.replayPartRevisions(v4, 'connector', allLogs, 1);

    expect(reconstructedV1.version).toBe(1);
    for (const field of CONNECTOR_FIELDS) {
      const fieldKey = field.name as keyof typeof v1;
      expect(reconstructedV1[fieldKey]).toEqual(v1[fieldKey]);
    }

    // Replay backwards to version 2
    const reconstructedV2 = replayPartRevisions(v4, 'connector', allLogs, 2);
    expect(reconstructedV2.version).toBe(2);
    expect(reconstructedV2.temp_max).toBe(125);
    expect(reconstructedV2.ratings).toBe('13A, 250V');
    expect(reconstructedV2.temp_min).toBe(-40);
    expect(reconstructedV2.manufacturer_part_number).toBeNull();
    expect(reconstructedV2.keying).toBe('A');
    expect(reconstructedV2.gender).toBe('plug');
  });

  // Acceptance test 7: version numbers are per part, not global: two parts each edited once are both at version 2
  it('assigns version numbers per part, not global: two parts each edited once are both at version 2', () => {
    const partA = db.createContact({
      part_number: 'CONT-T17-07-A',
      gauge_min_mm2: 0.5,
      gauge_max_mm2: 1.5,
    });
    const partB = db.createContact({
      part_number: 'CONT-T17-07-B',
      gauge_min_mm2: 1.0,
      gauge_max_mm2: 2.5,
    });

    expect(partA.version).toBe(1);
    expect(partB.version).toBe(1);

    const updatedA = db.updateContact('CONT-T17-07-A', { gauge_max_mm2: 2.0 });
    const updatedB = db.updateContact('CONT-T17-07-B', { gauge_max_mm2: 3.0 });

    expect(updatedA.version).toBe(2);
    expect(updatedB.version).toBe(2);

    const logsA = db.getPartRevisionLogs('CONT-T17-07-A');
    const logsB = db.getPartRevisionLogs('CONT-T17-07-B');

    expect(logsA).toHaveLength(1);
    expect(logsA[0]?.version).toBe(2);

    expect(logsB).toHaveLength(1);
    expect(logsB[0]?.version).toBe(2);
  });

  // Acceptance test 8: a numeric field changing only in representation (1.50 → 1.5) is not a change and logs nothing
  it('does not consider a numeric field changing only in representation (1.50 -> 1.5) as a change and logs nothing', () => {
    const initialDate = '2026-08-20T12:00:00.000Z';
    db.createWireSpec({
      part_number: 'WIRE-T17-08',
      gauge_mm2: 1.5,
      last_modified_date: initialDate,
    });

    // Update with numeric literal 1.50
    const result = db.updateWireSpec('WIRE-T17-08', {
      gauge_mm2: 1.50,
      last_modified_date: '2026-08-25T14:00:00.000Z',
    });

    expect(result.version).toBe(1);
    expect(result.last_modified_date).toBe(initialDate);

    // Update where string representations differ (e.g. "1.50" arriving from form input vs 1.5 stored)
    expect(areValuesEqual('1.50', '1.5', 'number')).toBe(true);
    expect(areValuesEqual('1.50', 1.5, 'number')).toBe(true);
    expect(areValuesEqual(1.5, '1.50', 'number')).toBe(true);

    const diffs = computeDiffs(
      { gauge_mm2: 1.5 },
      { gauge_mm2: '1.50' as unknown as number },
      WIRE_SPEC_FIELDS,
    );
    expect(diffs).toHaveLength(0);

    const resultString = db.updateWireSpec('WIRE-T17-08', {
      gauge_mm2: '1.50' as unknown as number,
      last_modified_date: '2026-08-25T15:00:00.000Z',
    });
    expect(resultString.version).toBe(1);
    expect(resultString.last_modified_date).toBe(initialDate);

    const logs = db.getPartRevisionLogs('WIRE-T17-08', 'wire');
    expect(logs).toHaveLength(0);
  });

  // Acceptance test 9: delete logs __deleted__ rows and the part is gone
  it('logs __deleted__ rows on delete and removes the part', () => {
    db.createTooling({
      part_number: 'TOOL-T17-09',
      manufacturer_part_number: 'M22520/1-01',
      description: 'Crimp tool frame',
      calibration_interval_days: 180,
      last_calibration_date: '2026-01-01T00:00:00.000Z',
    });

    const deleted = db.deleteTooling('TOOL-T17-09', 'audit-officer');
    expect(deleted).toBe(true);

    // Part is gone from store
    const fetched = db.getToolingByPartNumber('TOOL-T17-09');
    expect(fetched).toBeNull();

    // Revision log contains __deleted__ rows for non-null fields
    const logs = db.getPartRevisionLogs('TOOL-T17-09', 'tooling');
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      expect(log.field_name).toBe('__deleted__');
      expect(log.new_value).toBeNull();
      expect(log.old_value).not.toBeNull();
      expect(log.version).toBe(2);
      expect(log.changed_by).toBe('audit-officer');
    }

    const oldValues = logs.map(l => l.old_value);
    expect(oldValues).toContain('TOOL-T17-09');
    expect(oldValues).toContain('M22520/1-01');
    expect(oldValues).toContain('Crimp tool frame');
    expect(oldValues).toContain('180');
  });

  // Acceptance test 10: changed_by null is accepted and round-trips
  it('accepts changed_by null and round-trips it cleanly', () => {
    db.createConnectorFamily({
      manufacturer: 'Deutsch',
      series_name: 'DT-T17-10',
      sealed: true,
    });

    // Update with changed_by explicitly null
    db.updateConnectorFamily(
      1,
      { description: 'Updated Deutsch family' },
      null,
    );

    const logs = db.getPartRevisionLogs('DT-T17-10', 'connector_family');
    expect(logs).toHaveLength(1);
    expect(logs[0]?.changed_by).toBeNull();
    expect(logs[0]?.field_name).toBe('description');
    expect(logs[0]?.new_value).toBe('Updated Deutsch family');

    // Update with changed_by string
    db.updateConnectorFamily(
      1,
      { shape: 'rectangular' },
      'operator-42',
    );

    const updatedLogs = db.getPartRevisionLogs('DT-T17-10', 'connector_family');
    expect(updatedLogs).toHaveLength(2);
    expect(updatedLogs[0]?.changed_by).toBe('operator-42');
    expect(updatedLogs[0]?.field_name).toBe('shape');
  });

  describe('Exhaustive part type revisions & replay tests', () => {
    it('handles contact revisions and replay', () => {
      const v1 = db.createContact({
        part_number: 'CONT-MULTI-REV',
        gauge_min_mm2: 0.5,
        gauge_max_mm2: 1.5,
        gender: 'pin',
        termination_type: 'crimp',
      });

      const v2 = db.updateContact('CONT-MULTI-REV', { gauge_max_mm2: 2.5 }, 'eng-1');
      expect(v2.version).toBe(2);

      const v3 = db.updateContact('CONT-MULTI-REV', { gender: 'socket', termination_type: 'solder' }, 'eng-2');
      expect(v3.version).toBe(3);

      const logs = db.getPartRevisionLogs('CONT-MULTI-REV', 'contact');
      expect(logs).toHaveLength(3);

      const replayedV1 = db.replayPartRevisions(v3, 'contact', logs, 1);
      expect(replayedV1.version).toBe(1);
      expect(replayedV1.gauge_max_mm2).toBe(v1.gauge_max_mm2);
      expect(replayedV1.gender).toBe('pin');
      expect(replayedV1.termination_type).toBe('crimp');

      const replayedV2 = db.replayPartRevisions(v3, 'contact', logs, 2);
      expect(replayedV2.version).toBe(2);
      expect(replayedV2.gauge_max_mm2).toBe(2.5);
      expect(replayedV2.gender).toBe('pin');
    });

    it('handles wire spec revisions and replay', () => {
      const v1 = db.createWireSpec({
        part_number: 'WIRE-MULTI-REV',
        gauge_mm2: 0.5189,
        outer_diameter_um: 1200,
        spool_length: { value: 1000, unit: 'ft' },
      });

      const v2 = db.updateWireSpec(
        'WIRE-MULTI-REV',
        { outer_diameter_um: 1350, spool_length: { value: 500, unit: 'm' } },
        'wire-lead',
      );
      expect(v2.version).toBe(2);

      const logs = db.getPartRevisionLogs('WIRE-MULTI-REV', 'wire');
      expect(logs).toHaveLength(3); // outer_diameter_um, spool_length_um, spool_length_display_unit

      const replayedV1 = db.replayPartRevisions(v2, 'wire', logs, 1);
      expect(replayedV1.version).toBe(1);
      expect(replayedV1.outer_diameter_um).toBe(v1.outer_diameter_um);
      expect(replayedV1.spool_length_um).toBe(v1.spool_length_um);
      expect(replayedV1.spool_length_display_unit).toBe(v1.spool_length_display_unit);
    });

    it('handles connector family revisions and delete', () => {
      const fam = db.createConnectorFamily({
        manufacturer: 'Amphenol',
        series_name: 'AT-SERIES',
        sealed: false,
      });

      const updated = db.updateConnectorFamily(fam.id, { sealed: true, description: 'Sealed AT series' });
      expect(updated.version).toBe(2);
      expect(updated.sealed).toBe(true);

      const logs = db.getPartRevisionLogs('AT-SERIES', 'connector_family');
      expect(logs).toHaveLength(2);

      const deleted = db.deleteConnectorFamily(fam.id, 'admin');
      expect(deleted).toBe(true);
      expect(db.getConnectorFamily(fam.id)).toBeNull();

      const delLogs = db.getPartRevisionLogs('AT-SERIES', 'connector_family');
      const delRows = delLogs.filter(l => l.field_name === '__deleted__');
      expect(delRows.length).toBeGreaterThan(0);
    });

    it('handles backshell delete logging', () => {
      db.createBackshell({
        part_number: 'BS-DEL-TEST',
        description: 'Test BS',
      });

      const deleted = db.deleteBackshell('BS-DEL-TEST', 'tester');
      expect(deleted).toBe(true);
      expect(db.getBackshellByPartNumber('BS-DEL-TEST')).toBeNull();

      const logs = db.getPartRevisionLogs('BS-DEL-TEST', 'backshell');
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0]?.field_name).toBe('__deleted__');
    });

    it('handles contact delete logging', () => {
      db.createContact({
        part_number: 'CONT-DEL-TEST',
        gender: 'pin',
      });

      const deleted = db.deleteContact('CONT-DEL-TEST', 'tester');
      expect(deleted).toBe(true);
      expect(db.getContactByPartNumber('CONT-DEL-TEST')).toBeNull();

      const logs = db.getPartRevisionLogs('CONT-DEL-TEST', 'contact');
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0]?.field_name).toBe('__deleted__');
    });

    it('handles wire spec delete logging', () => {
      db.createWireSpec({
        part_number: 'WIRE-DEL-TEST',
        gauge_mm2: 0.75,
      });

      const deleted = db.deleteWireSpec('WIRE-DEL-TEST', 'tester');
      expect(deleted).toBe(true);
      expect(db.getWireSpecByPartNumber('WIRE-DEL-TEST')).toBeNull();

      const logs = db.getPartRevisionLogs('WIRE-DEL-TEST', 'wire');
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0]?.field_name).toBe('__deleted__');
    });

    it('throws when replaying to a targetVersion higher than the current version', () => {
      const conn = db.createConnector({
        part_number: 'CONN-TARGET-ERR',
        cavity_count: 2,
        version: 1,
      });

      expect(() => {
        db.replayPartRevisions(conn, 'connector', [], 3);
      }).toThrow(/Target version 3 cannot be greater than current part version 1/);
    });

    it('filters replay logs by part_number and part_type, preventing cross-part or cross-type corruption', () => {
      db.createConnector({
        part_number: 'CONN-FILTER-A',
        cavity_count: 2,
        temp_max: 105,
      });
      db.createConnector({
        part_number: 'CONN-FILTER-B',
        cavity_count: 4,
        temp_max: 105,
      });
      db.createContact({
        part_number: 'CONT-FILTER-C',
        gender: 'pin',
      });

      const updatedConnA = db.updateConnector('CONN-FILTER-A', { temp_max: 125 });
      db.updateConnector('CONN-FILTER-B', { temp_max: 150 });
      db.updateContact('CONT-FILTER-C', { gender: 'socket' });

      expect(updatedConnA.version).toBe(2);

      // Collect all logs in the database across all parts and types
      const allLogs = db.listAllRevisionLogs();
      expect(allLogs.length).toBe(3);

      // Replaying CONN-A with all combined logs must only apply CONN-A logs
      const replayedA = db.replayPartRevisions(updatedConnA, 'connector', allLogs, 1);
      expect(replayedA.version).toBe(1);
      expect(replayedA.temp_max).toBe(105);
      expect(replayedA.cavity_count).toBe(2);
      expect(replayedA.part_number).toBe('CONN-FILTER-A');
    });

    it('prevents contact logs from being applied when replaying a connector', () => {
      db.createConnector({
        part_number: 'PART-SHARED-PN',
        cavity_count: 6,
      });
      const updatedConn = db.updateConnector('PART-SHARED-PN', { cavity_count: 8 });
      expect(updatedConn.version).toBe(2);

      // Create synthetic contact log with same part_number but part_type 'contact'
      const contactLogsOnly = [
        {
          id: 1,
          part_number: 'PART-SHARED-PN',
          part_type: 'contact' as const,
          version: 2,
          field_name: 'cavity_count',
          old_value: '10',
          new_value: '20',
          changed_date: new Date().toISOString(),
          changed_by: 'tester',
        },
      ];

      // Replaying connector with contact logs must filter them out and fail due to missing connector logs
      expect(() => {
        db.replayPartRevisions(updatedConn, 'connector', contactLogsOnly, 1);
      }).toThrow(/Incomplete revision log history for connector "PART-SHARED-PN": missing logs for version 2/);
    });

    it('fails loudly when revision history is incomplete or missing intermediate versions', () => {
      db.createConnector({
        part_number: 'CONN-HOLE-TEST',
        cavity_count: 2,
        temp_max: 105,
      });
      db.updateConnector('CONN-HOLE-TEST', { temp_max: 125 }); // v2
      db.updateConnector('CONN-HOLE-TEST', { temp_max: 150 }); // v3
      const v4 = db.updateConnector('CONN-HOLE-TEST', { temp_max: 175 }); // v4

      const logs = db.getPartRevisionLogs('CONN-HOLE-TEST', 'connector');
      expect(logs).toHaveLength(3);

      // Simulate a gap where version 2 log is missing (e.g. earliest log is v3)
      const logsMissingV2 = logs.filter(l => l.version !== 2);

      expect(() => {
        db.replayPartRevisions(v4, 'connector', logsMissingV2, 1);
      }).toThrow(/Incomplete revision log history for connector "CONN-HOLE-TEST": missing logs for version 2/);

      // Replay to v3 only requires v4 log, which is present, so it succeeds
      const replayedV3 = db.replayPartRevisions(v4, 'connector', logsMissingV2, 3);
      expect(replayedV3.version).toBe(3);
      expect(replayedV3.temp_max).toBe(150);
    });

    it('throws when updating a non-existent part', () => {
      expect(() => {
        db.updateConnector('NON-EXISTENT-PART', { cavity_count: 4 });
      }).toThrow(/Connector "NON-EXISTENT-PART" not found/);
    });
  });
});
