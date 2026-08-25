import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  openPartsDatabase,
  PartsDatabase,
  runMigrations,
  SCHEMA_V1_DDL,
  CURRENT_SCHEMA_VERSION,
  type SourcingCurrency,
} from '../index.js';

describe('T18 — Procurement, Sourcing, and Price History (@openharness/parts)', () => {
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

  // Acceptance test 1: a supplier with three sourcing rows across three parts round-trips
  it('round-trips a supplier with three sourcing rows across three parts', () => {
    const supplier = db.createSupplier({
      name: 'DigiKey',
      contact_info: 'orders@digikey.com | 1-800-344-4539',
    });
    expect(supplier.id).toBeGreaterThan(0);
    expect(supplier.name).toBe('DigiKey');
    expect(supplier.contact_info).toBe('orders@digikey.com | 1-800-344-4539');

    // Create 3 parts of different types
    db.createConnector({
      part_number: 'DT04-2P',
      cavity_count: 2,
    });
    db.createContact({
      part_number: '0460-202-16141',
    });
    db.createWireSpec({
      part_number: 'WIRE-20AWG-TEFZEL',
      gauge_mm2: 0.5189,
    });

    // Create 3 sourcing rows for DigiKey
    const row1 = db.createPartSourcing({
      part_number: 'DT04-2P',
      part_type: 'connector',
      supplier_id: supplier.id,
      supplier_part_number: 'WM001-ND',
      unit_cost: 3.5,
      currency: 'USD',
      moq: 1,
      lead_time_days: 2,
      stock_status: 'in_stock',
      distributor_url: 'https://www.digikey.com/short/wm001',
      preferred: true,
      last_checked_date: '2026-08-25T08:00:00.000Z',
    });

    const row2 = db.createPartSourcing({
      part_number: '0460-202-16141',
      part_type: 'contact',
      supplier_id: supplier.id,
      supplier_part_number: 'WM002-ND',
      unit_cost: 0.45,
      currency: 'USD',
      moq: 100,
      lead_time_days: 1,
      stock_status: 'in_stock',
      distributor_url: 'https://www.digikey.com/short/wm002',
      preferred: true,
      last_checked_date: '2026-08-25T08:00:00.000Z',
    });

    const row3 = db.createPartSourcing({
      part_number: 'WIRE-20AWG-TEFZEL',
      part_type: 'wire',
      supplier_id: supplier.id,
      supplier_part_number: 'WM003-ND',
      unit_cost: 0.85,
      currency: 'USD',
      moq: 50,
      lead_time_days: 5,
      stock_status: 'in_stock',
      distributor_url: 'https://www.digikey.com/short/wm003',
      preferred: false,
      last_checked_date: '2026-08-25T08:00:00.000Z',
    });

    // Query supplier sourcing rows
    const supplierRows = db.listPartSourcingForSupplier(supplier.id);
    expect(supplierRows).toHaveLength(3);

    expect(db.getPartSourcing('DT04-2P', 'connector', supplier.id)).toEqual(row1);
    expect(db.getPartSourcing('0460-202-16141', 'contact', supplier.id)).toEqual(row2);
    expect(db.getPartSourcing('WIRE-20AWG-TEFZEL', 'wire', supplier.id)).toEqual(row3);
  });

  // Acceptance test 2: the same part sourced from two suppliers yields two rows
  it('yields two rows when the same part is sourced from two suppliers', () => {
    const supplierA = db.createSupplier({ name: 'Mouser' });
    const supplierB = db.createSupplier({ name: 'DigiKey' });

    db.createConnector({
      part_number: 'DT06-2S',
      cavity_count: 2,
    });

    db.createPartSourcing({
      part_number: 'DT06-2S',
      part_type: 'connector',
      supplier_id: supplierA.id,
      supplier_part_number: '571-DT06-2S',
      unit_cost: 4.1,
      currency: 'USD',
      preferred: false,
    });

    db.createPartSourcing({
      part_number: 'DT06-2S',
      part_type: 'connector',
      supplier_id: supplierB.id,
      supplier_part_number: 'WM004-ND',
      unit_cost: 3.95,
      currency: 'USD',
      preferred: true,
    });

    const rows = db.listPartSourcingForPart('DT06-2S', 'connector');
    expect(rows).toHaveLength(2);

    const supplierIds = rows.map(r => r.supplier_id);
    expect(supplierIds).toContain(supplierA.id);
    expect(supplierIds).toContain(supplierB.id);
  });

  // Acceptance test 3: setting preferred on supplier B clears it on supplier A, atomically
  it('clears preferred on supplier A atomically when setting preferred on supplier B', () => {
    const supplierA = db.createSupplier({ name: 'Supplier Alpha' });
    const supplierB = db.createSupplier({ name: 'Supplier Beta' });

    db.createContact({ part_number: 'CONT-PREF-TEST' });

    // Sourcing row A starts preferred
    db.createPartSourcing({
      part_number: 'CONT-PREF-TEST',
      part_type: 'contact',
      supplier_id: supplierA.id,
      unit_cost: 0.5,
      currency: 'USD',
      preferred: true,
    });

    // Sourcing row B starts non-preferred
    db.createPartSourcing({
      part_number: 'CONT-PREF-TEST',
      part_type: 'contact',
      supplier_id: supplierB.id,
      unit_cost: 0.48,
      currency: 'USD',
      preferred: false,
    });

    // Verify A is preferred
    expect(db.getPreferredSourcing('CONT-PREF-TEST', 'contact')?.supplier_id).toBe(supplierA.id);
    expect(db.getPartSourcing('CONT-PREF-TEST', 'contact', supplierA.id)?.preferred).toBe(true);
    expect(db.getPartSourcing('CONT-PREF-TEST', 'contact', supplierB.id)?.preferred).toBe(false);

    // Set preferred on supplier B
    db.setPreferredSupplier('CONT-PREF-TEST', 'contact', supplierB.id);

    // Verify A is now cleared (false) and B is preferred (true)
    const rowA = db.getPartSourcing('CONT-PREF-TEST', 'contact', supplierA.id);
    const rowB = db.getPartSourcing('CONT-PREF-TEST', 'contact', supplierB.id);
    expect(rowA?.preferred).toBe(false);
    expect(rowB?.preferred).toBe(true);

    const preferred = db.getPreferredSourcing('CONT-PREF-TEST', 'contact');
    expect(preferred?.supplier_id).toBe(supplierB.id);
  });

  // Acceptance test 4: a part with zero preferred and one row is distinguishable from one with zero preferred and three rows
  it('distinguishes a part with zero preferred and one row from one with zero preferred and three rows', () => {
    const sup1 = db.createSupplier({ name: 'Sup 1' });
    const sup2 = db.createSupplier({ name: 'Sup 2' });
    const sup3 = db.createSupplier({ name: 'Sup 3' });

    db.createConnector({ part_number: 'PART-SINGLE-ROW', cavity_count: 2 });
    db.createConnector({ part_number: 'PART-TRIPLE-ROW', cavity_count: 4 });

    // Part 1: exactly 1 sourcing row, zero preferred
    db.createPartSourcing({
      part_number: 'PART-SINGLE-ROW',
      part_type: 'connector',
      supplier_id: sup1.id,
      unit_cost: 5.0,
      currency: 'USD',
      preferred: false,
    });

    // Part 2: 3 sourcing rows, zero preferred
    db.createPartSourcing({
      part_number: 'PART-TRIPLE-ROW',
      part_type: 'connector',
      supplier_id: sup1.id,
      unit_cost: 10.0,
      currency: 'USD',
      preferred: false,
    });
    db.createPartSourcing({
      part_number: 'PART-TRIPLE-ROW',
      part_type: 'connector',
      supplier_id: sup2.id,
      unit_cost: 10.5,
      currency: 'USD',
      preferred: false,
    });
    db.createPartSourcing({
      part_number: 'PART-TRIPLE-ROW',
      part_type: 'connector',
      supplier_id: sup3.id,
      unit_cost: 9.8,
      currency: 'USD',
      preferred: false,
    });

    const singleRows = db.listPartSourcingForPart('PART-SINGLE-ROW', 'connector');
    const tripleRows = db.listPartSourcingForPart('PART-TRIPLE-ROW', 'connector');

    expect(singleRows).toHaveLength(1);
    expect(singleRows.every(r => !r.preferred)).toBe(true);
    expect(db.getPreferredSourcing('PART-SINGLE-ROW', 'connector')).toBeNull();

    expect(tripleRows).toHaveLength(3);
    expect(tripleRows.every(r => !r.preferred)).toBe(true);
    expect(db.getPreferredSourcing('PART-TRIPLE-ROW', 'connector')).toBeNull();

    // The two scenarios are unambiguously distinguishable by row count
    expect(singleRows.length).not.toBe(tripleRows.length);
  });

  // Acceptance test 5: changing unit_cost writes a price_history row; changing lead_time_days does not
  it('writes a price_history row when changing unit_cost, but does not write a price_history row when changing lead_time_days', () => {
    const supplier = db.createSupplier({ name: 'Distributor X' });
    db.createWireSpec({ part_number: 'WIRE-AUDIT-01', gauge_mm2: 0.75 });

    // Initial creation with unit_cost writes initial price history row
    db.createPartSourcing({
      part_number: 'WIRE-AUDIT-01',
      part_type: 'wire',
      supplier_id: supplier.id,
      unit_cost: 1.25,
      currency: 'USD',
      lead_time_days: 14,
    });

    const initialHistory = db.getPriceHistory('WIRE-AUDIT-01', 'wire', supplier.id);
    expect(initialHistory).toHaveLength(1);
    expect(initialHistory[0]?.unit_cost).toBe(1.25);
    expect(initialHistory[0]?.currency).toBe('USD');

    // Changing lead_time_days only
    db.updatePartSourcing('WIRE-AUDIT-01', 'wire', supplier.id, {
      lead_time_days: 21,
    });

    const historyAfterLeadTime = db.getPriceHistory('WIRE-AUDIT-01', 'wire', supplier.id);
    expect(historyAfterLeadTime).toHaveLength(1);

    // Changing unit_cost writes a new price history row
    db.updatePartSourcing('WIRE-AUDIT-01', 'wire', supplier.id, {
      unit_cost: 1.45,
    });

    const historyAfterCostChange = db.getPriceHistory('WIRE-AUDIT-01', 'wire', supplier.id);
    expect(historyAfterCostChange).toHaveLength(2);
    expect(historyAfterCostChange[0]?.unit_cost).toBe(1.45);
    expect(historyAfterCostChange[1]?.unit_cost).toBe(1.25);
  });

  // Acceptance test 6: rewriting the same unit_cost writes no history row
  it('writes no history row when rewriting the same unit_cost', () => {
    const supplier = db.createSupplier({ name: 'Distributor Y' });
    db.createContact({ part_number: 'CONT-SAME-PRICE' });

    db.createPartSourcing({
      part_number: 'CONT-SAME-PRICE',
      part_type: 'contact',
      supplier_id: supplier.id,
      unit_cost: 2.5,
      currency: 'USD',
    });

    expect(db.getPriceHistory('CONT-SAME-PRICE', 'contact', supplier.id)).toHaveLength(1);

    // Update with identical numeric unit_cost
    db.updatePartSourcing('CONT-SAME-PRICE', 'contact', supplier.id, {
      unit_cost: 2.5,
      stock_status: 'in_stock',
    });

    // Still exactly 1 row
    const history = db.getPriceHistory('CONT-SAME-PRICE', 'contact', supplier.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.unit_cost).toBe(2.5);
  });

  // Acceptance test 7: a cost in CAD and a cost in USD for the same part both persist, unconverted, and are separately readable
  it('persists and separately reads costs in CAD and USD for the same part without conversion', () => {
    const supplierUS = db.createSupplier({ name: 'DigiKey US' });
    const supplierCA = db.createSupplier({ name: 'DigiKey Canada' });

    db.createTooling({ part_number: 'CRIMP-TOOL-MULTI-CURR' });

    db.createPartSourcing({
      part_number: 'CRIMP-TOOL-MULTI-CURR',
      part_type: 'tooling',
      supplier_id: supplierUS.id,
      unit_cost: 250.0,
      currency: 'USD',
    });

    db.createPartSourcing({
      part_number: 'CRIMP-TOOL-MULTI-CURR',
      part_type: 'tooling',
      supplier_id: supplierCA.id,
      unit_cost: 342.75,
      currency: 'CAD',
    });

    const usSourcing = db.getPartSourcing('CRIMP-TOOL-MULTI-CURR', 'tooling', supplierUS.id);
    const caSourcing = db.getPartSourcing('CRIMP-TOOL-MULTI-CURR', 'tooling', supplierCA.id);

    expect(usSourcing).not.toBeNull();
    expect(usSourcing?.unit_cost).toBe(250.0);
    expect(usSourcing?.currency).toBe('USD');

    expect(caSourcing).not.toBeNull();
    expect(caSourcing?.unit_cost).toBe(342.75);
    expect(caSourcing?.currency).toBe('CAD');

    // No currency conversion was applied — both native values persist
    expect(usSourcing?.unit_cost).not.toBe(caSourcing?.unit_cost);
  });

  // Acceptance test 8: currency outside {USD, CAD} is rejected
  it('rejects currency outside {USD, CAD}', () => {
    const supplier = db.createSupplier({ name: 'European Supplier' });
    db.createConnector({ part_number: 'CONN-CURR-REJECT', cavity_count: 2 });

    expect(() => {
      db.createPartSourcing({
        part_number: 'CONN-CURR-REJECT',
        part_type: 'connector',
        supplier_id: supplier.id,
        unit_cost: 10.0,
        currency: 'EUR' as SourcingCurrency,
      });
    }).toThrow(/Invalid currency: "EUR"/);

    expect(() => {
      db.createPartSourcing({
        part_number: 'CONN-CURR-REJECT',
        part_type: 'connector',
        supplier_id: supplier.id,
        unit_cost: 10.0,
        currency: 'GBP' as SourcingCurrency,
      });
    }).toThrow(/Invalid currency: "GBP"/);

    // Valid currencies succeed
    const validRow = db.createPartSourcing({
      part_number: 'CONN-CURR-REJECT',
      part_type: 'connector',
      supplier_id: supplier.id,
      unit_cost: 10.0,
      currency: 'CAD',
    });
    expect(validRow.currency).toBe('CAD');

    // Rejecting invalid currency on update
    expect(() => {
      db.updatePartSourcing('CONN-CURR-REJECT', 'connector', supplier.id, {
        currency: 'JPY' as SourcingCurrency,
      });
    }).toThrow(/Invalid currency: "JPY"/);
  });

  // Acceptance test 9: moq and lead_time_days may be null and round-trip as null, not 0
  it('allows moq and lead_time_days to be null and round-trips them as null (not 0), and preserves explicit 0', () => {
    const supplier = db.createSupplier({ name: 'Distributor Z' });
    db.createWireSpec({ part_number: 'WIRE-NULL-TEST-1', gauge_mm2: 0.5 });
    db.createWireSpec({ part_number: 'WIRE-NULL-TEST-2', gauge_mm2: 0.5 });

    // 1. Explicit null / not known
    db.createPartSourcing({
      part_number: 'WIRE-NULL-TEST-1',
      part_type: 'wire',
      supplier_id: supplier.id,
      moq: null,
      lead_time_days: null,
    });

    const fetchedNull = db.getPartSourcing('WIRE-NULL-TEST-1', 'wire', supplier.id);
    expect(fetchedNull).not.toBeNull();
    expect(fetchedNull?.moq).toBeNull();
    expect(fetchedNull?.moq).not.toBe(0);
    expect(fetchedNull?.lead_time_days).toBeNull();
    expect(fetchedNull?.lead_time_days).not.toBe(0);

    // 2. Explicit 0 (e.g. 0 MOQ, same day lead time 0 days)
    db.createPartSourcing({
      part_number: 'WIRE-NULL-TEST-2',
      part_type: 'wire',
      supplier_id: supplier.id,
      moq: 0,
      lead_time_days: 0,
    });

    const fetchedZero = db.getPartSourcing('WIRE-NULL-TEST-2', 'wire', supplier.id);
    expect(fetchedZero).not.toBeNull();
    expect(fetchedZero?.moq).toBe(0);
    expect(fetchedZero?.lead_time_days).toBe(0);
  });

  // Acceptance test 10: deleting a supplier does not orphan sourcing rows silently — either cascade or refuse, and the test states which
  it('cascades deletion: deleting a supplier removes all its part_sourcing and price_history rows without leaving orphans', () => {
    // Statement: We adopt ON DELETE CASCADE for supplier deletion. Sourcing without a supplier is meaningless.
    const supplier = db.createSupplier({ name: 'Supplier To Delete' });

    db.createConnector({ part_number: 'CONN-CASCADE-01', cavity_count: 2 });
    db.createConnector({ part_number: 'CONN-CASCADE-02', cavity_count: 4 });

    db.createPartSourcing({
      part_number: 'CONN-CASCADE-01',
      part_type: 'connector',
      supplier_id: supplier.id,
      unit_cost: 3.5,
      currency: 'USD',
    });

    db.createPartSourcing({
      part_number: 'CONN-CASCADE-02',
      part_type: 'connector',
      supplier_id: supplier.id,
      unit_cost: 7.2,
      currency: 'USD',
    });

    expect(db.listPartSourcingForSupplier(supplier.id)).toHaveLength(2);
    expect(db.getPriceHistory('CONN-CASCADE-01', 'connector', supplier.id)).toHaveLength(1);
    expect(db.getPriceHistory('CONN-CASCADE-02', 'connector', supplier.id)).toHaveLength(1);

    // Delete supplier
    const deleted = db.deleteSupplier(supplier.id);
    expect(deleted).toBe(true);
    expect(db.getSupplier(supplier.id)).toBeNull();

    // Sourcing rows are cascaded
    const sourcingAfterDelete = db.listPartSourcingForSupplier(supplier.id);
    expect(sourcingAfterDelete).toHaveLength(0);

    // Price history entries for that supplier are also cascaded
    expect(db.getPriceHistory('CONN-CASCADE-01', 'connector', supplier.id)).toHaveLength(0);
    expect(db.getPriceHistory('CONN-CASCADE-02', 'connector', supplier.id)).toHaveLength(0);

    // Verify raw SQLite tables have zero orphan rows
    const rawSourcing = db.rawDb
      .prepare('SELECT * FROM part_sourcing WHERE supplier_id = ?')
      .all(supplier.id);
    expect(rawSourcing).toHaveLength(0);

    const rawHistory = db.rawDb
      .prepare('SELECT * FROM price_history WHERE supplier_id = ?')
      .all(supplier.id);
    expect(rawHistory).toHaveLength(0);
  });

  // Additional tests: Migration v1 -> v2, Supplier CRUD, Price history queries
  describe('Schema migrations and procurement accessors', () => {
    it('migrates a schema v1 database to v2 preserving existing parts and creating procurement tables', () => {
      const rawDb = new Database(':memory:');
      rawDb.pragma('foreign_keys = ON');

      // Set up v1 database manually
      rawDb.exec(SCHEMA_V1_DDL);
      rawDb.pragma('user_version = 1');

      // Insert v1 parts
      rawDb.prepare(`
        INSERT INTO connectors (part_number, cavity_count, version, last_modified_date)
        VALUES ('CONN-V1-MIGRATED', 6, 1, '2026-08-20T00:00:00.000Z')
      `).run();

      const v1UserVersion = rawDb.pragma('user_version', { simple: true }) as number;
      expect(v1UserVersion).toBe(1);

      // Run migrations up to v2
      runMigrations(rawDb, CURRENT_SCHEMA_VERSION);

      const v2UserVersion = rawDb.pragma('user_version', { simple: true }) as number;
      expect(v2UserVersion).toBe(2);

      // Verify old connector still exists
      const existingConn = rawDb
        .prepare('SELECT * FROM connectors WHERE part_number = ?')
        .get('CONN-V1-MIGRATED') as { cavity_count: number };
      expect(existingConn.cavity_count).toBe(6);

      // Verify procurement tables exist and work
      const supplierStmt = rawDb.prepare(
        'INSERT INTO suppliers (name, created_at, updated_at) VALUES (?, ?, ?)',
      );
      const res = supplierStmt.run('New Migrated Supplier', '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z');
      expect(res.lastInsertRowid).toBeGreaterThan(0);

      rawDb.close();
    });

    it('manages supplier updates and lookup by name', () => {
      const sup = db.createSupplier({
        name: 'Initial Name',
        contact_info: 'info@initial.com',
      });

      const updated = db.updateSupplier(sup.id, {
        name: 'Updated Name',
        contact_info: 'info@updated.com',
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.contact_info).toBe('info@updated.com');

      const byName = db.getSupplierByName('Updated Name');
      expect(byName?.id).toBe(sup.id);
    });

    it('deletes part sourcing and cascades price history deletion', () => {
      const supplier = db.createSupplier({ name: 'Del Sourcing Sup' });
      db.createConnector({ part_number: 'CONN-DEL-SRC', cavity_count: 2 });

      db.createPartSourcing({
        part_number: 'CONN-DEL-SRC',
        part_type: 'connector',
        supplier_id: supplier.id,
        unit_cost: 12.0,
        currency: 'USD',
      });

      expect(db.getPriceHistory('CONN-DEL-SRC', 'connector', supplier.id)).toHaveLength(1);

      const deleted = db.deletePartSourcing('CONN-DEL-SRC', 'connector', supplier.id);
      expect(deleted).toBe(true);

      expect(db.getPartSourcing('CONN-DEL-SRC', 'connector', supplier.id)).toBeNull();
      expect(db.getPriceHistory('CONN-DEL-SRC', 'connector', supplier.id)).toHaveLength(0);
    });

    it('rejects invalid part_type when creating part sourcing', () => {
      const supplier = db.createSupplier({ name: 'Test Sup' });
      expect(() => {
        db.createPartSourcing({
          part_number: 'INVALID-TYPE-PART',
          part_type: 'nonexistent_type' as unknown as 'connector',
          supplier_id: supplier.id,
        });
      }).toThrow(/Invalid part_type/);
    });

    it('rejects updating sourcing to have unit_cost without currency or clearing currency while unit_cost exists', () => {
      const supplier = db.createSupplier({ name: 'Validation Sup' });
      db.createConnector({ part_number: 'CONN-VAL-01', cavity_count: 2 });
      db.createConnector({ part_number: 'CONN-VAL-02', cavity_count: 2 });

      // Row 1 starts with cost and currency
      db.createPartSourcing({
        part_number: 'CONN-VAL-01',
        part_type: 'connector',
        supplier_id: supplier.id,
        unit_cost: 5.0,
        currency: 'USD',
      });

      // Clearing currency alone when unit_cost is present is rejected
      expect(() => {
        db.updatePartSourcing('CONN-VAL-01', 'connector', supplier.id, {
          currency: null,
        });
      }).toThrow(/Currency \(USD or CAD\) is required when unit_cost is specified/);

      // Row 2 starts with no cost and no currency
      db.createPartSourcing({
        part_number: 'CONN-VAL-02',
        part_type: 'connector',
        supplier_id: supplier.id,
      });

      // Adding unit_cost without currency is rejected
      expect(() => {
        db.updatePartSourcing('CONN-VAL-02', 'connector', supplier.id, {
          unit_cost: 10.0,
        });
      }).toThrow(/Currency \(USD or CAD\) is required when unit_cost is specified/);

      // Adding unit_cost with currency succeeds
      const updatedWithCurr = db.updatePartSourcing('CONN-VAL-02', 'connector', supplier.id, {
        unit_cost: 10.0,
        currency: 'CAD',
      });
      expect(updatedWithCurr.unit_cost).toBe(10.0);
      expect(updatedWithCurr.currency).toBe('CAD');

      // Clearing both unit_cost and currency succeeds
      const clearedBoth = db.updatePartSourcing('CONN-VAL-01', 'connector', supplier.id, {
        unit_cost: null,
        currency: null,
      });
      expect(clearedBoth.unit_cost).toBeNull();
      expect(clearedBoth.currency).toBeNull();
    });

    it('stamps price_history.recorded_at with update timestamp when updating cost without last_checked_date', () => {
      const supplier = db.createSupplier({ name: 'History Date Sup' });
      db.createConnector({ part_number: 'CONN-HIST-DATE', cavity_count: 2 });

      // Initial sourcing created in 2024
      db.createPartSourcing({
        part_number: 'CONN-HIST-DATE',
        part_type: 'connector',
        supplier_id: supplier.id,
        unit_cost: 10.0,
        currency: 'USD',
        last_checked_date: '2024-01-01T00:00:00.000Z',
        created_at: '2024-01-01T00:00:00.000Z',
      });

      const initialHist = db.getPriceHistory('CONN-HIST-DATE', 'connector', supplier.id);
      expect(initialHist).toHaveLength(1);
      expect(initialHist[0]?.recorded_at).toBe('2024-01-01T00:00:00.000Z');

      // Update unit_cost today without specifying last_checked_date
      db.updatePartSourcing('CONN-HIST-DATE', 'connector', supplier.id, {
        unit_cost: 12.5,
        updated_at: '2026-08-25T14:00:00.000Z',
      });

      const histAfterCostChange = db.getPriceHistory('CONN-HIST-DATE', 'connector', supplier.id);
      expect(histAfterCostChange).toHaveLength(2);
      // New price history row must be stamped with updated_at (2026), not stale last_checked_date (2024)
      expect(histAfterCostChange[0]?.unit_cost).toBe(12.5);
      expect(histAfterCostChange[0]?.recorded_at).toBe('2026-08-25T14:00:00.000Z');

      // Part sourcing table's last_checked_date remains unchanged
      const currentSourcing = db.getPartSourcing('CONN-HIST-DATE', 'connector', supplier.id);
      expect(currentSourcing?.last_checked_date).toBe('2024-01-01T00:00:00.000Z');

      // Update unit_cost with an explicit new last_checked_date
      db.updatePartSourcing('CONN-HIST-DATE', 'connector', supplier.id, {
        unit_cost: 15.0,
        last_checked_date: '2026-08-25T16:00:00.000Z',
        updated_at: '2026-08-25T16:30:00.000Z',
      });

      const histWithExplicitDate = db.getPriceHistory('CONN-HIST-DATE', 'connector', supplier.id);
      expect(histWithExplicitDate).toHaveLength(3);
      expect(histWithExplicitDate[0]?.unit_cost).toBe(15.0);
      expect(histWithExplicitDate[0]?.recorded_at).toBe('2026-08-25T16:00:00.000Z');
    });
  });
});
