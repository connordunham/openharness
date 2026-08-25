/**
 * Cavity operations for connectors (T05 §3):
 * pure functions for moving, inserting, and deleting cavities in a connector.
 *
 * All operations go through store.transact so each action is a single undo step.
 * Cavity reordering moves the entire Cavity object (signal, direction, contact/seal
 * references, custom properties), not just designations. Deletions are guarded by
 * `cavityIsWired` so a wired cavity cannot be accidentally dropped.
 */

import type { Cavity, ComponentId, CavityId, Endpoint, HarnessDocument, HarnessStore } from '@openharness/core';
import { newInstanceId } from '@openharness/core';

/** True if any wire endpoint in the document connects to this cavity. */
export function cavityIsWired(doc: HarnessDocument, componentId: ComponentId, cavityId: CavityId): boolean {
  const touches = (ep: Endpoint) => ep.kind === 'cavity' && ep.componentId === componentId && ep.cavityId === cavityId;
  return Object.values(doc.wires).some((w) => touches(w.source) || touches(w.target));
}

/**
 * Move a cavity up or down within its connector.
 * Returns true if the cavity was moved, false if the operation was invalid (e.g. at boundary).
 */
export function moveCavity(
  store: HarnessStore,
  connectorId: ComponentId,
  cavityId: CavityId,
  direction: 'up' | 'down',
): boolean {
  const c = store.doc.components[connectorId];
  if (!c || c.type !== 'connector') return false;
  const idx = c.cavities.findIndex((cav) => cav.id === cavityId);
  if (idx < 0) return false;
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= c.cavities.length) return false;

  store.transact(`Move cavity ${direction}`, (draft) => {
    const conn = draft.components[connectorId];
    if (!conn || conn.type !== 'connector') return;
    const from = conn.cavities.findIndex((cav) => cav.id === cavityId);
    if (from < 0) return;
    const to = direction === 'up' ? from - 1 : from + 1;
    if (to < 0 || to >= conn.cavities.length) return;
    const temp = conn.cavities[from]!;
    conn.cavities[from] = conn.cavities[to]!;
    conn.cavities[to] = temp;
  });
  return true;
}

/**
 * Insert a new cavity immediately below the specified cavity.
 * Generates a unique designation without altering any existing cavity designations.
 */
export function insertCavityBelow(
  store: HarnessStore,
  connectorId: ComponentId,
  cavityId: CavityId,
): Cavity | undefined {
  const c = store.doc.components[connectorId];
  if (!c || c.type !== 'connector') return undefined;
  const idx = c.cavities.findIndex((cav) => cav.id === cavityId);
  if (idx < 0) return undefined;

  const existing = new Set(c.cavities.map((cav) => cav.designation));
  let num = c.cavities.length + 1;
  while (existing.has(String(num))) num++;
  const newCavity: Cavity = {
    id: newInstanceId(),
    designation: String(num),
    custom: {},
  };

  store.transact('Insert cavity', (draft) => {
    const conn = draft.components[connectorId];
    if (!conn || conn.type !== 'connector') return;
    const at = conn.cavities.findIndex((cav) => cav.id === cavityId);
    if (at < 0) return;
    conn.cavities.splice(at + 1, 0, newCavity);
  });
  return newCavity;
}

/**
 * Delete a cavity from a connector. Refuses deletion if any wire connects to it.
 * Returns true if deleted, false if refused or not found.
 */
export function deleteCavity(
  store: HarnessStore,
  connectorId: ComponentId,
  cavityId: CavityId,
): boolean {
  if (cavityIsWired(store.doc, connectorId, cavityId)) return false;
  const c = store.doc.components[connectorId];
  if (!c || c.type !== 'connector') return false;
  const idx = c.cavities.findIndex((cav) => cav.id === cavityId);
  if (idx < 0) return false;

  store.transact('Delete cavity', (draft) => {
    const conn = draft.components[connectorId];
    if (!conn || conn.type !== 'connector') return;
    const at = conn.cavities.findIndex((cav) => cav.id === cavityId);
    if (at >= 0) {
      conn.cavities.splice(at, 1);
    }
  });
  return true;
}
