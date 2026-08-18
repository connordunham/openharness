/**
 * Raw vendor wire-format (v0.8) types, as directly observed in the
 * two captured reference exports (spec §3.1, §3.2):
 *   - a real document (`fixtures/reference-harness.json`): wires, connectors,
 *     twistedWires, bundles, splices, resistors + resistorParts,
 *     connectorParts.
 *   - a synthetic "kitchen sink" document (`fixtures/kitchen-sink.json`):
 *     terminals, cables (cores + shield), schematicNotes, branchPoints,
 *     coveringParts.
 *
 * These are intentionally loose (mostly optional fields) — the source
 * format is JSON with no schema, and every field here is either present in
 * one of the two captured exports or documented as absent-but-expected in
 * HARNESS-DESIGNER-SPEC.md §14. Do not add fields speculatively.
 */

export interface RawPoint {
  x: number;
  y: number;
}

export interface RawEndpoint {
  id: string;
  /** A cavity/core id, or the magic strings "Splice" / "Left" / "Right". */
  handle: string;
}

export interface RawWire {
  id: string;
  color: string;
  stripeColor?: string;
  source: RawEndpoint;
  target: RawEndpoint;
}

export interface RawCavity {
  id: string;
  signal?: string;
  global?: boolean;
}

export interface RawConnector {
  id: string;
  label?: string;
  partId?: string;
  cavities: RawCavity[];
  layoutPosition?: RawPoint;
  schematicPosition?: RawPoint;
  coveringIds?: string[];
}

export interface RawSplice {
  id: string;
  layoutPosition?: RawPoint;
  schematicPosition?: RawPoint;
}

export interface RawResistor {
  id: string;
  partId?: string;
  layoutPosition?: RawPoint;
  schematicPosition?: RawPoint;
}

export interface RawTerminal {
  id: string;
  type: string; // "Ring", etc — PascalCase in the source format
  layoutPosition?: RawPoint;
  schematicPosition?: RawPoint;
}

export interface RawCableCore {
  id: string;
  color: string;
  signal?: string;
}

export interface RawCable {
  id: string;
  partId?: string;
  schematicPosition?: RawPoint;
  cores: RawCableCore[];
  shield?: RawCableCore;
}

export interface RawTwistedWires {
  id: string;
  wires: RawWire[];
  schematicPosition?: RawPoint;
}

export interface RawBundle {
  id: string;
  sourceId: string;
  targetId: string;
  length?: number;
}

export interface RawSchematicNote {
  id: string;
  schematicPosition: RawPoint;
  text: string;
}

export interface RawBranchPoint {
  id: string;
  layoutPosition: RawPoint;
}

export interface RawConnectorConfiguration {
  id: string;
  name?: string;
}

export interface RawConnectorPart {
  id: string;
  partNumber?: string;
  manufacturer?: string;
  numberOfCavities?: number;
  configurations?: RawConnectorConfiguration[];
}

export interface RawResistorPart {
  id: string;
  partNumber?: string;
  manufacturer?: string;
}

export interface RawCoveringPart {
  id: string;
  type: string; // "HeatShrink", etc
  partNumber?: string;
  manufacturer?: string;
}

export interface RawHarnessDocument {
  version: number;
  lengthUnit: string;
  wires?: RawWire[];
  connectors?: RawConnector[];
  splices?: RawSplice[];
  resistors?: RawResistor[];
  terminals?: RawTerminal[];
  cables?: RawCable[];
  twistedWires?: RawTwistedWires[];
  bundles?: RawBundle[];
  schematicNotes?: RawSchematicNote[];
  branchPoints?: RawBranchPoint[];
  connectorParts?: RawConnectorPart[];
  resistorParts?: RawResistorPart[];
  coveringParts?: RawCoveringPart[];
}
