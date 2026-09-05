/**
 * Render-path tests for the routing UI added to both canvases.
 *
 * The repo has no DOM test environment (see schematicMateRender.test.tsx's
 * header), so these render to static markup and assert on what actually
 * reaches the screen — the class of bug AGENTS.md warns about, where a change
 * typechecks and passes every unit test while putting nothing usable in front
 * of the user. The gesture logic itself is covered by connectGesture.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createEmptyDocument, HarnessStore,
  type Connector, type Wire, type Bundle, type HarnessDocument, type BranchPoint,
} from '@openharness/core';
import { LayoutCanvas } from '../LayoutCanvas.js';
import { SchematicCanvas } from '../SchematicCanvas.js';

function connectorAt(id: string, refdes: string, x: number, y: number, placed = true): Connector {
  return {
    id, type: 'connector', refdes,
    cavities: [{ id: 'a', designation: '1', custom: {} }],
    schematicPosition: { x, y },
    ...(placed ? { layoutPosition: { x, y } } : {}),
    custom: {},
  } satisfies Connector;
}

function wireBetween(id: string, refdes: string, from: string, to: string): Wire {
  return {
    id, refdes, color: 'Red',
    source: { kind: 'cavity', componentId: from, cavityId: 'a' },
    target: { kind: 'cavity', componentId: to, cavityId: 'a' },
    custom: {},
  } satisfies Wire;
}

/** Two placed connectors, one wire, and a bundle joining them — everything
 * routes, so the pane should report a clean bill of health. */
function routedDoc(): HarnessDocument {
  const d = createEmptyDocument('Test');
  d.components['c1'] = connectorAt('c1', 'C1', 0, 0);
  d.components['c2'] = connectorAt('c2', 'C2', 200, 0);
  d.wires['w1'] = wireBetween('w1', 'W1', 'c1', 'c2');
  d.bundles['b1'] = { id: 'b1', refdes: 'BND1', sourceId: 'c1', targetId: 'c2', custom: {} } satisfies Bundle;
  return d;
}

/** Same two connectors and wire, but no bundle — so the wire has no path
 * through the layout graph and the pane must say so. */
function unroutedDoc(): HarnessDocument {
  const d = createEmptyDocument('Test');
  d.components['c1'] = connectorAt('c1', 'C1', 0, 0);
  d.components['c2'] = connectorAt('c2', 'C2', 200, 0);
  d.wires['w1'] = wireBetween('w1', 'W1', 'c1', 'c2');
  return d;
}

function renderLayout(doc: HarnessDocument): string {
  return renderToStaticMarkup(createElement(LayoutCanvas, { store: new HarnessStore(doc) }));
}

describe('Layout pane — tool switcher', () => {
  it('offers both of the pane’s verbs as a radiogroup, with Select active by default', () => {
    const html = renderLayout(routedDoc());
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('>Select<');
    expect(html).toContain('>Route<');
    // Exactly one is checked, and it is Select.
    expect(html.match(/aria-checked="true"/g) ?? []).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true"[^>]*>Select</);
  });
});

describe('Layout pane — route health', () => {
  it('reports every wire routed when the bundle graph connects them', () => {
    const html = renderLayout(routedDoc());
    expect(html).toContain('1 routed');
    expect(html).not.toContain('unrouted');
    expect(html).not.toContain('Needs a route');
  });

  it('surfaces an unroutable wire in the toolbar chip and the sidebar', () => {
    const html = renderLayout(unroutedDoc());
    // The toolbar chip is the "you are in a bad state" signal.
    expect(html).toContain('1 unrouted / 1');
    // ...and the sidebar names the wire under its own heading.
    expect(html).toContain('Needs a route (1)');
    expect(html).toContain('W1');
  });

  it('counts a wire whose component is unplaced as needing a route', () => {
    const d = createEmptyDocument('Test');
    d.components['c1'] = connectorAt('c1', 'C1', 0, 0);
    d.components['c2'] = connectorAt('c2', 'C2', 200, 0, /* placed */ false);
    d.wires['w1'] = wireBetween('w1', 'W1', 'c1', 'c2');
    expect(renderLayout(d)).toContain('Needs a route (1)');
  });

  it('shows the routing summary rather than the old flat length list', () => {
    const html = renderLayout(routedDoc());
    expect(html).toContain('Routing');
    expect(html).toContain('Measured');
    expect(html).toContain('Total length');
    expect(html).not.toContain('Wire lengths');
  });

  it('says nothing about routing when there are no wires to route', () => {
    const d = createEmptyDocument('Test');
    d.components['c1'] = connectorAt('c1', 'C1', 0, 0);
    const html = renderLayout(d);
    expect(html).toContain('No wires yet.');
    expect(html).not.toContain('routed');
  });
});

describe('Layout pane — bundle source handles', () => {
  it('gives every placed node a drag-to-bundle handle explaining both idioms', () => {
    const html = renderLayout(routedDoc());
    expect(html).toContain('Drag to another component to bundle them');
    expect(html).toContain('click here, then click the target');
  });

  it('draws no handle on a branch point, which has no connector glyph', () => {
    const d = routedDoc();
    d.components['bp'] = {
      id: 'bp', type: 'branchPoint', refdes: 'BP1',
      layoutPosition: { x: 100, y: 50 }, custom: {},
    } satisfies BranchPoint;
    // One handle each for C1 and C2, none for the branch point.
    const html = renderLayout(d);
    expect(html.match(/Drag to another component to bundle them/g) ?? []).toHaveLength(2);
  });
});

describe('Schematic pane — wire drawing', () => {
  it('advertises drag-to-connect in the idle hint', () => {
    const html = renderToStaticMarkup(
      createElement(SchematicCanvas, { store: new HarnessStore(routedDoc()) }),
    );
    expect(html).toContain('Drag port to port to wire');
  });

  it('still renders every port as a crosshair target', () => {
    const html = renderToStaticMarkup(
      createElement(SchematicCanvas, { store: new HarnessStore(routedDoc()) }),
    );
    expect(html).toContain('crosshair');
  });
});
