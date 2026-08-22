/**
 * @openharness/render — pure scene builders for the Schematic and Layout
 * views (spec §5.1, §7.2, §7.3). No DOM dependency.
 *
 * IMPLEMENTED: computeSchematicScene (spec §7.2), wire routing (auto and
 * manual), and the twisted-pair / shield-termination overlay geometry.
 * TODO (Phase 2/3): computeLayoutScene, PDF-ready path/text output for the
 * eventual PDF exporter (spec §9).
 */
export * from './schematicScene.js';
export * from './routing.js';
export * from './overlays.js';
export * from './zoomGeometry.js';
export * from './sceneBounds.js';
