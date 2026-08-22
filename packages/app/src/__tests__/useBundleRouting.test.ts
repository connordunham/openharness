/**
 * Phase 2a — bundle drag + wire extraction logic (bundleRouting.ts, the pure
 * core of the useBundleRouting hook). The repo has no DOM test environment,
 * so the gesture math is tested directly and the document mutations are
 * tested against a real HarnessStore — including undo/redo, which falls out
 * of store.transact and must keep working for both gestures.
 */
import { describe, it, expect } from 'vitest';
import {
  createEmptyDocument, HarnessStore, computeRouteAvoidingBundle,
  type Connector, type Wire, type Bundle, type HarnessDocument,
} from '@openharness/core';
import {
  startBundleDrag, startWireExtract, updateBundleDrag, applyBundleWaypoints,
  extractWireFromBundle, BUNDLE_DRAG_THRESHOLD,
} from '../bundleRouting.js';

function connectorAt(id: string, refdes: string, x: number, y: number): Connector {
  return {
    id, type: 'connector', refdes,
    cavities: [{ id: 'a', designation: '1', custom: {} }],
    layoutPosition: { x, y },
    custom: {},
  } satisfies Connector;
}

function wireBetween(id: string, refdes: string, from: string, to: string): Wire {
  return {
    id, refdes, color: 'Red',
    source: { kind: 'cavity', componentId: from, cavityId: 'a' },
    target: { kind: 'cavity', componentId: to, cavityId: 'a' },
    custom: {},
  } satisfies Wire;
}

/** c1 ──direct── c2, plus a two-hop detour c1─leg1─mid─leg2─c2. The direct
 * bundle is 200 mm; the detour is longer, so an unforced wire routes direct. */
function routableDoc(): HarnessDocument {
  const d = createEmptyDocument('Test');
  d.components['c1'] = connectorAt('c1', 'C1', 0, 0);
  d.components['c2'] = connectorAt('c2', 'C2', 200, 0);
  d.components['mid'] = { id: 'mid', type: 'branchPoint', refdes: 'B1', layoutPosition: { x: 100, y: 100 }, custom: {} };
  d.wires['w1'] = wireBetween('w1', 'W1', 'c1', 'c2');
  d.bundles['direct'] = { id: 'direct', refdes: 'BND1', sourceId: 'c1', targetId: 'c2', custom: {} } satisfies Bundle;
  d.bundles['leg1'] = { id: 'leg1', refdes: 'BND2', sourceId: 'c1', targetId: 'mid', custom: {} } satisfies Bundle;
  d.bundles['leg2'] = { id: 'leg2', refdes: 'BND3', sourceId: 'mid', targetId: 'c2', custom: {} } satisfies Bundle;
  return d;
}

/** c1 ──only── c2: one bundle, no way around it. */
function singleBundleDoc(): HarnessDocument {
  const d = createEmptyDocument('Test');
  d.components['c1'] = connectorAt('c1', 'C1', 0, 0);
  d.components['c2'] = connectorAt('c2', 'C2', 100, 0);
  d.wires['w1'] = wireBetween('w1', 'W1', 'c1', 'c2');
  d.bundles['only'] = { id: 'only', refdes: 'BND1', sourceId: 'c1', targetId: 'c2', custom: {} } satisfies Bundle;
  return d;
}

describe('bundle drag state machine', () => {
  it('starts a bundle drag unmoved, holding the waypoints at press time', () => {
    const state = startBundleDrag('b1', 100, 100, [{ x: 10, y: 20 }]);
    expect(state).toMatchObject({ kind: 'bundle', bundleId: 'b1', moved: false });
    expect(state.waypointsStart).toEqual([{ x: 10, y: 20 }]);
  });

  it('travel under the drag threshold is still a click — nothing to commit', () => {
    const state = startBundleDrag('b1', 100, 100, [{ x: 10, y: 20 }]);
    const upd = updateBundleDrag(state, 100 + BUNDLE_DRAG_THRESHOLD - 1, 100, 1, 4);
    expect(upd.state.moved).toBe(false);
    expect(upd.waypoints).toBeUndefined();
  });

  it('travel past the threshold translates every waypoint by the same mm offset', () => {
    const state = startBundleDrag('b1', 100, 100, [{ x: 10, y: 20 }, { x: 30, y: 40 }]);
    // 16 canvas px at scale 1 → 16 screen px (> 3); at 4 px/mm that is 4 mm.
    const upd = updateBundleDrag(state, 116, 108, 1, 4);
    expect(upd.state.moved).toBe(true);
    expect(upd.waypoints).toEqual([{ x: 14, y: 22 }, { x: 34, y: 42 }]);
  });

  it('the threshold is a SCREEN-pixel budget at any zoom (review C9)', () => {
    // Pointer arguments are SCREEN client px (the hook feeds e.clientX/Y), so
    // the travel values below are screen px; at 25% zoom 2 screen px of jitter
    // is 8 canvas px internally — must stay a click…
    const at25 = startBundleDrag('b1', 0, 0, []);
    expect(updateBundleDrag(at25, 2, 0, 0.25, 4).state.moved).toBe(false);
    // …while 4 screen px (16 canvas px) is a real drag.
    expect(updateBundleDrag(at25, 4, 0, 0.25, 4).state.moved).toBe(true);
  });

  it('a wire-extraction drag tracks the threshold but never produces waypoints', () => {
    const state = startWireExtract('w1', 'b1', 0, 0);
    const still = updateBundleDrag(state, 1, 0, 1, 4);
    expect(still.state.moved).toBe(false);
    expect(still.waypoints).toBeUndefined();
    const gone = updateBundleDrag(state, 50, 20, 1, 4);
    expect(gone.state.moved).toBe(true);
    expect(gone.waypoints).toBeUndefined();
  });

  it('applyBundleWaypoints replaces the whole waypoint list, undoably', () => {
    const store = new HarnessStore(routableDoc());
    store.transact('seed', (draft) => { draft.bundles['direct']!.waypoints = [{ x: 1, y: 1 }]; });
    store.transact('move', (draft) => {
      applyBundleWaypoints(draft, 'direct', [{ x: 5, y: 6 }, { x: 7, y: 8 }]);
    });
    expect(store.doc.bundles['direct']!.waypoints).toEqual([{ x: 5, y: 6 }, { x: 7, y: 8 }]);
    // One bundle move is one undo step that restores the pre-drag shape.
    store.undo();
    expect(store.doc.bundles['direct']!.waypoints).toEqual([{ x: 1, y: 1 }]);
    store.redo();
    expect(store.doc.bundles['direct']!.waypoints).toEqual([{ x: 5, y: 6 }, { x: 7, y: 8 }]);
  });
});

describe('wire extraction', () => {
  it('extracts a wire by freezing a route that avoids the bundle', () => {
    const store = new HarnessStore(routableDoc());
    expect(store.derived.bundleContents.get('direct')).toContain('w1');

    const done = extractWireFromBundle(store, 'w1', 'direct');
    expect(done).toBe(true);
    expect(store.doc.wires['w1']!.route).toEqual(['leg1', 'leg2']);
    // The derived model follows: w1 is gone from the bundle it left and
    // present on the detour.
    expect(store.derived.bundleContents.get('direct') ?? []).not.toContain('w1');
    expect(store.derived.bundleContents.get('leg1')).toContain('w1');
    expect(store.derived.bundleContents.get('leg2')).toContain('w1');
  });

  it('is one undoable transaction', () => {
    const store = new HarnessStore(routableDoc());
    extractWireFromBundle(store, 'w1', 'direct');
    store.undo();
    expect(store.doc.wires['w1']!.route).toBeUndefined();
    expect(store.derived.bundleContents.get('direct')).toContain('w1');
    store.redo();
    expect(store.doc.wires['w1']!.route).toEqual(['leg1', 'leg2']);
  });

  it('refuses when the bundle is the wire\'s only way across — document untouched', () => {
    const store = new HarnessStore(singleBundleDoc());
    const before = store.doc;
    expect(extractWireFromBundle(store, 'w1', 'only')).toBe(false);
    expect(store.doc.wires['w1']!.route).toBeUndefined();
    // No transaction was committed — the document object is identical.
    expect(store.doc).toBe(before);
  });

  it('refuses for a wire that does not route through the bundle', () => {
    const store = new HarnessStore(routableDoc());
    expect(extractWireFromBundle(store, 'w1', 'leg1')).toBe(false);
    expect(store.doc.wires['w1']!.route).toBeUndefined();
  });

  it('refuses for an unknown wire', () => {
    const store = new HarnessStore(routableDoc());
    expect(extractWireFromBundle(store, 'ghost', 'direct')).toBe(false);
  });
});

describe('extraction feasibility preview', () => {
  it('computeRouteAvoidingBundle answers "can this wire leave" without mutating', () => {
    const d = routableDoc();
    expect(computeRouteAvoidingBundle(d, 'w1', 'direct')).toEqual(['leg1', 'leg2']);
    expect(computeRouteAvoidingBundle(d, 'w1', 'leg1')).toEqual(['direct']);
    // leg1 alone is not on w1's route, but the oracle still answers the
    // topological question.
    expect(computeRouteAvoidingBundle(singleBundleDoc(), 'w1', 'only')).toBeUndefined();
  });
});
