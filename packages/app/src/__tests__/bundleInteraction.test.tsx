/**
 * Phase 2a — render-path smoke tests for bundle visualization & interaction
 * on the Layout canvas. The repo has no DOM test environment (see
 * schematicMateRender.test.tsx's header), so this proves the component
 * actually consumes the bundle scene data without crashing and puts the
 * outline/label/diameter/conflict markup on screen — the class of bug
 * AGENTS.md warns about — plus the inspector's extraction UI. The pointer
 * gestures themselves are covered by useBundleRouting.test.ts (pure logic).
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createEmptyDocument, HarnessStore, DEFAULT_BUNDLE_COLOR,
  type Connector, type Wire, type Bundle, type WirePart, type HarnessDocument, type Splice,
} from '@openharness/core';
import { LayoutCanvas, BundleInspector } from '../LayoutCanvas.js';

function connectorAt(id: string, refdes: string, x: number, y: number): Connector {
  return {
    id, type: 'connector', refdes,
    cavities: [{ id: 'a', designation: '1', custom: {} }],
    layoutPosition: { x, y },
    custom: {},
  } satisfies Connector;
}

function wireBetween(id: string, refdes: string, from: string, to: string, partId?: string): Wire {
  return {
    id, refdes, color: 'Red',
    source: { kind: 'cavity', componentId: from, cavityId: 'a' },
    target: { kind: 'cavity', componentId: to, cavityId: 'a' },
    ...(partId ? { partId } : {}),
    custom: {},
  } satisfies Wire;
}

/** Two connectors joined by one bundle carrying two gauged wires. */
function vizDoc(): HarnessDocument {
  const d = createEmptyDocument('Test');
  d.components['c1'] = connectorAt('c1', 'C1', 0, 0);
  d.components['c2'] = connectorAt('c2', 'C2', 120, 0);
  d.parts['p1'] = { id: 'p1', kind: 'wire', gauge: { value: 0.5, unit: 'mm2' }, outerDiameter: 2, custom: {} } satisfies WirePart;
  d.parts['p2'] = { id: 'p2', kind: 'wire', gauge: { value: 1.5, unit: 'mm2' }, outerDiameter: 2.6, custom: {} } satisfies WirePart;
  d.wires['w1'] = wireBetween('w1', 'W1', 'c1', 'c2', 'p1');
  d.wires['w2'] = wireBetween('w2', 'W2', 'c1', 'c2', 'p2');
  d.bundles['b1'] = { id: 'b1', refdes: 'BND1', sourceId: 'c1', targetId: 'c2', custom: {} } satisfies Bundle;
  return d;
}

/** Four connectors, two bundles whose drawn paths cross in the middle. */
function crossingDoc(): HarnessDocument {
  const d = createEmptyDocument('Test');
  d.components['c1'] = connectorAt('c1', 'C1', 0, 0);
  d.components['c2'] = connectorAt('c2', 'C2', 100, 100);
  d.components['c3'] = connectorAt('c3', 'C3', 0, 100);
  d.components['c4'] = connectorAt('c4', 'C4', 100, 0);
  d.wires['w1'] = wireBetween('w1', 'W1', 'c1', 'c2');
  d.wires['w2'] = wireBetween('w2', 'W2', 'c3', 'c4');
  d.bundles['ba'] = { id: 'ba', refdes: 'BND1', sourceId: 'c1', targetId: 'c2', custom: {} } satisfies Bundle;
  d.bundles['bb'] = { id: 'bb', refdes: 'BND2', sourceId: 'c3', targetId: 'c4', custom: {} } satisfies Bundle;
  return d;
}

function renderCanvas(doc: HarnessDocument): string {
  return renderToStaticMarkup(createElement(LayoutCanvas, { store: new HarnessStore(doc) }));
}

describe('LayoutCanvas — bundle visualization (Phase 2a)', () => {
  it('draws the bundle outline in the default bundle color', () => {
    const html = renderCanvas(vizDoc());
    expect(html).toContain(`stroke="${DEFAULT_BUNDLE_COLOR}"`);
  });

  it('draws the bundle label with wire count, gauge range and diameter', () => {
    const html = renderCanvas(vizDoc());
    expect(html).toContain('BND1 · 2 wires · 0.5–1.5 mm² · Ø');
  });

  it('uses the authored bundle color when one is set', () => {
    const d = vizDoc();
    d.bundles['b1']!.color = '#123456';
    const html = renderCanvas(d);
    expect(html).toContain('stroke="#123456"');
  });

  it('the bundle hit target offers the move cursor (drag-to-move gesture)', () => {
    const html = renderCanvas(vizDoc());
    expect(html).toContain('cursor:move');
  });

  it('flags crossing bundle paths with the conflict indicator', () => {
    const html = renderCanvas(crossingDoc());
    // The red dashed conflict outline…
    expect(html).toContain('stroke-dasharray="7 5"');
    // …and a marker at the crossing point itself.
    expect(html).toContain("crosses another bundle&#x27;s path here");
  });

  it('parallel bundles render without any conflict indicator', () => {
    const html = renderCanvas(vizDoc());
    expect(html).not.toContain('stroke-dasharray="7 5"');
    expect(html).not.toContain('crosses another bundle');
  });

  it('still renders a document with no bundles at all', () => {
    const d = createEmptyDocument('Test');
    d.components['c1'] = connectorAt('c1', 'C1', 0, 0);
    expect(() => renderCanvas(d)).not.toThrow();
  });
});

describe('LayoutCanvas — connector rotation feedback (Phase 2b)', () => {
  function rotationDoc(rotation?: number): HarnessDocument {
    const d = createEmptyDocument('Test');
    d.components['c1'] = { ...connectorAt('c1', 'C1', 40, 40), ...(rotation !== undefined ? { rotation } : {}) };
    d.components['c2'] = connectorAt('c2', 'C2', 160, 40);
    d.wires['w1'] = wireBetween('w1', 'W1', 'c1', 'c2');
    d.bundles['b1'] = { id: 'b1', refdes: 'BND1', sourceId: 'c1', targetId: 'c2', custom: {} } satisfies Bundle;
    return d;
  }

  it('labels a stored rotation on the connector', () => {
    const html = renderCanvas(rotationDoc(90));
    expect(html).toContain('>90°<');
  });

  it('an unrotated connector shows no angle label (unset reads as 0, and 0 is not clutter)', () => {
    const html = renderCanvas(rotationDoc());
    expect(html).not.toContain('°<');
  });

  it('a full circle (360°) reads as unrotated again — no label', () => {
    const html = renderCanvas(rotationDoc(360));
    expect(html).not.toContain('°<');
  });

  it('the angle label is connector-only — a stored rotation on another component type draws nothing', () => {
    // Rotation is a connector feature (rotateConnector refuses every other
    // type), but a hand-authored document can still carry rotation on e.g. a
    // splice; the label must not leak onto it. The selected-non-connector
    // "0°" half of this gate needs a live pointer to exercise (selection is
    // component state) — that is running-app check territory.
    const d = rotationDoc(90);
    d.components['s1'] = {
      id: 's1', type: 'splice', refdes: 'S1',
      layoutPosition: { x: 100, y: 120 }, rotation: 270, custom: {},
    } satisfies Splice;
    const html = renderCanvas(d);
    expect(html).toContain('>90°<');     // the connector keeps its label…
    expect(html).not.toContain('270°');  // …the rotated splice gets none
  });

  it('rotation turns the glyph — the drawn body polygon differs from the unrotated one', () => {
    const plain = renderCanvas(rotationDoc());
    const rotated = renderCanvas(rotationDoc(180));
    const bodyPoints = (html: string) => html.match(/<polygon points="([^"]+)"/)?.[1];
    expect(bodyPoints(plain)).toBeTruthy();
    expect(bodyPoints(rotated)).toBeTruthy();
    expect(bodyPoints(rotated)).not.toBe(bodyPoints(plain));
  });

  it('the canvas container is focusable so the pane can receive the R key once clicked', () => {
    const html = renderCanvas(rotationDoc());
    expect(html).toContain('tabindex="-1"');
  });
});

describe('BundleInspector — bundle properties & extraction UI (Phase 2a)', () => {
  const bundle = { id: 'b1', refdes: 'BND1' };
  const noop = () => undefined;

  function renderInspector(props: Partial<Parameters<typeof BundleInspector>[0]> = {}): string {
    return renderToStaticMarkup(createElement(BundleInspector, {
      bundle,
      wires: [{ id: 'w1', refdes: 'W1' }, { id: 'w2', refdes: 'W2' }],
      canExtractWire: () => true,
      onSetLength: noop,
      onSetSegmentLength: noop,
      onSetColor: noop,
      onSetLabel: noop,
      onExtractWire: noop,
      onDelete: noop,
      onClearRoutingNodes: noop,
      onClose: noop,
      ...props,
    } as Parameters<typeof BundleInspector>[0]));
  }

  it('lists member wires with an Extract action each', () => {
    const html = renderInspector();
    expect(html).toContain('W1');
    expect(html).toContain('W2');
    expect(html.match(/Extract/g)?.length ?? 0).toBe(2);
  });

  it('disables extraction exactly when the wire has no route around the bundle', () => {
    const html = renderInspector({ canExtractWire: (id: string) => id === 'w1' });
    // One enabled, one disabled button.
    expect(html).toContain('disabled');
    expect(html).toContain('has no route that avoids this bundle');
  });

  it('shows the color picker on the default color and a reset once custom', () => {
    const defaultHtml = renderInspector();
    expect(defaultHtml).toContain(`value="${DEFAULT_BUNDLE_COLOR}"`);
    expect(defaultHtml).not.toContain('>reset<');
    const customHtml = renderInspector({ bundle: { ...bundle, color: '#ff0000' } });
    expect(customHtml).toContain('value="#ff0000"');
    expect(customHtml).toContain('>reset<');
  });

  it('shows derived bundle facts when scene data is provided', () => {
    const html = renderInspector({
      scene: {
        id: 'b1', refdes: 'BND1', color: DEFAULT_BUNDLE_COLOR,
        wireCount: 2, wireIds: ['w1', 'w2'], wireRefdes: ['W1', 'W2'],
        gaugeLabel: '0.5–1.5 mm²', diameterMm: 3.4, outlineWidthPx: 13.6,
        polyline: [], labelPosition: { x: 0, y: 0 }, labelText: 'BND1', crossings: [], hasCrossing: false,
      },
    });
    expect(html).toContain('0.5–1.5 mm²');
    expect(html).toContain('Ø 3.4 mm');
  });
});
