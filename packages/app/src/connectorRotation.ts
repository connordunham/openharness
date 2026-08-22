/**
 * Connector orientation logic (Phase 2b, docs/PHASE2-REFINED-DESIGN.md §3):
 * the pure core behind the useConnectorRotation hook — same split as
 * bundleRouting.ts / useBundleRouting.ts, so the document mutations and the
 * R-key decision are testable without a DOM and the hook stays a thin React
 * wrapper.
 *
 * Rotation is stored on the existing Component.rotation field as an offset in
 * 90° steps applied ON TOP of the Layout glyph's auto-orientation (see
 * render/layoutOrientation.ts). Unset reads as 0, and a full circle collapses
 * back to unset — the "optional means not-stated, never a literal zero"
 * convention, so an unrotated document serialises exactly as it did before
 * Phase 2b.
 */

import type { ComponentId, HarnessDocument, HarnessStore } from '@openharness/core';
import {
  findOptimalRotation,
  normalizeRotationDegrees,
} from '@openharness/render';

/** Layout-canvas defaults — the same scale, endpoint exclusion and branch
 * radius LayoutCanvas feeds its own crossing detection, so auto-optimize
 * applies the same definition of a crossing as the canvas's conflict
 * indicator. Scoring still approximates inline pass-throughs (see
 * countWireCrossings in render/connectorOptimization.ts), so "same
 * parameters" is not "pixel-identical". Callers with their own scale
 * (tests, automation) pass their own. */
export const ROTATION_DEFAULT_PX_PER_MM = 4;
export const ROTATION_DEFAULT_ENDPOINT_EXCLUSION_PX = 14;
export const ROTATION_DEFAULT_BRANCH_R_PX = 7;

/** The connector's stored rotation, normalised to [0, 360); unset reads as 0. */
export function connectorRotationOf(doc: HarnessDocument, connectorId: ComponentId): number {
  return normalizeRotationDegrees(doc.components[connectorId]?.rotation ?? 0);
}

/** Write a connector's stored rotation, collapsing 0 back to unset. */
function applyRotation(draft: HarnessDocument, connectorId: ComponentId, rotation: number): void {
  const c = draft.components[connectorId];
  if (!c) return;
  if (rotation === 0) delete c.rotation;
  else c.rotation = rotation;
}

/**
 * Rotate a connector one 90° step (clockwise by default) in one undoable
 * transaction. Returns the new stored rotation, or undefined when the
 * component is missing or not a connector (rotation is a connector feature —
 * the design brief's "select a connector, press R").
 *
 * The transaction label names the RESULTING angle deliberately: it makes
 * Ctrl+Z read sensibly ("Undo Rotate connector to 90°") and keeps two quick
 * presses from coalescing into one undo step — the store coalesces
 * same-label transactions on the same target within its window, which is
 * right for drags and wrong for discrete key presses.
 */
export function rotateConnector(
  store: HarnessStore,
  doc: HarnessDocument,
  connectorId: ComponentId,
  clockwise = true,
): number | undefined {
  const c = doc.components[connectorId];
  if (!c || c.type !== 'connector') return undefined;
  const next = normalizeRotationDegrees((c.rotation ?? 0) + (clockwise ? 90 : -90));
  store.transact(`Rotate connector to ${next}°`, (draft) => {
    applyRotation(draft, connectorId, next);
  });
  return next;
}

/**
 * Auto-optimize a connector's stored rotation: try all four rotations, keep
 * the one with the fewest bundle crossings (see render's
 * findOptimalRotation, including its keep-the-current tie-break). One
 * undoable transaction. Already optimal commits NOTHING — transact always
 * touches meta.modifiedAt, so an unskipped no-op would still land on the
 * undo stack as a fake rotation step. Returns the stored rotation applied,
 * or undefined when the component is missing or not a connector.
 */
export function autoOptimizeConnector(
  store: HarnessStore,
  doc: HarnessDocument,
  connectorId: ComponentId,
  pxPerMm = ROTATION_DEFAULT_PX_PER_MM,
  endpointExclusionPx = ROTATION_DEFAULT_ENDPOINT_EXCLUSION_PX,
  branchRadiusPx = ROTATION_DEFAULT_BRANCH_R_PX,
): number | undefined {
  const c = doc.components[connectorId];
  if (!c || c.type !== 'connector') return undefined;
  const optimal = findOptimalRotation(c, doc, pxPerMm, endpointExclusionPx, branchRadiusPx);
  if (optimal === connectorRotationOf(doc, connectorId)) return optimal;
  store.transact(`Rotate connector to ${optimal}° (auto-optimize)`, (draft) => {
    applyRotation(draft, connectorId, optimal);
  });
  return optimal;
}

/** What the R key means for the Layout canvas, decided without a DOM: plain
 * R rotates, Shift+R auto-optimizes, everything else (other keys, modified
 * R, typing in a form field, a non-connector selection) is null. */
export function rotationActionForKey(
  e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  selected: { kind: 'component' | 'bundle'; id: string } | null,
  doc: HarnessDocument,
  targetIsFormField: boolean,
): 'rotate' | 'optimize' | null {
  if (e.key !== 'r' && e.key !== 'R') return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (targetIsFormField) return null;
  if (!selected || selected.kind !== 'component') return null;
  const c = doc.components[selected.id];
  if (!c || c.type !== 'connector') return null;
  return e.shiftKey ? 'optimize' : 'rotate';
}
