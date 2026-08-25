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
  PartType,
  SpoolLengthDisplayUnit,
  FieldType,
  FieldSpec,
  Supplier,
  SupplierInput,
  PartSourcing,
  PartSourcingInput,
  PriceHistoryEntry,
  SourcingCurrency,
} from './types.js';

export const VALID_PART_TYPES = new Set<PartType>([
  'connector',
  'contact',
  'wire',
  'tooling',
  'backshell',
  'connector_family',
]);

export const VALID_SOURCING_CURRENCIES = new Set<SourcingCurrency>(['USD', 'CAD']);

// ---------------------------------------------------------------------------
// Helpers & Validation
// ---------------------------------------------------------------------------

const VALID_SPOOL_UNITS = new Set<SpoolLengthDisplayUnit>(['ft', 'm', 'in', 'cm']);

export const CONNECTOR_FAMILY_FIELDS: FieldSpec[] = [
  { name: 'manufacturer', type: 'string' },
  { name: 'series_name', type: 'string' },
  { name: 'description', type: 'string' },
  { name: 'sealed', type: 'boolean' },
  { name: 'shape', type: 'string' },
  { name: 'datasheet_url', type: 'string' },
];

export const CONNECTOR_FIELDS: FieldSpec[] = [
  { name: 'family_id', type: 'number' },
  { name: 'part_number', type: 'string' },
  { name: 'manufacturer_part_number', type: 'string' },
  { name: 'cavity_count', type: 'number' },
  { name: 'gender', type: 'string' },
  { name: 'ratings', type: 'string' },
  { name: 'gauge_min_mm2', type: 'number' },
  { name: 'gauge_max_mm2', type: 'number' },
  { name: 'keying', type: 'string' },
  { name: 'mounting', type: 'string' },
  { name: 'temp_min', type: 'number' },
  { name: 'temp_max', type: 'number' },
  { name: 'image_ref', type: 'string' },
];

export const CONTACT_FIELDS: FieldSpec[] = [
  { name: 'part_number', type: 'string' },
  { name: 'manufacturer_part_number', type: 'string' },
  { name: 'gauge_min_mm2', type: 'number' },
  { name: 'gauge_max_mm2', type: 'number' },
  { name: 'termination_type', type: 'string' },
  { name: 'gender', type: 'string' },
  { name: 'cavity_seal_part_id', type: 'string' },
];

export const BACKSHELL_FIELDS: FieldSpec[] = [
  { name: 'part_number', type: 'string' },
  { name: 'manufacturer_part_number', type: 'string' },
  { name: 'description', type: 'string' },
];

export const WIRE_SPEC_FIELDS: FieldSpec[] = [
  { name: 'part_number', type: 'string' },
  { name: 'manufacturer_part_number', type: 'string' },
  { name: 'gauge_mm2', type: 'number' },
  { name: 'outer_diameter_um', type: 'number' },
  { name: 'spool_length_um', type: 'number' },
  { name: 'spool_length_display_unit', type: 'string' },
];

export const TOOLING_FIELDS: FieldSpec[] = [
  { name: 'part_number', type: 'string' },
  { name: 'manufacturer_part_number', type: 'string' },
  { name: 'description', type: 'string' },
  { name: 'calibration_interval_days', type: 'number' },
  { name: 'last_calibration_date', type: 'date' },
];

export const FIELD_SPECS_BY_PART_TYPE: Record<PartType, FieldSpec[]> = {
  connector_family: CONNECTOR_FAMILY_FIELDS,
  connector: CONNECTOR_FIELDS,
  contact: CONTACT_FIELDS,
  backshell: BACKSHELL_FIELDS,
  wire: WIRE_SPEC_FIELDS,
  tooling: TOOLING_FIELDS,
};

/**
 * Type-aware equality comparison to prevent superficial formatting differences (e.g. float representation
 * "1.50" vs 1.5, or date string variations) from triggering spurious revision logs and version bumps.
 */
export function areValuesEqual(valA: unknown, valB: unknown, type: FieldType): boolean {
  const aNull = valA === null || valA === undefined;
  const bNull = valB === null || valB === undefined;
  if (aNull && bNull) return true;
  if (aNull !== bNull) return false;

  if (type === 'number') {
    const numA = typeof valA === 'number' ? valA : Number(valA);
    const numB = typeof valB === 'number' ? valB : Number(valB);
    if (Number.isNaN(numA) && Number.isNaN(numB)) return true;
    if (Number.isNaN(numA) || Number.isNaN(numB)) return false;
    return Math.abs(numA - numB) < 1e-9;
  }

  if (type === 'boolean') {
    return Boolean(valA) === Boolean(valB);
  }

  if (type === 'date') {
    try {
      const dateA = new Date(valA as string).toISOString();
      const dateB = new Date(valB as string).toISOString();
      return dateA === dateB;
    } catch {
      return String(valA) === String(valB);
    }
  }

  return String(valA) === String(valB);
}

/**
 * Normalizes field values into stringified log representations while preserving null/unset distinction
 * so SQL NULL explicitly denotes unpopulated/unset fields rather than string literal "null" or "undefined".
 */
export function stringifyValue(val: unknown, type?: FieldType): string | null {
  if (val === null || val === undefined) {
    return null;
  }
  if (type === 'boolean' || typeof val === 'boolean') {
    return val ? 'true' : 'false';
  }
  if (type === 'number' || typeof val === 'number') {
    return String(val);
  }
  if (type === 'date') {
    try {
      return new Date(val as string).toISOString();
    } catch {
      return String(val);
    }
  }
  return String(val);
}

/**
 * Converts stringified audit log values back into strongly typed domain primitives (numbers, booleans, dates)
 * so reconstructed historical snapshots faithfully match the master table runtime schemas.
 */
export function parseValue(val: string | null, type: FieldType): unknown {
  if (val === null) {
    return null;
  }
  if (type === 'number') {
    const num = Number(val);
    return Number.isNaN(num) ? null : num;
  }
  if (type === 'boolean') {
    return val === 'true' || val === '1';
  }
  if (type === 'date') {
    try {
      return new Date(val).toISOString();
    } catch {
      return val;
    }
  }
  return val;
}

export interface DiffEntry {
  field_name: string;
  old_value: string | null;
  new_value: string | null;
}

export function computeDiffs<T extends object>(
  existing: T,
  candidate: T,
  fieldSpecs: FieldSpec[],
): DiffEntry[] {
  const diffs: DiffEntry[] = [];
  for (const field of fieldSpecs) {
    const oldVal = (existing as Record<string, unknown>)[field.name];
    const newVal = (candidate as Record<string, unknown>)[field.name];
    if (!areValuesEqual(oldVal, newVal, field.type)) {
      diffs.push({
        field_name: field.name,
        old_value: stringifyValue(oldVal, field.type),
        new_value: stringifyValue(newVal, field.type),
      });
    }
  }
  return diffs;
}

/**
 * Computes __deleted__ audit entries capturing the final non-null field values of a deleted record.
 * Null and undefined fields are omitted intentionally because unpopulated fields carry no historical state prior to deletion.
 */
export function computeDeleteLogs<T extends object>(
  existing: T,
  fieldSpecs: FieldSpec[],
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  for (const field of fieldSpecs) {
    const val = (existing as Record<string, unknown>)[field.name];
    if (val !== null && val !== undefined) {
      entries.push({
        field_name: '__deleted__',
        old_value: stringifyValue(val, field.type),
        new_value: null,
      });
    }
  }
  return entries;
}

export function getFieldSpec(partType: PartType, fieldName: string): FieldSpec | undefined {
  const specs = FIELD_SPECS_BY_PART_TYPE[partType];
  return specs?.find(s => s.name === fieldName);
}

/**
 * Reconstructs a historical part state by stepping backward from the current master record through
 * reverse revision diffs, ensuring exact point-in-time fidelity without duplicating full rows on every edit.
 */
export function replayPartRevisions<T extends { version: number }>(
  currentPart: T,
  partType: PartType,
  logs: PartRevisionLogEntry[],
  targetVersion: number,
): T {
  if (targetVersion < 1) {
    throw new Error(`Target version ${targetVersion} must be at least 1`);
  }
  if (targetVersion > currentPart.version) {
    throw new Error(
      `Target version ${targetVersion} cannot be greater than current part version ${currentPart.version}`,
    );
  }
  if (targetVersion === currentPart.version) {
    return { ...currentPart };
  }

  const partNumber =
    (currentPart as Record<string, unknown>).part_number ??
    (currentPart as Record<string, unknown>).series_name;

  if (typeof partNumber !== 'string') {
    throw new Error(`Cannot replay revisions: part is missing part_number or series_name`);
  }

  // Filter logs strictly for this part and part type that occurred within the target version window (targetVersion, currentPart.version]
  // to ensure logs from unrelated components or outside the rollback interval do not corrupt the snapshot.
  const relevantLogs = logs.filter(
    log =>
      log.part_type === partType &&
      log.part_number === partNumber &&
      log.version > targetVersion &&
      log.version <= currentPart.version,
  );

  // Ensure the revision sequence is unbroken; missing intermediate versions mean we cannot reliably reconstruct target state.
  const versionsPresent = new Set(relevantLogs.map(l => l.version));
  for (let v = targetVersion + 1; v <= currentPart.version; v++) {
    if (!versionsPresent.has(v)) {
      throw new Error(
        `Incomplete revision log history for ${partType} "${partNumber}": missing logs for version ${v}`,
      );
    }
  }

  // Apply diffs in reverse chronological order (highest version down to targetVersion + 1) so mutations
  // are progressively rolled back step by step to the target version's state.
  relevantLogs.sort((a, b) => {
    if (b.version !== a.version) {
      return b.version - a.version;
    }
    return b.id - a.id;
  });

  const reconstructed = { ...currentPart } as Record<string, unknown>;

  for (const log of relevantLogs) {
    if (
      log.field_name === '__deleted__' ||
      log.field_name === 'version' ||
      log.field_name === 'last_modified_date'
    ) {
      continue;
    }
    const spec = getFieldSpec(partType, log.field_name);
    const type: FieldType = spec ? spec.type : 'string';
    reconstructed[log.field_name] = parseValue(log.old_value ?? null, type);
  }

  reconstructed.version = targetVersion;
  return reconstructed as T;
}

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
  changedBy?: string | null,
): ConnectorFamily {
  const existing = getConnectorFamily(db, id);
  if (!existing) {
    throw new Error(`Connector family with id ${id} not found`);
  }

  const manufacturer = input.manufacturer !== undefined ? input.manufacturer : existing.manufacturer;
  const series_name = input.series_name !== undefined ? input.series_name : existing.series_name;
  const description = input.description !== undefined ? input.description : existing.description;
  const sealed = input.sealed !== undefined ? Boolean(input.sealed) : existing.sealed;
  const shape = input.shape !== undefined ? input.shape : existing.shape;
  const datasheet_url = input.datasheet_url !== undefined ? input.datasheet_url : existing.datasheet_url;

  const candidate: ConnectorFamily = {
    id,
    manufacturer,
    series_name,
    description,
    sealed,
    shape,
    datasheet_url,
    version: existing.version,
    last_modified_date: existing.last_modified_date,
  };

  const diffs = computeDiffs(existing, candidate, CONNECTOR_FAMILY_FIELDS);
  if (diffs.length === 0) {
    return existing;
  }

  const newVersion = existing.version + 1;
  const lastModified = validateAndFormatDate(input.last_modified_date, 'last_modified_date');
  const user = input.changed_by !== undefined ? input.changed_by : (changedBy ?? null);

  const updateTxn = db.transaction(() => {
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
      sealed ? 1 : 0,
      shape,
      datasheet_url,
      newVersion,
      lastModified,
      id,
    );

    const logStmt = db.prepare(`
      INSERT INTO part_revision_log (
        part_number, part_type, version, field_name, old_value, new_value, changed_date, changed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const diff of diffs) {
      logStmt.run(
        series_name,
        'connector_family',
        newVersion,
        diff.field_name,
        diff.old_value,
        diff.new_value,
        lastModified,
        user,
      );
    }
  });

  updateTxn();

  return {
    id,
    manufacturer,
    series_name,
    description,
    sealed,
    shape,
    datasheet_url,
    version: newVersion,
    last_modified_date: lastModified,
  };
}

export function deleteConnectorFamily(
  db: Database.Database,
  id: number,
  changedBy?: string | null,
): boolean {
  const existing = getConnectorFamily(db, id);
  if (!existing) {
    return false;
  }

  const deletedLogs = computeDeleteLogs(existing, CONNECTOR_FAMILY_FIELDS);
  const deletedVersion = existing.version + 1;
  const changedDate = new Date().toISOString();
  const user = changedBy ?? null;

  const deleteTxn = db.transaction(() => {
    const logStmt = db.prepare(`
      INSERT INTO part_revision_log (
        part_number, part_type, version, field_name, old_value, new_value, changed_date, changed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const log of deletedLogs) {
      logStmt.run(
        existing.series_name,
        'connector_family',
        deletedVersion,
        log.field_name,
        log.old_value,
        log.new_value,
        changedDate,
        user,
      );
    }

    db.prepare('DELETE FROM connector_families WHERE id = ?').run(id);
  });

  deleteTxn();
  return true;
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
  changedBy?: string | null,
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
  const part_number = input.part_number !== undefined ? input.part_number : existing.part_number;
  const manufacturer_part_number =
    input.manufacturer_part_number !== undefined
      ? input.manufacturer_part_number
      : existing.manufacturer_part_number;
  const cavity_count = input.cavity_count !== undefined ? input.cavity_count : existing.cavity_count;
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

  const candidate: ConnectorPart = {
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
    version: existing.version,
    last_modified_date: existing.last_modified_date,
  };

  const diffs = computeDiffs(existing, candidate, CONNECTOR_FIELDS);
  if (diffs.length === 0) {
    return existing;
  }

  const newVersion = existing.version + 1;
  const lastModified = validateAndFormatDate(input.last_modified_date, 'last_modified_date');
  const user = input.changed_by !== undefined ? input.changed_by : (changedBy ?? null);

  const updateTxn = db.transaction(() => {
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
      newVersion,
      lastModified,
      id,
    );

    const logStmt = db.prepare(`
      INSERT INTO part_revision_log (
        part_number, part_type, version, field_name, old_value, new_value, changed_date, changed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const diff of diffs) {
      logStmt.run(
        part_number,
        'connector',
        newVersion,
        diff.field_name,
        diff.old_value,
        diff.new_value,
        lastModified,
        user,
      );
    }
  });

  updateTxn();

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
    version: newVersion,
    last_modified_date: lastModified,
  };
}

export function deleteConnector(
  db: Database.Database,
  idOrPartNumber: number | string,
  changedBy?: string | null,
): boolean {
  const existing =
    typeof idOrPartNumber === 'number'
      ? getConnector(db, idOrPartNumber)
      : getConnectorByPartNumber(db, idOrPartNumber);

  if (!existing) {
    return false;
  }

  const deletedLogs = computeDeleteLogs(existing, CONNECTOR_FIELDS);
  const deletedVersion = existing.version + 1;
  const changedDate = new Date().toISOString();
  const user = changedBy ?? null;

  const deleteTxn = db.transaction(() => {
    const logStmt = db.prepare(`
      INSERT INTO part_revision_log (
        part_number, part_type, version, field_name, old_value, new_value, changed_date, changed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const log of deletedLogs) {
      logStmt.run(
        existing.part_number,
        'connector',
        deletedVersion,
        log.field_name,
        log.old_value,
        log.new_value,
        changedDate,
        user,
      );
    }

    db.prepare('DELETE FROM connectors WHERE id = ?').run(existing.id);
  });

  deleteTxn();
  return true;
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
  changedBy?: string | null,
): ContactPart {
  const existing =
    typeof idOrPartNumber === 'number'
      ? getContact(db, idOrPartNumber)
      : getContactByPartNumber(db, idOrPartNumber);

  if (!existing) {
    throw new Error(`Contact "${idOrPartNumber}" not found`);
  }

  const id = existing.id;
  const part_number = input.part_number !== undefined ? input.part_number : existing.part_number;
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

  const candidate: ContactPart = {
    id,
    part_number,
    manufacturer_part_number,
    gauge_min_mm2,
    gauge_max_mm2,
    termination_type,
    gender,
    cavity_seal_part_id,
    version: existing.version,
    last_modified_date: existing.last_modified_date,
  };

  const diffs = computeDiffs(existing, candidate, CONTACT_FIELDS);
  if (diffs.length === 0) {
    return existing;
  }

  const newVersion = existing.version + 1;
  const lastModified = validateAndFormatDate(input.last_modified_date, 'last_modified_date');
  const user = input.changed_by !== undefined ? input.changed_by : (changedBy ?? null);

  const updateTxn = db.transaction(() => {
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
      newVersion,
      lastModified,
      id,
    );

    const logStmt = db.prepare(`
      INSERT INTO part_revision_log (
        part_number, part_type, version, field_name, old_value, new_value, changed_date, changed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const diff of diffs) {
      logStmt.run(
        part_number,
        'contact',
        newVersion,
        diff.field_name,
        diff.old_value,
        diff.new_value,
        lastModified,
        user,
      );
    }
  });

  updateTxn();

  return {
    id,
    part_number,
    manufacturer_part_number,
    gauge_min_mm2,
    gauge_max_mm2,
    termination_type,
    gender,
    cavity_seal_part_id,
    version: newVersion,
    last_modified_date: lastModified,
  };
}

export function deleteContact(
  db: Database.Database,
  idOrPartNumber: number | string,
  changedBy?: string | null,
): boolean {
  const existing =
    typeof idOrPartNumber === 'number'
      ? getContact(db, idOrPartNumber)
      : getContactByPartNumber(db, idOrPartNumber);

  if (!existing) {
    return false;
  }

  const deletedLogs = computeDeleteLogs(existing, CONTACT_FIELDS);
  const deletedVersion = existing.version + 1;
  const changedDate = new Date().toISOString();
  const user = changedBy ?? null;

  const deleteTxn = db.transaction(() => {
    const logStmt = db.prepare(`
      INSERT INTO part_revision_log (
        part_number, part_type, version, field_name, old_value, new_value, changed_date, changed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const log of deletedLogs) {
      logStmt.run(
        existing.part_number,
        'contact',
        deletedVersion,
        log.field_name,
        log.old_value,
        log.new_value,
        changedDate,
        user,
      );
    }

    db.prepare('DELETE FROM contacts WHERE id = ?').run(existing.id);
  });

  deleteTxn();
  return true;
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
  changedBy?: string | null,
): BackshellPart {
  const existing =
    typeof idOrPartNumber === 'number'
      ? getBackshell(db, idOrPartNumber)
      : getBackshellByPartNumber(db, idOrPartNumber);

  if (!existing) {
    throw new Error(`Backshell "${idOrPartNumber}" not found`);
  }

  const id = existing.id;
  const part_number = input.part_number !== undefined ? input.part_number : existing.part_number;
  const manufacturer_part_number =
    input.manufacturer_part_number !== undefined
      ? input.manufacturer_part_number
      : existing.manufacturer_part_number;
  const description = input.description !== undefined ? input.description : existing.description;

  const candidate: BackshellPart = {
    id,
    part_number,
    manufacturer_part_number,
    description,
    version: existing.version,
    last_modified_date: existing.last_modified_date,
  };

  const diffs = computeDiffs(existing, candidate, BACKSHELL_FIELDS);
  if (diffs.length === 0) {
    return existing;
  }

  const newVersion = existing.version + 1;
  const lastModified = validateAndFormatDate(input.last_modified_date, 'last_modified_date');
  const user = input.changed_by !== undefined ? input.changed_by : (changedBy ?? null);

  const updateTxn = db.transaction(() => {
    db.prepare(`
      UPDATE backshells SET
        part_number = ?,
        manufacturer_part_number = ?,
        description = ?,
        version = ?,
        last_modified_date = ?
      WHERE id = ?
    `).run(part_number, manufacturer_part_number, description, newVersion, lastModified, id);

    const logStmt = db.prepare(`
      INSERT INTO part_revision_log (
        part_number, part_type, version, field_name, old_value, new_value, changed_date, changed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const diff of diffs) {
      logStmt.run(
        part_number,
        'backshell',
        newVersion,
        diff.field_name,
        diff.old_value,
        diff.new_value,
        lastModified,
        user,
      );
    }
  });

  updateTxn();

  return {
    id,
    part_number,
    manufacturer_part_number,
    description,
    version: newVersion,
    last_modified_date: lastModified,
  };
}

export function deleteBackshell(
  db: Database.Database,
  idOrPartNumber: number | string,
  changedBy?: string | null,
): boolean {
  const existing =
    typeof idOrPartNumber === 'number'
      ? getBackshell(db, idOrPartNumber)
      : getBackshellByPartNumber(db, idOrPartNumber);

  if (!existing) {
    return false;
  }

  const deletedLogs = computeDeleteLogs(existing, BACKSHELL_FIELDS);
  const deletedVersion = existing.version + 1;
  const changedDate = new Date().toISOString();
  const user = changedBy ?? null;

  const deleteTxn = db.transaction(() => {
    const logStmt = db.prepare(`
      INSERT INTO part_revision_log (
        part_number, part_type, version, field_name, old_value, new_value, changed_date, changed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const log of deletedLogs) {
      logStmt.run(
        existing.part_number,
        'backshell',
        deletedVersion,
        log.field_name,
        log.old_value,
        log.new_value,
        changedDate,
        user,
      );
    }

    db.prepare('DELETE FROM backshells WHERE id = ?').run(existing.id);
  });

  deleteTxn();
  return true;
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
  changedBy?: string | null,
): WireSpecPart {
  const existing =
    typeof idOrPartNumber === 'number'
      ? getWireSpec(db, idOrPartNumber)
      : getWireSpecByPartNumber(db, idOrPartNumber);

  if (!existing) {
    throw new Error(`Wire spec "${idOrPartNumber}" not found`);
  }

  const id = existing.id;
  const part_number = input.part_number !== undefined ? input.part_number : existing.part_number;
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

  const candidate: WireSpecPart = {
    id,
    part_number,
    manufacturer_part_number,
    gauge_mm2,
    outer_diameter_um,
    spool_length_um,
    spool_length_display_unit,
    version: existing.version,
    last_modified_date: existing.last_modified_date,
  };

  const diffs = computeDiffs(existing, candidate, WIRE_SPEC_FIELDS);
  if (diffs.length === 0) {
    return existing;
  }

  const newVersion = existing.version + 1;
  const lastModified = validateAndFormatDate(input.last_modified_date, 'last_modified_date');
  const user = input.changed_by !== undefined ? input.changed_by : (changedBy ?? null);

  const updateTxn = db.transaction(() => {
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
      newVersion,
      lastModified,
      id,
    );

    const logStmt = db.prepare(`
      INSERT INTO part_revision_log (
        part_number, part_type, version, field_name, old_value, new_value, changed_date, changed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const diff of diffs) {
      logStmt.run(
        part_number,
        'wire',
        newVersion,
        diff.field_name,
        diff.old_value,
        diff.new_value,
        lastModified,
        user,
      );
    }
  });

  updateTxn();

  return {
    id,
    part_number,
    manufacturer_part_number,
    gauge_mm2,
    outer_diameter_um,
    spool_length_um,
    spool_length_display_unit,
    version: newVersion,
    last_modified_date: lastModified,
  };
}

export function deleteWireSpec(
  db: Database.Database,
  idOrPartNumber: number | string,
  changedBy?: string | null,
): boolean {
  const existing =
    typeof idOrPartNumber === 'number'
      ? getWireSpec(db, idOrPartNumber)
      : getWireSpecByPartNumber(db, idOrPartNumber);

  if (!existing) {
    return false;
  }

  const deletedLogs = computeDeleteLogs(existing, WIRE_SPEC_FIELDS);
  const deletedVersion = existing.version + 1;
  const changedDate = new Date().toISOString();
  const user = changedBy ?? null;

  const deleteTxn = db.transaction(() => {
    const logStmt = db.prepare(`
      INSERT INTO part_revision_log (
        part_number, part_type, version, field_name, old_value, new_value, changed_date, changed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const log of deletedLogs) {
      logStmt.run(
        existing.part_number,
        'wire',
        deletedVersion,
        log.field_name,
        log.old_value,
        log.new_value,
        changedDate,
        user,
      );
    }

    db.prepare('DELETE FROM wire_specs WHERE id = ?').run(existing.id);
  });

  deleteTxn();
  return true;
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
  changedBy?: string | null,
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

  const candidate: ToolingPart = {
    id,
    part_number,
    manufacturer_part_number,
    description,
    calibration_interval_days,
    last_calibration_date,
    version: existing.version,
    last_modified_date: existing.last_modified_date,
  };

  const diffs = computeDiffs(existing, candidate, TOOLING_FIELDS);
  if (diffs.length === 0) {
    return existing;
  }

  const newVersion = existing.version + 1;
  const lastModified = validateAndFormatDate(input.last_modified_date, 'last_modified_date');
  const user = input.changed_by !== undefined ? input.changed_by : (changedBy ?? null);

  const updateTxn = db.transaction(() => {
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
      newVersion,
      lastModified,
      id,
    );

    const logStmt = db.prepare(`
      INSERT INTO part_revision_log (
        part_number, part_type, version, field_name, old_value, new_value, changed_date, changed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const diff of diffs) {
      logStmt.run(
        part_number,
        'tooling',
        newVersion,
        diff.field_name,
        diff.old_value,
        diff.new_value,
        lastModified,
        user,
      );
    }
  });

  updateTxn();

  return {
    id,
    part_number,
    manufacturer_part_number,
    description,
    calibration_interval_days,
    last_calibration_date,
    version: newVersion,
    last_modified_date: lastModified,
  };
}

export function deleteTooling(
  db: Database.Database,
  idOrPartNumber: number | string,
  changedBy?: string | null,
): boolean {
  const existing =
    typeof idOrPartNumber === 'number'
      ? getTooling(db, idOrPartNumber)
      : getToolingByPartNumber(db, idOrPartNumber);

  if (!existing) {
    return false;
  }

  const deletedLogs = computeDeleteLogs(existing, TOOLING_FIELDS);
  const deletedVersion = existing.version + 1;
  const changedDate = new Date().toISOString();
  const user = changedBy ?? null;

  const deleteTxn = db.transaction(() => {
    const logStmt = db.prepare(`
      INSERT INTO part_revision_log (
        part_number, part_type, version, field_name, old_value, new_value, changed_date, changed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const log of deletedLogs) {
      logStmt.run(
        existing.part_number,
        'tooling',
        deletedVersion,
        log.field_name,
        log.old_value,
        log.new_value,
        changedDate,
        user,
      );
    }

    db.prepare('DELETE FROM tooling WHERE id = ?').run(existing.id);
  });

  deleteTxn();
  return true;
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

// ---------------------------------------------------------------------------
// 9. Suppliers (T18)
// ---------------------------------------------------------------------------

interface SupplierRow {
  id: number;
  name: string;
  contact_info: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    name: row.name,
    contact_info: row.contact_info,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createSupplier(
  db: Database.Database,
  input: SupplierInput,
): Supplier {
  if (!input.name || typeof input.name !== 'string' || input.name.trim() === '') {
    throw new Error('Supplier name is required');
  }
  const createdAt = validateAndFormatDate(input.created_at, 'created_at');
  const updatedAt = validateAndFormatDate(input.updated_at ?? input.created_at, 'updated_at');

  const stmt = db.prepare(`
    INSERT INTO suppliers (name, contact_info, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.name.trim(),
    input.contact_info ?? null,
    createdAt,
    updatedAt,
  );

  return {
    id: Number(result.lastInsertRowid),
    name: input.name.trim(),
    contact_info: input.contact_info ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function getSupplier(
  db: Database.Database,
  id: number,
): Supplier | null {
  const row = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as
    | SupplierRow
    | undefined;
  return row ? rowToSupplier(row) : null;
}

export function getSupplierByName(
  db: Database.Database,
  name: string,
): Supplier | null {
  const row = db.prepare('SELECT * FROM suppliers WHERE name = ?').get(name.trim()) as
    | SupplierRow
    | undefined;
  return row ? rowToSupplier(row) : null;
}

export function listSuppliers(db: Database.Database): Supplier[] {
  const rows = db.prepare('SELECT * FROM suppliers ORDER BY name ASC, id ASC').all() as SupplierRow[];
  return rows.map(rowToSupplier);
}

export function updateSupplier(
  db: Database.Database,
  id: number,
  input: Partial<SupplierInput>,
): Supplier {
  const existing = getSupplier(db, id);
  if (!existing) {
    throw new Error(`Supplier with id ${id} not found`);
  }

  const name = input.name !== undefined ? input.name.trim() : existing.name;
  if (!name) {
    throw new Error('Supplier name cannot be empty');
  }
  const contactInfo = input.contact_info !== undefined ? input.contact_info : existing.contact_info;
  const updatedAt = validateAndFormatDate(input.updated_at, 'updated_at');

  db.prepare(`
    UPDATE suppliers SET
      name = ?,
      contact_info = ?,
      updated_at = ?
    WHERE id = ?
  `).run(name, contactInfo, updatedAt, id);

  return {
    id,
    name,
    contact_info: contactInfo,
    created_at: existing.created_at,
    updated_at: updatedAt,
  };
}

export function deleteSupplier(db: Database.Database, id: number): boolean {
  const result = db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// 10. Part Sourcing & Price History (T18)
// ---------------------------------------------------------------------------

interface PartSourcingRow {
  part_number: string;
  part_type: string;
  supplier_id: number;
  supplier_part_number: string | null;
  unit_cost: number | null;
  currency: string | null;
  moq: number | null;
  lead_time_days: number | null;
  stock_status: string | null;
  distributor_url: string | null;
  preferred: number;
  last_checked_date: string | null;
  created_at: string;
  updated_at: string;
}

function rowToPartSourcing(row: PartSourcingRow): PartSourcing {
  return {
    part_number: row.part_number,
    part_type: row.part_type as PartType,
    supplier_id: row.supplier_id,
    supplier_part_number: row.supplier_part_number,
    unit_cost: row.unit_cost,
    currency: (row.currency as SourcingCurrency) || null,
    moq: row.moq,
    lead_time_days: row.lead_time_days,
    stock_status: row.stock_status,
    distributor_url: row.distributor_url,
    preferred: Boolean(row.preferred),
    last_checked_date: row.last_checked_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

interface PriceHistoryRow {
  id: number;
  part_number: string;
  part_type: string;
  supplier_id: number;
  unit_cost: number;
  currency: string;
  recorded_at: string;
}

function rowToPriceHistoryEntry(row: PriceHistoryRow): PriceHistoryEntry {
  return {
    id: row.id,
    part_number: row.part_number,
    part_type: row.part_type as PartType,
    supplier_id: row.supplier_id,
    unit_cost: row.unit_cost,
    currency: row.currency as SourcingCurrency,
    recorded_at: row.recorded_at,
  };
}

export function validatePartType(partType: PartType): void {
  if (!VALID_PART_TYPES.has(partType)) {
    throw new Error(`Invalid part_type: "${partType}". Must be one of: ${Array.from(VALID_PART_TYPES).join(', ')}`);
  }
}

export function validateCurrency(currency?: string | null): SourcingCurrency | null {
  if (currency === undefined || currency === null) {
    return null;
  }
  if (!VALID_SOURCING_CURRENCIES.has(currency as SourcingCurrency)) {
    throw new Error(`Invalid currency: "${currency}". Sourcing currency must be USD or CAD.`);
  }
  return currency as SourcingCurrency;
}

export function createPartSourcing(
  db: Database.Database,
  input: PartSourcingInput,
): PartSourcing {
  validatePartType(input.part_type);

  if (!input.part_number || typeof input.part_number !== 'string' || input.part_number.trim() === '') {
    throw new Error('part_number is required');
  }
  if (!input.supplier_id || typeof input.supplier_id !== 'number') {
    throw new Error('Valid supplier_id is required');
  }

  const currency = validateCurrency(input.currency);

  let unitCost: number | null = null;
  if (input.unit_cost !== undefined && input.unit_cost !== null) {
    if (typeof input.unit_cost !== 'number' || Number.isNaN(input.unit_cost)) {
      throw new Error('unit_cost must be a valid number');
    }
    if (!currency) {
      throw new Error('Currency (USD or CAD) is required when unit_cost is specified');
    }
    unitCost = input.unit_cost;
  }

  const createdAt = validateAndFormatDate(input.created_at, 'created_at');
  const updatedAt = validateAndFormatDate(input.updated_at ?? input.created_at, 'updated_at');
  const lastCheckedDate = input.last_checked_date
    ? validateAndFormatDate(input.last_checked_date, 'last_checked_date')
    : null;

  const moq = input.moq !== undefined ? input.moq : null;
  const leadTimeDays = input.lead_time_days !== undefined ? input.lead_time_days : null;
  const preferred = Boolean(input.preferred);

  const insertTxn = db.transaction(() => {
    // Setting preferred on this supplier clears it on all other suppliers for the same part atomically
    if (preferred) {
      db.prepare(`
        UPDATE part_sourcing
        SET preferred = 0, updated_at = ?
        WHERE part_number = ? AND part_type = ? AND supplier_id != ? AND preferred = 1
      `).run(updatedAt, input.part_number, input.part_type, input.supplier_id);
    }

    db.prepare(`
      INSERT INTO part_sourcing (
        part_number, part_type, supplier_id, supplier_part_number, unit_cost, currency,
        moq, lead_time_days, stock_status, distributor_url, preferred, last_checked_date,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.part_number,
      input.part_type,
      input.supplier_id,
      input.supplier_part_number ?? null,
      unitCost,
      currency,
      moq,
      leadTimeDays,
      input.stock_status ?? null,
      input.distributor_url ?? null,
      preferred ? 1 : 0,
      lastCheckedDate,
      createdAt,
      updatedAt,
    );

    // If unit_cost was recorded on create, write initial price_history row
    if (unitCost !== null && currency !== null) {
      db.prepare(`
        INSERT INTO price_history (
          part_number, part_type, supplier_id, unit_cost, currency, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        input.part_number,
        input.part_type,
        input.supplier_id,
        unitCost,
        currency,
        lastCheckedDate ?? createdAt,
      );
    }
  });

  insertTxn();

  return {
    part_number: input.part_number,
    part_type: input.part_type,
    supplier_id: input.supplier_id,
    supplier_part_number: input.supplier_part_number ?? null,
    unit_cost: unitCost,
    currency,
    moq,
    lead_time_days: leadTimeDays,
    stock_status: input.stock_status ?? null,
    distributor_url: input.distributor_url ?? null,
    preferred,
    last_checked_date: lastCheckedDate,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function getPartSourcing(
  db: Database.Database,
  partNumber: string,
  partType: PartType,
  supplierId: number,
): PartSourcing | null {
  const row = db.prepare(`
    SELECT * FROM part_sourcing
    WHERE part_number = ? AND part_type = ? AND supplier_id = ?
  `).get(partNumber, partType, supplierId) as PartSourcingRow | undefined;
  return row ? rowToPartSourcing(row) : null;
}

export function listPartSourcingForPart(
  db: Database.Database,
  partNumber: string,
  partType?: PartType,
): PartSourcing[] {
  let query = 'SELECT * FROM part_sourcing WHERE part_number = ?';
  const params: unknown[] = [partNumber];
  if (partType) {
    query += ' AND part_type = ?';
    params.push(partType);
  }
  query += ' ORDER BY preferred DESC, supplier_id ASC';
  const rows = db.prepare(query).all(...params) as PartSourcingRow[];
  return rows.map(rowToPartSourcing);
}

export function listPartSourcingForSupplier(
  db: Database.Database,
  supplierId: number,
): PartSourcing[] {
  const rows = db.prepare(`
    SELECT * FROM part_sourcing
    WHERE supplier_id = ?
    ORDER BY part_number ASC, part_type ASC
  `).all(supplierId) as PartSourcingRow[];
  return rows.map(rowToPartSourcing);
}

export function listAllPartSourcing(db: Database.Database): PartSourcing[] {
  const rows = db.prepare(`
    SELECT * FROM part_sourcing
    ORDER BY part_number ASC, part_type ASC, supplier_id ASC
  `).all() as PartSourcingRow[];
  return rows.map(rowToPartSourcing);
}

export function getPreferredSourcing(
  db: Database.Database,
  partNumber: string,
  partType?: PartType,
): PartSourcing | null {
  let query = 'SELECT * FROM part_sourcing WHERE part_number = ? AND preferred = 1';
  const params: unknown[] = [partNumber];
  if (partType) {
    query += ' AND part_type = ?';
    params.push(partType);
  }
  const row = db.prepare(query).get(...params) as PartSourcingRow | undefined;
  return row ? rowToPartSourcing(row) : null;
}

export function updatePartSourcing(
  db: Database.Database,
  partNumber: string,
  partType: PartType,
  supplierId: number,
  input: Partial<PartSourcingInput>,
): PartSourcing {
  validatePartType(partType);

  const existing = getPartSourcing(db, partNumber, partType, supplierId);
  if (!existing) {
    throw new Error(
      `Part sourcing for part_number "${partNumber}", part_type "${partType}", supplier_id ${supplierId} not found`,
    );
  }

  let currency = existing.currency;
  if (input.currency !== undefined) {
    currency = validateCurrency(input.currency);
  }

  let unitCost = existing.unit_cost;
  if (input.unit_cost !== undefined) {
    if (input.unit_cost !== null) {
      if (typeof input.unit_cost !== 'number' || Number.isNaN(input.unit_cost)) {
        throw new Error('unit_cost must be a valid number');
      }
      unitCost = input.unit_cost;
    } else {
      unitCost = null;
    }
  }

  if (unitCost !== null && unitCost !== undefined && !currency) {
    throw new Error('Currency (USD or CAD) is required when unit_cost is specified');
  }

  const supplierPartNumber =
    input.supplier_part_number !== undefined
      ? input.supplier_part_number
      : existing.supplier_part_number;

  const moq = input.moq !== undefined ? input.moq : existing.moq;
  const leadTimeDays =
    input.lead_time_days !== undefined ? input.lead_time_days : existing.lead_time_days;
  const stockStatus =
    input.stock_status !== undefined ? input.stock_status : existing.stock_status;
  const distributorUrl =
    input.distributor_url !== undefined ? input.distributor_url : existing.distributor_url;
  const preferred =
    input.preferred !== undefined ? Boolean(input.preferred) : existing.preferred;

  const updatedAt = validateAndFormatDate(input.updated_at, 'updated_at');
  const lastCheckedDate =
    input.last_checked_date !== undefined
      ? (input.last_checked_date
          ? validateAndFormatDate(input.last_checked_date, 'last_checked_date')
          : null)
      : existing.last_checked_date;

  // Determine if unit_cost has actually changed
  let priceChanged = false;
  if (unitCost !== null && unitCost !== undefined && currency !== null && currency !== undefined) {
    if (
      existing.unit_cost === null ||
      existing.unit_cost === undefined ||
      existing.currency === null ||
      existing.currency === undefined
    ) {
      priceChanged = true;
    } else if (
      Math.abs(existing.unit_cost - unitCost) > 1e-9 ||
      existing.currency !== currency
    ) {
      priceChanged = true;
    }
  }

  const updateTxn = db.transaction(() => {
    // If setting preferred = true, atomically clear preferred on all other suppliers for this part
    if (preferred && !existing.preferred) {
      db.prepare(`
        UPDATE part_sourcing
        SET preferred = 0, updated_at = ?
        WHERE part_number = ? AND part_type = ? AND supplier_id != ? AND preferred = 1
      `).run(updatedAt, partNumber, partType, supplierId);
    }

    db.prepare(`
      UPDATE part_sourcing SET
        supplier_part_number = ?,
        unit_cost = ?,
        currency = ?,
        moq = ?,
        lead_time_days = ?,
        stock_status = ?,
        distributor_url = ?,
        preferred = ?,
        last_checked_date = ?,
        updated_at = ?
      WHERE part_number = ? AND part_type = ? AND supplier_id = ?
    `).run(
      supplierPartNumber,
      unitCost,
      currency,
      moq,
      leadTimeDays,
      stockStatus,
      distributorUrl,
      preferred ? 1 : 0,
      lastCheckedDate,
      updatedAt,
      partNumber,
      partType,
      supplierId,
    );

    // If unit_cost changed, record a new row in price_history
    if (priceChanged && unitCost !== null && currency !== null) {
      const historyRecordedAt =
        input.last_checked_date !== undefined && lastCheckedDate !== null
          ? lastCheckedDate
          : updatedAt;

      db.prepare(`
        INSERT INTO price_history (
          part_number, part_type, supplier_id, unit_cost, currency, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        partNumber,
        partType,
        supplierId,
        unitCost,
        currency,
        historyRecordedAt,
      );
    }
  });

  updateTxn();

  return {
    part_number: partNumber,
    part_type: partType,
    supplier_id: supplierId,
    supplier_part_number: supplierPartNumber,
    unit_cost: unitCost,
    currency,
    moq,
    lead_time_days: leadTimeDays,
    stock_status: stockStatus,
    distributor_url: distributorUrl,
    preferred,
    last_checked_date: lastCheckedDate,
    created_at: existing.created_at,
    updated_at: updatedAt,
  };
}

export function setPreferredSupplier(
  db: Database.Database,
  partNumber: string,
  partType: PartType,
  supplierId: number,
): PartSourcing {
  return updatePartSourcing(db, partNumber, partType, supplierId, { preferred: true });
}

export function deletePartSourcing(
  db: Database.Database,
  partNumber: string,
  partType: PartType,
  supplierId: number,
): boolean {
  const result = db.prepare(`
    DELETE FROM part_sourcing
    WHERE part_number = ? AND part_type = ? AND supplier_id = ?
  `).run(partNumber, partType, supplierId);
  return result.changes > 0;
}

export function getPriceHistory(
  db: Database.Database,
  partNumber: string,
  partType?: PartType,
  supplierId?: number,
): PriceHistoryEntry[] {
  let query = 'SELECT * FROM price_history WHERE part_number = ?';
  const params: unknown[] = [partNumber];
  if (partType) {
    query += ' AND part_type = ?';
    params.push(partType);
  }
  if (supplierId !== undefined) {
    query += ' AND supplier_id = ?';
    params.push(supplierId);
  }
  query += ' ORDER BY recorded_at DESC, id DESC';
  const rows = db.prepare(query).all(...params) as PriceHistoryRow[];
  return rows.map(rowToPriceHistoryEntry);
}

export function listAllPriceHistory(db: Database.Database): PriceHistoryEntry[] {
  const rows = db.prepare('SELECT * FROM price_history ORDER BY recorded_at ASC, id ASC').all() as PriceHistoryRow[];
  return rows.map(rowToPriceHistoryEntry);
}
