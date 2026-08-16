import type { HarnessStore, HarnessDocument, Point } from '@openharness/core';
import { newInstanceId } from '@openharness/core';

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
  return nextLayoutGridFromDraft(store.doc);
}

/** Same grid formula as `nextLayoutGrid`, but reading an in-flight `draft`
 * instead of `store.doc` — needed whenever a single transact places more
 * than one component (`nextLayoutGrid(store)` would read the same stale
 * `store.doc` twice and hand back the same slot for both). Originally lived
 * only inside SchematicCanvas.tsx's own wire-drawing handler; pulled out
 * here for the same reason `nextLayoutGrid` itself already was — something
 * else (interconnectEdit.ts, importing/creating connections from an
 * interconnect table row) needs it too. */
export function nextLayoutGridFromDraft(draft: HarnessDocument): Point {
  const placed = Object.values(draft.components).filter((c) => !!c.layoutPosition).length;
  return { x: 20 + (placed % 5) * 60, y: 20 + Math.floor(placed / 5) * 50 };
}

/** Connor: "all routing in schematic should appear automatically in the
 * layout as well" — the same "automatic" philosophy as auto-placement
 * (nextLayoutGrid) and auto-orientation (LayoutCanvas's nodeAngles),
 * extended from "the component exists in Layout" to "the physical route
 * between two connected components exists in Layout too." Called right
 * after a wire is drawn between two components in Schematic (and, per
 * Connor's later follow-up, right after an interconnect-table row creates a
 * wire the same way — see interconnectEdit.ts): makes sure both ends are
 * placed (defensive — they're normally already placed by the "Add X"
 * actions' own auto-placement, but an imported or programmatically created
 * component might not be), then makes sure a Bundle directly connects them,
 * unless one already does (in either direction). Doesn't touch branch
 * points — those are pure layout topology the user places and wires up
 * deliberately (spec §4.2), not something to auto-route through. */
export function autoRouteInLayout(draft: HarnessDocument, componentIdA: string, componentIdB: string): void {
  if (componentIdA === componentIdB) return;
  const a = draft.components[componentIdA];
  const b = draft.components[componentIdB];
  if (!a || !b || a.type === 'branchPoint' || b.type === 'branchPoint') return;
  if (!a.layoutPosition) a.layoutPosition = nextLayoutGridFromDraft(draft);
  if (!b.layoutPosition) b.layoutPosition = nextLayoutGridFromDraft(draft);
  const alreadyRouted = Object.values(draft.bundles).some(
    (bd) => (bd.sourceId === componentIdA && bd.targetId === componentIdB) || (bd.sourceId === componentIdB && bd.targetId === componentIdA),
  );
  if (!alreadyRouted) {
    const id = newInstanceId();
    const n = Object.keys(draft.bundles).length;
    draft.bundles[id] = { id, refdes: `BND${n + 1}`, sourceId: componentIdA, targetId: componentIdB, custom: {} };
  }
}
