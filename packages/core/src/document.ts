import type { HarnessDocument } from './types.js';

/**
 * Default schematic port-exit stub length, in schematic px. Lives here (not
 * in @openharness/render) because it is a *document* default — the value a
 * new document's `settings.schematicExitStub` starts at — and core cannot
 * depend on render. render/routing.ts keeps its own identical fallback for
 * the case where a caller passes no options at all; the two are asserted
 * equal by a test rather than left to drift.
 */
export const DEFAULT_EXIT_STUB = 14;

/** A fresh, empty document with sane defaults (spec §4.1). */
export function createEmptyDocument(name = 'Untitled Harness'): HarnessDocument {
  const now = new Date().toISOString();
  return {
    formatVersion: 1,
    meta: {
      id: cryptoRandomId(),
      name,
      createdAt: now,
      modifiedAt: now,
      revision: 0,
      readOnly: false,
      custom: {},
    },
    settings: {
      lengthUnit: 'mm',
      gaugeUnit: 'mm2',
      currency: 'USD',
      formboard: { enabled: false, scale: 1 },
      // Explicit defaults for the settings added alongside the twisted-pair
      // symbol style, parasitics and shield work. Each is optional on the
      // type (so documents written before they existed still load) but a
      // freshly-created document states them, so the Settings UI shows a
      // concrete value rather than an empty field standing in for an
      // implicit default.
      twistedPairStyle: 'ieee315',
      showParasitics: false,
      schematicExitStub: DEFAULT_EXIT_STUB,
      refdesPrefixes: {
        connector: 'C',
        splice: 'S',
        terminal: 'T',
        branchPoint: 'B',
        resistor: 'R',
        diode: 'D',
        cable: 'CB',
        generic: 'G',
      },
    },
    components: {},
    wires: {},
    bundles: {},
    groups: {},
    notes: {},
    wireGroups: {},
    parts: {},
  };
}

function cryptoRandomId(): string {
  // Lazily imported to keep this module trivially testable without pulling
  // in the nanoid dependency graph for something this small.
  return Math.random().toString(36).slice(2, 12);
}
