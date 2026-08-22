/**
 * Phase 2b — layout orientation geometry extracted from LayoutCanvas into
 * render (layoutOrientation.ts). These pin the behaviour the canvas used to
 * compute inline — auto-orientation, stored-rotation offset, bundle attach
 * points, bundle polylines — so the canvas and the rotation optimizer keep
 * sharing one spelling of the geometry.
 */
import { describe, it, expect } from 'vitest';
import {
  createEmptyDocument,
  type Bundle, type Connector, type Terminal,
} from '@openharness/core';
import {
  branchOutlinePoint, bundlePolyline, computeNodeAutoAngles, glyphAttachPoint,
  glyphBodyHalfLen, glyphStubRadius, nodeFacingAngle, scalePoint, GLYPH_STUB_LEN,
} from '../layoutOrientation.js';

const PX_PER_MM = 4;

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

describe('auto-orientation', () => {
  it('two connectors bundled only to each other face exactly opposite ways', () => {
    const d = createEmptyDocument('Test');
    d.components['c1'] = connectorAt('c1', 'C1', 0, 0);
    d.components['c2'] = connectorAt('c2', 'C2', 100, 0);
    d.bundles['b1'] = bundle('b1', 'BND1', 'c1', 'c2');
    const angles = computeNodeAutoAngles(d, PX_PER_MM);
    expect(angles.get('c1')).toBeCloseTo(0); // cable stub points east, at c2
    expect(angles.get('c2')).toBeCloseTo(Math.PI); // …and c2's points west, at c1
  });

  it('aims at the bundle\'s first/last routing waypoint when one exists', () => {
    const d = createEmptyDocument('Test');
    d.components['c1'] = connectorAt('c1', 'C1', 0, 0);
    d.components['c2'] = connectorAt('c2', 'C2', 100, 0);
    d.bundles['b1'] = { ...bundle('b1', 'BND1', 'c1', 'c2'), waypoints: [{ x: 0, y: -50 }] };
    const angles = computeNodeAutoAngles(d, PX_PER_MM);
    // c1 aims at the waypoint (straight up, screen y-down), not at c2.
    expect(angles.get('c1')).toBeCloseTo(-Math.PI / 2);
    // c2 aims back at the same waypoint from its end.
    expect(angles.get('c2')).toBeCloseTo(Math.atan2(-50 * PX_PER_MM, -100 * PX_PER_MM));
  });

  it('a component with no placed bundle partner faces 0', () => {
    const d = createEmptyDocument('Test');
    d.components['c1'] = connectorAt('c1', 'C1', 10, 10);
    expect(computeNodeAutoAngles(d, PX_PER_MM).get('c1')).toBe(0);
  });

  it('the angle is a direction — independent of the px scale', () => {
    const d = createEmptyDocument('Test');
    d.components['c1'] = connectorAt('c1', 'C1', 0, 0);
    d.components['c2'] = connectorAt('c2', 'C2', 30, 40);
    d.bundles['b1'] = bundle('b1', 'BND1', 'c1', 'c2');
    expect(computeNodeAutoAngles(d, 1).get('c1')).toBeCloseTo(computeNodeAutoAngles(d, PX_PER_MM).get('c1')!);
  });
});

describe('stored rotation offset', () => {
  it('offsets the facing angle clockwise (screen y-down)', () => {
    expect(nodeFacingAngle(0, 90)).toBeCloseTo(Math.PI / 2);
    expect(nodeFacingAngle(0, 180)).toBeCloseTo(Math.PI);
    expect(nodeFacingAngle(0, 270)).toBeCloseTo(3 * Math.PI / 2);
  });

  it('unset rotation reads as 0 — pre-Phase-2b documents render unchanged', () => {
    expect(nodeFacingAngle(1.23, undefined)).toBeCloseTo(1.23);
  });
});

describe('glyph attach points', () => {
  it('a connector attaches one body-half + one stub out from its center', () => {
    const c = connectorAt('c1', 'C1', 0, 0);
    expect(glyphStubRadius('connector')).toBe(glyphBodyHalfLen('connector') + GLYPH_STUB_LEN);
    const at0 = glyphAttachPoint({ x: 100, y: 100 }, 0, c);
    expect(at0).toEqual({ x: 100 + glyphStubRadius('connector'), y: 100 });
    const atDown = glyphAttachPoint({ x: 100, y: 100 }, Math.PI / 2, c);
    expect(atDown.x).toBeCloseTo(100);
    expect(atDown.y).toBeCloseTo(100 + glyphStubRadius('connector'));
  });

  it('a flipped terminal attaches on the opposite side', () => {
    const t = {
      id: 't1', type: 'terminal', refdes: 'T1', terminalKind: 'ring',
      layoutPosition: { x: 0, y: 0 }, flipped: true, custom: {},
    } satisfies Terminal;
    const attach = glyphAttachPoint({ x: 0, y: 0 }, 0, t);
    expect(attach.x).toBeCloseTo(-glyphStubRadius('terminal'));
    expect(attach.y).toBeCloseTo(0);
  });

  it('branch points have no stub', () => {
    expect(glyphStubRadius('branchPoint')).toBe(0);
  });
});

describe('branchOutlinePoint', () => {
  it('clips to the circle edge toward the aim point', () => {
    expect(branchOutlinePoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 7)).toEqual({ x: 7, y: 0 });
    expect(branchOutlinePoint({ x: 0, y: 0 }, { x: 0, y: -50 }, 7)).toEqual({ x: 0, y: -7 });
  });

  it('a zero-length aim stays at the center instead of dividing by zero', () => {
    expect(branchOutlinePoint({ x: 3, y: 4 }, { x: 3, y: 4 }, 7)).toEqual({ x: 3, y: 4 });
  });
});

describe('bundlePolyline', () => {
  it('runs source attach → waypoints → target attach in px', () => {
    const d = createEmptyDocument('Test');
    d.components['c1'] = connectorAt('c1', 'C1', 0, 0);
    d.components['c2'] = connectorAt('c2', 'C2', 100, 0);
    const b = { ...bundle('b1', 'BND1', 'c1', 'c2'), waypoints: [{ x: 50, y: 30 }] };
    d.bundles['b1'] = b;
    const angles = new Map<string, number>([['c1', 0], ['c2', Math.PI]]);
    const points = bundlePolyline(d, b, angles, PX_PER_MM, 7);
    const r = glyphStubRadius('connector');
    expect(points).toHaveLength(3);
    expect(points![0]!.x).toBeCloseTo(r);
    expect(points![0]!.y).toBeCloseTo(0);
    expect(points![1]).toEqual({ x: 200, y: 120 }); // the waypoint, mm → px
    expect(points![2]!.x).toBeCloseTo(400 - r);     // c2's stub tip, facing west
    expect(points![2]!.y).toBeCloseTo(0);
  });

  it('rotating an endpoint moves the polyline\'s attach point — bundles re-route on rotation', () => {
    const d = createEmptyDocument('Test');
    d.components['c1'] = connectorAt('c1', 'C1', 0, 0);
    d.components['c2'] = connectorAt('c2', 'C2', 100, 0);
    const b = bundle('b1', 'BND1', 'c1', 'c2');
    d.bundles['b1'] = b;
    const r = glyphStubRadius('connector');
    const before = bundlePolyline(d, b, new Map([['c1', 0], ['c2', Math.PI]]), PX_PER_MM, 7);
    const rotated = bundlePolyline(d, b, new Map([['c1', Math.PI], ['c2', Math.PI]]), PX_PER_MM, 7);
    expect(before![0]!.x).toBeCloseTo(r);
    expect(before![0]!.y).toBeCloseTo(0);
    expect(rotated![0]!.x).toBeCloseTo(-r); // c1's stub now faces west
    expect(rotated![0]!.y).toBeCloseTo(0);
    // The far end is untouched by c1's rotation.
    expect(rotated![rotated!.length - 1]).toEqual(before![before!.length - 1]);
  });

  it('is undefined when either end is unplaced — the bundle cannot be drawn', () => {
    const d = createEmptyDocument('Test');
    d.components['c1'] = connectorAt('c1', 'C1', 0, 0);
    d.components['c2'] = { ...connectorAt('c2', 'C2', 100, 0), layoutPosition: undefined };
    const b = bundle('b1', 'BND1', 'c1', 'c2');
    d.bundles['b1'] = b;
    expect(bundlePolyline(d, b, new Map(), PX_PER_MM, 7)).toBeUndefined();
  });
});

describe('scalePoint', () => {
  it('scales mm into px', () => {
    expect(scalePoint({ x: 10, y: -5 }, PX_PER_MM)).toEqual({ x: 40, y: -20 });
  });
});
