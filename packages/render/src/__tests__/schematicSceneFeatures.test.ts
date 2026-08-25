import { describe, it, expect } from 'vitest';
import {
  createEmptyDocument, BACKSHELL_CAVITY_ID, DEFAULT_EXIT_STUB,
  type Connector, type Wire, type WireGroup,
} from '@openharness/core';
import { computeSchematicScene, HEADER_HEIGHT, ROW_HEIGHT, BOX_WIDTH } from '../schematicScene.js';

function connector(id: string, refdes: string, x: number, y: number, cavities = 1): Connector {
  return {
    id, type: 'connector', refdes,
    cavities: Array.from({ length: cavities }, (_, i) => ({
      id: `${id}-${i + 1}`, designation: String(i + 1), custom: {},
    })),
    schematicPosition: { x, y },
    custom: {},
  };
}

/** The two connectors are deliberately on DIFFERENT rows. Put them on the
 * same y and the whole route collapses to one collinear segment, which is
 * correct behaviour but hides the individual stub points these tests are
 * asserting on. */
function twoConnectorDoc(cavities = 1) {
  const doc = createEmptyDocument('S');
  doc.components['c1'] = connector('c1', 'C1', 0, 0, cavities);
  doc.components['c2'] = connector('c2', 'C2', 600, 200, cavities);
  return doc;
}

function wireBetween(id: string, i = 1): Wire {
  return {
    id, refdes: id.toUpperCase(), color: 'Red', custom: {},
    source: { kind: 'cavity', componentId: 'c1', cavityId: `c1-${i}` },
    target: { kind: 'cavity', componentId: 'c2', cavityId: `c2-${i}` },
  };
}

describe('manual wire routing in the scene', () => {
  it('routes automatically when a wire has no waypoints', () => {
    const doc = twoConnectorDoc();
    doc.wires['w1'] = wireBetween('w1');
    const w = computeSchematicScene(doc).wires[0]!;
    expect(w.manualWaypoints).toEqual([]);
  });

  it('threads the wire through its waypoints when it has them', () => {
    const doc = twoConnectorDoc();
    doc.wires['w1'] = { ...wireBetween('w1'), schematicWaypoints: [{ x: 300, y: 400 }] };
    const w = computeSchematicScene(doc).wires[0]!;
    expect(w.manualWaypoints).toEqual([{ x: 300, y: 400 }]);
    expect(w.routePoints).toContainEqual({ x: 300, y: 400 });
  });

  it('exposes each port exit direction so the canvas can re-run the router', () => {
    const doc = twoConnectorDoc();
    doc.wires['w1'] = wireBetween('w1');
    const w = computeSchematicScene(doc).wires[0]!;
    expect(w.fromDir).toBe('right');
    expect(w.toDir).toBe('right'); // c2 is not flipped, so its port also exits right
  });

  // The stub is asserted through a MANUALLY routed wire. On an auto-routed
  // run the stub point is usually collinear with the flat lead-in that
  // follows it and gets legitimately collapsed away, so it isn't observable
  // in the output — whereas a manual bend guarantees a direction change
  // right after the stub, which is also the case the setting exists for
  // (leaving room to draw a shield wrap before the wire turns).
  it('honours the document exit-stub setting', () => {
    const doc = twoConnectorDoc();
    doc.settings.schematicExitStub = 60;
    doc.wires['w1'] = { ...wireBetween('w1'), schematicWaypoints: [{ x: 300, y: 400 }] };
    const w = computeSchematicScene(doc).wires[0]!;
    expect(w.routePoints[1]).toEqual({ x: BOX_WIDTH + 60, y: w.from.y });
  });

  it('falls back to the router default when the setting is absent', () => {
    const doc = twoConnectorDoc();
    doc.settings.schematicExitStub = undefined;
    doc.wires['w1'] = { ...wireBetween('w1'), schematicWaypoints: [{ x: 300, y: 400 }] };
    const w = computeSchematicScene(doc).wires[0]!;
    expect(w.routePoints[1]).toEqual({ x: BOX_WIDTH + DEFAULT_EXIT_STUB, y: w.from.y });
  });
});

describe('connector backshell termination', () => {
  it('adds no extra row when the toggle is off', () => {
    const doc = twoConnectorDoc(2);
    expect(computeSchematicScene(doc).nodes[0]!.rows).toHaveLength(2);
  });

  it('appends a BS row below the cavities without touching the cavity list', () => {
    const doc = twoConnectorDoc(2);
    (doc.components['c1'] as Connector).backshellTermination = true;
    const node = computeSchematicScene(doc).nodes.find((n) => n.componentId === 'c1')!;

    expect(node.rows).toHaveLength(3);
    const bs = node.rows[2]!;
    expect(bs.rowId).toBe(BACKSHELL_CAVITY_ID);
    expect(bs.label).toBe('BS');
    expect(bs.point.y).toBe(HEADER_HEIGHT + 2 * ROW_HEIGHT + ROW_HEIGHT / 2);
    // The housing's own cavity list is untouched — that's the whole reason
    // the backshell isn't stored as a synthetic Cavity.
    expect((doc.components['c1'] as Connector).cavities).toHaveLength(2);
  });

  it('marks the BS row as not signal-capable — a shell ground has no direction', () => {
    const doc = twoConnectorDoc(1);
    (doc.components['c1'] as Connector).backshellTermination = true;
    const node = computeSchematicScene(doc).nodes.find((n) => n.componentId === 'c1')!;
    expect(node.rows.find((r) => r.rowId === BACKSHELL_CAVITY_ID)!.signalCapable).toBe(false);
  });

  it('lets a wire land on the backshell like any other port', () => {
    const doc = twoConnectorDoc(1);
    (doc.components['c1'] as Connector).backshellTermination = true;
    doc.wires['w1'] = {
      id: 'w1', refdes: 'W1', color: 'Green', custom: {},
      source: { kind: 'cavity', componentId: 'c1', cavityId: BACKSHELL_CAVITY_ID },
      target: { kind: 'cavity', componentId: 'c2', cavityId: 'c2-1' },
    };
    const w = computeSchematicScene(doc).wires[0]!;
    expect(w.degraded).toBe(false);
  });
});

describe('shield termination nodes', () => {
  function shieldedDoc(terminationNode: boolean) {
    const doc = twoConnectorDoc(2);
    doc.wires['w1'] = { ...wireBetween('w1', 1), twistGroupId: 'g1' };
    doc.wires['w2'] = { ...wireBetween('w2', 2), twistGroupId: 'g1' };
    const group: WireGroup = {
      id: 'g1', kind: 'twist', refdes: 'SH1', memberWireIds: ['w1', 'w2'], memberGroupIds: [],
      shield: { terminationNode: terminationNode || undefined }, custom: {},
    };
    doc.wireGroups['g1'] = group;
    return doc;
  }

  it('emits no shield node when the group has not asked for one', () => {
    expect(computeSchematicScene(shieldedDoc(false)).shieldNodes).toEqual([]);
  });

  it('emits one node per shielded group that asked, with a point at each end', () => {
    const scene = computeSchematicScene(shieldedDoc(true));
    expect(scene.shieldNodes).toHaveLength(1);
    expect(scene.shieldNodes[0]!.groupId).toBe('g1');
    expect(scene.shieldNodes[0]!.refdes).toBe('SH1');
    expect(scene.shieldNodes[0]!.points).toHaveLength(2);
  });

  it('resolves a drain wire targeting the node, in the second pass', () => {
    // This is the two-pass part of the scene builder: the node's position
    // comes from the member wires' routes, and the drain wire is not a
    // member, so it can only be routed after those exist.
    const doc = shieldedDoc(true);
    doc.wires['drain'] = {
      id: 'drain', refdes: 'DRAIN', color: 'Green', custom: {},
      source: { kind: 'shieldNode', groupId: 'g1' },
      target: { kind: 'cavity', componentId: 'c2', cavityId: 'c2-2' },
    };
    const scene = computeSchematicScene(doc);
    const drain = scene.wires.find((w) => w.wireId === 'drain')!;

    expect(drain.degraded).toBe(false);
    expect(drain.from).toEqual(scene.shieldNodes[0]!.anchor);
  });

  it('degrades a drain wire whose group has no termination node', () => {
    // Not a crash and not a silent (0,0) route — a visibly broken wire, the
    // same treatment any other dangling reference gets.
    const doc = shieldedDoc(false);
    doc.wires['drain'] = {
      id: 'drain', refdes: 'DRAIN', color: 'Green', custom: {},
      source: { kind: 'shieldNode', groupId: 'g1' },
      target: { kind: 'cavity', componentId: 'c2', cavityId: 'c2-2' },
    };
    expect(computeSchematicScene(doc).wires.find((w) => w.wireId === 'drain')!.degraded).toBe(true);
  });

  it('follows nested groups so a shield over two pairs finds all four wires', () => {
    const doc = twoConnectorDoc(4);
    for (let i = 1; i <= 4; i++) {
      doc.wires[`w${i}`] = { ...wireBetween(`w${i}`, i), twistGroupId: i <= 2 ? 'inner1' : 'inner2' };
    }
    doc.wireGroups['inner1'] = { id: 'inner1', kind: 'twist', memberWireIds: ['w1', 'w2'], memberGroupIds: [], custom: {} };
    doc.wireGroups['inner2'] = { id: 'inner2', kind: 'twist', memberWireIds: ['w3', 'w4'], memberGroupIds: [], custom: {} };
    doc.wireGroups['outer'] = {
      id: 'outer', kind: 'cable', refdes: 'CB1', memberWireIds: [], memberGroupIds: ['inner1', 'inner2'],
      shield: { terminationNode: true }, custom: {},
    };

    const scene = computeSchematicScene(doc);
    // The outer group lists no member wires of its own; without following
    // memberGroupIds its shield mark would silently fail to appear.
    expect(scene.shieldNodes.map((n) => n.groupId)).toEqual(['outer']);
  });
});

describe('schematic node rotation and dimensions', () => {
  it('rotation transposes node dimensions and the ports follow', () => {
    // 2 cavities -> unrotated width = 160, unrotated height = 24 + 2 * 22 = 68
    const doc = createEmptyDocument('Test');
    const c1 = connector('c1', 'C1', 100, 100, 2);
    doc.components['c1'] = c1;

    // Unrotated (0°)
    const scene0 = computeSchematicScene(doc);
    const node0 = scene0.nodes[0]!;
    expect(node0.width).toBe(BOX_WIDTH);
    expect(node0.height).toBe(HEADER_HEIGHT + 2 * ROW_HEIGHT);
    expect(node0.rows[0]!.point).toEqual({ x: 100 + BOX_WIDTH, y: 100 + HEADER_HEIGHT + ROW_HEIGHT / 2 });
    expect(node0.rows[0]!.dir).toBe('right');

    // Rotated 90° -> width and height are transposed
    c1.rotation = 90;
    const scene90 = computeSchematicScene(doc);
    const node90 = scene90.nodes[0]!;
    expect(node90.width).toBe(HEADER_HEIGHT + 2 * ROW_HEIGHT);
    expect(node90.height).toBe(BOX_WIDTH);
    // Port 1 is transposed to bottom edge
    const unrotatedH = HEADER_HEIGHT + 2 * ROW_HEIGHT;
    const baseY0 = HEADER_HEIGHT + ROW_HEIGHT / 2;
    expect(node90.rows[0]!.point).toEqual({ x: 100 + (unrotatedH - baseY0), y: 100 + BOX_WIDTH });
    expect(node90.rows[0]!.dir).toBe('right');

    // Rotated 180°
    c1.rotation = 180;
    const scene180 = computeSchematicScene(doc);
    const node180 = scene180.nodes[0]!;
    expect(node180.width).toBe(BOX_WIDTH);
    expect(node180.height).toBe(HEADER_HEIGHT + 2 * ROW_HEIGHT);
    expect(node180.rows[0]!.point).toEqual({ x: 100, y: 100 + (unrotatedH - baseY0) });
    expect(node180.rows[0]!.dir).toBe('left');

    // Rotated 270°
    c1.rotation = 270;
    const scene270 = computeSchematicScene(doc);
    const node270 = scene270.nodes[0]!;
    expect(node270.width).toBe(HEADER_HEIGHT + 2 * ROW_HEIGHT);
    expect(node270.height).toBe(BOX_WIDTH);
    expect(node270.rows[0]!.point).toEqual({ x: 100 + baseY0, y: 100 });
    expect(node270.rows[0]!.dir).toBe('right');
  });

  it('rotation and flipped compose sensibly', () => {
    const doc = createEmptyDocument('Test');
    const c1 = connector('c1', 'C1', 100, 100, 2);
    c1.flipped = true;
    c1.rotation = 90;
    doc.components['c1'] = c1;

    const scene = computeSchematicScene(doc);
    const node = scene.nodes[0]!;
    const unrotatedH = HEADER_HEIGHT + 2 * ROW_HEIGHT;
    const baseY0 = HEADER_HEIGHT + ROW_HEIGHT / 2;

    expect(node.width).toBe(unrotatedH);
    expect(node.height).toBe(BOX_WIDTH);
    // Flipped + 90° puts ports on the top edge (y = 100) with dir left
    expect(node.rows[0]!.point).toEqual({ x: 100 + (unrotatedH - baseY0), y: 100 });
    expect(node.rows[0]!.dir).toBe('left');

    // Flipped + 180° puts ports on the right edge with dir right
    c1.rotation = 180;
    const scene180 = computeSchematicScene(doc);
    const node180 = scene180.nodes[0]!;
    expect(node180.rows[0]!.point).toEqual({ x: 100 + BOX_WIDTH, y: 100 + (unrotatedH - baseY0) });
    expect(node180.rows[0]!.dir).toBe('right');
  });

  it('scales node width when widthPercent is specified', () => {
    const doc = createEmptyDocument('Test');
    const c1 = connector('c1', 'C1', 100, 100, 1);
    c1.widthPercent = 150; // 150% of 160 = 240
    doc.components['c1'] = c1;

    const scene = computeSchematicScene(doc);
    const node = scene.nodes[0]!;
    expect(node.width).toBe(240);
    expect(node.rows[0]!.point.x).toBe(100 + 240);

    // When rotated 90°, transposed height becomes 240
    c1.rotation = 90;
    const scene90 = computeSchematicScene(doc);
    const node90 = scene90.nodes[0]!;
    expect(node90.height).toBe(240);
  });

  it('rotates terminal and transposes its dimensions', () => {
    const doc = createEmptyDocument('Test');
    doc.components['t1'] = {
      id: 't1',
      type: 'terminal',
      refdes: 'T1',
      terminalKind: 'ring',
      schematicPosition: { x: 50, y: 50 },
      rotation: 90,
      custom: {},
    };

    const scene = computeSchematicScene(doc);
    const node = scene.nodes[0]!;
    const unrotatedW = BOX_WIDTH * 0.6; // 96
    const unrotatedH = HEADER_HEIGHT + ROW_HEIGHT; // 46
    expect(node.width).toBe(unrotatedH);
    expect(node.height).toBe(unrotatedW);
  });
});
