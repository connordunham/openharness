/**
 * @openharness/render — pure scene builders for the Schematic and Layout
 * views (spec §5.1, §7.2, §7.3). No DOM dependency.
 *
 * IMPLEMENTED: computeSchematicScene (spec §7.2).
 * TODO (Phase 2/3): computeLayoutScene, PDF-ready path/text output for the
 * eventual PDF exporter (spec §9).
 */
export * from './schematicScene.js';
