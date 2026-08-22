/**
 * Draft-level mate operations for the Schematic canvas (T02 rendering /
 * interaction, review B5). Pure `(draft) => …` functions so the canvas
 * handlers and the unit tests share one implementation; every call site
 * still wraps them in `store.transact`, so one user-visible action stays one
 * undo step and automation keeps the same door as the GUI.
 */

import type { CavityId, HarnessDocument, Mate, MateCavityPair, MateId } from '@openharness/core';
import { newInstanceId } from '@openharness/core';

/**
 * Add a mate between two components, normalising direction for the
 * terminal-into-connector case: `Mate.targetCavityId` is defined as "the
 * connector end says which cavity receives the terminal", and both net
 * extraction and the mate rules only read the terminal-as-source spelling —
 * a connector→terminal mate would validate nothing and union nothing, so the
 * UI never writes one.
 *
 * `cavityId` is the cavity the user clicked while completing the mate (if
 * they completed it on a port rather than a box). It only means something
 * for terminal-into-connector mates and is dropped otherwise — writing it on
 * a connector-connector mate would be a field that the model says is
 * "ignored", and ignored data should never be authored.
 *
 * Returns the new mate's id, or null when the mate cannot exist (a missing
 * component, or a component mated to itself).
 */
export function addMateInDraft(
  draft: HarnessDocument,
  a: string,
  b: string,
  cavityId?: CavityId,
): MateId | null {
  if (a === b) return null;
  const ca = draft.components[a];
  const cb = draft.components[b];
  if (!ca || !cb) return null;

  let sourceId = a;
  let targetId = b;
  if (ca.type === 'connector' && cb.type === 'terminal') {
    // Flip so the terminal is the source — see doc comment.
    sourceId = b;
    targetId = a;
  }

  const source = draft.components[sourceId];
  const target = draft.components[targetId];
  if (!source || !target) return null;

  const id = newInstanceId();
  const mate: Mate = { id, sourceId, targetId, custom: {} };
  if (source.type === 'terminal' && target.type === 'connector' && cavityId) {
    mate.targetCavityId = cavityId;
  }
  // doc.mates is optional — "absent" means "no mates" (T02 trap), so create
  // it lazily on first mate rather than up front in createEmptyDocument.
  if (!draft.mates) draft.mates = {};
  draft.mates[id] = mate;
  return id;
}

/**
 * Delete a mate, collapsing an emptied `mates` record back to undefined —
 * absent must stay indistinguishable from empty, so a document whose last
 * mate was deleted serialises exactly as it did before the mate existed.
 */
export function deleteMateInDraft(draft: HarnessDocument, mateId: MateId): void {
  if (!draft.mates) return;
  delete draft.mates[mateId];
  collapseEmptyMates(draft);
}

/**
 * Drop every mate that references `componentId` — called when the component
 * is deleted. The derived model ignores mates naming vanished components
 * (that is the sanctioned degrade path), but leaving the entries in the
 * document would litter it with mates the UI can no longer draw, select, or
 * delete.
 */
export function removeMatesOfComponentInDraft(draft: HarnessDocument, componentId: string): void {
  if (!draft.mates) return;
  for (const [mateId, mate] of Object.entries(draft.mates)) {
    if (mate.sourceId === componentId || mate.targetId === componentId) {
      delete draft.mates[mateId];
    }
  }
  collapseEmptyMates(draft);
}

/** Set — or clear — the cavity a terminal mates into. Only meaningful for
 * terminal-into-connector mates (see Mate.targetCavityId). */
export function setMateTargetCavityInDraft(
  draft: HarnessDocument,
  mateId: MateId,
  cavityId: CavityId | undefined,
): void {
  const mate = draft.mates?.[mateId];
  if (!mate) return;
  mate.targetCavityId = cavityId;
}

/**
 * Add one explicit cavity pair to a mate's map (D3). The first pair creates
 * the map: an empty cavityMap is indistinguishable from positional (net
 * extraction requires `length > 0`), so the empty array is never stored.
 */
export function addMateCavityPairInDraft(
  draft: HarnessDocument,
  mateId: MateId,
  sourceCavityId: CavityId,
  targetCavityId: CavityId,
): void {
  const mate = draft.mates?.[mateId];
  if (!mate) return;
  if (!mate.cavityMap) mate.cavityMap = [];
  mate.cavityMap.push({ sourceCavityId, targetCavityId });
}

/** Edit one side of an existing cavity pair. */
export function updateMateCavityPairInDraft(
  draft: HarnessDocument,
  mateId: MateId,
  index: number,
  patch: Partial<MateCavityPair>,
): void {
  const pair = draft.mates?.[mateId]?.cavityMap?.[index];
  if (!pair) return;
  if (patch.sourceCavityId !== undefined) pair.sourceCavityId = patch.sourceCavityId;
  if (patch.targetCavityId !== undefined) pair.targetCavityId = patch.targetCavityId;
}

/** Remove one cavity pair; the last one collapses the map back to
 * positional, same one-spelling-per-meaning rule as addMateCavityPairInDraft. */
export function removeMateCavityPairInDraft(draft: HarnessDocument, mateId: MateId, index: number): void {
  const mate = draft.mates?.[mateId];
  if (!mate || !mate.cavityMap) return;
  mate.cavityMap.splice(index, 1);
  if (mate.cavityMap.length === 0) mate.cavityMap = undefined;
}

/** Discard the explicit map entirely and return the mate to positional
 * pairing (the default, per D3). */
export function clearMateCavityMapInDraft(draft: HarnessDocument, mateId: MateId): void {
  const mate = draft.mates?.[mateId];
  if (!mate) return;
  mate.cavityMap = undefined;
}

function collapseEmptyMates(draft: HarnessDocument): void {
  if (draft.mates && Object.keys(draft.mates).length === 0) delete draft.mates;
}
