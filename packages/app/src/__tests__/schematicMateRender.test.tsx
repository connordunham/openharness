/**
 * T02 B5 — render-path smoke test for mates on the Schematic canvas.
 * Unit tests of the scene builder prove the geometry is emitted; this proves
 * the component actually consumes it without crashing and puts the mate on
 * screen (the class of bug AGENTS.md warns about: typechecked, tested, and
 * still broken in the running app). The repo has no DOM test environment, so
 * this renders with react-dom/server — effects don't run there, which is
 * fine: everything mate-visible happens during render.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEmptyDocument, HarnessStore, type Connector, type HarnessDocument } from '@openharness/core';
import { SchematicCanvas } from '../SchematicCanvas.js';

function doc(): HarnessDocument {
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
  return d;
}

function render(store: HarnessStore): string {
  return renderToStaticMarkup(createElement(SchematicCanvas, { store }));
}

describe('SchematicCanvas — mate rendering', () => {
  it('draws a mate as a dashed, labelled line with a hit target', () => {
    const d = doc();
    d.mates = { m1: { id: 'm1', sourceId: 'c1', targetId: 'c2', custom: {} } };
    const html = render(new HarnessStore(d));

    // The dashed visual + its label.
    expect(html).toContain('stroke-dasharray="6 4"');
    expect(html).toContain('>mate<');
    // The tooltip names both ends and the pairing mode in effect.
    expect(html).toContain('C1 ↔ C2 — mate (positional pairing, the default)');
    // The fat transparent hit target (same stroke-line the click handlers sit on).
    expect(html).toContain('stroke="transparent" stroke-width="12"');
  });

  it('labels a mapped mate differently from a positional one', () => {
    const d = doc();
    d.mates = {
      m1: {
        id: 'm1', sourceId: 'c1', targetId: 'c2',
        cavityMap: [{ sourceCavityId: 'a1', targetCavityId: 'b2' }],
        custom: {},
      },
    };
    const html = render(new HarnessStore(d));
    expect(html).toContain('>mate · mapped<');
    expect(html).toContain('C1 ↔ C2 — mate (explicit cavity map)');
  });

  it('renders a document with no mates record at all (optional field)', () => {
    // doc() has no `mates` key — absent must mean empty, not crash.
    expect(() => render(new HarnessStore(doc()))).not.toThrow();
    expect(render(new HarnessStore(doc()))).not.toContain('>mate<');
  });
});
