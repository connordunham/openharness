/**
 * @openharness/io — load/save, format migrations, and every export/import
 * path (spec §9, §11).
 *
 * IMPLEMENTED:
 *   - vendor wire-format v0.8 JSON import (spec §11), tested against both real
 *     captured exports (see src/__tests__/fixtures/).
 *   - `.ohd` document (de)serialisation with stable, sorted keys (spec §10).
 *   - BOM CSV export (spec §9).
 *   - Diagnostics JSON/text formatting for `openharness validate` (spec §8.6).
 *
 * SCAFFOLDING / TODO: Schematic/Layout PDF, wiring-table XLSX, WireViz YAML
 * export, KiCad/CSV netlist import (Phase 6 for exports, per spec §12).
 */
export * from './vendorRawFormat.js';
export * from './importVendorJson.js';
export * from './ohdFormat.js';
export * from './bomCsv.js';
export * from './interconnectCsv.js';
export * from './diagnosticsFormat.js';
