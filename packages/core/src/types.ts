/**
 * OpenHarness document model.
 *
 * Transcribed from HARNESS-DESIGNER-SPEC.md §4. This is a normalised model:
 * every component type (connector, splice, terminal, branch point, resistor,
 * diode, cable, generic) lives in one `components` map keyed by id, with a
 * `type` discriminant — a deliberate divergence from the the reference tool wire
 * format, which uses separate top-level arrays per type (spec §3.3, §15).
 *
 * Do not add fields here speculatively. Anything not directly observed in
 * either reference export (`_reference_harness_export.json`,
 * `_kitchen_sink_export.json`) or explicitly designed in the spec should be
 * flagged `[inferred]` in a comment, matching the spec's own provenance
 * discipline (spec §0, §14).
 */

import type {
  ComponentId, WireId, BundleId, GroupId, NoteId, PartId, CavityId, TwistGroupId,
} from './ids.js';

/** A WireGroup shares the twist-group id space (spec's `twistedWires[].id`,
 * §3.3) — the same id a `Wire.twistGroupId` points at. */
export type WireGroupId = TwistGroupId;

// ---------------------------------------------------------------------------
// Top level (spec §4.1)
// ---------------------------------------------------------------------------

export interface HarnessDocument {
  formatVersion: 1;
  meta: DocumentMeta;
  settings: DocumentSettings;

  components: Record<ComponentId, Component>;
  wires: Record<WireId, Wire>;
  bundles: Record<BundleId, Bundle>;
  groups: Record<GroupId, Group>;
  notes: Record<NoteId, Note>;
  /** Wire groupings authored in this app (spec revision, Connor's wiring-core
   * request): a WireGroup is how a "cable" now comes into being — select two
   * or more wires (or already-grouped wires) and group them, optionally
   * attaching a cable part. See WireGroup below for why this replaces
   * placing a `Cable` *component* as the primary authoring path. */
  wireGroups: Record<WireGroupId, WireGroup>;

  parts: Record<PartId, Part>;
}

export interface DocumentMeta {
  id: string;
  name: string;
  createdAt: string; // ISO 8601
  modifiedAt: string;
  revision: number;
  readOnly: boolean;
  /** Free-form. Automations own this namespace; core never reads or writes it. */
  custom: Record<string, unknown>;
}

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export type GaugeUnit = 'mm2' | 'awg';
export type Currency = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'INR';

export interface SheetSize {
  name: string;
  widthMm: number;
  heightMm: number;
}

export interface DocumentSettings {
  lengthUnit: LengthUnit;
  gaugeUnit: GaugeUnit;
  currency: Currency;
  formboard: { enabled: boolean; scale: number; sheet?: SheetSize };
  refdesPrefixes: Partial<Record<ComponentType, string>>;
}

export interface Point {
  x: number;
  y: number;
}

export interface Group {
  id: GroupId;
  memberIds: (ComponentId | WireId)[];
  label?: string;
}

export interface Note {
  id: NoteId;
  schematicPosition: Point;
  text: string;
}

// ---------------------------------------------------------------------------
// Components (spec §4.2)
// ---------------------------------------------------------------------------

export type ComponentType =
  | 'connector' | 'splice' | 'terminal' | 'branchPoint'
  | 'resistor' | 'diode' | 'cable' | 'generic';

export interface ComponentBase {
  id: ComponentId;
  type: ComponentType;
  refdes: string;
  label?: string;
  partId?: PartId;
  configurationId?: string;
  schematicPosition?: Point;
  layoutPosition?: Point;
  rotation?: number;
  excludeFromBom?: boolean;
  groupId?: GroupId;
  /** Confirmed against real exports (spec §3.3): plain array of part refs, not a separate entity. */
  coveringIds?: PartId[];
  custom: Record<string, unknown>;
}

export interface Cavity {
  id: CavityId;
  designation: string;
  signal?: string;
  global?: boolean;
  noPropagate?: boolean;
  sealPartId?: PartId;
  contactPartId?: PartId;
  custom: Record<string, unknown>;
}

export interface Connector extends ComponentBase {
  type: 'connector';
  cavities: Cavity[];
  widthPercent?: number;
  flipped?: boolean;
  hasShell?: boolean;
}

export type SpliceKind = 'crimp' | 'weld' | 'solderSleeve'; // [inferred] — spec §14/R6

export interface Splice extends ComponentBase {
  type: 'splice';
  spliceKind?: SpliceKind;
}

export type TerminalKind =
  | 'ferrule' | 'ring' | 'spade' | 'maleQuickConnect'
  | 'femaleQuickConnect' | 'looseWireEnd';

export interface Terminal extends ComponentBase {
  type: 'terminal';
  terminalKind: TerminalKind;
}

/** Layout-only: confirmed structurally (never has schematicPosition) in the kitchen-sink export. */
export interface BranchPoint extends ComponentBase {
  type: 'branchPoint';
  schematicPosition?: undefined;
}

export interface TwoTerminal extends ComponentBase {
  type: 'resistor' | 'diode';
  polarity?: 'forward' | 'reverse'; // diodes only; [inferred]
}

export interface CableCore {
  id: CavityId;
  color: string;
  signal?: string;
  designation?: string;
}

/**
 * Confirmed against the kitchen-sink export (spec §3.2/§3.3): `cores[]` plus
 * an optional single `shield`, structurally identical to a core
 * (`{ id, color: "Shield" }`). No separate shield metadata exists.
 */
export interface Cable extends ComponentBase {
  type: 'cable';
  cores: CableCore[];
  shield?: CableCore;
  /** Which side wires exit — same affordance as Connector.flipped (spec §2.3's
   * "chevrons on each side flip which way the wires exit" applies to any
   * multi-row schematic node, not just connectors). [inferred] */
  flipped?: boolean;
}

export interface GenericComponent extends ComponentBase {
  type: 'generic';
}

export type Component =
  | Connector | Splice | Terminal | BranchPoint
  | TwoTerminal | Cable | GenericComponent;

// ---------------------------------------------------------------------------
// Wires (spec §4.3)
// ---------------------------------------------------------------------------

export type WireColor = string; // named color ('Red') or '#rrggbb'

export interface WireEnd {
  stripLength?: number;
  terminalPartId?: PartId;
  sealPartId?: PartId;
  treatment?: 'crimp' | 'solder' | 'tinned' | 'ultrasonicWeld' | 'none';
  crimpHeight?: number;
}

/**
 * NOTE on naming: the source wire format uses the magic handle "Splice" for
 * splices and "Left"/"Right" for two-terminal parts (resistor/diode) — only
 * "Right" has been directly observed (spec §14). That is distinct from the
 * `Terminal` *component type* (ferrule/ring/spade/...), which is a
 * single-point connection like a splice but with exactly one wire, not
 * n-ary. Kept as separate Endpoint kinds (`twoTerminalSide` vs
 * `terminalPoint`) to avoid conflating the two "terminal" concepts.
 */
export type Endpoint =
  | { kind: 'cavity'; componentId: ComponentId; cavityId: CavityId }
  | { kind: 'cableCore'; componentId: ComponentId; coreId: CavityId }
  | { kind: 'splice'; componentId: ComponentId }
  | { kind: 'terminalPoint'; componentId: ComponentId }
  | { kind: 'twoTerminalSide'; componentId: ComponentId; side: 'Left' | 'Right' }
  | { kind: 'free'; point: Point };

export interface Wire {
  id: WireId;
  refdes: string;
  source: Endpoint;
  target: Endpoint;

  color: WireColor;
  stripeColor?: WireColor;

  partId?: PartId;
  gauge?: { value: number; unit: GaugeUnit };

  ident?: string;
  group?: string;
  /** Which WireGroup (twist or cable) this wire belongs to, if any — see
   * WireGroup below. Shares the id space with the legacy `twistedWires[].id`
   * from imports (spec §3.3). */
  twistGroupId?: TwistGroupId;

  /** Explicit frozen route through the layout graph. If absent, derived (spec §6.2). */
  route?: BundleId[];
  serviceLoop?: { source: number; target: number };
  /** Manual override; computed length still surfaced so a DRC rule can flag divergence. */
  lengthOverride?: number;

  ends?: { source: WireEnd; target: WireEnd };

  custom: Record<string, unknown>;
}

/**
 * A grouping of wires (and/or other WireGroups, so a jacketed cable can
 * bundle several already-twisted pairs plus loose wires — Connor's "allow
 * grouping through twisting but also allow grouping of single wires or
 * multiple pairs").
 *
 * `kind: 'twist'` is a physical/visual grouping only — no part, no BOM
 * line, just wires drawn and (eventually) routed together.
 * `kind: 'cable'` is the same grouping mechanism with a part reference
 * attached, so it rolls up to a real BOM line — this is deliberately how a
 * "cable" comes into being now, instead of placing a `Cable` *component*
 * with pre-declared cores and wiring each one individually. The legacy
 * `Cable` component type (spec §3.3, real the reference tool exports use it)
 * is kept for import fidelity only — see schematicScene.ts.
 */
export interface WireGroup {
  id: WireGroupId;
  kind: 'twist' | 'cable';
  refdes?: string;
  memberWireIds: WireId[];
  /** Nested groups — e.g. two twisted pairs bundled into one jacketed cable. */
  memberGroupIds: WireGroupId[];
  /** Only meaningful for `kind: 'cable'` — references a CablePart. */
  partId?: PartId;
  /** Jacket color, `kind: 'cable'` only. [inferred] */
  color?: string;
  schematicPosition?: Point;
  custom: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Bundles (spec §4.4)
// ---------------------------------------------------------------------------

export interface Bundle {
  id: BundleId;
  refdes: string;
  sourceId: ComponentId;
  targetId: ComponentId;
  /** Authored length in the document's lengthUnit at the API boundary; stored as integer µm internally (spec §6.3). */
  length?: number;
  waypoints?: Point[];
  custom: Record<string, unknown>;
}

export type LengthStatus =
  | 'exact' | 'lowerBound' | 'noRoute' | 'unplaced' | 'overridden'
  | 'jumper' | 'shield';

// ---------------------------------------------------------------------------
// Parts (spec §4.5)
// ---------------------------------------------------------------------------

export interface PartBase {
  id: PartId;
  kind: string;
  partNumber?: string;
  manufacturer?: string;
  description?: string;
  url?: string;
  price?: number;
  source?: { provider: string; ref: string; fetchedAt: string };
  custom: Record<string, unknown>;
}

export type DesignationTemplate =
  | { kind: 'numbers'; start?: number }
  | { kind: 'alphabetical'; skipIOQ?: boolean }
  | { kind: 'grid'; rows: number; cols: number; rowLabels: 'alpha' | 'numeric' }
  | { kind: 'custom'; designations: string[] };

export interface ConnectorConfiguration {
  id: string;
  name: string;
  lockPartId?: PartId;
  dustCoverPartId?: PartId;
  backshellPartId?: PartId;
  bootPartId?: PartId;
  contactPartId?: PartId;
  cavitySealPartId?: PartId;
}

export interface ConnectorPart extends PartBase {
  kind: 'connector';
  numberOfCavities: number;
  designationTemplate: DesignationTemplate;
  gender?: 'male' | 'female' | 'hermaphroditic';
  color?: string;
  hasShell?: boolean;
  configurations: ConnectorConfiguration[];
  cavityLayout?: { rows: number; cols: number; pitch: number; map?: (string | null)[][] };
  matingPartId?: PartId;
  keying?: string; // [inferred] free text for now — spec R7
}

export interface WirePart extends PartBase {
  kind: 'wire';
  gauge: { value: number; unit: GaugeUnit };
  color?: WireColor;
  stripeColor?: WireColor;
  insulation?: string;
  outerDiameter?: number;
  tempRating?: { min: number; max: number };
  voltageRating?: number;
  currentRating?: number;
  strandCount?: number;
}

/** Confirmed directly against the live "Heat Shrink" part editor (spec §2.6/§4.5). */
export interface CoveringPart extends PartBase {
  kind: 'covering';
  coveringType: 'heatShrink' | 'tape' | 'corrugatedTubing' | 'spiralWrap' | 'tubing' | 'braidedSleeve';
  color?: string;
  minDiameter?: number;
  maxDiameter?: number;
  fixedLength?: boolean;
  pricePerMeter?: number;
}

// Not yet observed directly (spec §14) — pattern-matched shapes, kept deliberately minimal.
export interface SplicePart extends PartBase { kind: 'splice'; spliceKind?: SpliceKind }
export interface TerminalPart extends PartBase { kind: 'terminal'; terminalKind?: TerminalKind }
export interface ResistorPart extends PartBase { kind: 'resistor'; resistanceOhms?: number }
export interface DiodePart extends PartBase { kind: 'diode' }
export interface CablePart extends PartBase { kind: 'cable'; coreCount?: number; shielded?: boolean }
export interface AccessoryPart extends PartBase {
  kind: 'accessory';
  accessoryType?: 'contact' | 'lock' | 'dustCover' | 'backshell' | 'boot' | 'cavitySeal';
}
export interface GenericPart extends PartBase { kind: 'generic' }

export type Part =
  | ConnectorPart | WirePart | CablePart | SplicePart | TerminalPart
  | ResistorPart | DiodePart | CoveringPart | AccessoryPart | GenericPart;

// ---------------------------------------------------------------------------
// Derived model (spec §5.3, §6)
// ---------------------------------------------------------------------------

export interface Net {
  id: string;
  memberIds: string[]; // vertex ids: cavity/splice/terminal-side/cableCore/free-end refs
  signal?: string;
}

export interface RouteResult {
  status: LengthStatus;
  segments: BundleId[];
}

export interface LengthResultSegment {
  bundleId: BundleId;
  length: number; // integer µm
  authored: boolean;
}

export interface LengthResult {
  status: LengthStatus;
  value: number; // integer µm
  segments: LengthResultSegment[];
}

export interface BomLine {
  partId?: PartId;
  partNumber: string;
  manufacturer: string;
  description: string;
  quantity: number;
  unit: 'ea' | 'mm' | 'cm' | 'm' | 'in' | 'ft';
  unitPrice?: number;
  extendedPrice?: number;
  refdes: string[];
  warnings: string[];
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  ruleId: string;
  severity: DiagnosticSeverity;
  message: string;
  targets: { kind: 'component' | 'wire' | 'bundle' | 'cavity' | 'net'; id: string }[];
  fix?: { label: string; apply(draft: HarnessDocument): void };
}

export interface DerivedModel {
  nets: Net[];
  wireRoutes: Map<WireId, RouteResult>;
  wireLengths: Map<WireId, LengthResult>;
  bundleContents: Map<BundleId, WireId[]>;
  bundleDiameters: Map<BundleId, number>;
  bom: BomLine[];
  diagnostics: Diagnostic[];
}
