/**
 * Phase 2a — bundle scene emission. Feeds emitBundleGeometry a document plus
 * canvas-resolved polylines and checks the per-bundle scene data the Layout
 * canvas draws from: membership counts, gauge labels, derived diameter →
 * outline width, color default/override, label text/placement, and the
 * crossing (conflict) flag.
 */
import { describe, it, expect } from 'vitest';
import {
  createEmptyDocument, computeDerivedModel, DEFAULT_BUNDLE_COLOR,
  type Connector, type Wire, type WirePart, type Bundle,
} from '@openharness/core';
import { emitBundleGeometry, bundleGaugeLabel } from '../bundleScene.js';

function doc() {
  return createEmptyDocument('Test');
}

function connectorAt(id: string, refdes: string, x: number, y: number, cavityIds: string[]): Connector {
  return {
    id, type: 'connector', refdes,
    cavities: cavityIds.map((cid) => ({ id: cid, designation: cid, custom: {} })),
    layoutPosition: { x, y },
    custom: {},
  } satisfies Connector;
}

function wireBetween(id: string, refdes: string, from: [string, string], to: [string, string], partId?: string): Wire {
  return {
    id, refdes, color: 'Red',
    source: { kind: 'cavity', componentId: from[0], cavityId: from[1] },
    target: { kind: 'cavity', componentId: to[0], cavityId: to[1] },
    ...(partId ? { partId } : {}),
    custom: {},
  } satisfies Wire;
}

function wirePart(id: string, gaugeMm2: number, outerDiameter: number): WirePart {
  return { id, kind: 'wire', gauge: { value: gaugeMm2, unit: 'mm2' }, outerDiameter, custom: {} } satisfies WirePart;
}

/** A two-connector document joined by `bundleCount` parallel bundles and one
 * wire per bundle, each wire on its own gauge/OD part. */
function harness(bundleCount: number, gaugeMm2 = 0.5, outerDiameter = 2) {
  const d = doc();
  d.components['c1'] = connectorAt('c1', 'C1', 0, 0, ['a']);
  d.components['c2'] = connectorAt('c2', 'C2', 100, 0, ['b']);
  for (let i = 0; i < bundleCount; i++) {
    const partId = `p${i}`;
    d.parts[partId] = wirePart(partId, gaugeMm2, outerDiameter);
    d.wires[`w${i}`] = wireBetween(`w${i}`, `W${i}`, ['c1', 'a'], ['c2', 'b'], partId);
    d.bundles[`b${i}`] = { id: `b${i}`, refdes: `BND${i + 1}`, sourceId: 'c1', targetId: 'c2', custom: {} } satisfies Bundle;
  }
  return d;
}

/** Straight px-space polyline for bundle i (the canvas would resolve this). */
function straightPath(bundleId: string, y = 0) {
  return { bundleId, points: [{ x: 0, y }, { x: 400, y }] };
}

describe('emitBundleGeometry', () => {
  it('emits one SceneBundle per drawable bundle with derived membership', () => {
    const d = harness(1);
    const derived = computeDerivedModel(d);
    const scene = emitBundleGeometry(d, derived, [straightPath('b0')], 4);

    expect(scene).toHaveLength(1);
    const sb = scene[0]!;
    expect(sb.id).toBe('b0');
    expect(sb.refdes).toBe('BND1');
    expect(sb.wireCount).toBe(1);
    expect(sb.wireIds).toEqual(['w0']);
    expect(sb.wireRefdes).toEqual(['W0']);
  });

  it('defaults the outline color and honours an authored override', () => {
    const d = harness(2);
    d.bundles['b1']!.color = '#ff0000';
    const derived = computeDerivedModel(d);
    const scene = emitBundleGeometry(d, derived, [straightPath('b0'), straightPath('b1', 20)], 4);

    expect(scene.find((s) => s.id === 'b0')!.color).toBe(DEFAULT_BUNDLE_COLOR);
    expect(scene.find((s) => s.id === 'b1')!.color).toBe('#ff0000');
  });

  it('maps the derived diameter to the outline width (the diameter indicator)', () => {
    const d = harness(1, 0.5, 2); // one 2 mm-OD wire → D = 1.15·√(2²) = 2.3 mm
    const derived = computeDerivedModel(d);
    const sb = emitBundleGeometry(d, derived, [straightPath('b0')], 4)[0]!;

    expect(sb.diameterMm).toBeCloseTo(2.3, 5);
    expect(sb.outlineWidthPx).toBeCloseTo(2.3 * 4, 5);
    expect(sb.labelText).toContain('Ø 2.3 mm');
  });

  it('omits the diameter from the label when nothing has a known outer diameter', () => {
    const d = harness(1);
    delete (d.parts['p0'] as WirePart).outerDiameter; // derived diameter → 0
    const derived = computeDerivedModel(d);
    const sb = emitBundleGeometry(d, derived, [straightPath('b0')], 4)[0]!;

    expect(sb.diameterMm).toBe(0);
    expect(sb.outlineWidthPx).toBe(6); // the minimum floor
    expect(sb.labelText).not.toContain('Ø');
  });

  it('builds a gauge range label across mixed gauges in the document unit', () => {
    const d = doc();
    d.settings.gaugeUnit = 'mm2';
    d.components['c1'] = connectorAt('c1', 'C1', 0, 0, ['a', 'b']);
    d.components['c2'] = connectorAt('c2', 'C2', 100, 0, ['a', 'b']);
    d.parts['small'] = wirePart('small', 0.5, 2);
    d.parts['large'] = wirePart('large', 2.5, 3);
    d.wires['w1'] = wireBetween('w1', 'W1', ['c1', 'a'], ['c2', 'a'], 'small');
    d.wires['w2'] = wireBetween('w2', 'W2', ['c1', 'b'], ['c2', 'b'], 'large');
    d.bundles['b0'] = { id: 'b0', refdes: 'BND1', sourceId: 'c1', targetId: 'c2', custom: {} };
    const derived = computeDerivedModel(d);

    const sb = emitBundleGeometry(d, derived, [straightPath('b0')], 4)[0]!;
    expect(sb.gaugeLabel).toBe('0.5–2.5 mm²');
    expect(sb.labelText).toContain('2 wires');
    expect(sb.labelText).toContain('0.5–2.5 mm²');
  });

  it('collapses a single gauge to one value, not a degenerate range', () => {
    const d = harness(1, 0.5, 2);
    const derived = computeDerivedModel(d);
    const sb = emitBundleGeometry(d, derived, [straightPath('b0')], 4)[0]!;
    expect(sb.gaugeLabel).toBe('0.5 mm²');
  });

  it('places the label at the polyline arc-length midpoint', () => {
    const d = harness(1);
    const derived = computeDerivedModel(d);
    const sb = emitBundleGeometry(d, derived, [{ bundleId: 'b0', points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] }], 4)[0]!;
    expect(sb.labelPosition).toEqual({ x: 100, y: 0 });
  });

  it('flags bundles whose drawn paths cross (conflict indicator)', () => {
    const d = harness(2);
    const derived = computeDerivedModel(d);
    const scene = emitBundleGeometry(
      d, derived,
      [
        { bundleId: 'b0', points: [{ x: 0, y: 0 }, { x: 400, y: 0 }] },
        { bundleId: 'b1', points: [{ x: 200, y: -100 }, { x: 200, y: 100 }] },
      ],
      4,
    );
    expect(scene.find((s) => s.id === 'b0')!.hasCrossing).toBe(true);
    expect(scene.find((s) => s.id === 'b1')!.hasCrossing).toBe(true);
    expect(scene.find((s) => s.id === 'b0')!.crossings).toEqual([{ x: 200, y: 0 }]);
  });

  it('does not flag parallel bundles that never cross', () => {
    const d = harness(2);
    const derived = computeDerivedModel(d);
    const scene = emitBundleGeometry(
      d, derived,
      [straightPath('b0', 0), straightPath('b1', 30)],
      4,
    );
    expect(scene.every((s) => !s.hasCrossing)).toBe(true);
  });

  it('skips a bundle with a degenerate path or a missing bundle record', () => {
    const d = harness(1);
    const derived = computeDerivedModel(d);
    const scene = emitBundleGeometry(
      d, derived,
      [
        { bundleId: 'b0', points: [{ x: 0, y: 0 }] },        // one point → not drawable
        { bundleId: 'ghost', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }, // no such bundle
      ],
      4,
    );
    expect(scene).toHaveLength(0);
  });

  it('includes the authored label in the label text when present', () => {
    const d = harness(1);
    d.bundles['b0']!.label = 'Main loom';
    const derived = computeDerivedModel(d);
    const sb = emitBundleGeometry(d, derived, [straightPath('b0')], 4)[0]!;
    expect(sb.labelText).toContain('BND1 “Main loom”');
  });
});

describe('bundleGaugeLabel', () => {
  it('returns undefined when no member wire has a resolvable gauge', () => {
    const d = harness(1);
    // Drop the part reference — the wire then has no gauge anywhere.
    delete d.wires['w0']!.partId;
    expect(bundleGaugeLabel(d, ['w0'])).toBeUndefined();
  });

  it('prefers the wire instance gauge over its part gauge', () => {
    const d = harness(1, 0.5, 2);
    d.wires['w0']!.gauge = { value: 1.5, unit: 'mm2' };
    expect(bundleGaugeLabel(d, ['w0'])).toBe('1.5 mm²');
  });

  it('formats AWG ranges in the document unit, ascending by cross-section', () => {
    const d = doc();
    d.settings.gaugeUnit = 'awg';
    d.components['c1'] = connectorAt('c1', 'C1', 0, 0, ['a', 'b']);
    d.components['c2'] = connectorAt('c2', 'C2', 100, 0, ['a', 'b']);
    // Wire parts authored in AWG: 20 AWG (≈0.52 mm²) and 22 AWG (≈0.33 mm²).
    d.parts['g20'] = { id: 'g20', kind: 'wire', gauge: { value: 20, unit: 'awg' }, custom: {} } satisfies WirePart;
    d.parts['g22'] = { id: 'g22', kind: 'wire', gauge: { value: 22, unit: 'awg' }, custom: {} } satisfies WirePart;
    d.wires['w1'] = wireBetween('w1', 'W1', ['c1', 'a'], ['c2', 'a'], 'g20');
    d.wires['w2'] = wireBetween('w2', 'W2', ['c1', 'b'], ['c2', 'b'], 'g22');

    // Ascending by cross-section: 22 AWG (smaller) → 20 AWG (larger).
    expect(bundleGaugeLabel(d, ['w1', 'w2'])).toBe('22–20 AWG');
  });

  it('renders 1/0…4/0 sizes the way the standard publishes them', () => {
    const d = doc();
    d.settings.gaugeUnit = 'awg';
    d.wires['w1'] = { ...wireBetween('w1', 'W1', ['c1', 'a'], ['c2', 'a']), gauge: { value: -1, unit: 'awg' } };
    expect(bundleGaugeLabel(d, ['w1'])).toBe('2/0 AWG');
  });
});
