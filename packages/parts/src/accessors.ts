/**
 * Typed SQLite accessors for @openharness/parts.
 *
 * Implements CRUD and compatibility queries for all master tables and revision logs.
 * Enforces canonical units (mm², µm), ISO-8601 timestamps, and closed-set enumerations.
 */

import type Database from 'better-sqlite3';
import {
  toSquareMillimetres,
  fromSquareMillimetres,
  toMicrometres,
  fromMicrometres,
  type Gauge,
  type GaugeUnit,
  type LengthUnit,
} from '@openharness/core';
import type {
  ConnectorFamily,
  ConnectorFamilyInput,
  ConnectorPart,
  ConnectorPartInput,
  Cavity,
  CavityInput,
  ContactPart,
  ContactPartInput,
  BackshellPart,
  BackshellPartInput,
  WireSpecPart,
  WireSpecPartInput,
  ToolingPart,
  ToolingPartInput,
  PartRevisionLogEntry,
  PartRevisionLogInput,
  PartType,
  SpoolLengthDisplayUnit,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers & Validation
// ---------------------------------------------------------------------------

const VALID_PART_TYPES = new Set<PartType>([
  'connector',
  'contact',
  'wire',
  'tooling',
  'backshell',
  'connector_family',
]);

const VALID_SPOOL_UNITS = new Set<SpoolLengthDisplayUnit>(['ft', 'm', 'in', 'cm']);

/**
 * Validates and formats an ISO-8601 date string.
 * Normalizes input dates to canonical ISO-8601 format before storing.
 * If undefined or empty, returns current timestamp in ISO-8601 format.
 */
export function validateAndFormatDate(dateStr?: string | null, fieldName = 'date'): string {
  if (dateStr === undefined || dateStr === null || dateStr === '') {
    return new Date().toISOString();
  }
  const timestamp = Date.parse(dateStr);
  if (Number.isNaN(timestamp)) {
    throw new Error(`Invalid ISO-8601 date for ${fieldName}: "${dateStr}"`);
  }
  return new Date(timestamp).toISOString();
}

/**
 * Resolves a Gauge or number (in mm²) to canonical mm² (number).
 */
export function resolveGaugeMm2(
  gaugeOrMm2?: Gauge | number | null,
  gaugeObj?: Gauge | null,
): number | null {
  if (gaugeObj !== undefined && gaugeObj !== null) {
    return toSquareMillimetres(gaugeObj);
  }
  if (gaugeOrMm2 === undefined || gaugeOrMm2 === null) {
    return null;
  }
  if (typeof gaugeOrMm2 === 'number') {
    return gaugeOrMm2;
  }
  return toSquareMillimetres(gaugeOrMm2);
}

/**
 * Formats a wire's spool length in its display unit (e.g. { value: 500, unit: 'ft' }).
 */
export function renderSpoolLength(
  wire: WireSpecPart,
): { value: number; unit: SpoolLengthDisplayUnit } | undefined {
  if (wire.spool_length_um === null || wire.spool_length_um === undefined) {
    return undefined;
  }
  const unit = wire.spool_length_display_unit;
  if (!unit || !VALID_SPOOL_UNITS.has(unit)) {
    return undefined;
  }
  const value = fromMicrometres(wire.spool_length_um, unit as LengthUnit);
  return { value, unit };
}

/**
 * Formats a wire's spool length as a human-readable string (e.g. "500 ft").
 */
export function formatSpoolLength(wire: WireSpecPart): string | undefined {
  const rendered = renderSpoolLength(wire);
  if (!rendered) return undefined;
  return `${rendered.value} ${rendered.unit}`;
}

/**
 * Converts a wire's canonical gauge in mm² to any supported GaugeUnit.
 */
export function getWireSpecGauge(wire: WireSpecPart, unit: GaugeUnit = 'mm2'): Gauge {
  return {
    value: fromSquareMillimetres(wire.gauge_mm2, unit),
    unit,
  };
}

// ---------------------------------------------------------------------------
// 1. Connector Families
// ---------------------------------------------------------------------------

interface ConnectorFamilyRow {
  id: number;
  manufacturer: string;
  series_name: string;
  description: string | null;
  sealed: number;
  shape: string | null;
  datasheet_url: string | null;
  version: number;
  last_modified_date: string;
}

function rowToConnectorFamily(row: ConnectorFamilyRow): ConnectorFamily {
  return {
    id: row.id,
    manufacturer: row.manufacturer,
    series_name: row.series_name,
    description: row.description,
    sealed: Boolean(row.sealed),
    shape: row.shape,
    datasheet_url: row.datasheet_url,
    version: row.version,
    last_modified_date: row.last_modified_date,
  };
}

export function createConnectorFamily(
  db: Database.Database,
  input: ConnectorFamilyInput,
): ConnectorFamily {
  const lastModified = validateAndFormatDate(input.last_modified_date, 'last_modified_date');
  const version = input.version ?? 1;
  const sealed = input.sealed ? 1 : 0;

  const stmt = db.prepare(`
    INSERT INTO connector_families (
      manufacturer, series_name, description, sealed, shape, datasheet_url, version, last_modified_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.manufacturer,
    input.series_name,
    input.description ?? null,
    sealed,
    input.shape ?? null,
    input.datasheet_url ?? null,
    version,
    lastModified,
  );

  return {
    id: Number(result.lastInsertRowid),
    manufacturer: input.manufacturer,
    series_name: input.series_name,
    description: input.description ?? null,
    sealed: Boolean(input.sealed),
    shape: input.shape ?? null,
    datasheet_url: input.datasheet_url ?? null,
    version,
    last_modified_date: lastModified,
  };
}

export function getConnectorFamily(
  db: Database.Database,
  id: number,
): ConnectorFamily | null {
  const row = db.prepare('SELECT * FROM connector_families WHERE id = ?').get(id) as
    | ConnectorFamilyRow
    | undefined;
  return row ? rowToConnectorFamily(row) : null;
}

export function listConnectorFamilies(db: Database.Database): ConnectorFamily[] {
  const rows = db.prepare('SELECT * FROM connector_families ORDER BY manufacturer, series_name').all() as ConnectorFamilyRow[];
  return rows.map(rowToConnectorFamily);
}

export function updateConnectorFamily(
  db: Database.Database,
  id: number,
  input: Partial<ConnectorFamilyInput>,
): ConnectorFamily {
  const existing = getConnectorFamily(db, id);
  if (!existing) {
    throw new Error(`Connector family with id ${id} not found`);
  }

  const manufacturer = input.manufacturer ?? existing.manufacturer;
  const series_name = input.series_name ?? existing.series_name;
  const description = input.description !== undefined ? input.description : existing.description;
  const sealed = input.sealed !== undefined ? (input.sealed ? 1 : 0) : (existing.sealed ? 1 : 0);
  const shape = input.shape !== undefined ? input.shape : existing.shape;
  const datasheet_url = input.datasheet_url !== undefined ? input.datasheet_url : existing.datasheet_url;
  const version = input.version ?? existing.version;
  const last_modified_date = validateAndFormatDate(input.last_modified_date, 'last_modified_date');

  db.prepare(`
    UPDATE connector_families SET
      manufacturer = ?,
      series_name = ?,
      description = ?,
      sealed = ?,
      shape = ?,
      datasheet_url = ?,
      version = ?,
      last_modified_date = ?
    WHERE id = ?
  `).run(
    manufacturer,
    series_name,
    description,
    sealed,
    shape,
    datasheet_url,
    version,
    last_modified_date,
    id,
  );

  return {
    id,
    manufacturer,
    series_name,
    description,
    sealed: Boolean(sealed),
    shape,
    datasheet_url,
    version,
    last_modified_date,
  };
}

export function deleteConnectorFamily(db: Database.Database, id: number): boolean {
  const result = db.prepare('DELETE FROM connector_families WHERE id = ?').run(id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// 2. Connectors
// ---------------------------------------------------------------------------

interface ConnectorRow {
  id: number;
  family_id: number | null;
  part_number: string;
  manufacturer_part_number: string | null;
  cavity_count: number;
  gender: string | null;
  ratings: string | null;
  gauge_min_mm2: number | null;
  gauge_max_mm2: number | null;
  keying: string | null;
  mounting: string | null;
  temp_min: number | null;
  temp_max: number | null;
  image_ref: string | null;
  version: number;
  last_modified_date: string;
}

function rowToConnectorPart(row: ConnectorRow): ConnectorPart {
  return {
    id: row.id,
    family_id: row.family_id,
    part_number: row.part_number,
    manufacturer_part_number: row.manufacturer_part_number,
    cavity_count: row.cavity_count,
    gender: row.gender,
    ratings: row.ratings,
    gauge_min_mm2: row.gauge_min_mm2,
    gauge_max_mm2: row.gauge_max_mm2,
    keying: row.keying,
    mounting: row.mounting,
    temp_min: row.temp_min,
    temp_max: row.temp_max,
    image_ref: row.image_ref,
    version: row.version,
    last_modified_date: row.last_modified_date,
  };
}

export function createConnector(
  db: Database.Database,
  input: ConnectorPartInput,
): ConnectorPart {
  const lastModified = validateAndFormatDate(input.last_modified_date, 'last_modified_date');
  const version = input.version ?? 1;
  const gaugeMin = resolveGaugeMm2(input.gauge_min_mm2, input.gauge_min);
  const gaugeMax = resolveGaugeMm2(input.gauge_max_mm2, input.gauge_max);

  const stmt = db.prepare(`
    INSERT INTO connectors (
      family_id, part_number, manufacturer_part_number, cavity_count, gender,
      ratings, gauge_min_mm2, gauge_max_mm2, keying, mounting, temp_min,
      temp_max, image_ref, version, last_modified_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.family_id ?? null,
    input.part_number,
    input.manufacturer_part_number ?? null,
    input.cavity_count,
    input.gender ?? null,
    input.ratings ?? null,
    gaugeMin,
    gaugeMax,
    input.keying ?? null,
    input.mounting ?? null,
    input.temp_min ?? null,
    input.temp_max ?? null,
    input.image_ref ?? null,
    version,
    lastModified,
  );

  return {
    id: Number(result.lastInsertRowid),
    family_id: input.family_id ?? null,
    part_number: input.part_number,
    manufacturer_part_number: input.manufacturer_part_number ?? null,
    cavity_count: input.cavity_count,
    gender: input.gender ?? null,
    ratings: input.ratings ?? null,
    gauge_min_mm2: gaugeMin,
    gauge_max_mm2: gaugeMax,
    keying: input.keying ?? null,
    mounting: input.mounting ?? null,
    temp_min: input.temp_min ?? null,
    temp_max: input.temp_max ?? null,
    image_ref: input.image_ref ?? null,
    version,
    last_modified_date: lastModified,
  };
}

export function getConnector(
  db: Database.Database,
  id: number,
): ConnectorPart | null {
  const row = db.prepare('SELECT * FROM connectors WHERE id = ?').get(id) as
    | ConnectorRow
    | undefined;
  return row ? rowToConnectorPart(row) : null;
}

export function getConnectorByPartNumber(
  db: Database.Database,
  partNumber: string,
): ConnectorPart | null {
  const row = db.prepare('SELECT * FROM connectors WHERE part_number = ?').get(partNumber) as
    | ConnectorRow
    | undefined;
  return row ? rowToConnectorPart(row) : null;
}

export function listConnectors(
  db: Database.Database,
  filter?: { family_id?: number },
): ConnectorPart[] {
  let query = 'SELECT * FROM connectors';
  const params: unknown[] = [];
  if (filter?.family_id !== undefined) {
    query += ' WHERE family_id = ?';
    params.push(filter.family_id);
  }
  query += ' ORDER BY part_number';
  const rows = db.prepare(query).all(...params) as ConnectorRow[];
  return rows.map(rowToConnectorPart);
}

export function updateConnector(
  db: Database.Database,
  idOrPartNumber: number | string,
  input: Partial<ConnectorPartInput>,
): ConnectorPart {
  const existing =
    typeof idOrPartNumber === 'number'
      ? getConnector(db, idOrPartNumber)
      : getConnectorByPartNumber(db, idOrPartNumber);

  if (!existing) {
    throw new Error(`Connector "${idOrPartNumber}" not found`);
  }

  const id = existing.id;
  const family_id = input.family_id !== undefined ? input.family_id : existing.family_id;
  const part_number = input.part_number ?? existing.part_number;
  const manufacturer_part_number =
    input.manufacturer_part_number !== undefined
      ? input.manufacturer_part_number
      : existing.manufacturer_part_number;
  const cavity_count = input.cavity_count ?? existing.cavity_count;
  const gender = input.gender !== undefined ? input.gender : existing.gender;
  const ratings = input.ratings !== undefined ? input.ratings : existing.ratings;

  const gauge_min_mm2 =
    input.gauge_min !== undefined || input.gauge_min_mm2 !== undefined
      ? resolveGaugeMm2(input.gauge_min_mm2, input.gauge_min)
      : existing.gauge_min_mm2;

  const gauge_max_mm2 =
    input.gauge_max !== undefined || input.gauge_max_mm2 !== undefined
      ? resolveGaugeMm2(input.gauge_max_mm2, input.gauge_max)
      : existing.gauge_max_mm2;

  const keying = input.keying !== undefined ? input.keying : existing.keying;
  const mounting = input.mounting !== undefined ? input.mounting : existing.mounting;
  const temp_min = input.temp_min !== undefined ? input.temp_min : existing.temp_min;
  const temp_max = input.temp_max !== undefined ? input.temp_max : existing.temp_max;
  const image_ref = input.image_ref !== undefined ? input.image_ref : existing.image_ref;
  const version = input.version ?? existing.version;
  const last_modified_date = validateAndFormatDate(input.last_modified_date, 'last_modified_date');

  db.prepare(`
    UPDATE connectors SET
      family_id = ?,
      part_number = ?,
      manufacturer_part_number = ?,
      cavity_count = ?,
      gender = ?,
      ratings = ?,
      gauge_min_mm2 = ?,
      gauge_max_mm2 = ?,
      keying = ?,
      mounting = ?,
      temp_min = ?,
      temp_max = ?,
      image_ref = ?,
      version = ?,
      last_modified_date = ?
    WHERE id = ?
  `).run(
    family_id,
    part_number,
    manufacturer_part_number,
    cavity_count,
    gender,
    ratings,
    gauge_min_mm2,
    gauge_max_mm2,
    keying,
    mounting,
    temp_min,
    temp_max,
    image_ref,
    version,
    last_modified_date,
    id,
  );

  return {
    id,
    family_id,
    part_number,
    manufacturer_part_number,
    cavity_count,
    gender,
    ratings,
    gauge_min_mm2,
    gauge_max_mm2,
    keying,
    mounting,
    temp_min,
    temp_max,
    image_ref,
    version,
    last_modified_date,
  };
}

export function deleteConnector(
  db: Database.Database,
  idOrPartNumber: number | string,
): boolean {
  const result =
    typeof idOrPartNumber === 'number'
      ? db.prepare('DELETE FROM connectors WHERE id = ?').run(idOrPartNumber)
      : db.prepare('DELETE FROM connectors WHERE part_number = ?').run(idOrPartNumber);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// 3. Cavities
// ---------------------------------------------------------------------------

interface CavityRow {
  id: number;
  connector_id: number;
  cavity_number: number;
  position_label: string | null;
  max_wire_gauge_mm2: number | null;
  contact_part_number: string | null;
}

function rowToCavity(row: CavityRow): Cavity {
  return {
    id: row.id,
    connector_id: row.connector_id,
    cavity_number: row.cavity_number,
    position_label: row.position_label,
    max_wire_gauge_mm2: row.max_wire_gauge_mm2,
    contact_part_number: row.contact_part_number,
  };
}

export function createCavity(
  db: Database.Database,
  input: CavityInput,
): Cavity {
  const maxGaugeMm2 = resolveGaugeMm2(input.max_wire_gauge_mm2, input.max_wire_gauge);

  const stmt = db.prepare(`
    INSERT INTO cavities (
      connector_id, cavity_number, position_label, max_wire_gauge_mm2, contact_part_number
    ) VALUES (?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.connector_id,
    input.cavity_number,
    input.position_label ?? null,
    maxGaugeMm2,
    input.contact_part_number ?? null,
  );

  return {
    id: Number(result.lastInsertRowid),
    connector_id: input.connector_id,
    cavity_number: input.cavity_number,
    position_label: input.position_label ?? null,
    max_wire_gauge_mm2: maxGaugeMm2,
    contact_part_number: input.contact_part_number ?? null,
  };
}

export function createCavities(
  db: Database.Database,
  inputs: CavityInput[],
): Cavity[] {
  const insertMany = db.transaction((cavityInputs: CavityInput[]) => {
    return cavityInputs.map(input => createCavity(db, input));
  });
  return insertMany(inputs);
}

export function getCavitiesForConnector(
  db: Database.Database,
  connectorId: number,
): Cavity[] {
  const rows = db
    .prepare('SELECT * FROM cavities WHERE connector_id = ? ORDER BY cavity_number')
    .all(connectorId) as CavityRow[];
  return rows.map(rowToCavity);
}

export function deleteCavity(db: Database.Database, id: number): boolean {
  const result = db.prepare('DELETE FROM cavities WHERE id = ?').run(id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// 4. Contacts
// ---------------------------------------------------------------------------

interface ContactRow {
  id: number;
  part_number: string;
  manufacturer_part_number: string | null;
  gauge_min_mm2: number | null;
  gauge_max_mm2: number | null;
  termination_type: string | null;
  gender: string | null;
  cavity_seal_part_id: string | null;
  version: number;
  last_modified_date: string;
}

function rowToContactPart(row: ContactRow): ContactPart {
  return {
    id: row.id,
    part_number: row.part_number,
    manufacturer_part_number: row.manufacturer_part_number,
    gauge_min_mm2: row.gauge_min_mm2,
    gauge_max_mm2: row.gauge_max_mm2,
    termination_type: row.termination_type,
    gender: row.gender,
    cavity_seal_part_id: row.cavity_seal_part_id,
    version: row.version,
    last_modified_date: row.last_modified_date,
  };
}

export function createContact(
  db: Database.Database,
  input: ContactPartInput,
): ContactPart {
  const lastModified = validateAndFormatDate(input.last_modified_date, 'last_modified_date');
  const version = input.version ?? 1;
  const gaugeMin = resolveGaugeMm2(input.gauge_min_mm2, input.gauge_min);
  const gaugeMax = resolveGaugeMm2(input.gauge_max_mm2, input.gauge_max);

  const stmt = db.prepare(`
    INSERT INTO contacts (
      part_number, manufacturer_part_number, gauge_min_mm2, gauge_max_mm2,
      termination_type, gender, cavity_seal_part_id, version, last_modified_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.part_number,
    input.manufacturer_part_number ?? null,
    gaugeMin,
    gaugeMax,
    input.termination_type ?? null,
    input.gender ?? null,
    input.cavity_seal_part_id ?? null,
    version,
    lastModified,
  );

  return {
    id: Number(result.lastInsertRowid),
    part_number: input.part_number,
    manufacturer_part_number: input.manufacturer_part_number ?? null,
    gauge_min_mm2: gaugeMin,
    gauge_max_mm2: gaugeMax,
    termination_type: input.termination_type ?? null,
    gender: input.gender ?? null,
    cavity_seal_part_id: input.cavity_seal_part_id ?? null,
    version,
    last_modified_date: lastModified,
  };
}

export function getContact(
  db: Database.Database,
  id: number,
): ContactPart | null {
  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as ContactRow | undefined;
  return row ? rowToContactPart(row) : null;
}

export function getContactByPartNumber(
  db: Database.Database,
  partNumber: string,
): ContactPart | null {
  const row = db.prepare('SELECT * FROM contacts WHERE part_number = ?').get(partNumber) as
    | ContactRow
    | undefined;
  return row ? rowToContactPart(row) : null;
}

export function listContacts(db: Database.Database): ContactPart[] {
  const rows = db.prepare('SELECT * FROM contacts ORDER BY part_number').all() as ContactRow[];
  return rows.map(rowToContactPart);
}

export function updateContact(
  db: Database.Database,
  idOrPartNumber: number | string,
  input: Partial<ContactPartInput>,
): ContactPart {
  const existing =
    typeof idOrPartNumber === 'number'
      ? getContact(db, idOrPartNumber)
      : getContactByPartNumber(db, idOrPartNumber);

  if (!existing) {
    throw new Error(`Contact "${idOrPartNumber}" not found`);
  }

  const id = existing.id;
  const part_number = input.part_number ?? existing.part_number;
  const manufacturer_part_number =
    input.manufacturer_part_number !== undefined
      ? input.manufacturer_part_number
      : existing.manufacturer_part_number;

  const gauge_min_mm2 =
    input.gauge_min !== undefined || input.gauge_min_mm2 !== undefined
      ? resolveGaugeMm2(input.gauge_min_mm2, input.gauge_min)
      : existing.gauge_min_mm2;

  const gauge_max_mm2 =
    input.gauge_max !== undefined || input.gauge_max_mm2 !== undefined
      ? resolveGaugeMm2(input.gauge_max_mm2, input.gauge_max)
      : existing.gauge_max_mm2;

  const termination_type =
    input.termination_type !== undefined ? input.termination_type : existing.termination_type;
  const gender = input.gender !== undefined ? input.gender : existing.gender;
  const cavity_seal_part_id =
    input.cavity_seal_part_id !== undefined
      ? input.cavity_seal_part_id
      : existing.cavity_seal_part_id;
  const version = input.version ?? existing.version;
  const last_modified_date = validateAndFormatDate(input.last_modified_date, 'last_modified_date');

  db.prepare(`
    UPDATE contacts SET
      part_number = ?,
      manufacturer_part_number = ?,
      gauge_min_mm2 = ?,
      gauge_max_mm2 = ?,
      termination_type = ?,
      gender = ?,
      cavity_seal_part_id = ?,
      version = ?,
      last_modified_date = ?
    WHERE id = ?
  `).run(
    part_number,
    manufacturer_part_number,
    gauge_min_mm2,
    gauge_max_mm2,
    termination_type,
    gender,
    cavity_seal_part_id,
    version,
    last_modified_date,
    id,
  );

  return {
    id,
    part_number,
    manufacturer_part_number,
    gauge_min_mm2,
    gauge_max_mm2,
    termination_type,
    gender,
    cavity_seal_part_id,
    version,
    last_modified_date,
  };
}

export function deleteContact(
  db: Database.Database,
  idOrPartNumber: number | string,
): boolean {
  const result =
    typeof idOrPartNumber === 'number'
      ? db.prepare('DELETE FROM contacts WHERE id = ?').run(idOrPartNumber)
      : db.prepare('DELETE FROM contacts WHERE part_number = ?').run(idOrPartNumber);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// 5. Backshells & Compatibility
// ---------------------------------------------------------------------------

interface BackshellRow {
  id: number;
  part_number: string;
  manufacturer_part_number: string | null;
  description: string | null;
  version: number;
  last_modified_date: string;
}

function rowToBackshellPart(row: BackshellRow): BackshellPart {
  return {
    id: row.id,
    part_number: row.part_number,
    manufacturer_part_number: row.manufacturer_part_number,
    description: row.description,
    version: row.version,
    last_modified_date: row.last_modified_date,
  };
}

export function createBackshell(
  db: Database.Database,
  input: BackshellPartInput,
): BackshellPart {
  const lastModified = validateAndFormatDate(input.last_modified_date, 'last_modified_date');
  const version = input.version ?? 1;

  const stmt = db.prepare(`
    INSERT INTO backshells (
      part_number, manufacturer_part_number, description, version, last_modified_date
    ) VALUES (?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.part_number,
    input.manufacturer_part_number ?? null,
    input.description ?? null,
    version,
    lastModified,
  );

  return {
    id: Number(result.lastInsertRowid),
    part_number: input.part_number,
    manufacturer_part_number: input.manufacturer_part_number ?? null,
    description: input.description ?? null,
    version,
    last_modified_date: lastModified,
  };
}

export function getBackshell(
  db: Database.Database,
  id: number,
): BackshellPart | null {
  const row = db.prepare('SELECT * FROM backshells WHERE id = ?').get(id) as BackshellRow | undefined;
  return row ? rowToBackshellPart(row) : null;
}

export function getBackshellByPartNumber(
  db: Database.Database,
  partNumber: string,
): BackshellPart | null {
  const row = db.prepare('SELECT * FROM backshells WHERE part_number = ?').get(partNumber) as
    | BackshellRow
    | undefined;
  return row ? rowToBackshellPart(row) : null;
}

export function listBackshells(db: Database.Database): BackshellPart[] {
  const rows = db.prepare('SELECT * FROM backshells ORDER BY part_number').all() as BackshellRow[];
  return rows.map(rowToBackshellPart);
}

export function updateBackshell(
  db: Database.Database,
  idOrPartNumber: number | string,
  input: Partial<BackshellPartInput>,
): BackshellPart {
  const existing =
    typeof idOrPartNumber === 'number'
      ? getBackshell(db, idOrPartNumber)
      : getBackshellByPartNumber(db, idOrPartNumber);

  if (!existing) {
    throw new Error(`Backshell "${idOrPartNumber}" not found`);
  }

  const id = existing.id;
  const part_number = input.part_number ?? existing.part_number;
  const manufacturer_part_number =
    input.manufacturer_part_number !== undefined
      ? input.manufacturer_part_number
      : existing.manufacturer_part_number;
  const description = input.description !== undefined ? input.description : existing.description;
  const version = input.version ?? existing.version;
  const last_modified_date = validateAndFormatDate(input.last_modified_date, 'last_modified_date');

  db.prepare(`
    UPDATE backshells SET
      part_number = ?,
      manufacturer_part_number = ?,
      description = ?,
      version = ?,
      last_modified_date = ?
    WHERE id = ?
  `).run(part_number, manufacturer_part_number, description, version, last_modified_date, id);

  return {
    id,
    part_number,
    manufacturer_part_number,
    description,
    version,
    last_modified_date,
  };
}

export function deleteBackshell(
  db: Database.Database,
  idOrPartNumber: number | string,
): boolean {
  const result =
    typeof idOrPartNumber === 'number'
      ? db.prepare('DELETE FROM backshells WHERE id = ?').run(idOrPartNumber)
      : db.prepare('DELETE FROM backshells WHERE part_number = ?').run(idOrPartNumber);
  return result.changes > 0;
}

export function setBackshellCompatibility(
  db: Database.Database,
  backshellId: number,
  familyIds: number[],
): void {
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM backshell_compatibility WHERE backshell_id = ?').run(backshellId);
    const insert = db.prepare(
      'INSERT INTO backshell_compatibility (backshell_id, connector_family_id) VALUES (?, ?)',
    );
    for (const familyId of familyIds) {
      insert.run(backshellId, familyId);
    }
  });
  txn();
}

export function getBackshellCompatibleFamilies(
  db: Database.Database,
  backshellId: number,
): ConnectorFamily[] {
  const rows = db.prepare(`
    SELECT f.* FROM connector_families f
    JOIN backshell_compatibility bc ON f.id = bc.connector_family_id
    WHERE bc.backshell_id = ?
    ORDER BY f.manufacturer, f.series_name
  `).all(backshellId) as ConnectorFamilyRow[];
  return rows.map(rowToConnectorFamily);
}

export function getCompatibleBackshellsForFamily(
  db: Database.Database,
  familyId: number,
): BackshellPart[] {
  const rows = db.prepare(`
    SELECT b.* FROM backshells b
    JOIN backshell_compatibility bc ON b.id = bc.backshell_id
    WHERE bc.connector_family_id = ?
    ORDER BY b.part_number
  `).all(familyId) as BackshellRow[];
  return rows.map(rowToBackshellPart);
}

// ---------------------------------------------------------------------------
// 6. Wire Specs
// ---------------------------------------------------------------------------

interface WireSpecRow {
  id: number;
  part_number: string;
  manufacturer_part_number: string | null;
  gauge_mm2: number;
  outer_diameter_um: number | null;
  spool_length_um: number | null;
  spool_length_display_unit: string | null;
  version: number;
  last_modified_date: string;
}

function rowToWireSpecPart(row: WireSpecRow): WireSpecPart {
  return {
    id: row.id,
    part_number: row.part_number,
    manufacturer_part_number: row.manufacturer_part_number,
    gauge_mm2: row.gauge_mm2,
    outer_diameter_um: row.outer_diameter_um,
    spool_length_um: row.spool_length_um,
    spool_length_display_unit: (row.spool_length_display_unit as SpoolLengthDisplayUnit) || null,
    version: row.version,
    last_modified_date: row.last_modified_date,
  };
}

export function createWireSpec(
  db: Database.Database,
  input: WireSpecPartInput,
): WireSpecPart {
  const lastModified = validateAndFormatDate(input.last_modified_date, 'last_modified_date');
  const version = input.version ?? 1;

  let gaugeMm2: number;
  if (input.gauge !== undefined) {
    gaugeMm2 = toSquareMillimetres(input.gauge);
  } else if (input.gauge_mm2 !== undefined) {
    gaugeMm2 = input.gauge_mm2;
  } else {
    throw new Error('Wire spec requires gauge or gauge_mm2');
  }

  let spoolLengthUm: number | null = input.spool_length_um ?? null;
  let spoolUnit: SpoolLengthDisplayUnit | null = input.spool_length_display_unit ?? null;

  if (input.spool_length !== undefined) {
    const unit = input.spool_length.unit as SpoolLengthDisplayUnit;
    if (!VALID_SPOOL_UNITS.has(unit)) {
      throw new Error(`Invalid spool length display unit: "${unit}"`);
    }
    spoolLengthUm = toMicrometres(input.spool_length.value, unit as LengthUnit);
    spoolUnit = unit;
  }

  if (spoolUnit !== null && !VALID_SPOOL_UNITS.has(spoolUnit)) {
    throw new Error(`Invalid spool length display unit: "${spoolUnit}"`);
  }

  const odUm = input.outer_diameter_um !== undefined && input.outer_diameter_um !== null
    ? Math.round(input.outer_diameter_um)
    : null;

  const stmt = db.prepare(`
    INSERT INTO wire_specs (
      part_number, manufacturer_part_number, gauge_mm2, outer_diameter_um,
      spool_length_um, spool_length_display_unit, version, last_modified_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.part_number,
    input.manufacturer_part_number ?? null,
    gaugeMm2,
    odUm,
    spoolLengthUm,
    spoolUnit,
    version,
    lastModified,
  );

  return {
    id: Number(result.lastInsertRowid),
    part_number: input.part_number,
    manufacturer_part_number: input.manufacturer_part_number ?? null,
    gauge_mm2: gaugeMm2,
    outer_diameter_um: odUm,
    spool_length_um: spoolLengthUm,
    spool_length_display_unit: spoolUnit,
    version,
    last_modified_date: lastModified,
  };
}

export function getWireSpec(
  db: Database.Database,
  id: number,
): WireSpecPart | null {
  const row = db.prepare('SELECT * FROM wire_specs WHERE id = ?').get(id) as WireSpecRow | undefined;
  return row ? rowToWireSpecPart(row) : null;
}

export function getWireSpecByPartNumber(
  db: Database.Database,
  partNumber: string,
): WireSpecPart | null {
  const row = db.prepare('SELECT * FROM wire_specs WHERE part_number = ?').get(partNumber) as
    | WireSpecRow
    | undefined;
  return row ? rowToWireSpecPart(row) : null;
}

export function listWireSpecs(db: Database.Database): WireSpecPart[] {
  const rows = db.prepare('SELECT * FROM wire_specs ORDER BY part_number').all() as WireSpecRow[];
  return rows.map(rowToWireSpecPart);
}

export function updateWireSpec(
  db: Database.Database,
  idOrPartNumber: number | string,
  input: Partial<WireSpecPartInput>,
): WireSpecPart {
  const existing =
    typeof idOrPartNumber === 'number'
      ? getWireSpec(db, idOrPartNumber)
      : getWireSpecByPartNumber(db, idOrPartNumber);

  if (!existing) {
    throw new Error(`Wire spec "${idOrPartNumber}" not found`);
  }

  const id = existing.id;
  const part_number = input.part_number ?? existing.part_number;
  const manufacturer_part_number =
    input.manufacturer_part_number !== undefined
      ? input.manufacturer_part_number
      : existing.manufacturer_part_number;

  let gauge_mm2 = existing.gauge_mm2;
  if (input.gauge !== undefined) {
    gauge_mm2 = toSquareMillimetres(input.gauge);
  } else if (input.gauge_mm2 !== undefined) {
    gauge_mm2 = input.gauge_mm2;
  }

  let outer_diameter_um = existing.outer_diameter_um;
  if (input.outer_diameter_um !== undefined) {
    outer_diameter_um = input.outer_diameter_um !== null ? Math.round(input.outer_diameter_um) : null;
  }

  let spool_length_um = existing.spool_length_um;
  let spool_length_display_unit = existing.spool_length_display_unit;

  if (input.spool_length !== undefined) {
    const unit = input.spool_length.unit as SpoolLengthDisplayUnit;
    if (!VALID_SPOOL_UNITS.has(unit)) {
      throw new Error(`Invalid spool length display unit: "${unit}"`);
    }
    spool_length_um = toMicrometres(input.spool_length.value, unit as LengthUnit);
    spool_length_display_unit = unit;
  } else {
    if (input.spool_length_um !== undefined) {
      spool_length_um = input.spool_length_um;
    }
    if (input.spool_length_display_unit !== undefined) {
      if (input.spool_length_display_unit !== null && !VALID_SPOOL_UNITS.has(input.spool_length_display_unit)) {
        throw new Error(`Invalid spool length display unit: "${input.spool_length_display_unit}"`);
      }
      spool_length_display_unit = input.spool_length_display_unit;
    }
  }

  const version = input.version ?? existing.version;
  const last_modified_date = validateAndFormatDate(input.last_modified_date, 'last_modified_date');

  db.prepare(`
    UPDATE wire_specs SET
      part_number = ?,
      manufacturer_part_number = ?,
      gauge_mm2 = ?,
      outer_diameter_um = ?,
      spool_length_um = ?,
      spool_length_display_unit = ?,
      version = ?,
      last_modified_date = ?
    WHERE id = ?
  `).run(
    part_number,
    manufacturer_part_number,
    gauge_mm2,
    outer_diameter_um,
    spool_length_um,
    spool_length_display_unit,
    version,
    last_modified_date,
    id,
  );

  return {
    id,
    part_number,
    manufacturer_part_number,
    gauge_mm2,
    outer_diameter_um,
    spool_length_um,
    spool_length_display_unit,
    version,
    last_modified_date,
  };
}

export function deleteWireSpec(
  db: Database.Database,
  idOrPartNumber: number | string,
): boolean {
  const result =
    typeof idOrPartNumber === 'number'
      ? db.prepare('DELETE FROM wire_specs WHERE id = ?').run(idOrPartNumber)
      : db.prepare('DELETE FROM wire_specs WHERE part_number = ?').run(idOrPartNumber);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// 7. Tooling & Compatibility
// ---------------------------------------------------------------------------

interface ToolingRow {
  id: number;
  part_number: string;
  manufacturer_part_number: string | null;
  description: string | null;
  calibration_interval_days: number | null;
  last_calibration_date: string | null;
  version: number;
  last_modified_date: string;
}

function rowToToolingPart(row: ToolingRow): ToolingPart {
  return {
    id: row.id,
    part_number: row.part_number,
    manufacturer_part_number: row.manufacturer_part_number,
    description: row.description,
    calibration_interval_days: row.calibration_interval_days,
    last_calibration_date: row.last_calibration_date,
    version: row.version,
    last_modified_date: row.last_modified_date,
  };
}

export function createTooling(
  db: Database.Database,
  input: ToolingPartInput,
): ToolingPart {
  const lastModified = validateAndFormatDate(input.last_modified_date, 'last_modified_date');
  const lastCalDate = input.last_calibration_date
    ? validateAndFormatDate(input.last_calibration_date, 'last_calibration_date')
    : null;
  const version = input.version ?? 1;

  const stmt = db.prepare(`
    INSERT INTO tooling (
      part_number, manufacturer_part_number, description, calibration_interval_days,
      last_calibration_date, version, last_modified_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.part_number,
    input.manufacturer_part_number ?? null,
    input.description ?? null,
    input.calibration_interval_days ?? null,
    lastCalDate,
    version,
    lastModified,
  );

  return {
    id: Number(result.lastInsertRowid),
    part_number: input.part_number,
    manufacturer_part_number: input.manufacturer_part_number ?? null,
    description: input.description ?? null,
    calibration_interval_days: input.calibration_interval_days ?? null,
    last_calibration_date: lastCalDate,
    version,
    last_modified_date: lastModified,
  };
}

export function getTooling(
  db: Database.Database,
  id: number,
): ToolingPart | null {
  const row = db.prepare('SELECT * FROM tooling WHERE id = ?').get(id) as ToolingRow | undefined;
  return row ? rowToToolingPart(row) : null;
}

export function getToolingByPartNumber(
  db: Database.Database,
  partNumber: string,
): ToolingPart | null {
  const row = db.prepare('SELECT * FROM tooling WHERE part_number = ?').get(partNumber) as
    | ToolingRow
    | undefined;
  return row ? rowToToolingPart(row) : null;
}

export function listTooling(db: Database.Database): ToolingPart[] {
  const rows = db.prepare('SELECT * FROM tooling ORDER BY part_number').all() as ToolingRow[];
  return rows.map(rowToToolingPart);
}

export function updateTooling(
  db: Database.Database,
  idOrPartNumber: number | string,
  input: Partial<ToolingPartInput>,
): ToolingPart {
  const existing =
    typeof idOrPartNumber === 'number'
      ? getTooling(db, idOrPartNumber)
      : getToolingByPartNumber(db, idOrPartNumber);

  if (!existing) {
    throw new Error(`Tooling "${idOrPartNumber}" not found`);
  }

  const id = existing.id;
  const part_number = input.part_number ?? existing.part_number;
  const manufacturer_part_number =
    input.manufacturer_part_number !== undefined
      ? input.manufacturer_part_number
      : existing.manufacturer_part_number;
  const description = input.description !== undefined ? input.description : existing.description;
  const calibration_interval_days =
    input.calibration_interval_days !== undefined
      ? input.calibration_interval_days
      : existing.calibration_interval_days;
  const last_calibration_date =
    input.last_calibration_date !== undefined
      ? input.last_calibration_date
        ? validateAndFormatDate(input.last_calibration_date, 'last_calibration_date')
        : null
      : existing.last_calibration_date;
  const version = input.version ?? existing.version;
  const last_modified_date = validateAndFormatDate(input.last_modified_date, 'last_modified_date');

  db.prepare(`
    UPDATE tooling SET
      part_number = ?,
      manufacturer_part_number = ?,
      description = ?,
      calibration_interval_days = ?,
      last_calibration_date = ?,
      version = ?,
      last_modified_date = ?
    WHERE id = ?
  `).run(
    part_number,
    manufacturer_part_number,
    description,
    calibration_interval_days,
    last_calibration_date,
    version,
    last_modified_date,
    id,
  );

  return {
    id,
    part_number,
    manufacturer_part_number,
    description,
    calibration_interval_days,
    last_calibration_date,
    version,
    last_modified_date,
  };
}

export function deleteTooling(
  db: Database.Database,
  idOrPartNumber: number | string,
): boolean {
  const result =
    typeof idOrPartNumber === 'number'
      ? db.prepare('DELETE FROM tooling WHERE id = ?').run(idOrPartNumber)
      : db.prepare('DELETE FROM tooling WHERE part_number = ?').run(idOrPartNumber);
  return result.changes > 0;
}

export function setToolingCompatibility(
  db: Database.Database,
  toolingId: number,
  familyIds: number[],
): void {
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM tooling_compatibility WHERE tooling_id = ?').run(toolingId);
    const insert = db.prepare(
      'INSERT INTO tooling_compatibility (tooling_id, connector_family_id) VALUES (?, ?)',
    );
    for (const familyId of familyIds) {
      insert.run(toolingId, familyId);
    }
  });
  txn();
}

export function getToolingCompatibleFamilies(
  db: Database.Database,
  toolingId: number,
): ConnectorFamily[] {
  const rows = db.prepare(`
    SELECT f.* FROM connector_families f
    JOIN tooling_compatibility tc ON f.id = tc.connector_family_id
    WHERE tc.tooling_id = ?
    ORDER BY f.manufacturer, f.series_name
  `).all(toolingId) as ConnectorFamilyRow[];
  return rows.map(rowToConnectorFamily);
}

export function getCompatibleToolingForFamily(
  db: Database.Database,
  familyId: number,
): ToolingPart[] {
  const rows = db.prepare(`
    SELECT t.* FROM tooling t
    JOIN tooling_compatibility tc ON t.id = tc.tooling_id
    WHERE tc.connector_family_id = ?
    ORDER BY t.part_number
  `).all(familyId) as ToolingRow[];
  return rows.map(rowToToolingPart);
}

// ---------------------------------------------------------------------------
// 8. Part Revision Log
// ---------------------------------------------------------------------------

interface PartRevisionLogRow {
  id: number;
  part_number: string;
  part_type: string;
  version: number;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_date: string;
  changed_by: string | null;
}

function rowToRevisionLogEntry(row: PartRevisionLogRow): PartRevisionLogEntry {
  return {
    id: row.id,
    part_number: row.part_number,
    part_type: row.part_type as PartType,
    version: row.version,
    field_name: row.field_name,
    old_value: row.old_value,
    new_value: row.new_value,
    changed_date: row.changed_date,
    changed_by: row.changed_by,
  };
}

export function logPartRevision(
  db: Database.Database,
  input: PartRevisionLogInput,
): PartRevisionLogEntry {
  if (!VALID_PART_TYPES.has(input.part_type)) {
    throw new Error(`Invalid part_type in revision log: "${input.part_type}"`);
  }
  const changedDate = validateAndFormatDate(input.changed_date, 'changed_date');

  const stmt = db.prepare(`
    INSERT INTO part_revision_log (
      part_number, part_type, version, field_name, old_value, new_value, changed_date, changed_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.part_number,
    input.part_type,
    input.version,
    input.field_name,
    input.old_value ?? null,
    input.new_value ?? null,
    changedDate,
    input.changed_by ?? null,
  );

  return {
    id: Number(result.lastInsertRowid),
    part_number: input.part_number,
    part_type: input.part_type,
    version: input.version,
    field_name: input.field_name,
    old_value: input.old_value ?? null,
    new_value: input.new_value ?? null,
    changed_date: changedDate,
    changed_by: input.changed_by ?? null,
  };
}

export function logPartRevisions(
  db: Database.Database,
  entries: PartRevisionLogInput[],
): PartRevisionLogEntry[] {
  const insertMany = db.transaction((logInputs: PartRevisionLogInput[]) => {
    return logInputs.map(entry => logPartRevision(db, entry));
  });
  return insertMany(entries);
}

export function getPartRevisionLogs(
  db: Database.Database,
  partNumber: string,
  partType?: PartType,
): PartRevisionLogEntry[] {
  let query = 'SELECT * FROM part_revision_log WHERE part_number = ?';
  const params: unknown[] = [partNumber];
  if (partType) {
    query += ' AND part_type = ?';
    params.push(partType);
  }
  query += ' ORDER BY version DESC, id ASC';
  const rows = db.prepare(query).all(...params) as PartRevisionLogRow[];
  return rows.map(rowToRevisionLogEntry);
}

export function listAllRevisionLogs(db: Database.Database): PartRevisionLogEntry[] {
  const rows = db.prepare('SELECT * FROM part_revision_log ORDER BY id ASC').all() as PartRevisionLogRow[];
  return rows.map(rowToRevisionLogEntry);
}
