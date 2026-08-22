/**
 * T02 B5 — the draft-level mate operations the Schematic canvas mutates
 * through `store.transact`. These carry the behaviour the UI relies on and
 * cannot express in a unit test of the component itself (no DOM in this
 * repo's test setup): direction normalisation, the optional-`mates` traps,
 * and the cavity-map editing rules from DOMAIN-DECISIONS D3.
 */
import { describe, it, expect } from 'vitest';
import {
  createEmptyDocument, HarnessStore,
  type Connector, type Terminal, type HarnessDocument,
} from '@openharness/core';
import {
  addMateInDraft, deleteMateInDraft, removeMatesOfComponentInDraft,
  setMateTargetCavityInDraft, addMateCavityPairInDraft, updateMateCavityPairInDraft,
  removeMateCavityPairInDraft, clearMateCavityMapInDraft,
} from '../mateOps.js';

function docWithPair(): HarnessDocument {
  const d = createEmptyDocument('Test');
  d.components['c1'] = {
    id: 'c1', type: 'connector', refdes: 'C1',
    cavities: [
      { id: 'a1', designation: '1', custom: {} },
      { id: 'a2', designation: '2', custom: {} },
    ],
    schematicPosition: { x: 0, y: 0 }, custom: {},
  } satisfies Connector;
  d.components['c2'] = {
    id: 'c2', type: 'connector', refdes: 'C2',
    cavities: [
      { id: 'b1', designation: '1', custom: {} },
      { id: 'b2', designation: '2', custom: {} },
    ],
    schematicPosition: { x: 300, y: 0 }, custom: {},
  } satisfies Connector;
  d.components['t1'] = {
    id: 't1', type: 'terminal', refdes: 'T1', terminalKind: 'ferrule',
    schematicPosition: { x: 150, y: 150 }, custom: {},
  } satisfies Terminal;
  return d;
}

function storeWithPair(): HarnessStore {
  return new HarnessStore(docWithPair());
}

/** addMateInDraft through a real transaction, failing loudly if it refuses. */
function addMate(store: HarnessStore, a: string, b: string, cavityId?: string): string {
  const { value } = store.transact('Add mate', (draft) => addMateInDraft(draft, a, b, cavityId));
  if (value === null) throw new Error(`addMateInDraft(${a}, ${b}) unexpectedly refused`);
  return value;
}

describe('addMateInDraft', () => {
  it('creates the mate and the optional mates record on demand', () => {
    const store = storeWithPair();
    expect(store.doc.mates).toBeUndefined();
    const id = addMate(store, 'c1', 'c2');
    const mate = store.doc.mates?.[id];
    expect(mate).toBeDefined();
    expect(mate?.sourceId).toBe('c1');
    expect(mate?.targetId).toBe('c2');
  });

  it('normalises connector→terminal to terminal→connector, the only spelling the derive stages read', () => {
    const store = storeWithPair();
    // User started from the CONNECTOR and completed on the terminal.
    const id = addMate(store, 'c1', 't1');
    const mate = store.doc.mates?.[id];
    expect(mate?.sourceId).toBe('t1');
    expect(mate?.targetId).toBe('c1');
  });

  it('records the clicked cavity only for terminal-into-connector mates', () => {
    const store = storeWithPair();
    const terminalMate = addMate(store, 't1', 'c1', 'a2');
    expect(store.doc.mates?.[terminalMate]?.targetCavityId).toBe('a2');

    // A cavity id passed while completing a connector-connector mate is
    // meaningless there and must not be authored.
    const connectorMate = addMate(store, 'c1', 'c2', 'b1');
    expect(store.doc.mates?.[connectorMate]?.targetCavityId).toBeUndefined();
  });

  it('refuses self-mates and missing components, writing nothing', () => {
    const store = storeWithPair();
    store.transact('Add mate', (draft) => {
      expect(addMateInDraft(draft, 'c1', 'c1')).toBeNull();
      expect(addMateInDraft(draft, 'c1', 'ghost')).toBeNull();
    });
    expect(store.doc.mates).toBeUndefined();
  });
});

describe('deleteMateInDraft', () => {
  it('removes the mate and collapses the emptied record back to undefined', () => {
    const store = storeWithPair();
    const id = addMate(store, 'c1', 'c2');
    expect(store.doc.mates).toBeDefined();
    store.transact('Delete mate', (draft) => {
      deleteMateInDraft(draft, id);
    });
    // T02 trap: no empty `mates: {}` left behind in the serialised document.
    expect(store.doc.mates).toBeUndefined();
  });
});

describe('removeMatesOfComponentInDraft', () => {
  it('drops every mate referencing the component (both ends) and collapses', () => {
    const store = storeWithPair();
    addMate(store, 'c1', 'c2');
    addMate(store, 't1', 'c1', 'a1');
    expect(Object.keys(store.doc.mates ?? {})).toHaveLength(2);
    store.transact('Delete component', (draft) => {
      removeMatesOfComponentInDraft(draft, 'c1');
    });
    expect(store.doc.mates).toBeUndefined();
  });

  it('keeps mates that do not reference the component', () => {
    const store = storeWithPair();
    const kept = addMate(store, 'c1', 'c2');
    addMate(store, 't1', 'c1', 'a1');
    store.transact('Delete component', (draft) => {
      removeMatesOfComponentInDraft(draft, 't1');
    });
    expect(Object.keys(store.doc.mates ?? {})).toEqual([kept]);
  });
});

describe('cavity map editing (D3)', () => {
  function storeWithMate(): { store: HarnessStore; mateId: string } {
    const store = storeWithPair();
    return { store, mateId: addMate(store, 'c1', 'c2') };
  }

  it('the first pair creates the map; pairs are editable', () => {
    const { store, mateId } = storeWithMate();
    store.transact('Add cavity pair', (draft) => {
      addMateCavityPairInDraft(draft, mateId, 'a1', 'b2');
    });
    expect(store.doc.mates?.[mateId]?.cavityMap).toEqual([
      { sourceCavityId: 'a1', targetCavityId: 'b2' },
    ]);

    store.transact('Edit cavity pair', (draft) => {
      updateMateCavityPairInDraft(draft, mateId, 0, { targetCavityId: 'b1' });
    });
    expect(store.doc.mates?.[mateId]?.cavityMap).toEqual([
      { sourceCavityId: 'a1', targetCavityId: 'b1' },
    ]);
  });

  it('removing the last pair collapses the map to positional (undefined)', () => {
    const { store, mateId } = storeWithMate();
    store.transact('Add cavity pair', (draft) => {
      addMateCavityPairInDraft(draft, mateId, 'a1', 'b1');
    });
    store.transact('Remove cavity pair', (draft) => {
      removeMateCavityPairInDraft(draft, mateId, 0);
    });
    // An empty array would be a second spelling of "positional" — net
    // extraction treats it as such, so the document must not store it.
    expect(store.doc.mates?.[mateId]?.cavityMap).toBeUndefined();
  });

  it('clearMateCavityMap returns the mate to positional pairing', () => {
    const { store, mateId } = storeWithMate();
    store.transact('Add cavity pair', (draft) => {
      addMateCavityPairInDraft(draft, mateId, 'a1', 'b1');
      addMateCavityPairInDraft(draft, mateId, 'a2', 'b2');
    });
    store.transact('Clear cavity map', (draft) => {
      clearMateCavityMapInDraft(draft, mateId);
    });
    expect(store.doc.mates?.[mateId]?.cavityMap).toBeUndefined();
  });

  it('setMateTargetCavity sets and clears the terminal receiving cavity', () => {
    const store = storeWithPair();
    const mateId = addMate(store, 't1', 'c1');
    expect(store.doc.mates?.[mateId]?.targetCavityId).toBeUndefined();
    store.transact('Set cavity', (draft) => {
      setMateTargetCavityInDraft(draft, mateId, 'a1');
    });
    expect(store.doc.mates?.[mateId]?.targetCavityId).toBe('a1');
    store.transact('Clear cavity', (draft) => {
      setMateTargetCavityInDraft(draft, mateId, undefined);
    });
    expect(store.doc.mates?.[mateId]?.targetCavityId).toBeUndefined();
  });

  it('each edit is one undo step', () => {
    const { store, mateId } = storeWithMate();
    store.transact('Add cavity pair', (draft) => {
      addMateCavityPairInDraft(draft, mateId, 'a1', 'b1');
    });
    expect(store.doc.mates?.[mateId]?.cavityMap).toHaveLength(1);
    store.undo();
    expect(store.doc.mates?.[mateId]?.cavityMap).toBeUndefined();
    store.redo();
    expect(store.doc.mates?.[mateId]?.cavityMap).toHaveLength(1);
  });
});

describe('mates never leak into the conductor model', () => {
  it('a mate creates no wire and reaches no BOM — it only unions nets', () => {
    // Guard the T02 trap at the boundary the UI creates mates: after
    // addMateInDraft the document has exactly one more mate and the same
    // wires it had before.
    const store = storeWithPair();
    const wiresBefore = Object.keys(store.doc.wires).length;
    addMate(store, 'c1', 'c2');
    expect(Object.keys(store.doc.wires)).toHaveLength(wiresBefore);

    // Nets: two 2-cavity connectors joined positionally -> each nth cavity
    // pair lands on one net with no wire involved; the unrelated terminal
    // keeps its own singleton net.
    const nets = store.derived.nets;
    expect(nets).toHaveLength(3);
    const cavityNets = nets.filter((n) => n.memberIds.some((m) => m.startsWith('cavity:')));
    expect(cavityNets).toHaveLength(2);
    for (const net of cavityNets) {
      expect(net.memberIds).toHaveLength(2);
    }

    // A mate carries no part, so it can never surface as a BOM line: the BOM
    // is byte-for-byte what it was before the mate existed.
    const store2 = storeWithPair();
    const bomBefore = store2.derived.bom;
    addMate(store2, 'c1', 'c2');
    expect(store2.derived.bom).toEqual(bomBefore);
  });
});
