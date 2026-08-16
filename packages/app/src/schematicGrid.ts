import type { HarnessDocument, HarnessStore, Component, Point } from '@openharness/core';

/**
 * Rough grid placement for auto-placing a component on the Schematic canvas,
 * plus refdes numbering — pulled out of SchematicCanvas.tsx (which used to
 * define these as private, `store`-only helpers next to its "Add X" toolbar
 * actions) into their own module for the same reason `layoutGrid.ts` already
 * exists: something outside SchematicCanvas needs them too. Here that's
 * `interconnectEdit.ts` (Connor: "if the table exists, then the schematic
 * should automatically be generated") — importing a row that names a
 * connector/cavity nobody has drawn yet has to invent a refdes and a
 * schematic position for it exactly the same way clicking "+ Connector"
 * would, without pulling in the whole 2700-line canvas component.
 *
 * Two flavors of each helper: the `store`-based ones read committed state
 * (used before a transact starts, same as the original "Add X" actions
 * always have), and the `FromDraft` ones read a draft `HarnessDocument`
 * mid-transaction — needed when a single transact creates several new
 * components in a row (e.g. importing a whole interconnect CSV), where
 * calling the `store` version repeatedly would return the same stale
 * position/refdes for every one of them.
 */

export function nextRefdes(store: HarnessStore, prefix: string, type: Component['type']): string {
  return nextRefdesFromDraft(store.doc, prefix, type);
}

export function nextRefdesFromDraft(draft: HarnessDocument, prefix: string, type: Component['type']): string {
  const count = Object.values(draft.components).filter((c) => c.type === type).length;
  return `${prefix}${count + 1}`;
}

export function nextGridPosition(store: HarnessStore): Point {
  return nextGridPositionFromDraft(store.doc);
}

export function nextGridPositionFromDraft(draft: HarnessDocument): Point {
  const placed =
    Object.values(draft.components).filter((c) => !!c.schematicPosition).length +
    Object.keys(draft.notes).length;
  return { x: 60 + (placed % 4) * 230, y: 70 + Math.floor(placed / 4) * 180 };
}
