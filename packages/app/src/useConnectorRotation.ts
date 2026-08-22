/**
 * React wiring around connectorRotation.ts for the Layout canvas (Phase 2b,
 * docs/PHASE2-REFINED-DESIGN.md §3). All document logic lives in
 * connectorRotation.ts — this hook only binds it to the current render's
 * doc/store so the canvas's R-key handler reads fresh state, same thin-wrapper
 * split as useBundleRouting.ts (Phase 2a).
 */

import { useCallback } from 'react';
import type { ComponentId, HarnessDocument, HarnessStore } from '@openharness/core';
import {
  autoOptimizeConnector,
  connectorRotationOf,
  rotateConnector,
  ROTATION_DEFAULT_BRANCH_R_PX,
  ROTATION_DEFAULT_ENDPOINT_EXCLUSION_PX,
  ROTATION_DEFAULT_PX_PER_MM,
} from './connectorRotation.js';

export interface ConnectorRotationControls {
  /** Rotate the connector 90° (clockwise by default). Returns the new
   * stored rotation, or undefined when the component is missing or not a
   * connector. */
  rotateConnector(connectorId: ComponentId, clockwise?: boolean): number | undefined;
  /** Try all four rotations, keep the one with the fewest bundle crossings.
   * Returns the stored rotation applied (which may equal the current one —
   * that case commits no transaction). */
  autoOptimizeConnector(connectorId: ComponentId): number | undefined;
  /** Current stored rotation, normalised to [0, 360); unset reads as 0. */
  getRotation(connectorId: ComponentId): number;
}

export function useConnectorRotation(
  doc: HarnessDocument,
  store: HarnessStore,
  pxPerMm = ROTATION_DEFAULT_PX_PER_MM,
  endpointExclusionPx = ROTATION_DEFAULT_ENDPOINT_EXCLUSION_PX,
  branchRadiusPx = ROTATION_DEFAULT_BRANCH_R_PX,
): ConnectorRotationControls {
  const rotate = useCallback(
    (connectorId: ComponentId, clockwise = true) => rotateConnector(store, doc, connectorId, clockwise),
    [store, doc],
  );
  const optimize = useCallback(
    (connectorId: ComponentId) => autoOptimizeConnector(store, doc, connectorId, pxPerMm, endpointExclusionPx, branchRadiusPx),
    [store, doc, pxPerMm, endpointExclusionPx, branchRadiusPx],
  );
  const getRotation = useCallback(
    (connectorId: ComponentId) => connectorRotationOf(doc, connectorId),
    [doc],
  );
  return { rotateConnector: rotate, autoOptimizeConnector: optimize, getRotation };
}
