import { describe, it, expect } from 'vitest';
import { createEmptyDocument, HarnessStore, type Connector, type Wire } from '@openharness/core';
import { moveCavity, insertCavityBelow, deleteCavity, cavityIsWired } from '../cavityOps.js';

function createTestConnectorDoc(): { store: HarnessStore; connectorId: string } {
  const doc = createEmptyDocument('Test');
  const conn: Connector = {
    id: 'c1',
    type: 'connector',
    refdes: 'J1',
    schematicPosition: { x: 100, y: 100 },
    cavities: [
      { id: 'cav-1', designation: 'PIN_A', signal: 'CAN_HIGH', contactPartId: 'cp-gold', direction: 'output', custom: { notes: 'first' } },
      { id: 'cav-2', designation: 'PIN_B', signal: 'CAN_LOW', contactPartId: 'cp-silver', direction: 'input', custom: { notes: 'second' } },
      { id: 'cav-3', designation: 'PIN_C', signal: 'GND', custom: {} },
    ],
    custom: {},
  };
  doc.components['c1'] = conn;
  const store = new HarnessStore(doc);
  return { store, connectorId: 'c1' };
}

describe('cavityOps — cavity operations', () => {
  it('cavity insert-below puts the new cavity at the right index and leaves existing designations intact', () => {
    const { store, connectorId } = createTestConnectorDoc();

    // Insert below PIN_A (index 0) -> new cavity should land at index 1 (between PIN_A and PIN_B)
    const newCav = insertCavityBelow(store, connectorId, 'cav-1');
    expect(newCav).toBeDefined();

    const conn = store.doc.components[connectorId] as Connector;
    expect(conn.cavities).toHaveLength(4);
    expect(conn.cavities[0]!.id).toBe('cav-1');
    expect(conn.cavities[0]!.designation).toBe('PIN_A');
    expect(conn.cavities[1]!.id).toBe(newCav!.id);
    expect(conn.cavities[2]!.id).toBe('cav-2');
    expect(conn.cavities[2]!.designation).toBe('PIN_B');
    expect(conn.cavities[3]!.id).toBe('cav-3');
    expect(conn.cavities[3]!.designation).toBe('PIN_C');

    // All existing designations remain intact
    expect(conn.cavities.map((c) => c.designation)).toEqual(['PIN_A', newCav!.designation, 'PIN_B', 'PIN_C']);
  });

  it('cavity reorder moves the signal and the contact reference with it', () => {
    const { store, connectorId } = createTestConnectorDoc();

    // Move PIN_A down -> swaps with PIN_B
    const movedDown = moveCavity(store, connectorId, 'cav-1', 'down');
    expect(movedDown).toBe(true);

    let conn = store.doc.components[connectorId] as Connector;
    expect(conn.cavities[0]!.id).toBe('cav-2');
    expect(conn.cavities[0]!.signal).toBe('CAN_LOW');
    expect(conn.cavities[0]!.contactPartId).toBe('cp-silver');
    expect(conn.cavities[0]!.direction).toBe('input');

    expect(conn.cavities[1]!.id).toBe('cav-1');
    expect(conn.cavities[1]!.signal).toBe('CAN_HIGH');
    expect(conn.cavities[1]!.contactPartId).toBe('cp-gold');
    expect(conn.cavities[1]!.direction).toBe('output');
    expect(conn.cavities[1]!.custom).toEqual({ notes: 'first' });

    // Move PIN_A up -> swaps back to original position
    const movedUp = moveCavity(store, connectorId, 'cav-1', 'up');
    expect(movedUp).toBe(true);

    conn = store.doc.components[connectorId] as Connector;
    expect(conn.cavities[0]!.id).toBe('cav-1');
    expect(conn.cavities[0]!.signal).toBe('CAN_HIGH');
    expect(conn.cavities[0]!.contactPartId).toBe('cp-gold');
  });

  it('deleting a wired cavity is refused', () => {
    const { store, connectorId } = createTestConnectorDoc();

    // Wire cavity 1 (cav-1) to something
    const wire1: Wire = {
      id: 'w1',
      refdes: 'W1',
      color: 'Red',
      source: { kind: 'cavity', componentId: connectorId, cavityId: 'cav-1' },
      target: { kind: 'free', point: { x: 200, y: 200 } },
      custom: {},
    };
    store.transact('Add test wire', (draft) => {
      draft.wires['w1'] = wire1;
    });

    expect(cavityIsWired(store.doc, connectorId, 'cav-1')).toBe(true);
    expect(cavityIsWired(store.doc, connectorId, 'cav-2')).toBe(false);

    // Attempting to delete wired cavity is refused
    const deleteResult = deleteCavity(store, connectorId, 'cav-1');
    expect(deleteResult).toBe(false);

    // Cavities list is untouched
    const conn = store.doc.components[connectorId] as Connector;
    expect(conn.cavities).toHaveLength(3);
    expect(conn.cavities.map((c) => c.id)).toContain('cav-1');

    // Deleting unwired cavity succeeds
    const deleteUnwired = deleteCavity(store, connectorId, 'cav-2');
    expect(deleteUnwired).toBe(true);
    const connAfter = store.doc.components[connectorId] as Connector;
    expect(connAfter.cavities).toHaveLength(2);
    expect(connAfter.cavities.map((c) => c.id)).not.toContain('cav-2');
  });

  it('refuses move up on first cavity and move down on last cavity', () => {
    const { store, connectorId } = createTestConnectorDoc();

    expect(moveCavity(store, connectorId, 'cav-1', 'up')).toBe(false);
    expect(moveCavity(store, connectorId, 'cav-3', 'down')).toBe(false);

    // Non-existent cavity / component
    expect(moveCavity(store, connectorId, 'non-existent', 'up')).toBe(false);
    expect(moveCavity(store, 'non-existent', 'cav-1', 'up')).toBe(false);
  });

  it('undo and redo work cleanly for cavity operations', () => {
    const { store, connectorId } = createTestConnectorDoc();

    moveCavity(store, connectorId, 'cav-1', 'down');
    expect((store.doc.components[connectorId] as Connector).cavities[0]!.id).toBe('cav-2');

    store.undo();
    expect((store.doc.components[connectorId] as Connector).cavities[0]!.id).toBe('cav-1');

    store.redo();
    expect((store.doc.components[connectorId] as Connector).cavities[0]!.id).toBe('cav-2');
  });
});
