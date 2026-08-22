import { describe, it, expect } from 'vitest';
import { createEmptyDocument, type Connector, type Wire, type Note, type WireGroup } from '@openharness/core';
import { computeSchematicScene } from '../schematicScene.js';
import { sceneNodeRect, sceneWireRect, schematicContentRects, schematicSelectionRects } from '../sceneBounds.js';
import type { SceneWire } from '../schematicScene.js';

/** Two placed connectors joined by one wire — the minimal scene with a node,
 * a wire, and (when added) a note, shared by the tests below. */
function wiredDoc() {
  const d = createEmptyDocument('Test');
  d.components['c1'] = {
    id: 'c1', type: 'connector', refdes: 'C1',
    cavities: [{ id: 'a', designation: '1', custom: {} }],
    schematicPosition: { x: 0, y: 0 }, custom: {},
  } satisfies Connector;
  d.components['c2'] = {
    id: 'c2', type: 'connector', refdes: 'C2',
    cavities: [{ id: 'b', designation: '1', custom: {} }],
    schematicPosition: { x: 400, y: 200 }, custom: {},
  } satisfies Connector;
  d.wires['w1'] = {
    id: 'w1', refdes: 'W1', color: 'Red',
    source: { kind: 'cavity', componentId: 'c1', cavityId: 'a' },
    target: { kind: 'cavity', componentId: 'c2', cavityId: 'b' },
    custom: {},
  } satisfies Wire;
  return d;
}

function fakeWire(routePoints: { x: number; y: number }[]): SceneWire {
  return {
    wireId: 'w', refdes: 'W', color: 'Red',
    from: routePoints[0] ?? { x: 0, y: 0 },
    to: routePoints[routePoints.length - 1] ?? { x: 0, y: 0 },
    fromDir: 'right', toDir: 'left',
    degraded: false,
    routePoints,
    path: '',
    midpoint: { x: 0, y: 0 },
    manualWaypoints: [],
  };
}

describe('sceneNodeRect', () => {
  it('is the node box itself, in canvas units', () => {
    const scene = computeSchematicScene(wiredDoc());
    const node = scene.nodes.find((n) => n.componentId === 'c1')!;
    expect(sceneNodeRect(node)).toEqual({ x: node.x, y: node.y, width: node.width, height: node.height });
  });
});

describe('sceneWireRect', () => {
  it('bounds the routed path', () => {
    const r = sceneWireRect(fakeWire([{ x: 10, y: 20 }, { x: 50, y: 5 }, { x: 30, y: 60 }]));
    expect(r).toEqual({ x: 10, y: 5, width: 40, height: 55 });
  });

  it('is a zero-extent rect for a single-point path', () => {
    expect(sceneWireRect(fakeWire([{ x: 7, y: 9 }]))).toEqual({ x: 7, y: 9, width: 0, height: 0 });
  });

  it('is null when the wire has no route points at all', () => {
    expect(sceneWireRect(fakeWire([]))).toBeNull();
  });
});

describe('schematicContentRects', () => {
  it('is empty for an empty document', () => {
    expect(schematicContentRects(computeSchematicScene(createEmptyDocument('Empty')))).toEqual([]);
  });

  it('covers node boxes, wire routes, and note positions', () => {
    const d = wiredDoc();
    d.notes['n1'] = { id: 'n1', schematicPosition: { x: 700, y: 50 }, text: 'hi' } satisfies Note;
    const scene = computeSchematicScene(d);
    const rects = schematicContentRects(scene);

    // Every node box appears verbatim.
    for (const node of scene.nodes) {
      expect(rects).toContainEqual(sceneNodeRect(node));
    }
    // The note contributes a point rect at its position.
    expect(rects).toContainEqual({ x: 700, y: 50, width: 0, height: 0 });
    // The wire's route appears — so the union spans both endpoints.
    const wire = scene.wires[0]!;
    expect(rects).toContainEqual(sceneWireRect(wire));
  });
});

describe('schematicSelectionRects', () => {
  it('resolves a component to its node box', () => {
    const d = wiredDoc();
    const scene = computeSchematicScene(d);
    const node = scene.nodes.find((n) => n.componentId === 'c2')!;
    expect(schematicSelectionRects(scene, d, [{ kind: 'component', id: 'c2' }])).toEqual([sceneNodeRect(node)]);
  });

  it('resolves a note to a point rect at its position', () => {
    const d = wiredDoc();
    d.notes['n1'] = { id: 'n1', schematicPosition: { x: 123, y: 456 }, text: 'hi' } satisfies Note;
    const scene = computeSchematicScene(d);
    expect(schematicSelectionRects(scene, d, [{ kind: 'note', id: 'n1' }])).toEqual([
      { x: 123, y: 456, width: 0, height: 0 },
    ]);
  });

  it('resolves a wire to its routed-path bounds', () => {
    const d = wiredDoc();
    const scene = computeSchematicScene(d);
    const wire = scene.wires[0]!;
    expect(schematicSelectionRects(scene, d, [{ kind: 'wire', id: 'w1' }])).toEqual([sceneWireRect(wire)]);
  });

  it('resolves a group to its member wires, following nested memberGroupIds', () => {
    const d = wiredDoc();
    d.wires['w2'] = {
      id: 'w2', refdes: 'W2', color: 'Blue',
      source: { kind: 'cavity', componentId: 'c1', cavityId: 'a' },
      target: { kind: 'cavity', componentId: 'c2', cavityId: 'b' },
      custom: {},
    } satisfies Wire;
    d.wireGroups['inner'] = {
      id: 'inner', kind: 'twist', memberWireIds: ['w1'], memberGroupIds: [], custom: {},
    } satisfies WireGroup;
    d.wireGroups['outer'] = {
      id: 'outer', kind: 'cable', memberWireIds: ['w2'], memberGroupIds: ['inner'], custom: {},
    } satisfies WireGroup;

    const scene = computeSchematicScene(d);
    const byId = new Map(scene.wires.map((w) => [w.wireId, w]));
    const rects = schematicSelectionRects(scene, d, [{ kind: 'group', id: 'outer' }]);
    // Both the direct member and the nested group's member, in some order.
    expect(rects).toHaveLength(2);
    expect(rects).toContainEqual(sceneWireRect(byId.get('w1')!));
    expect(rects).toContainEqual(sceneWireRect(byId.get('w2')!));
  });

  it('skips items that no longer resolve instead of crashing', () => {
    const d = wiredDoc();
    const scene = computeSchematicScene(d);
    expect(
      schematicSelectionRects(scene, d, [
        { kind: 'component', id: 'deleted' },
        { kind: 'wire', id: 'deleted' },
        { kind: 'group', id: 'deleted' },
        { kind: 'note', id: 'deleted' },
      ]),
    ).toEqual([]);
  });
});
