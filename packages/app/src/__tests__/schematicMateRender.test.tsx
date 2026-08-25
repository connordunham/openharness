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

describe('SchematicCanvas — rotated connector rendering', () => {
  it('positions row labels and divider line appropriately for 90° rotation', () => {
    const d = doc();
    d.components['c1']!.rotation = 90;
    const html = render(new HarnessStore(d));

    // For 90° rotation, header divider line is vertical at x = node.x + node.width - HEADER_HEIGHT
    // Unrotated height = 24 + 2 * 22 = 68. Width when transposed = 68. Height when transposed = BOX_WIDTH = 160.
    // Line at x = 0 + 68 - 24 = 44.
    expect(html).toContain('x1="44" y1="0" x2="44" y2="160"');

    // Row labels are rotated 90° so they read vertically in each cavity column without overlapping
    expect(html).toContain('transform="rotate(90)"');
    expect(html).toContain('x="8" y="-37"');
    expect(html).toContain('x="8" y="-15"');
  });

  it('positions divider line for 180° and 270° rotations', () => {
    const d180 = doc();
    d180.components['c1']!.rotation = 180;
    const html180 = render(new HarnessStore(d180));
    // 180° divider line is at y = node.y + node.height - HEADER_HEIGHT = 0 + 68 - 24 = 44
    expect(html180).toContain('x1="0" y1="44" x2="160" y2="44"');

    const d270 = doc();
    d270.components['c1']!.rotation = 270;
    const html270 = render(new HarnessStore(d270));
    // 270° divider line is at x = node.x + HEADER_HEIGHT = 24
    expect(html270).toContain('x1="24" y1="0" x2="24" y2="160"');
    // Row labels are rotated -90° for 270° rotation
    expect(html270).toContain('transform="rotate(-90)"');
    expect(html270).toContain('x="-152" y="31"');
    expect(html270).toContain('x="-152" y="53"');
  });
});
