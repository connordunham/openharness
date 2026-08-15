import type { HarnessDocument } from './types.js';

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
