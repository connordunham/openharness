/**
 * @openharness/io — load/save, format migrations, and every export/import
 * path (spec §9, §11).
 *
 * IMPLEMENTED: vendor wire-format v0.8 JSON import (spec §11), tested against
 * both real captured exports (see src/__tests__/fixtures/).
 *
 * SCAFFOLDING / TODO: Schematic/Layout PDF, wiring-table XLSX, BOM CSV,
 * WireViz YAML export, KiCad/CSV netlist import, `.ohd` load/save (Phase 1
 * for import + validate CLI path, Phase 6 for exports per spec §12).
 */
export * from './vendorRawFormat.js';
export * from './importVendorJson.js';
