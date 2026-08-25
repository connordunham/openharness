/**
 * Phase 2b — connector rotation (connectorRotation.ts, the pure core of the
 * useConnectorRotation hook). Same discipline as Phase 2a's
 * useBundleRouting.test.ts: the repo has no DOM test environment, so the
 * document mutations are tested against a real HarnessStore — including
 * undo/redo and the .ohd save/load round-trip, which fall out of
 * store.transact and the io serializers and must keep working.
 */
import { describe, it, expect } from 'vitest';
import {
  createEmptyDocument, HarnessStore,
  type Bundle, type Connector, type HarnessDocument, type Splice,
} from '@openharness/core';
import { serializeDocument, parseDocument } from '@openharness/io';
import { countWireCrossings } from '@openharness/render';
import {
  autoOptimizeConnector, connectorRotationOf, rotateConnector, rotationActionForKey,
  ROTATION_DEFAULT_BRANCH_R_PX, ROTATION_DEFAULT_ENDPOINT_EXCLUSION_PX, ROTATION_DEFAULT_PX_PER_MM,
} from '../connectorRotation.js';

function connectorAt(id: string, refdes: string, x: number, y: number, rotation?: number): Connector {
  return {
    id, type: 'connector', refdes,
    cavities: [{ id: 'a', designation: '1', custom: {} }],
    layoutPosition: { x, y },
    ...(rotation !== undefined ? { rotation } : {}),
    custom: {},
  } satisfies Connector;
}

function bundle(id: string, refdes: string, sourceId: string, targetId: string): Bundle {
  return { id, refdes, sourceId, targetId, custom: {} } satisfies Bundle;
}

function singleConnectorDoc(rotation?: number): HarnessDocument {
  const d = createEmptyDocument('Test');
  d.components['c1'] = connectorAt('c1', 'C1', 10, 10, rotation);
  return d;
}

/** Same geometry as render's connectorOptimization.test.ts: rotating c1 to
 * 180° costs one bundle crossing; 0° is optimal. Kept in this package so the
 * hook is tested end-to-end (store → optimizer → store) without reaching
 * into render's test fixtures. */
function crossingDoc(c1Rotation?: number): HarnessDocument {
  const d = createEmptyDocument('Test');
  d.components['c1'] = connectorAt('c1', 'C1', 100, 100, c1Rotation);
  d.components['c2'] = connectorAt('c2', 'C2', 200, 100);
  d.components['c3'] = connectorAt('c3', 'C3', 107.5, 0);
  d.components['c4'] = connectorAt('c4', 'C4', 107.5, 200);
  d.bundles['b1'] = bundle('b1', 'BND1', 'c1', 'c2');
  d.bundles['bx'] = bundle('bx', 'BND2', 'c3', 'c4');
  return d;
}

const OPTS = [ROTATION_DEFAULT_PX_PER_MM, ROTATION_DEFAULT_ENDPOINT_EXCLUSION_PX, ROTATION_DEFAULT_BRANCH_R_PX] as const;

describe('rotateConnector — 90° steps', () => {
  it('rotates 90°, 180°, 270°, then a full circle back to unset (0)', () => {
    const store = new HarnessStore(singleConnectorDoc());
    expect(rotateConnector(store, store.doc, 'c1')).toBe(90);
    expect(store.doc.components['c1']!.rotation).toBe(90);
    expect(rotateConnector(store, store.doc, 'c1')).toBe(180);
    expect(rotateConnector(store, store.doc, 'c1')).toBe(270);
    expect(rotateConnector(store, store.doc, 'c1')).toBe(0);
    // A full circle collapses back to unset — "optional means not stated,
    // never a literal zero", so the serialised document is untouched.
    expect(store.doc.components['c1']!.rotation).toBeUndefined();
    expect(connectorRotationOf(store.doc, 'c1')).toBe(0);
  });

  it('rotates counter-clockwise when asked', () => {
    const store = new HarnessStore(singleConnectorDoc());
    expect(rotateConnector(store, store.doc, 'c1', false)).toBe(270);
    expect(rotateConnector(store, store.doc, 'c1', false)).toBe(180);
  });

  it('rotates terminals as well', () => {
    const d = singleConnectorDoc();
    d.components['t1'] = { id: 't1', type: 'terminal', refdes: 'T1', terminalKind: 'ring', custom: {} };
    const store = new HarnessStore(d);
    expect(rotateConnector(store, store.doc, 't1')).toBe(90);
    expect(store.doc.components['t1']!.rotation).toBe(90);
  });

  it('refuses non-connectors/terminals and unknown ids — document untouched', () => {
    const d = singleConnectorDoc();
    d.components['s1'] = { id: 's1', type: 'splice', refdes: 'S1', layoutPosition: { x: 0, y: 0 }, custom: {} } satisfies Splice;
    const store = new HarnessStore(d);
    const before = store.doc;
    expect(rotateConnector(store, store.doc, 's1')).toBeUndefined();
    expect(rotateConnector(store, store.doc, 'ghost')).toBeUndefined();
    expect(store.doc).toBe(before); // no transaction committed
  });
});

describe('undo / redo', () => {
  it('one rotation is one undo step — quick presses do NOT coalesce', () => {
    const store = new HarnessStore(singleConnectorDoc());
    rotateConnector(store, store.doc, 'c1'); // → 90
    rotateConnector(store, store.doc, 'c1'); // → 180, milliseconds later
    // If the two presses coalesced into one undo entry this would jump
    // straight back to unset; the transaction labels (which name the
    // resulting angle) keep them apart.
    store.undo();
    expect(connectorRotationOf(store.doc, 'c1')).toBe(90);
    store.undo();
    expect(store.doc.components['c1']!.rotation).toBeUndefined();
    store.redo();
    expect(connectorRotationOf(store.doc, 'c1')).toBe(90);
    store.redo();
    expect(connectorRotationOf(store.doc, 'c1')).toBe(180);
  });

  it('auto-optimize is one undoable step restoring the previous rotation', () => {
    const store = new HarnessStore(crossingDoc(180));
    expect(autoOptimizeConnector(store, store.doc, 'c1', ...OPTS)).toBe(0);
    expect(store.doc.components['c1']!.rotation).toBeUndefined();
    store.undo();
    expect(store.doc.components['c1']!.rotation).toBe(180);
    store.redo();
    expect(store.doc.components['c1']!.rotation).toBeUndefined();
  });
});

describe('autoOptimizeConnector', () => {
  it('tries all four rotations and applies the one with fewest crossings', () => {
    const store = new HarnessStore(crossingDoc(180)); // starts at 1 crossing
    const c1 = store.doc.components['c1'] as Connector;
    expect(countWireCrossings(c1, 180, store.doc, ...OPTS)).toBe(1);
    expect(autoOptimizeConnector(store, store.doc, 'c1', ...OPTS)).toBe(0);
    const optimized = store.doc.components['c1'] as Connector;
    expect(countWireCrossings(optimized, 0, store.doc, ...OPTS)).toBe(0);
  });

  it('already optimal — commits nothing, document object identical', () => {
    const store = new HarnessStore(crossingDoc()); // rotation unset = optimal here
    const before = store.doc;
    expect(autoOptimizeConnector(store, store.doc, 'c1', ...OPTS)).toBe(0);
    expect(store.doc).toBe(before);
  });

  it('refuses non-connectors', () => {
    const store = new HarnessStore(singleConnectorDoc());
    expect(autoOptimizeConnector(store, store.doc, 'ghost', ...OPTS)).toBeUndefined();
  });
});

describe('getRotation (connectorRotationOf)', () => {
  it('reads unset as 0 and normalises stray values into [0, 360)', () => {
    expect(connectorRotationOf(singleConnectorDoc(), 'c1')).toBe(0);
    expect(connectorRotationOf(singleConnectorDoc(90), 'c1')).toBe(90);
    expect(connectorRotationOf(singleConnectorDoc(-90), 'c1')).toBe(270);
    expect(connectorRotationOf(singleConnectorDoc(450), 'c1')).toBe(90);
    expect(connectorRotationOf(singleConnectorDoc(), 'ghost')).toBe(0);
  });
});

describe('persistence', () => {
  it('rotation survives a .ohd save/load round-trip', () => {
    const store = new HarnessStore(singleConnectorDoc());
    rotateConnector(store, store.doc, 'c1');
    rotateConnector(store, store.doc, 'c1'); // 180
    const loaded = parseDocument(serializeDocument(store.doc));
    expect(loaded.components['c1']!.rotation).toBe(180);
    expect(connectorRotationOf(loaded, 'c1')).toBe(180);
  });

  it('an unrotated document serialises with no rotation field at all', () => {
    const store = new HarnessStore(singleConnectorDoc());
    rotateConnector(store, store.doc, 'c1'); // full circle back to 0…
    rotateConnector(store, store.doc, 'c1');
    rotateConnector(store, store.doc, 'c1');
    rotateConnector(store, store.doc, 'c1');
    expect(serializeDocument(store.doc)).not.toContain('"rotation"');
  });
});

describe('rotationActionForKey — the R-key decision', () => {
  const doc = singleConnectorDoc();
  const selectedConnector = { kind: 'component', id: 'c1' } as const;
  const plain = { key: 'r', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };

  it('plain R rotates, Shift+R optimizes', () => {
    expect(rotationActionForKey(plain, selectedConnector, doc, false)).toBe('rotate');
    expect(rotationActionForKey({ ...plain, key: 'R' }, selectedConnector, doc, false)).toBe('rotate');
    expect(rotationActionForKey({ ...plain, shiftKey: true }, selectedConnector, doc, false)).toBe('optimize');
  });

  it('ignores other keys and modified R (Ctrl/Meta/Alt belong to the browser or app hotkeys)', () => {
    expect(rotationActionForKey({ ...plain, key: 'x' }, selectedConnector, doc, false)).toBeNull();
    expect(rotationActionForKey({ ...plain, ctrlKey: true }, selectedConnector, doc, false)).toBeNull();
    expect(rotationActionForKey({ ...plain, metaKey: true }, selectedConnector, doc, false)).toBeNull();
    expect(rotationActionForKey({ ...plain, altKey: true }, selectedConnector, doc, false)).toBeNull();
  });

  it('never fires while typing in a form field', () => {
    expect(rotationActionForKey(plain, selectedConnector, doc, true)).toBeNull();
  });

  it('needs a selected CONNECTOR or TERMINAL — nothing selected, a bundle, note, wire, or a splice all do nothing', () => {
    expect(rotationActionForKey(plain, null, doc, false)).toBeNull();
    expect(rotationActionForKey(plain, { kind: 'bundle', id: 'b1' }, doc, false)).toBeNull();
    expect(rotationActionForKey(plain, { kind: 'note', id: 'n1' }, doc, false)).toBeNull();
    expect(rotationActionForKey(plain, { kind: 'wire', id: 'w1' }, doc, false)).toBeNull();
    expect(rotationActionForKey(plain, { kind: 'group', id: 'g1' }, doc, false)).toBeNull();
    expect(rotationActionForKey(plain, { kind: 'mate', id: 'm1' }, doc, false)).toBeNull();
    const withSplice = singleConnectorDoc();
    withSplice.components['s1'] = { id: 's1', type: 'splice', refdes: 'S1', custom: {} } satisfies Splice;
    expect(rotationActionForKey(plain, { kind: 'component', id: 's1' }, withSplice, false)).toBeNull();

    // Terminals are rotatable with plain R, but cannot be auto-optimized with Shift+R
    const withTerminal = singleConnectorDoc();
    withTerminal.components['t1'] = { id: 't1', type: 'terminal', refdes: 'T1', terminalKind: 'ring', custom: {} };
    expect(rotationActionForKey(plain, { kind: 'component', id: 't1' }, withTerminal, false)).toBe('rotate');
    expect(rotationActionForKey({ ...plain, shiftKey: true }, { kind: 'component', id: 't1' }, withTerminal, false)).toBeNull();
  });
});
