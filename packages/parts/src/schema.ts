/**
 * SQLite schema definitions and constants for @openharness/parts.
 *
 * Transcribed from DATA-LAYER-SPEC.md § Adopted schema.
 * All master tables carry `version INTEGER NOT NULL DEFAULT 1` and `last_modified_date TEXT`.
 */

export const CURRENT_SCHEMA_VERSION = 2;

export const SCHEMA_V1_DDL = `
CREATE TABLE IF NOT EXISTS connector_families (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manufacturer TEXT NOT NULL,
  series_name TEXT NOT NULL,
  description TEXT,
  sealed INTEGER NOT NULL DEFAULT 0,
  shape TEXT,
  datasheet_url TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  last_modified_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connectors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER REFERENCES connector_families(id) ON DELETE SET NULL,
  part_number TEXT NOT NULL UNIQUE,
  manufacturer_part_number TEXT,
  cavity_count INTEGER NOT NULL,
  gender TEXT,
  ratings TEXT,
  gauge_min_mm2 REAL,
  gauge_max_mm2 REAL,
  keying TEXT,
  mounting TEXT,
  temp_min REAL,
  temp_max REAL,
  image_ref TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  last_modified_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cavities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connector_id INTEGER NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  cavity_number INTEGER NOT NULL,
  position_label TEXT,
  max_wire_gauge_mm2 REAL,
  contact_part_number TEXT,
  UNIQUE(connector_id, cavity_number)
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_number TEXT NOT NULL UNIQUE,
  manufacturer_part_number TEXT,
  gauge_min_mm2 REAL,
  gauge_max_mm2 REAL,
  termination_type TEXT,
  gender TEXT,
  cavity_seal_part_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  last_modified_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backshells (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_number TEXT NOT NULL UNIQUE,
  manufacturer_part_number TEXT,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  last_modified_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backshell_compatibility (
  backshell_id INTEGER NOT NULL REFERENCES backshells(id) ON DELETE CASCADE,
  connector_family_id INTEGER NOT NULL REFERENCES connector_families(id) ON DELETE CASCADE,
  PRIMARY KEY (backshell_id, connector_family_id)
);

CREATE TABLE IF NOT EXISTS wire_specs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_number TEXT NOT NULL UNIQUE,
  manufacturer_part_number TEXT,
  gauge_mm2 REAL NOT NULL,
  outer_diameter_um INTEGER,
  spool_length_um INTEGER,
  spool_length_display_unit TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  last_modified_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tooling (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_number TEXT NOT NULL UNIQUE,
  manufacturer_part_number TEXT,
  description TEXT,
  calibration_interval_days INTEGER,
  last_calibration_date TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  last_modified_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tooling_compatibility (
  tooling_id INTEGER NOT NULL REFERENCES tooling(id) ON DELETE CASCADE,
  connector_family_id INTEGER NOT NULL REFERENCES connector_families(id) ON DELETE CASCADE,
  PRIMARY KEY (tooling_id, connector_family_id)
);

CREATE TABLE IF NOT EXISTS part_revision_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_number TEXT NOT NULL,
  part_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_date TEXT NOT NULL,
  changed_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_connectors_family ON connectors(family_id);
CREATE INDEX IF NOT EXISTS idx_cavities_connector ON cavities(connector_id);
CREATE INDEX IF NOT EXISTS idx_backshell_compat_family ON backshell_compatibility(connector_family_id);
CREATE INDEX IF NOT EXISTS idx_tooling_compat_family ON tooling_compatibility(connector_family_id);
CREATE INDEX IF NOT EXISTS idx_revision_log_part ON part_revision_log(part_number, part_type);
`;

export const SCHEMA_V2_DDL = `
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_info TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Unit cost storage decision (T18 trap / D2 / T21):
-- unit_cost is stored as REAL (floating-point) to accommodate fractional unit costs (e.g. bulk wire
-- at $0.034/m or high-volume stamped contacts at $0.0125/ea). T21 BOM release snapshot calculations
-- round aggregate line totals and order totals exact to the cent at calculation boundaries.
CREATE TABLE IF NOT EXISTS part_sourcing (
  part_number TEXT NOT NULL,
  part_type TEXT NOT NULL,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_part_number TEXT,
  unit_cost REAL,
  currency TEXT,
  moq INTEGER,
  lead_time_days INTEGER,
  stock_status TEXT,
  distributor_url TEXT,
  preferred INTEGER NOT NULL DEFAULT 0,
  last_checked_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (part_number, part_type, supplier_id)
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_number TEXT NOT NULL,
  part_type TEXT NOT NULL,
  supplier_id INTEGER NOT NULL,
  unit_cost REAL NOT NULL,
  currency TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (part_number, part_type, supplier_id) REFERENCES part_sourcing(part_number, part_type, supplier_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);
CREATE INDEX IF NOT EXISTS idx_part_sourcing_supplier ON part_sourcing(supplier_id);
CREATE INDEX IF NOT EXISTS idx_part_sourcing_part ON part_sourcing(part_number, part_type);
CREATE INDEX IF NOT EXISTS idx_price_history_sourcing ON price_history(part_number, part_type, supplier_id);
CREATE INDEX IF NOT EXISTS idx_price_history_recorded ON price_history(recorded_at);
`;

export const ALL_TABLE_NAMES = [
  'connector_families',
  'connectors',
  'cavities',
  'contacts',
  'backshells',
  'backshell_compatibility',
  'wire_specs',
  'tooling',
  'tooling_compatibility',
  'part_revision_log',
  'suppliers',
  'part_sourcing',
  'price_history',
] as const;
