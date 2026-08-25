/**
 * Types for @openharness/parts — the master parts library store.
 *
 * Transcribed from DATA-LAYER-SPEC.md § Adopted schema and T16 task packet.
 *
 * Rules:
 * - Units are canonical in storage: mm² for gauge, integer µm for length/OD.
 * - Display units (ft/m/in/cm) record what was entered, not what is stored.
 * - Dates are ISO-8601 strings.
 * - Version starts at 1 on master records.
 * - part_number is unique and user-defined (internal canonical).
 * - manufacturer_part_number is nullable, non-unique.
 */

import type { Gauge } from '@openharness/core';

export type PartType =
  | 'connector'
  | 'contact'
  | 'wire'
  | 'tooling'
  | 'backshell'
  | 'connector_family';

export type SpoolLengthDisplayUnit = 'ft' | 'm' | 'in' | 'cm';

export type FieldType = 'string' | 'number' | 'boolean' | 'date';

export interface FieldSpec {
  name: string;
  type: FieldType;
}

// ---------------------------------------------------------------------------
// Connector Families
// ---------------------------------------------------------------------------

export interface ConnectorFamily {
  id: number;
  manufacturer: string;
  series_name: string;
  description?: string | null;
  sealed: boolean;
  shape?: string | null;
  datasheet_url?: string | null;
  version: number;
  last_modified_date: string; // ISO-8601
}

export interface ConnectorFamilyInput {
  manufacturer: string;
  series_name: string;
  description?: string | null;
  sealed?: boolean;
  shape?: string | null;
  datasheet_url?: string | null;
  version?: number;
  last_modified_date?: string;
  changed_by?: string | null;
}

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

export interface ConnectorPart {
  id: number;
  family_id?: number | null;
  part_number: string;
  manufacturer_part_number?: string | null;
  cavity_count: number;
  gender?: string | null;
  ratings?: string | null;
  gauge_min_mm2?: number | null;
  gauge_max_mm2?: number | null;
  keying?: string | null;
  mounting?: string | null;
  temp_min?: number | null;
  temp_max?: number | null;
  image_ref?: string | null;
  version: number;
  last_modified_date: string;
}

export interface ConnectorPartInput {
  family_id?: number | null;
  part_number: string;
  manufacturer_part_number?: string | null;
  cavity_count: number;
  gender?: string | null;
  ratings?: string | null;
  gauge_min_mm2?: number | null;
  gauge_max_mm2?: number | null;
  gauge_min?: Gauge;
  gauge_max?: Gauge;
  keying?: string | null;
  mounting?: string | null;
  temp_min?: number | null;
  temp_max?: number | null;
  image_ref?: string | null;
  version?: number;
  last_modified_date?: string;
  changed_by?: string | null;
}

// ---------------------------------------------------------------------------
// Cavities
// ---------------------------------------------------------------------------

export interface Cavity {
  id: number;
  connector_id: number;
  cavity_number: number;
  position_label?: string | null;
  max_wire_gauge_mm2?: number | null;
  contact_part_number?: string | null;
}

export interface CavityInput {
  connector_id: number;
  cavity_number: number;
  position_label?: string | null;
  max_wire_gauge_mm2?: number | null;
  max_wire_gauge?: Gauge;
  contact_part_number?: string | null;
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export interface ContactPart {
  id: number;
  part_number: string;
  manufacturer_part_number?: string | null;
  gauge_min_mm2?: number | null;
  gauge_max_mm2?: number | null;
  termination_type?: string | null;
  gender?: string | null;
  cavity_seal_part_id?: string | null;
  version: number;
  last_modified_date: string;
}

export interface ContactPartInput {
  part_number: string;
  manufacturer_part_number?: string | null;
  gauge_min_mm2?: number | null;
  gauge_max_mm2?: number | null;
  gauge_min?: Gauge;
  gauge_max?: Gauge;
  termination_type?: string | null;
  gender?: string | null;
  cavity_seal_part_id?: string | null;
  version?: number;
  last_modified_date?: string;
  changed_by?: string | null;
}

// ---------------------------------------------------------------------------
// Backshells & Compatibility
// ---------------------------------------------------------------------------

export interface BackshellPart {
  id: number;
  part_number: string;
  manufacturer_part_number?: string | null;
  description?: string | null;
  version: number;
  last_modified_date: string;
}

export interface BackshellPartInput {
  part_number: string;
  manufacturer_part_number?: string | null;
  description?: string | null;
  version?: number;
  last_modified_date?: string;
  changed_by?: string | null;
}

export interface BackshellCompatibility {
  backshell_id: number;
  connector_family_id: number;
}

// ---------------------------------------------------------------------------
// Wire Specs
// ---------------------------------------------------------------------------

export interface WireSpecPart {
  id: number;
  part_number: string;
  manufacturer_part_number?: string | null;
  gauge_mm2: number;
  outer_diameter_um?: number | null;
  spool_length_um?: number | null;
  spool_length_display_unit?: SpoolLengthDisplayUnit | null;
  version: number;
  last_modified_date: string;
}

export interface WireSpecPartInput {
  part_number: string;
  manufacturer_part_number?: string | null;
  gauge_mm2?: number;
  gauge?: Gauge;
  outer_diameter_um?: number | null;
  spool_length_um?: number | null;
  spool_length?: { value: number; unit: SpoolLengthDisplayUnit };
  spool_length_display_unit?: SpoolLengthDisplayUnit | null;
  version?: number;
  last_modified_date?: string;
  changed_by?: string | null;
}

// ---------------------------------------------------------------------------
// Tooling & Compatibility
// ---------------------------------------------------------------------------

export interface ToolingPart {
  id: number;
  part_number: string;
  manufacturer_part_number?: string | null;
  description?: string | null;
  calibration_interval_days?: number | null;
  last_calibration_date?: string | null; // ISO-8601
  version: number;
  last_modified_date: string;
}

export interface ToolingPartInput {
  part_number: string;
  manufacturer_part_number?: string | null;
  description?: string | null;
  calibration_interval_days?: number | null;
  last_calibration_date?: string | null;
  version?: number;
  last_modified_date?: string;
  changed_by?: string | null;
}

export interface ToolingCompatibility {
  tooling_id: number;
  connector_family_id: number;
}

// ---------------------------------------------------------------------------
// Part Revision Log
// ---------------------------------------------------------------------------

export interface PartRevisionLogEntry {
  id: number;
  part_number: string;
  part_type: PartType;
  version: number;
  field_name: string;
  old_value?: string | null;
  new_value?: string | null;
  changed_date: string; // ISO-8601
  changed_by?: string | null;
}

export interface PartRevisionLogInput {
  part_number: string;
  part_type: PartType;
  version: number;
  field_name: string;
  old_value?: string | null;
  new_value?: string | null;
  changed_date?: string;
  changed_by?: string | null;
}

// ---------------------------------------------------------------------------
// Sourcing & Procurement (T18)
// ---------------------------------------------------------------------------

export type SourcingCurrency = 'USD' | 'CAD';

export interface Supplier {
  id: number;
  name: string;
  contact_info?: string | null;
  created_at: string; // ISO-8601
  updated_at: string; // ISO-8601
}

export interface SupplierInput {
  name: string;
  contact_info?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PartSourcing {
  part_number: string;
  part_type: PartType;
  supplier_id: number;
  supplier_part_number?: string | null;
  unit_cost?: number | null;
  currency?: SourcingCurrency | null;
  moq?: number | null;
  lead_time_days?: number | null;
  stock_status?: string | null;
  distributor_url?: string | null;
  preferred: boolean;
  last_checked_date?: string | null; // ISO-8601
  created_at: string; // ISO-8601
  updated_at: string; // ISO-8601
}

export interface PartSourcingInput {
  part_number: string;
  part_type: PartType;
  supplier_id: number;
  supplier_part_number?: string | null;
  unit_cost?: number | null;
  currency?: SourcingCurrency | null;
  moq?: number | null;
  lead_time_days?: number | null;
  stock_status?: string | null;
  distributor_url?: string | null;
  preferred?: boolean;
  last_checked_date?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PriceHistoryEntry {
  id: number;
  part_number: string;
  part_type: PartType;
  supplier_id: number;
  unit_cost: number;
  currency: SourcingCurrency;
  recorded_at: string; // ISO-8601
}


