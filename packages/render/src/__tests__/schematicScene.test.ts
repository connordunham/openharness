import { describe, it, expect } from 'vitest';
import { createEmptyDocument, type Connector, type Splice, type Wire, type Cable } from '@openharness/core';
import { computeSchematicScene, HEADER_HEIGHT, ROW_HEIGHT, BOX_WIDTH } from '../schematicScene.js';

function doc() {
  return createEmptyDocument('Test');
}

describe('computeSchematicScene', () => {
  it('places a connector box at its schematicPosition, sized by cavity count', () => {
    const d = doc();
    const connector: Connector = {
      id: 'c1', type: 'connector', refdes: 'C1',
      cavities: [
        { id: 'a', designation: '1', custom: {} },
        { id: 'b', designation: '2', custom: {} },
      ],
      schematicPosition: { x: 100, y: 50 },
      custom: {},
    };
    d.components['c1'] = connector;

    const scene = computeSchematicScene(d);
    expect(scene.nodes).toHaveLength(1);
    const node = scene.nodes[0]!;
    expect(node.x).toBe(100);
    expect(node.y).toBe(50);
    expect(node.height).toBe(HEADER_HEIGHT + 2 * ROW_HEIGHT);
    expect(node.rows).toHaveLength(2);
    expect(node.rows[0]!.point).toEqual({ x: 100 + BOX_WIDTH, y: 50 + HEADER_HEIGHT + ROW_HEIGHT / 2 });
  });

  it('omits a branch point (layout-only, spec §4.2) from the schematic scene', () => {
    const d = doc();
    d.components['b1'] = { id: 'b1', type: 'branchPoint', refdes: 'B1', layoutPosition: { x: 0, y: 0 }, custom: {} };
    expect(computeSchematicScene(d).nodes).toHaveLength(0);
  });

  it('omits any component with no schematicPosition (not yet placed on this canvas)', () => {
    const d = doc();
    d.components['c1'] = { id: 'c1', type: 'connector', refdes: 'C1', cavities: [], custom: {} };
    expect(computeSchematicScene(d).nodes).toHaveLength(0);
  });

  it('resolves a wire between two cavities to real points', () => {
    const d = doc();
    d.components['c1'] = {
      id: 'c1', type: 'connector', refdes: 'C1',
      cavities: [{ id: 'a', designation: '1', custom: {} }],
      schematicPosition: { x: 0, y: 0 }, custom: {},
    } satisfies Connector;
    d.components['c2'] = {
      id: 'c2', type: 'connector', refdes: 'C2',
      cavities: [{ id: 'b', designation: '1', custom: {} }],
      schematicPosition: { x: 300, y: 0 }, custom: {},
    } satisfies Connector;
    d.wires['w1'] = {
      id: 'w1', refdes: 'W1', color: 'Red',
      source: { kind: 'cavity', componentId: 'c1', cavityId: 'a' },
      target: { kind: 'cavity', componentId: 'c2', cavityId: 'b' },
      custom: {},
    } satisfies Wire;

    const scene = computeSchematicScene(d);
    expect(scene.wires).toHaveLength(1);
    expect(scene.wires[0]!.degraded).toBe(false);
    expect(scene.wires[0]!.from).toEqual({ x: BOX_WIDTH, y: HEADER_HEIGHT + ROW_HEIGHT / 2 });
    expect(scene.wires[0]!.to).toEqual({ x: 300 + BOX_WIDTH, y: HEADER_HEIGHT + ROW_HEIGHT / 2 });
  });

  it('resolves a wire to a splice as the splice box center (n-ary hyper-node, spec §6.1)', () => {
    const d = doc();
    d.components['c1'] = {
      id: 'c1', type: 'connector', refdes: 'C1',
      cavities: [{ id: 'a', designation: '1', custom: {} }],
      schematicPosition: { x: 0, y: 0 }, custom: {},
    } satisfies Connector;
    d.components['s1'] = {
      id: 's1', type: 'splice', refdes: 'S1', schematicPosition: { x: 200, y: 100 }, custom: {},
    } satisfies Splice;
    d.wires['w1'] = {
      id: 'w1', refdes: 'W1', color: 'Red',
      source: { kind: 'cavity', componentId: 'c1', cavityId: 'a' },
      target: { kind: 'splice', componentId: 's1' },
      custom: {},
    } satisfies Wire;

    const scene = computeSchematicScene(d);
    expect(scene.wires[0]!.degraded).toBe(false);
    expect(scene.wires[0]!.to.x).toBeGreaterThan(200);
  });

  it('marks a wire degraded when an endpoint cannot be resolved (dangling reference)', () => {
    const d = doc();
    d.components['c1'] = {
      id: 'c1', type: 'connector', refdes: 'C1',
      cavities: [{ id: 'a', designation: '1', custom: {} }],
      schematicPosition: { x: 0, y: 0 }, custom: {},
    } satisfies Connector;
    d.wires['w1'] = {
      id: 'w1', refdes: 'W1', color: 'Red',
      source: { kind: 'cavity', componentId: 'c1', cavityId: 'a' },
      target: { kind: 'cavity', componentId: 'does-not-exist', cavityId: 'x' },
      custom: {},
    } satisfies Wire;

    expect(computeSchematicScene(d).wires[0]!.degraded).toBe(true);
  });

  it('includes cable cores and the shield as rows', () => {
    const d = doc();
    d.components['cb1'] = {
      id: 'cb1', type: 'cable', refdes: 'CB1',
      cores: [{ id: 'core1', color: 'Red' }],
      shield: { id: 'shield1', color: 'Shield', designation: 'SHIELD' },
      schematicPosition: { x: 0, y: 0 }, custom: {},
    } satisfies Cable;

    const node = computeSchematicScene(d).nodes[0]!;
    expect(node.rows).toHaveLength(2);
    expect(node.rows[1]!.rowId).toBe('shield1');
  });

  it('includes notes verbatim', () => {
    const d = doc();
    d.notes['n1'] = { id: 'n1', schematicPosition: { x: 10, y: 20 }, text: 'Hello' };
    const scene = computeSchematicScene(d);
    expect(scene.notes).toEqual([{ noteId: 'n1', point: { x: 10, y: 20 }, text: 'Hello' }]);
  });
});
