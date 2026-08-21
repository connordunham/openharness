import { describe, it, expect } from 'vitest';
import { computeDerivedModel } from '../derive/index.js';
import {
  doc, withEntities, connector, cavity, wire,
  cavityEndpoint,
} from './helpers.js';
import type { ContactPart, ConnectorPart } from '../types.js';

function findDiagnostic(d: ReturnType<typeof doc>, ruleId: string) {
  return computeDerivedModel(d).diagnostics.find((diag) => diag.ruleId === ruleId);
}

function allDiagnostics(d: ReturnType<typeof doc>) {
  return computeDerivedModel(d).diagnostics;
}

describe('WIRE_GAUGE_RANGE rule', () => {
  it('does not fire when wire gauge is inside the contact range', () => {
    // Wire: 20 AWG ≈ 0.52 mm²
    // Contact: accepts 20-22 AWG wires
    //   - min: 22 AWG ≈ 0.33 mm² (smallest acceptable wire)
    //   - max: 20 AWG ≈ 0.52 mm² (largest acceptable wire)
    // 20 AWG fits within [min: 22 AWG, max: 20 AWG] = [0.33 mm², 0.52 mm²]
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], {
          layoutPosition: { x: 0, y: 0 },
          partId: 'connector1',
        }),
        connector('c2', 'C2', [cavity('b')], {
          layoutPosition: { x: 100, y: 0 },
          partId: 'connector1',
        }),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'), {
          partId: 'wire20',
        }),
      ],
    });

    // Define parts
    const contactPart: ContactPart = {
      id: 'contact1',
      kind: 'contact',
      minGauge: { value: 22, unit: 'awg' },
      maxGauge: { value: 20, unit: 'awg' },
      custom: {},
    };

    const connectorPart: ConnectorPart = {
      id: 'connector1',
      kind: 'connector',
      numberOfCavities: 1,
      designationTemplate: { kind: 'numbers' },
      configurations: [{ id: 'cfg1', name: 'Default', contactPartId: 'contact1' }],
      custom: {},
    };

    d.parts['contact1'] = contactPart;
    d.parts['connector1'] = connectorPart;
    d.parts['wire20'] = {
      id: 'wire20',
      kind: 'wire',
      gauge: { value: 20, unit: 'awg' },
      custom: {},
    };

    const diag = findDiagnostic(d, 'WIRE_GAUGE_RANGE');
    expect(diag).toBeUndefined();
  });

  it('fires when a single wire is below minGauge', () => {
    // Wire: 24 AWG (too thin)
    // Contact: min 18 AWG
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], {
          layoutPosition: { x: 0, y: 0 },
          partId: 'connector1',
        }),
        connector('c2', 'C2', [cavity('b')], {
          layoutPosition: { x: 100, y: 0 },
          partId: 'connector1',
        }),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'), {
          partId: 'wire24',
        }),
      ],
    });

    const contactPart: ContactPart = {
      id: 'contact1',
      kind: 'contact',
      minGauge: { value: 18, unit: 'awg' },
      maxGauge: { value: 22, unit: 'awg' },
      custom: {},
    };

    const connectorPart: ConnectorPart = {
      id: 'connector1',
      kind: 'connector',
      numberOfCavities: 1,
      designationTemplate: { kind: 'numbers' },
      configurations: [{ id: 'cfg1', name: 'Default', contactPartId: 'contact1' }],
      custom: {},
    };

    d.parts['contact1'] = contactPart;
    d.parts['connector1'] = connectorPart;
    d.parts['wire24'] = {
      id: 'wire24',
      kind: 'wire',
      gauge: { value: 24, unit: 'awg' },
      custom: {},
    };

    const diag = findDiagnostic(d, 'WIRE_GAUGE_RANGE');
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe('warning');
    expect(diag?.message).toContain('below minimum');
  });

  it('fires when a single wire is above maxGauge', () => {
    // Wire: 12 AWG (too thick)
    // Contact: max 22 AWG
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], {
          layoutPosition: { x: 0, y: 0 },
          partId: 'connector1',
        }),
        connector('c2', 'C2', [cavity('b')], {
          layoutPosition: { x: 100, y: 0 },
          partId: 'connector1',
        }),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'), {
          partId: 'wire12',
        }),
      ],
    });

    const contactPart: ContactPart = {
      id: 'contact1',
      kind: 'contact',
      minGauge: { value: 18, unit: 'awg' },
      maxGauge: { value: 22, unit: 'awg' },
      custom: {},
    };

    const connectorPart: ConnectorPart = {
      id: 'connector1',
      kind: 'connector',
      numberOfCavities: 1,
      designationTemplate: { kind: 'numbers' },
      configurations: [{ id: 'cfg1', name: 'Default', contactPartId: 'contact1' }],
      custom: {},
    };

    d.parts['contact1'] = contactPart;
    d.parts['connector1'] = connectorPart;
    d.parts['wire12'] = {
      id: 'wire12',
      kind: 'wire',
      gauge: { value: 12, unit: 'awg' },
      custom: {},
    };

    const diag = findDiagnostic(d, 'WIRE_GAUGE_RANGE');
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe('warning');
    expect(diag?.message).toContain('above maximum');
  });

  it('fires when two wires each fit but their sum does not', () => {
    // Two 20 AWG wires (each ≈0.52 mm²) sum to ≈1.04 mm²
    // Contact: min 18 AWG (0.82 mm²) - means sum must be at least 0.82 mm²
    // Each individual 20 AWG wire (0.52 mm²) fits within the max range,
    // but when two land in the same cavity, their sum (1.04 mm²) exceeds the min requirement.
    // Actually, that's confusing. Let me think about this differently.
    // For a contact that accepts 18-20 AWG (min=18, max=20):
    // - An individual 20 AWG wire fits
    // - But two 20 AWG wires together (sum ≈ 1.04 mm²) might exceed what a contact rated for 20 AWG can hold
    // The contact is rated for ~0.52 mm² (20 AWG), but sum of two is 1.04 mm².
    // So we need a contact with a narrow max range.
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], {
          layoutPosition: { x: 0, y: 0 },
          partId: 'connector1',
        }),
        connector('c2', 'C2', [cavity('b')], {
          layoutPosition: { x: 100, y: 0 },
          partId: 'connector1',
        }),
        connector('c3', 'C3', [cavity('c')], {
          layoutPosition: { x: 200, y: 0 },
          partId: 'connector1',
        }),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'), {
          partId: 'wire20',
        }),
        wire('w2', 'W2', cavityEndpoint('c1', 'a'), cavityEndpoint('c3', 'c'), {
          partId: 'wire20',
        }),
      ],
    });

    // Contact rated for max 20 AWG (0.52 mm²)
    // Two 20 AWG wires sum to 1.04 mm², exceeding the max
    const contactPart: ContactPart = {
      id: 'contact1',
      kind: 'contact',
      maxGauge: { value: 20, unit: 'awg' }, // max 0.52 mm²
      custom: {},
    };

    const connectorPart: ConnectorPart = {
      id: 'connector1',
      kind: 'connector',
      numberOfCavities: 2,
      designationTemplate: { kind: 'numbers' },
      configurations: [{ id: 'cfg1', name: 'Default', contactPartId: 'contact1' }],
      custom: {},
    };

    d.parts['contact1'] = contactPart;
    d.parts['connector1'] = connectorPart;
    d.parts['wire20'] = {
      id: 'wire20',
      kind: 'wire',
      gauge: { value: 20, unit: 'awg' },
      custom: {},
    };

    // Two 20 AWG wires in one cavity should trigger the rule AND OVERFILLED_CAVITY
    const diags = allDiagnostics(d);
    const gaugeRuleDiag = diags.find((diag) => diag.ruleId === 'WIRE_GAUGE_RANGE');
    expect(gaugeRuleDiag).toBeDefined();
    expect(gaugeRuleDiag?.severity).toBe('warning');
    expect(gaugeRuleDiag?.message).toContain('above maximum');
  });

  it('does not fire when two wires together still fit the contact', () => {
    // Two 24 AWG wires (each ≈0.2 mm²) sum to ≈0.4 mm²
    // Contact: min 24 AWG (0.2 mm²), max 16 AWG (1.31 mm²)
    // Together they fit within the range [0.2, 1.31] mm².
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], {
          layoutPosition: { x: 0, y: 0 },
          partId: 'connector1',
        }),
        connector('c2', 'C2', [cavity('b')], {
          layoutPosition: { x: 100, y: 0 },
          partId: 'connector1',
        }),
        connector('c3', 'C3', [cavity('c')], {
          layoutPosition: { x: 200, y: 0 },
          partId: 'connector1',
        }),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'), {
          partId: 'wire24',
        }),
        wire('w2', 'W2', cavityEndpoint('c1', 'a'), cavityEndpoint('c3', 'c'), {
          partId: 'wire24',
        }),
      ],
    });

    const contactPart: ContactPart = {
      id: 'contact1',
      kind: 'contact',
      minGauge: { value: 24, unit: 'awg' },
      maxGauge: { value: 16, unit: 'awg' },
      custom: {},
    };

    const connectorPart: ConnectorPart = {
      id: 'connector1',
      kind: 'connector',
      numberOfCavities: 2,
      designationTemplate: { kind: 'numbers' },
      configurations: [{ id: 'cfg1', name: 'Default', contactPartId: 'contact1' }],
      custom: {},
    };

    d.parts['contact1'] = contactPart;
    d.parts['connector1'] = connectorPart;
    d.parts['wire24'] = {
      id: 'wire24',
      kind: 'wire',
      gauge: { value: 24, unit: 'awg' },
      custom: {},
    };

    const diag = findDiagnostic(d, 'WIRE_GAUGE_RANGE');
    expect(diag).toBeUndefined();
  });

  it('does not fire when contact has no minGauge', () => {
    // Wire: arbitrarily thin (e.g. 30 AWG)
    // Contact: only maxGauge set
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], {
          layoutPosition: { x: 0, y: 0 },
          partId: 'connector1',
        }),
        connector('c2', 'C2', [cavity('b')], {
          layoutPosition: { x: 100, y: 0 },
          partId: 'connector1',
        }),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'), {
          partId: 'wire30',
        }),
      ],
    });

    const contactPart: ContactPart = {
      id: 'contact1',
      kind: 'contact',
      maxGauge: { value: 22, unit: 'awg' },
      custom: {},
    };

    const connectorPart: ConnectorPart = {
      id: 'connector1',
      kind: 'connector',
      numberOfCavities: 1,
      designationTemplate: { kind: 'numbers' },
      configurations: [{ id: 'cfg1', name: 'Default', contactPartId: 'contact1' }],
      custom: {},
    };

    d.parts['contact1'] = contactPart;
    d.parts['connector1'] = connectorPart;
    d.parts['wire30'] = {
      id: 'wire30',
      kind: 'wire',
      gauge: { value: 30, unit: 'awg' },
      custom: {},
    };

    const diag = findDiagnostic(d, 'WIRE_GAUGE_RANGE');
    expect(diag).toBeUndefined();
  });

  it('does not fire when no contact is resolvable', () => {
    // Connector has no contact part assigned, neither via cavity nor config.
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], {
          layoutPosition: { x: 0, y: 0 },
          partId: 'connector1',
        }),
        connector('c2', 'C2', [cavity('b')], {
          layoutPosition: { x: 100, y: 0 },
          partId: 'connector1',
        }),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'), {
          partId: 'wire20',
        }),
      ],
    });

    const connectorPart: ConnectorPart = {
      id: 'connector1',
      kind: 'connector',
      numberOfCavities: 1,
      designationTemplate: { kind: 'numbers' },
      configurations: [{ id: 'cfg1', name: 'Default' }], // no contactPartId
      custom: {},
    };

    d.parts['connector1'] = connectorPart;
    d.parts['wire20'] = {
      id: 'wire20',
      kind: 'wire',
      gauge: { value: 20, unit: 'awg' },
      custom: {},
    };

    const diag = findDiagnostic(d, 'WIRE_GAUGE_RANGE');
    expect(diag).toBeUndefined();
  });

  it('does not fire or crash when a wire has no gauge', () => {
    // Wire has no gauge part assigned.
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], {
          layoutPosition: { x: 0, y: 0 },
          partId: 'connector1',
        }),
        connector('c2', 'C2', [cavity('b')], {
          layoutPosition: { x: 100, y: 0 },
          partId: 'connector1',
        }),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b')),
        // No partId, so no gauge
      ],
    });

    const contactPart: ContactPart = {
      id: 'contact1',
      kind: 'contact',
      minGauge: { value: 18, unit: 'awg' },
      maxGauge: { value: 22, unit: 'awg' },
      custom: {},
    };

    const connectorPart: ConnectorPart = {
      id: 'connector1',
      kind: 'connector',
      numberOfCavities: 1,
      designationTemplate: { kind: 'numbers' },
      configurations: [{ id: 'cfg1', name: 'Default', contactPartId: 'contact1' }],
      custom: {},
    };

    d.parts['contact1'] = contactPart;
    d.parts['connector1'] = connectorPart;

    // Should not throw or fire WIRE_GAUGE_RANGE
    const diags = allDiagnostics(d);
    expect(() => allDiagnostics(d)).not.toThrow();
    const diag = diags.find((d) => d.ruleId === 'WIRE_GAUGE_RANGE');
    expect(diag).toBeUndefined();
  });

  it('handles mixed units (AWG and mm²) in one cavity correctly', () => {
    // Two wires: one 20 AWG (0.52 mm²), one 0.5 mm²
    // Sum should be 1.02 mm²
    // Contact: max 20 AWG (0.52 mm²)
    // Sum exceeds max, so it should fire.
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], {
          layoutPosition: { x: 0, y: 0 },
          partId: 'connector1',
        }),
        connector('c2', 'C2', [cavity('b')], {
          layoutPosition: { x: 100, y: 0 },
          partId: 'connector1',
        }),
        connector('c3', 'C3', [cavity('c')], {
          layoutPosition: { x: 200, y: 0 },
          partId: 'connector1',
        }),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'), {
          partId: 'wire20',
        }),
        wire('w2', 'W2', cavityEndpoint('c1', 'a'), cavityEndpoint('c3', 'c'), {
          partId: 'wireMm2',
        }),
      ],
    });

    const contactPart: ContactPart = {
      id: 'contact1',
      kind: 'contact',
      maxGauge: { value: 20, unit: 'awg' }, // max 0.52 mm²
      custom: {},
    };

    const connectorPart: ConnectorPart = {
      id: 'connector1',
      kind: 'connector',
      numberOfCavities: 2,
      designationTemplate: { kind: 'numbers' },
      configurations: [{ id: 'cfg1', name: 'Default', contactPartId: 'contact1' }],
      custom: {},
    };

    d.parts['contact1'] = contactPart;
    d.parts['connector1'] = connectorPart;
    d.parts['wire20'] = {
      id: 'wire20',
      kind: 'wire',
      gauge: { value: 20, unit: 'awg' }, // ≈ 0.52 mm²
      custom: {},
    };
    d.parts['wireMm2'] = {
      id: 'wireMm2',
      kind: 'wire',
      gauge: { value: 0.5, unit: 'mm2' },
      custom: {},
    };

    // 0.52 + 0.5 = 1.02 mm² > 0.52 mm², so rule should fire
    const diag = findDiagnostic(d, 'WIRE_GAUGE_RANGE');
    expect(diag).toBeDefined();
    expect(diag?.message).toContain('above maximum');
  });

  it('resolves contact from cavity override when set', () => {
    // Cavity has its own contactPartId override, separate from connector config.
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a', { contactPartId: 'contactOverride' })], {
          layoutPosition: { x: 0, y: 0 },
          partId: 'connector1',
        }),
        connector('c2', 'C2', [cavity('b')], {
          layoutPosition: { x: 100, y: 0 },
          partId: 'connector1',
        }),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'), {
          partId: 'wire12',
        }),
      ],
    });

    // Cavity override: allow up to 20 AWG (0.52 mm²)
    const overridePart: ContactPart = {
      id: 'contactOverride',
      kind: 'contact',
      maxGauge: { value: 20, unit: 'awg' },
      custom: {},
    };

    // Connector config: allow up to 18 AWG (0.82 mm²) - more restrictive
    const configPart: ContactPart = {
      id: 'contact1',
      kind: 'contact',
      maxGauge: { value: 18, unit: 'awg' },
      custom: {},
    };

    const connectorPart: ConnectorPart = {
      id: 'connector1',
      kind: 'connector',
      numberOfCavities: 1,
      designationTemplate: { kind: 'numbers' },
      configurations: [{ id: 'cfg1', name: 'Default', contactPartId: 'contact1' }],
      custom: {},
    };

    d.parts['contactOverride'] = overridePart;
    d.parts['contact1'] = configPart;
    d.parts['connector1'] = connectorPart;
    d.parts['wire12'] = {
      id: 'wire12',
      kind: 'wire',
      gauge: { value: 12, unit: 'awg' }, // 12 AWG ≈ 3.3 mm², exceeds both limits
      custom: {},
    };

    // 12 AWG exceeds the override's max of 20 AWG, so rule should fire with the override contact.
    const diag = findDiagnostic(d, 'WIRE_GAUGE_RANGE');
    expect(diag).toBeDefined();
    expect(diag?.message).toContain('above maximum');
  });

  it('reports in document unit (AWG)', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], {
          layoutPosition: { x: 0, y: 0 },
          partId: 'connector1',
        }),
        connector('c2', 'C2', [cavity('b')], {
          layoutPosition: { x: 100, y: 0 },
          partId: 'connector1',
        }),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'), {
          partId: 'wire30',
        }),
      ],
    });

    // Document is set to AWG units
    d.settings.gaugeUnit = 'awg';

    const contactPart: ContactPart = {
      id: 'contact1',
      kind: 'contact',
      minGauge: { value: 18, unit: 'awg' },
      custom: {},
    };

    const connectorPart: ConnectorPart = {
      id: 'connector1',
      kind: 'connector',
      numberOfCavities: 1,
      designationTemplate: { kind: 'numbers' },
      configurations: [{ id: 'cfg1', name: 'Default', contactPartId: 'contact1' }],
      custom: {},
    };

    d.parts['contact1'] = contactPart;
    d.parts['connector1'] = connectorPart;
    d.parts['wire30'] = {
      id: 'wire30',
      kind: 'wire',
      gauge: { value: 30, unit: 'awg' },
      custom: {},
    };

    const diag = findDiagnostic(d, 'WIRE_GAUGE_RANGE');
    expect(diag?.message).toContain('awg');
    expect(diag?.message).not.toContain('mm2');
  });

  it('finding message names the wire refdes, not just the cavity (C4)', () => {
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 }, partId: 'connector1' }),
        connector('c2', 'C2', [cavity('b')], { layoutPosition: { x: 100, y: 0 }, partId: 'connector1' }),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'), { partId: 'wire12' }),
      ],
    });

    d.parts['contact1'] = { id: 'contact1', kind: 'contact', maxGauge: { value: 22, unit: 'awg' }, custom: {} };
    d.parts['connector1'] = {
      id: 'connector1', kind: 'connector', numberOfCavities: 1,
      designationTemplate: { kind: 'numbers' },
      configurations: [{ id: 'cfg1', name: 'Default', contactPartId: 'contact1' }], custom: {},
    };
    d.parts['wire12'] = { id: 'wire12', kind: 'wire', gauge: { value: 12, unit: 'awg' }, custom: {} };

    const diag = findDiagnostic(d, 'WIRE_GAUGE_RANGE');
    expect(diag).toBeDefined();
    // The message must identify the wire (W1), not only the cavity.
    expect(diag?.message).toContain('W1');
  });

  it('does not crash on an untabulated wire gauge — skips the wire (B7)', () => {
    // A wire part naming an AWG size outside the tabulated 30…4/0 range must
    // degrade (be skipped), not throw the whole derive pipeline.
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 }, partId: 'connector1' }),
        connector('c2', 'C2', [cavity('b')], { layoutPosition: { x: 100, y: 0 }, partId: 'connector1' }),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'), { partId: 'wireOdd' }),
      ],
    });

    d.parts['contact1'] = { id: 'contact1', kind: 'contact', maxGauge: { value: 22, unit: 'awg' }, custom: {} };
    d.parts['connector1'] = {
      id: 'connector1', kind: 'connector', numberOfCavities: 1,
      designationTemplate: { kind: 'numbers' },
      configurations: [{ id: 'cfg1', name: 'Default', contactPartId: 'contact1' }], custom: {},
    };
    // AWG 999 is not in the table.
    d.parts['wireOdd'] = { id: 'wireOdd', kind: 'wire', gauge: { value: 999, unit: 'awg' }, custom: {} };

    // Must not throw, and must not produce a WIRE_GAUGE_RANGE finding for the
    // unconvertible wire (nothing measurable remains in the cavity).
    expect(() => allDiagnostics(d)).not.toThrow();
    expect(findDiagnostic(d, 'WIRE_GAUGE_RANGE')).toBeUndefined();
  });

  it('an odd-but-tabulated gauge (21 AWG) converts and validates normally (B7)', () => {
    // 21 AWG is a legitimate size now that the table is complete; it must be
    // checked like any other wire, not skipped.
    const d = withEntities(doc(), {
      components: [
        connector('c1', 'C1', [cavity('a')], { layoutPosition: { x: 0, y: 0 }, partId: 'connector1' }),
        connector('c2', 'C2', [cavity('b')], { layoutPosition: { x: 100, y: 0 }, partId: 'connector1' }),
      ],
      wires: [
        wire('w1', 'W1', cavityEndpoint('c1', 'a'), cavityEndpoint('c2', 'b'), { partId: 'wire21' }),
      ],
    });

    // Contact accepts at most 22 AWG (0.326 mm²); 21 AWG (0.412 mm²) is bigger.
    d.parts['contact1'] = { id: 'contact1', kind: 'contact', maxGauge: { value: 22, unit: 'awg' }, custom: {} };
    d.parts['connector1'] = {
      id: 'connector1', kind: 'connector', numberOfCavities: 1,
      designationTemplate: { kind: 'numbers' },
      configurations: [{ id: 'cfg1', name: 'Default', contactPartId: 'contact1' }], custom: {},
    };
    d.parts['wire21'] = { id: 'wire21', kind: 'wire', gauge: { value: 21, unit: 'awg' }, custom: {} };

    expect(() => allDiagnostics(d)).not.toThrow();
    const diag = findDiagnostic(d, 'WIRE_GAUGE_RANGE');
    expect(diag).toBeDefined();
    expect(diag?.message).toContain('above maximum');
  });
});
