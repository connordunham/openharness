import { describe, it, expect } from 'vitest';
import { classifyWheelInput } from '../canvasPan.js';

/**
 * B3 regression: before the fix there was no classification at all —
 * `useCanvasPan` panned on every wheel event while each canvas zoomed
 * independently on ctrl/deltaZ events, so a mouse wheel panned (contract
 * says it zooms) and a trackpad pinch zoomed and panned at once. These
 * tests pin the decision table the single wheel listener now applies.
 */
describe('classifyWheelInput', () => {
  it('pinch (ctrl+wheel, as every browser synthesises it) zooms', () => {
    expect(classifyWheelInput({ ctrlKey: true, deltaZ: 0 })).toBe('zoom');
  });

  it('ctrl wins even with a deltaZ present, so a pinch never pans too', () => {
    expect(classifyWheelInput({ ctrlKey: true, deltaZ: 1 })).toBe('zoom');
  });

  it('trackpad wheel (deltaZ without ctrl) pans', () => {
    expect(classifyWheelInput({ ctrlKey: false, deltaZ: 1 })).toBe('pan');
    expect(classifyWheelInput({ ctrlKey: false, deltaZ: -0.5 })).toBe('pan');
  });

  it('plain wheel (mouse) zooms', () => {
    expect(classifyWheelInput({ ctrlKey: false, deltaZ: 0 })).toBe('zoom');
  });

  it('deltaZ below the noise threshold is treated as a mouse wheel', () => {
    expect(classifyWheelInput({ ctrlKey: false, deltaZ: 0.001 })).toBe('zoom');
  });
});
