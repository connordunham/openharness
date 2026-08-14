import { describe, it, expect } from 'vitest';
import { createEmptyDocument } from '../document.js';
import { HarnessStore } from '../store.js';

describe('HarnessStore scaffold', () => {
  it('creates an empty, correctly-shaped document', () => {
    const doc = createEmptyDocument('Test Harness');
    expect(doc.formatVersion).toBe(1);
    expect(doc.meta.name).toBe('Test Harness');
    expect(doc.meta.revision).toBe(0);
    expect(Object.keys(doc.components)).toHaveLength(0);
  });

  it('transact() commits a mutation, bumps revision, and is undoable', () => {
    const store = new HarnessStore(createEmptyDocument());

    store.transact('Add connector', (draft) => {
      draft.components['c1'] = {
        id: 'c1',
        type: 'connector',
        refdes: 'C1',
        cavities: [],
        custom: {},
      };
    });

    expect(store.doc.components['c1']).toBeDefined();
    expect(store.doc.meta.revision).toBe(1);

    store.undo();
    expect(store.doc.components['c1']).toBeUndefined();

    store.redo();
    expect(store.doc.components['c1']).toBeDefined();
  });

  it('dryRun returns patches without applying them', () => {
    const store = new HarnessStore(createEmptyDocument());
    const result = store.transact(
      'Add connector (preview)',
      (draft) => {
        draft.components['c1'] = {
          id: 'c1', type: 'connector', refdes: 'C1', cavities: [], custom: {},
        };
      },
      { dryRun: true },
    );

    expect(result.patches.length).toBeGreaterThan(0);
    expect(store.doc.components['c1']).toBeUndefined();
  });

  it('derived model is present and correctly shaped even before algorithms land', () => {
    const store = new HarnessStore(createEmptyDocument());
    expect(store.derived.nets).toEqual([]);
    expect(store.derived.bom).toEqual([]);
  });

  it('undo() and redo() emit transaction:committed, so subscribers (GUI, automations) see them', () => {
    const store = new HarnessStore(createEmptyDocument());
    const events: string[] = [];
    store.on('transaction:committed', (e) => events.push(e.label));

    store.transact('Add connector', (draft) => {
      draft.components['c1'] = { id: 'c1', type: 'connector', refdes: 'C1', cavities: [], custom: {} };
    });
    store.undo();
    store.redo();

    expect(events).toEqual(['Add connector', 'Undo: Add connector', 'Redo: Add connector']);
    expect(store.doc.components['c1']).toBeDefined();
  });
});
