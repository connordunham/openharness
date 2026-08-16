import type { HarnessStore, Point } from '@openharness/core';

/**
 * Rough grid placement for auto-placing a component in the Layout pane (mm
 * space; `layoutPosition` is interpreted as the component's CENTER point —
 * see LayoutCanvas.tsx's connector-glyph rendering).
 *
 * Shared by LayoutCanvas's own "+ Branch point" action AND SchematicCanvas's
 * "Add X" actions (Connor: "layout place should happen by default as
 * connectors are placed in schematic") so newly-added components land in
 * Layout automatically instead of requiring a separate manual placement
 * step. Living in its own module (rather than inside LayoutCanvas.tsx, where
 * it used to be) avoids Schematic having to import Layout's whole component
 * just to reuse this one placement helper.
 */
export function nextLayoutGrid(store: HarnessStore): Point {
  const placed = Object.values(store.doc.components).filter((c) => !!c.layoutPosition).length;
  return { x: 20 + (placed % 5) * 60, y: 20 + Math.floor(placed / 5) * 50 };
}
