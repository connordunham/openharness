import { describe, it, expect } from 'vitest';
import { pointRect } from '@openharness/render';
import { layoutContentRects, layoutBundleRects } from '../layoutBounds.js';

/**
 * B4 regression: fit-to-view / fit-to-selection on the Layout canvas. These
 * helpers turn the pane's drawn geometry — placed component centers and
 * bundle routing nodes, all in px space — into the rect list `fitView`
 * consumes. On `main` the module did not exist at all, which is exactly the
 * gap these tests pin closed.
 */
describe('layoutContentRects', () => {
  it('maps component centers and bundle waypoints to point rects', () => {
    const rects = layoutContentRects(
      [{ x: 100, y: 200 }, { x: 500, y: 240 }],
      [{ x: 300, y: 40 }],
    );
    expect(rects).toEqual([
      pointRect({ x: 100, y: 200 }),
      pointRect({ x: 500, y: 240 }),
      pointRect({ x: 300, y: 40 }),
    ]);
  });

  it('is empty for an empty layout', () => {
    expect(layoutContentRects([], [])).toEqual([]);
  });
});

describe('layoutBundleRects', () => {
  it('covers the full drawn path: source, routing nodes in order, target', () => {
    const rects = layoutBundleRects({ x: 0, y: 0 }, { x: 800, y: 600 }, [{ x: 400, y: 100 }, { x: 600, y: 500 }]);
    expect(rects).toEqual([
      pointRect({ x: 0, y: 0 }),
      pointRect({ x: 400, y: 100 }),
      pointRect({ x: 600, y: 500 }),
      pointRect({ x: 800, y: 600 }),
    ]);
  });

  it('a bundle with no routing nodes is just its two endpoints', () => {
    expect(layoutBundleRects({ x: 10, y: 20 }, { x: 30, y: 40 }, [])).toEqual([
      pointRect({ x: 10, y: 20 }),
      pointRect({ x: 30, y: 40 }),
    ]);
  });
});
