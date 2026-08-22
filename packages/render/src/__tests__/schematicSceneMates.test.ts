/**
 * T02 B5 — mate geometry in the schematic scene. A mate must be visible
 * (emitted from the scene builder, not invented by the component), must
 * degrade the way the derived model does when a component vanishes, and must
 * be selectable (lasso + fit-to-selection need its geometry).
 */
import { describe, it, expect } from 'vitest';
import { createEmptyDocument, type Connector, type Terminal } from '@openharness/core';
import { computeSchematicScene, BOX_WIDTH, HEADER_HEIGHT, ROW_HEIGHT } from '../schematicScene.js';
import { sceneMateRect, schematicSelectionRects, segmentIntersectsRect } from '../sceneBounds.js';

function matedDoc() {
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
    schematicPosition: { x: 400, y: 200 }, custom: {},
  } satisfies Connector;
  d.mates = {
    m1: { id: 'm1', sourceId: 'c1', targetId: 'c2', custom: {} },
  };
  return d;
}

describe('computeSchematicScene — mates', () => {
  it('emits a centre-to-centre segment for a mate between two placed connectors', () => {
    const scene = computeSchematicScene(matedDoc());
    expect(scene.mates).toHaveLength(1);
    const mate = scene.mates[0]!;
    expect(mate.mateId).toBe('m1');
    expect(mate.sourceId).toBe('c1');
    expect(mate.targetId).toBe('c2');

    const height = HEADER_HEIGHT + 2 * ROW_HEIGHT;
    expect(mate.from).toEqual({ x: BOX_WIDTH / 2, y: height / 2 });
    expect(mate.to).toEqual({ x: 400 + BOX_WIDTH / 2, y: 200 + height / 2 });
    expect(mate.midpoint).toEqual({
      x: (mate.from.x + mate.to.x) / 2,
      y: (mate.from.y + mate.to.y) / 2,
    });
  });

  it('carries both endpoints\u2019 refdes so the canvas can label without re-resolving', () => {
    const mate = computeSchematicScene(matedDoc()).mates[0]!;
    expect(mate.sourceRefdes).toBe('C1');
    expect(mate.targetRefdes).toBe('C2');
  });

  it('treats an absent mates record as empty (doc.mates is optional)', () => {
    const d = matedDoc();
    delete d.mates;
    expect(computeSchematicScene(d).mates).toEqual([]);
  });

  it('ignores a mate naming a component that no longer exists — no throw, no geometry', () => {
    const d = matedDoc();
    d.mates = { ghost: { id: 'ghost', sourceId: 'c1', targetId: 'NONEXISTENT', custom: {} } };
    expect(() => computeSchematicScene(d)).not.toThrow();
    expect(computeSchematicScene(d).mates).toEqual([]);
  });

  it('skips a mate whose component exists but has no schematicPosition (nothing to join yet)', () => {
    const d = matedDoc();
    (d.components['c2'] as Connector).schematicPosition = undefined;
    expect(computeSchematicScene(d).mates).toEqual([]);
  });

  it('emits a mate from a terminal to a connector box', () => {
    const d = matedDoc();
    d.components['t1'] = {
      id: 't1', type: 'terminal', refdes: 'T1', terminalKind: 'ferrule',
      schematicPosition: { x: 200, y: 300 }, custom: {},
    } satisfies Terminal;
    d.mates = { m2: { id: 'm2', sourceId: 't1', targetId: 'c1', targetCavityId: 'a1', custom: {} } };

    const scene = computeSchematicScene(d);
    expect(scene.mates).toHaveLength(1);
    const mate = scene.mates[0]!;
    const terminalNode = scene.nodes.find((n) => n.componentId === 't1')!;
    expect(mate.from).toEqual({
      x: terminalNode.x + terminalNode.width / 2,
      y: terminalNode.y + terminalNode.height / 2,
    });
  });

  it('reports mapped=true only for a non-empty cavityMap — mirroring net extraction', () => {
    const d = matedDoc();
    // Explicit map -> mapped.
    d.mates = {
      m1: {
        id: 'm1', sourceId: 'c1', targetId: 'c2',
        cavityMap: [{ sourceCavityId: 'a1', targetCavityId: 'b2' }],
        custom: {},
      },
    };
    expect(computeSchematicScene(d).mates[0]!.mapped).toBe(true);

    // An EMPTY map is positional (net extraction requires length > 0), so the
    // scene must not advertise it as an explicit mapping either.
    d.mates = { m1: { id: 'm1', sourceId: 'c1', targetId: 'c2', cavityMap: [], custom: {} } };
    expect(computeSchematicScene(d).mates[0]!.mapped).toBe(false);
  });
});

describe('sceneMateRect', () => {
  it('bounds the segment regardless of direction', () => {
    const scene = computeSchematicScene(matedDoc());
    const mate = scene.mates[0]!;
    const r = sceneMateRect(mate);
    expect(r.x).toBe(Math.min(mate.from.x, mate.to.x));
    expect(r.y).toBe(Math.min(mate.from.y, mate.to.y));
    expect(r.width).toBe(Math.abs(mate.to.x - mate.from.x));
    expect(r.height).toBe(Math.abs(mate.to.y - mate.from.y));
  });
});

describe('schematicSelectionRects — mates', () => {
  it('resolves a selected mate to its segment bounds', () => {
    const d = matedDoc();
    const scene = computeSchematicScene(d);
    const rects = schematicSelectionRects(scene, d, [{ kind: 'mate', id: 'm1' }]);
    expect(rects).toEqual([sceneMateRect(scene.mates[0]!)]);
  });

  it('skips a mate that no longer resolves instead of crashing', () => {
    const d = matedDoc();
    const scene = computeSchematicScene(d);
    expect(schematicSelectionRects(scene, d, [{ kind: 'mate', id: 'deleted' }])).toEqual([]);
  });
});

describe('segmentIntersectsRect (lasso test for mates)', () => {
  const rect = { x: 140, y: 60, width: 20, height: 20 };

  it('catches a segment crossing the rect when neither endpoint nor midpoint is inside', () => {
    // (0,0)->(200,100) passes through (150,75) — inside the rect — while its
    // midpoint (100,50) and both endpoints are outside it. A sampling test
    // would miss this; the clip must not.
    expect(segmentIntersectsRect({ x: 0, y: 0 }, { x: 200, y: 100 }, rect)).toBe(true);
  });

  it('is false for a segment that misses the rect', () => {
    expect(segmentIntersectsRect({ x: 0, y: 0 }, { x: 100, y: 10 }, rect)).toBe(false);
  });

  it('is true when an endpoint is inside', () => {
    expect(segmentIntersectsRect({ x: 150, y: 70 }, { x: 500, y: 400 }, rect)).toBe(true);
  });

  it('handles a zero-length segment (point inside vs outside)', () => {
    expect(segmentIntersectsRect({ x: 150, y: 70 }, { x: 150, y: 70 }, rect)).toBe(true);
    expect(segmentIntersectsRect({ x: 5, y: 5 }, { x: 5, y: 5 }, rect)).toBe(false);
  });

  it('treats touching the rect edge as intersecting', () => {
    // Ends exactly on the rect's left edge (140,60).
    expect(segmentIntersectsRect({ x: 100, y: 60 }, { x: 140, y: 60 }, rect)).toBe(true);
  });
});
