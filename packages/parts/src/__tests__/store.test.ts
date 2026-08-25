import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import {
  openPartsDatabase,
  PartsDatabase,
  CURRENT_SCHEMA_VERSION,
  ALL_TABLE_NAMES,
  runMigrations,
  getWireSpecGauge,
  formatSpoolLength,
  renderSpoolLength,
  type ConnectorPartInput,
} from '../index.js';
import { toSquareMillimetres } from '@openharness/core';

describe('@openharness/parts — Parts Database Store', () => {
  let db: PartsDatabase;
  let tempDbPath: string | undefined;

  beforeEach(() => {
    db = openPartsDatabase(':memory:');
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // already closed
    }
    if (tempDbPath && fs.existsSync(tempDbPath)) {
      try {
        fs.unlinkSync(tempDbPath);
      } catch {
        // ignore cleanup error
      }
    }
  });

  // Acceptance test 1: create -> open -> every table exists, user_version matches
  it('creates and opens a database where every table exists and user_version matches', () => {
    const tempDir = os.tmpdir();
    tempDbPath = path.join(tempDir, `openharness-parts-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

    // Create & close
    const fileDb = openPartsDatabase(tempDbPath);
    fileDb.close();

    // Reopen & verify
    const reopened = openPartsDatabase(tempDbPath);
    const userVersion = reopened.rawDb.pragma('user_version', { simple: true }) as number;
    expect(userVersion).toBe(CURRENT_SCHEMA_VERSION);

    // Verify all 10 tables exist
    const tables = reopened.rawDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row: unknown) => (row as { name: string }).name);

    for (const expectedTable of ALL_TABLE_NAMES) {
      expect(tables).toContain(expectedTable);
    }
    reopened.close();
  });

  // Acceptance test 2: a part inserted and read back is field-identical, gauge included
  it('inserts and reads back a connector with all fields identical, gauge included', () => {
    const family = db.createConnectorFamily({
      manufacturer: 'Deutsch',
      series_name: 'DT',
      description: 'DT series 2-pin connector',
      sealed: true,
      shape: 'rectangular',
      datasheet_url: 'https://example.com/dt04-2p.pdf',
    });

    const connInput: ConnectorPartInput = {
      family_id: family.id,
      part_number: 'DT04-2P',
      manufacturer_part_number: 'DT04-2P-E004',
      cavity_count: 2,
      gender: 'receptacle',
      ratings: '13A, 250V',
      gauge_min: { value: 20, unit: 'awg' },
      gauge_max: { value: 14, unit: 'awg' },
      keying: 'A',
      mounting: 'free-hanging',
      temp_min: -55,
      temp_max: 125,
      image_ref: 'dt04-2p.png',
      version: 1,
      last_modified_date: '2026-08-24T12:00:00.000Z',
    };

    const created = db.createConnector(connInput);
    expect(created.id).toBeGreaterThan(0);

    const fetched = db.getConnectorByPartNumber('DT04-2P');
    expect(fetched).not.toBeNull();
    expect(fetched).toEqual({
      id: created.id,
      family_id: family.id,
      part_number: 'DT04-2P',
      manufacturer_part_number: 'DT04-2P-E004',
      cavity_count: 2,
      gender: 'receptacle',
      ratings: '13A, 250V',
      gauge_min_mm2: toSquareMillimetres({ value: 20, unit: 'awg' }),
      gauge_max_mm2: toSquareMillimetres({ value: 14, unit: 'awg' }),
      keying: 'A',
      mounting: 'free-hanging',
      temp_min: -55,
      temp_max: 125,
      image_ref: 'dt04-2p.png',
      version: 1,
      last_modified_date: '2026-08-24T12:00:00.000Z',
    });
  });

  // Acceptance test 3: duplicate part_number in one table is rejected by UNIQUE constraint
  it('rejects duplicate part_number in one table by UNIQUE constraint', () => {
    db.createContact({
      part_number: '0460-202-16141',
      manufacturer_part_number: '0460-202-16141',
      gauge_min_mm2: 0.5,
      gauge_max_mm2: 2.0,
      termination_type: 'crimp',
      gender: 'pin',
    });

    expect(() => {
      db.createContact({
        part_number: '0460-202-16141',
        manufacturer_part_number: 'ANOTHER-MFG-PN',
      });
    }).toThrow(/UNIQUE constraint failed/);
  });

  // Acceptance test 4: manufacturer_part_number may be null, and two parts may share one
  it('allows manufacturer_part_number to be null, and two parts may share one', () => {
    const part1 = db.createWireSpec({
      part_number: 'INTERNAL-WIRE-01',
      manufacturer_part_number: null,
      gauge_mm2: 0.5,
    });
    expect(part1.manufacturer_part_number).toBeNull();

    const part2 = db.createWireSpec({
      part_number: 'INTERNAL-WIRE-02',
      manufacturer_part_number: 'SHARED-M22759-16-20',
      gauge_mm2: 0.5,
    });

    const part3 = db.createWireSpec({
      part_number: 'INTERNAL-WIRE-03',
      manufacturer_part_number: 'SHARED-M22759-16-20',
      gauge_mm2: 0.5,
    });

    expect(part2.manufacturer_part_number).toBe('SHARED-M22759-16-20');
    expect(part3.manufacturer_part_number).toBe('SHARED-M22759-16-20');
  });

  // Acceptance test 5: a Gauge written as mm² and read back is unchanged; a part entered in AWG round-trips through mm² without drift at every AWG size the converter supports
  it('writes and reads back Gauge in mm² unchanged, and round-trips every AWG size through mm² without drift', () => {
    // 1. Direct mm²
    db.createWireSpec({
      part_number: 'WIRE-MM2-0.75',
      gauge_mm2: 0.75,
    });
    const fetchedMm2 = db.getWireSpecByPartNumber('WIRE-MM2-0.75');
    expect(fetchedMm2?.gauge_mm2).toBe(0.75);

    // 2. All AWG sizes supported in lookup table: 30 down to -3 (4/0)
    const allAwgSizes: number[] = [
      30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20,
      19, 18, 17, 16, 15, 14, 13, 12, 11, 10,
      9, 8, 7, 6, 5, 4, 3, 2, 1,
      0,   // 1/0
      -1,  // 2/0
      -2,  // 3/0
      -3,  // 4/0
    ];

    for (const awg of allAwgSizes) {
      const pn = `WIRE-AWG-${awg}`;
      db.createWireSpec({
        part_number: pn,
        gauge: { value: awg, unit: 'awg' },
      });

      const fetched = db.getWireSpecByPartNumber(pn);
      expect(fetched).not.toBeNull();
      const readAwg = getWireSpecGauge(fetched!, 'awg');
      expect(readAwg.unit).toBe('awg');
      expect(readAwg.value).toBe(awg);
    }
  });

  // Acceptance test 6: outer_diameter_um round-trips as an integer
  it('round-trips outer_diameter_um as an integer', () => {
    const wire = db.createWireSpec({
      part_number: 'WIRE-OD-TEST',
      gauge_mm2: 0.5189,
      outer_diameter_um: 1250, // 1.25 mm
    });
    expect(wire.outer_diameter_um).toBe(1250);

    const fetched = db.getWireSpecByPartNumber('WIRE-OD-TEST');
    expect(fetched?.outer_diameter_um).toBe(1250);
    expect(Number.isInteger(fetched?.outer_diameter_um)).toBe(true);
  });

  // Acceptance test 7: spool length entered as 500 ft stores as µm and renders back as 500 ft
  it('stores spool length entered as 500 ft in µm and renders back as 500 ft', () => {
    const wire = db.createWireSpec({
      part_number: 'WIRE-SPOOL-500FT',
      gauge_mm2: 0.5189,
      spool_length: { value: 500, unit: 'ft' },
    });

    // 500 ft = 500 * 304,800 µm = 152,400,000 µm
    expect(wire.spool_length_um).toBe(152400000);
    expect(wire.spool_length_display_unit).toBe('ft');

    const fetched = db.getWireSpecByPartNumber('WIRE-SPOOL-500FT');
    expect(fetched?.spool_length_um).toBe(152400000);
    expect(fetched?.spool_length_display_unit).toBe('ft');

    const rendered = renderSpoolLength(fetched!);
    expect(rendered).toEqual({ value: 500, unit: 'ft' });

    const formatted = formatSpoolLength(fetched!);
    expect(formatted).toBe('500 ft');
  });

  // Acceptance test 8: a backshell linked to three families produces three backshell_compatibility rows; querying by family returns it
  it('links a backshell to three families, produces three compatibility rows, and querying by family returns it', () => {
    const fam1 = db.createConnectorFamily({ manufacturer: 'Deutsch', series_name: 'DT' });
    const fam2 = db.createConnectorFamily({ manufacturer: 'Deutsch', series_name: 'DTM' });
    const fam3 = db.createConnectorFamily({ manufacturer: 'Amphenol', series_name: 'AT' });

    const backshell = db.createBackshell({
      part_number: 'BS-UNIVERSAL-01',
      description: 'Universal 180° backshell',
    });

    db.setBackshellCompatibility(backshell.id, [fam1.id, fam2.id, fam3.id]);

    // Check compatibility rows directly
    const rows = db.rawDb
      .prepare('SELECT * FROM backshell_compatibility WHERE backshell_id = ?')
      .all(backshell.id);
    expect(rows).toHaveLength(3);

    // Query compatible families for backshell
    const families = db.getBackshellCompatibleFamilies(backshell.id);
    expect(families.map(f => f.id).sort()).toEqual([fam1.id, fam2.id, fam3.id].sort());

    // Query backshells for each family
    const forFam1 = db.getCompatibleBackshellsForFamily(fam1.id);
    expect(forFam1.map(b => b.part_number)).toContain('BS-UNIVERSAL-01');

    const forFam2 = db.getCompatibleBackshellsForFamily(fam2.id);
    expect(forFam2.map(b => b.part_number)).toContain('BS-UNIVERSAL-01');

    const forFam3 = db.getCompatibleBackshellsForFamily(fam3.id);
    expect(forFam3.map(b => b.part_number)).toContain('BS-UNIVERSAL-01');
  });

  // Acceptance test 9: a tool qualified for two families produces two compatibility rows and querying by family returns it
  it('links a tool to two families, produces two compatibility rows, and querying by family returns it', () => {
    const fam1 = db.createConnectorFamily({ manufacturer: 'Molex', series_name: 'Mini-Fit Jr' });
    const fam2 = db.createConnectorFamily({ manufacturer: 'Molex', series_name: 'Mini-Fit Plus' });

    const tool = db.createTooling({
      part_number: 'TOOL-CRIMP-01',
      description: 'Hand crimp tool',
      calibration_interval_days: 180,
      last_calibration_date: '2026-01-15T00:00:00.000Z',
    });

    db.setToolingCompatibility(tool.id, [fam1.id, fam2.id]);

    const rows = db.rawDb
      .prepare('SELECT * FROM tooling_compatibility WHERE tooling_id = ?')
      .all(tool.id);
    expect(rows).toHaveLength(2);

    const families = db.getToolingCompatibleFamilies(tool.id);
    expect(families.map(f => f.id).sort()).toEqual([fam1.id, fam2.id].sort());

    const toolsForFam1 = db.getCompatibleToolingForFamily(fam1.id);
    expect(toolsForFam1.map(t => t.part_number)).toContain('TOOL-CRIMP-01');

    const toolsForFam2 = db.getCompatibleToolingForFamily(fam2.id);
    expect(toolsForFam2.map(t => t.part_number)).toContain('TOOL-CRIMP-01');
  });

  // Acceptance test 10: opening a library with a higher user_version than supported throws, and the message names both versions
  it('throws when opening a library with higher user_version than supported, naming both versions', () => {
    const rawDb = new Database(':memory:');
    rawDb.pragma('user_version = 99');

    expect(() => {
      runMigrations(rawDb);
    }).toThrow('Database schema version 99 is newer than supported version 1');
    rawDb.close();
  });

  // Acceptance test 11: a migration applied twice is a no-op
  it('is a no-op when migration is applied twice', () => {
    const rawDb = new Database(':memory:');
    runMigrations(rawDb);
    const v1 = rawDb.pragma('user_version', { simple: true }) as number;
    expect(v1).toBe(CURRENT_SCHEMA_VERSION);

    // Apply again
    runMigrations(rawDb);
    const v2 = rawDb.pragma('user_version', { simple: true }) as number;
    expect(v2).toBe(CURRENT_SCHEMA_VERSION);

    rawDb.close();
  });

  // Additional integrity tests: Revision logging, Cavities, Foreign keys, ISO-8601 validation
  describe('Additional integrity & revision tests', () => {
    it('records field-level revision logs correctly', () => {
      db.createConnector({
        part_number: 'CONN-REV-TEST',
        cavity_count: 4,
        temp_min: -40,
        temp_max: 105,
        version: 1,
      });

      // Update connector and log changes
      db.updateConnector('CONN-REV-TEST', {
        temp_max: 125,
        version: 2,
      });

      db.logPartRevision({
        part_number: 'CONN-REV-TEST',
        part_type: 'connector',
        version: 2,
        field_name: 'temp_max',
        old_value: '105',
        new_value: '125',
        changed_date: '2026-08-24T15:00:00.000Z',
        changed_by: 'cdunham',
      });

      const logs = db.getPartRevisionLogs('CONN-REV-TEST');
      expect(logs).toHaveLength(1);
      expect(logs[0]).toEqual({
        id: expect.any(Number),
        part_number: 'CONN-REV-TEST',
        part_type: 'connector',
        version: 2,
        field_name: 'temp_max',
        old_value: '105',
        new_value: '125',
        changed_date: '2026-08-24T15:00:00.000Z',
        changed_by: 'cdunham',
      });
    });

    it('manages cavities for a connector and cascades deletion', () => {
      const conn = db.createConnector({
        part_number: 'CONN-CAV-TEST',
        cavity_count: 2,
      });

      const cavities = db.createCavities([
        { connector_id: conn.id, cavity_number: 1, position_label: 'A' },
        {
          connector_id: conn.id,
          cavity_number: 2,
          position_label: 'B',
          max_wire_gauge: { value: 16, unit: 'awg' },
        },
      ]);

      expect(cavities).toHaveLength(2);
      expect(cavities[1]?.max_wire_gauge_mm2).toBeCloseTo(1.309, 3);

      const fetched = db.getCavitiesForConnector(conn.id);
      expect(fetched).toHaveLength(2);

      // Deleting connector cascades to cavities
      db.deleteConnector(conn.id);
      const afterDelete = db.getCavitiesForConnector(conn.id);
      expect(afterDelete).toHaveLength(0);
    });

    it('rejects invalid ISO-8601 date strings and normalizes valid date strings to ISO-8601', () => {
      expect(() => {
        db.createConnectorFamily({
          manufacturer: 'Test',
          series_name: 'InvalidDate',
          last_modified_date: 'not-a-valid-date',
        });
      }).toThrow(/Invalid ISO-8601 date/);

      const fam = db.createConnectorFamily({
        manufacturer: 'Test',
        series_name: 'NormalizedDate',
        last_modified_date: '2026-08-25 10:00:00 UTC',
      });
      expect(fam.last_modified_date).toBe('2026-08-25T10:00:00.000Z');
    });
  });
});
