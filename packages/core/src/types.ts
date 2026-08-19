/**
 * OpenHarness document model.
 *
 * Transcribed from HARNESS-DESIGNER-SPEC.md §4. This is a normalised model:
 * every component type (connector, splice, terminal, branch point, resistor,
 * diode, cable, generic) lives in one `components` map keyed by id, with a
 * `type` discriminant — a deliberate divergence from the vendor wire
 * format, which uses separate top-level arrays per type (spec §3.3, §15).
 *
 * Do not add fields here speculatively. Anything not directly observed in
 * either reference export (`_reference_harness_export.json`,
 * `_kitchen_sink_export.json`) or explicitly designed in the spec should be
 * flagged `[inferred]` in a comment, matching the spec's own provenance
 * discipline (spec §0, §14).
 */

import type {
  ComponentId, WireId, BundleId, GroupId, NoteId, PartId, CavityId, TwistGroupId, MateId,
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
  /** Connector/terminal mating — see Mate. Optional so documents written
   * before mates existed still load unchanged; treat absent as empty. */
  mates?: Record<MateId, Mate>;
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
/**
 * `cmil`/`kcmil` are circular mils, standard in North American power and
 * aerospace harnesses above roughly 4/0 AWG where AWG stops being expressive.
 * They are definitional rather than tabulated: 1 cmil is the area of a circle
 * one mil (0.001 in) in diameter. See `gauge.ts` for the conversions and for
 * why mm² is the canonical internal unit.
 */
export type GaugeUnit = 'mm2' | 'awg' | 'cmil' | 'kcmil';

/** A gauge with its unit. Always convert through `gauge.ts` rather than
 * comparing `.value` across two different units. */
export interface Gauge {
  value: number;
  unit: GaugeUnit;
}
export type Currency = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'INR';

export interface SheetSize {
  name: string;
  widthMm: number;
  heightMm: number;
}

/**
 * [inferred] — Connor: "add a project level setting to pick between IEEE Std
 * 315-1975 and IEC 60617-3 twisted-pair symbol styles". The two standards
 * draw the same idea differently: IEEE 315 uses interlocking loops (the
 * conductors visibly wrap around one another), IEC 60617-3 uses a single
 * shared crossing zone with the pair drawn as a braid. Which one a shop uses
 * is a drawing-standard decision made once per project, not per group —
 * hence a document setting rather than a field on WireGroup.
 */
export type TwistedPairStyle = 'ieee315' | 'iec60617';

export interface DocumentSettings {
  lengthUnit: LengthUnit;
  gaugeUnit: GaugeUnit;
  currency: Currency;
  formboard: { enabled: boolean; scale: number; sheet?: SheetSize };
  refdesPrefixes: Partial<Record<ComponentType, string>>;
  /** [inferred] — see TwistedPairStyle. Unset reads as 'ieee315', which is
   * exactly what the pre-setting renderer drew, so no existing document
   * changes appearance by loading into a build that has this field. */
  twistedPairStyle?: TwistedPairStyle;
  /** [inferred] — Connor: parasitics "should default to zero and be hidden
   * in the properties tab unless a 'show parasitics' checkbox is toggled".
   * Project-level rather than per-panel so the choice survives reload and
   * every Properties surface agrees; unset reads as false (hidden). */
  showParasitics?: boolean;
  /** [inferred] — Connor: "a configurable straight exit-stub length for
   * wires leaving a connector so there's room to draw the shield-wrap symbol
   * before the auto-router bends them". This is the `stub` the schematic
   * router already took as an option (render/routing.ts) — promoting it to a
   * document setting is what makes it user-controllable. In schematic px;
   * unset reads as the router's own DEFAULT_STUB. */
  schematicExitStub?: number;
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

/**
 * [inferred] — Connor: "add parasitics to all components — optional
 * resistance, capacitance and inductance, defaulting to zero and hidden in
 * Properties unless a 'show parasitics' checkbox is toggled."
 *
 * Stored in base SI units (Ω, F, H) rather than a value+unit pair like
 * `PartParameter`, deliberately: a parasitic is always the *same* physical
 * quantity for a given field, so there is nothing for a unit selector to
 * choose — only a display prefix, which is a formatting concern
 * (`formatParasitic`), not a storage one. Every field is optional and
 * `undefined` means "not characterised", which behaves as zero everywhere
 * that sums parasitics — so an untouched document is numerically identical
 * to one with explicit zeros, and nothing needs migrating.
 */
export interface Parasitics {
  resistanceOhms?: number;
  capacitanceFarads?: number;
  inductanceHenries?: number;
}

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
  /** [inferred] — see Parasitics. Lives on the component *instance*, not on
   * its Part: two connectors of the same catalog part in different positions
   * on the same harness can legitimately be characterised differently (lead
   * dress, mating hardware), and the parasitic is a property of this
   * physical instance in this build. */
  parasitics?: Parasitics;
  custom: Record<string, unknown>;
}

/** [inferred] — Connor's follow-up: "Add directionality to the pins defined
 * on each connector... toggle between bi-directional, input, and output."
 * Lives per-cavity (and per-CableCore below) since directionality is a
 * property of the signal at that exit point, not of the wire connecting two
 * of them — the interconnect table (derive/interconnect.ts) resolves a
 * wire's overall direction by comparing its two endpoints' declared
 * directions. Unset means "not specified" and renders/behaves exactly like
 * 'bidirectional' everywhere (no behavior change for any pre-existing
 * document). */
export type SignalDirection = 'bidirectional' | 'input' | 'output';

export interface Cavity {
  id: CavityId;
  designation: string;
  signal?: string;
  /** [inferred] — see SignalDirection doc comment. */
  direction?: SignalDirection;
  /** [inferred] — Connor's follow-up: "a separate field for whether the
   * signal is impedance matched." */
  impedanceMatched?: boolean;
  global?: boolean;
  noPropagate?: boolean;
  sealPartId?: PartId;
  contactPartId?: PartId;
  custom: Record<string, unknown>;
}

/**
 * [inferred] — Connor: "an optional connector 'backshell termination' toggle
 * that adds a BS contact". A backshell termination is a real, wirable
 * connection point (that's the whole reason to want it — a shield drain or
 * ground strap lands on it), but it is NOT a cavity: it isn't in the
 * housing's cavity count, doesn't take a contact or a seal, and must not
 * change `numberOfCavities` or the cavity designations. So rather than
 * pushing a synthetic `Cavity` into `Connector.cavities` — which would
 * corrupt every count, template and BOM rollup that walks that array — the
 * toggle is its own boolean, and the schematic scene emits an extra row for
 * it keyed by this reserved id. Wires land on it through the ordinary
 * `{ kind: 'cavity' }` endpoint (net extraction keys cavity vertices purely
 * by id, so this participates in nets for free), and the one rule that would
 * otherwise mis-fire on it — OVERFILLED_CAVITY, since a backshell legitimately
 * takes several straps — skips this id explicitly.
 */
export const BACKSHELL_CAVITY_ID = '__backshell__';

export interface Connector extends ComponentBase {
  type: 'connector';
  cavities: Cavity[];
  widthPercent?: number;
  flipped?: boolean;
  hasShell?: boolean;
  /** [inferred] — see BACKSHELL_CAVITY_ID. */
  backshellTermination?: boolean;
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
  /** Which side the wire exits — same affordance as Connector.flipped
   * (Connor's follow-up: "ensure all relevant features added to the
   * connector objects also appear in the other components"). A terminal has
   * exactly one directional port, same shape of problem as a connector or
   * cable, so the same flip toggle applies directly. [inferred] */
  flipped?: boolean;
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
  /** [inferred] — same affordance as Cavity.direction/impedanceMatched; a
   * cable core carries a signal exactly like a connector cavity does. */
  direction?: SignalDirection;
  impedanceMatched?: boolean;
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
  /** [inferred] — Connor: shields need "a termination connection node on the
   * shield itself". Without this a shield could only ever be *described*
   * (a style enum and a free-text note); with it, the drain/pigtail is a real
   * wire in the document, running from the shield to whatever it grounds to,
   * and therefore appears in nets, in the interconnect table, and in the BOM
   * like any other conductor. The node belongs to the WireGroup rather than
   * to any one member wire, since the shield wraps the whole group. Routing
   * treats it the same way it already treats a cable shield — status
   * 'shield', no physical bundle path of its own (see derive/routing.ts). */
  | { kind: 'shieldNode'; groupId: WireGroupId }
  | { kind: 'free'; point: Point };

/**
 * The Component an endpoint attaches to, or undefined for the two endpoint
 * kinds that don't attach to one: `free` (a floating point) and `shieldNode`
 * (which belongs to a WireGroup).
 *
 * Exported from core because the alternative — `'componentId' in ep` at each
 * call site — is a property-existence check masquerading as a type guard.
 * It compiles, it reads fine, and it silently starts returning the wrong
 * answer the moment a new endpoint kind is added, because there is nothing
 * for the compiler to complain about. This switch, by contrast, fails to
 * build until the new kind is handled.
 */
export function endpointComponentId(ep: Endpoint): ComponentId | undefined {
  switch (ep.kind) {
    case 'cavity':
    case 'cableCore':
    case 'splice':
    case 'terminalPoint':
    case 'twoTerminalSide':
      return ep.componentId;
    case 'shieldNode':
    case 'free':
      return undefined;
  }
}

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

  /**
   * Manual routing override for the Schematic canvas only (distinct from
   * `route`/`Bundle.waypoints`, which are physical Layout-space routing).
   * Each entry is one user-placed bend, in order from `source` to `target`;
   * an empty or absent array means "auto-routed", exactly as before this
   * field existed.
   *
   * The port stubs are NOT part of this list and are never editable: a wire
   * still leaves its source port heading in that port's exit direction and
   * still arrives at its target port from the correct side (see
   * render/routing.ts), because those two segments are electrical-drawing
   * correctness, not styling — a wire entering the back of a pin is simply
   * wrong. The manual path runs between the two stubs.
   *
   * Was `schematicWaypoint?: Point` (a single bend). That singular field was
   * removed along with the drag UI and is now migrated on load
   * (`migrateLegacyFields`) rather than read in two places forever.
   */
  schematicWaypoints?: Point[];

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
 * `Cable` component type (spec §3.3, real vendor exports use it)
 * is kept for import fidelity only — see schematicScene.ts.
 */
export interface WireGroup {
  id: WireGroupId;
  kind: 'twist' | 'cable';
  /**
   * [inferred] — Connor: "decouple the twisted visual from the group's
   * `kind` — make it an explicit opt-in checkbox instead of automatic."
   *
   * `kind` answers a commercial question (does this grouping roll up to a
   * BOM line?); whether the conductors are physically twisted is an
   * independent manufacturing fact. The old renderer conflated the two by
   * drawing the crossover glyph for exactly `kind === 'twist'`, which made
   * both mistakes at once: a twisted pair that gets a cable part number
   * silently stopped looking twisted, and an untwisted bundle of loose wires
   * looked twisted because it had no part yet.
   *
   * Unset is migrated on load to `kind === 'twist'` so every existing
   * document keeps the exact appearance it had (`migrateLegacyFields`);
   * after that the two fields move independently.
   */
  twisted?: boolean;
  refdes?: string;
  memberWireIds: WireId[];
  /** Nested groups — e.g. two twisted pairs bundled into one jacketed cable. */
  memberGroupIds: WireGroupId[];
  /** Only meaningful for `kind: 'cable'` — references a CablePart. */
  partId?: PartId;
  /** Jacket color, `kind: 'cable'` only. [inferred] */
  color?: string;
  schematicPosition?: Point;
  /** [inferred] — Connor's follow-up: "add the ability to add a shield to a
   * group of wires... shield should have its own set of properties which
   * can be manually defined or can be pulled from the designed [shield]
   * part number if available." A shield is orthogonal to `kind` (twist)
   * or cable) — any group, twisted or not, can be shielded — so this is a
   * separate optional field rather than a third `kind`. `partId` references
   * a `ShieldPart` in `doc.parts`, following the exact same lazy-create
   * pattern already used for `Wire.partId`/`WireGroup.partId` elsewhere in
   * this file: editing any shield field creates the ShieldPart on first
   * touch, so "manually defined" and "pulled from a part number" are the
   * same storage — a manually-typed field *is* how a part gets its
   * properties in this app, there being no separate live catalog lookup
   * yet (see the parts-library browser's own scope note). Referencing an
   * *existing* ShieldPart (created for an earlier shielded group) is how
   * "pulled from the designed part number" plays out in practice.
   * Termination fields (spec follow-up, schematic/visual/text-note form)
   * live on `ShieldTermination`, added alongside this. */
  shield?: Shield;
  custom: Record<string, unknown>;
}

/**
 * [inferred] — Connor: "a shield 'model' choice (standalone part /
 * IPC-620 wire+termination / custom)". This is a costing/documentation
 * question, not a geometry one: the same physical braid is bought and
 * documented three different ways depending on the shop's convention.
 *
 * - `standalonePart` — the shield is its own line item with its own part
 *   number (the original behaviour, and still the default).
 * - `ipc620WireTermination` — IPC/WHMA-A-620 treats the shield termination
 *   as an assembly operation on a wire rather than a separate purchased
 *   part: the braid and its termination are called out together against the
 *   conductor. Documents that follow 620 don't want a phantom BOM line for
 *   the braid itself, so this model suppresses it (see derive/bom.ts).
 * - `custom` — neither convention; the user is describing it by hand in the
 *   note/parameters and doesn't want the tool asserting a rollup either way.
 */
export type ShieldModel = 'standalonePart' | 'ipc620WireTermination' | 'custom';

/** [inferred] — see WireGroup.shield. */
export interface Shield {
  partId?: PartId;
  /** [inferred] — see ShieldModel. Unset reads as 'standalonePart'. */
  model?: ShieldModel;
  /**
   * [inferred] — Connor: "user-controlled position along the wire run
   * (wrapping at the connector)". Fraction of the run, measured inward from
   * each end, at which the shield-wrap mark is drawn — so 0 sits right at
   * the connector face and 0.5 sits at mid-span. Applies to both ends
   * symmetrically, which is what "wrapping at the connector" means in
   * practice: a shield terminates at both ends of the run it covers, at the
   * same inset. Unset reads as DEFAULT_SHIELD_POSITION.
   */
  position?: number;
  /** Termination detail. `termination` is the shared/default one;
   * `sourceTermination`/`targetTermination` override it per end, since a
   * shield can legitimately pigtail at one connector and land on a 360°
   * backshell at the other. Unset per-end falls back to `termination`. */
  termination?: ShieldTermination;
  sourceTermination?: ShieldTermination;
  targetTermination?: ShieldTermination;
  /**
   * [inferred] — Connor: "a termination connection node on the shield
   * itself". When true the schematic draws a wirable node on the shield
   * mark, and wires may target it via `{ kind: 'shieldNode', groupId }`.
   * Off by default: a shield with no drain to document shouldn't sprout an
   * extra port.
   */
  terminationNode?: boolean;
}

/** Default for `Shield.position` — far enough in from the connector face to
 * clear the twist crossover glyph drawn in the same zone, close enough to
 * still read as "terminated at the connector" rather than mid-span. */
export const DEFAULT_SHIELD_POSITION = 0.14;

/** [inferred] — coarse shield construction families (Connor: "multiple
 * types of shields to differentiate between braids, foils"). `foilBraid` is
 * the common combo construction (foil layer + braid over it); `served` is a
 * spiral-wrapped (not woven) wire shield — distinct enough from a braid to
 * call out separately per the same request. */
export type ShieldType = 'braid' | 'foil' | 'foilBraid' | 'served';

/** [inferred] — Connor's follow-up: "Shields should have method of
 * specifying termination both in schematic form, visual form, and through
 * text notes that can point to the backshell." `style` drives the schematic
 * glyph (see SchematicCanvas's shield-termination rendering); `note` is the
 * free-text field that can reference a backshell/connector by name since
 * there's no separate backshell-part linkage in the data model yet. */
export interface ShieldTermination {
  style?: 'pigtail' | 'lugTo360' | 'drainWire' | 'none';
  /** Free text — e.g. "terminates to backshell BS1 EMI band". */
  note?: string;
}

// ---------------------------------------------------------------------------
// Mates
// ---------------------------------------------------------------------------

/**
 * Two connectors plugged into each other, or terminals joined to each other
 * or into a connector cavity. Bulkhead and pass-through connectors are the
 * everyday case.
 *
 * WHY THIS IS ITS OWN ENTITY, not a wire and not a part reference:
 *
 * A mate is not a conductor — it carries no length, no gauge and no BOM line,
 * so modelling it as a Wire would corrupt every length and BOM rollup that
 * walks `doc.wires`. It is also not a property of a Part: the same connector
 * part can be mated to different things in different places in one harness,
 * and `ConnectorPart.matingPartId` only records what a part is *compatible*
 * with, never what a given instance is actually plugged into.
 *
 * What it DOES do is join nets. Mating C1 to C2 puts C1 cavity 1 and C2
 * cavity 1 on the same net with no wire drawn between them, which is why net
 * extraction has to know about mates (see derive/mates.ts). Until this
 * existed a bulkhead's two halves were unavoidably separate nets, which is
 * wrong in a way no amount of UI could paper over.
 *
 * CAVITY CORRESPONDENCE — engineer-confirmed, see docs/DOMAIN-DECISIONS.md D3.
 *
 * Pairing is never inferred from designations. Two mating housings routinely
 * label the same physical position differently (1..8 against A..H), so
 * matching on labels would mis-wire exactly the connectors most likely to be
 * bulkheads.
 *
 * Positional pairing — nth to nth — is the DEFAULT, and only a default. It is
 * right often enough to be a sensible starting point and wrong often enough
 * that the tool must not assert it: keyed housings, rotated inserts and
 * mixed-density mates all break it. So `cavityMap` exists, it overrides the
 * default entirely when present, and the UI must let the user edit it.
 *
 * A map that names only some cavities leaves the rest UNPAIRED rather than
 * falling back to positional for the remainder. A half-specified map is a
 * statement about the pairs it names, not an invitation to guess the others.
 */
/** One explicit cavity pairing inside a Mate. */
export interface MateCavityPair {
  sourceCavityId: CavityId;
  targetCavityId: CavityId;
}

export interface Mate {
  id: MateId;
  sourceId: ComponentId;
  targetId: ComponentId;
  /** Required only when mating a terminal INTO a connector cavity: a terminal
   * has one port, so the connector end needs to say which cavity receives it.
   * Meaningless (and ignored) for connector-to-connector mates. */
  targetCavityId?: CavityId;
  /** Explicit cavity pairing for a connector-to-connector mate. Absent means
   * positional. See the doc comment above for why this cannot be inferred
   * from designations, and why positional is only a default. */
  cavityMap?: MateCavityPair[];
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
  /** [inferred] — Connor's follow-up: "Dimensions between each routing point
   * should be able to be recorded (every single point), but the layout can
   * be assumed to be not to scale." One entry per segment of the path
   * `[source, ...waypoints, target]` (so `segmentLengths.length` should equal
   * `(waypoints?.length ?? 0) + 1`), in the document's lengthUnit — a hole
   * (`undefined`) just means that particular segment hasn't been measured
   * yet, same "unset = not authored" convention `length` already uses.
   * `derive/bundleLength.ts` sums whichever of `segmentLengths` / `length`
   * is more specific; nothing here implies the on-screen line is drawn to
   * scale (it never is — see LayoutCanvas.tsx's fixed PX_PER_MM). */
  segmentLengths?: (number | undefined)[];
  custom: Record<string, unknown>;
}

export type LengthStatus =
  | 'exact' | 'lowerBound' | 'noRoute' | 'unplaced' | 'overridden'
  | 'jumper' | 'shield';

// ---------------------------------------------------------------------------
// Parts (spec §4.5)
// ---------------------------------------------------------------------------

/**
 * [inferred] — Connor: "replace the single `maxRating` field with a
 * repeatable list of `{value, type: min/max/nom/typ...}` parameters,
 * user-extensible."
 *
 * `maxRating?: { value, unit }` was the previous shape: one generic
 * value+unit pair meant to stand in for whatever rating mattered most for a
 * given part kind. Real catalog parts don't have one rating — a wire has a
 * voltage rating AND a current rating AND a temperature range, and the
 * temperature range is itself two numbers (a min and a max) describing the
 * same named quantity. A single slot forces the user to pick which fact to
 * keep and throw the rest away.
 *
 * So: a list, each entry naming its own quantity, qualifier and unit.
 * `unit` is a free string rather than an enum precisely because this has to
 * be user-extensible — the app offers a suggestion list (see the app's
 * PARAMETER_UNITS) but never rejects a unit it hasn't heard of, which is
 * what "user-extensible" has to mean for a field whose whole job is to
 * record whatever the datasheet actually says.
 *
 * Legacy `maxRating` values are converted to a single `{ name: 'Max rating',
 * qualifier: 'max' }` parameter on load — see `migrateLegacyFields`.
 */
export type ParameterQualifier = 'nom' | 'min' | 'max' | 'typ' | 'abs';

export interface PartParameter {
  /** Stable id so the editor can key rows and reorder without remounting. */
  id: string;
  /** What quantity this is — "Voltage rating", "Operating temperature", … */
  name: string;
  qualifier: ParameterQualifier;
  value: number;
  /** Free text. 'V', 'A', 'degC', 'N·m', 'cycles' — whatever the datasheet says. */
  unit: string;
}

export const PARAMETER_QUALIFIERS: { value: ParameterQualifier; label: string }[] = [
  { value: 'nom', label: 'nom' },
  { value: 'min', label: 'min' },
  { value: 'max', label: 'max' },
  { value: 'typ', label: 'typ' },
  { value: 'abs', label: 'abs max' },
];

/** One-line rendering of a parameter, used by the BOM table, the BOM CSV and
 * tooltips so all three read identically. */
export function formatParameter(p: PartParameter): string {
  const name = p.name.trim() || 'Parameter';
  return `${name}: ${p.qualifier} ${p.value}${p.unit ? ` ${p.unit}` : ''}`;
}

export interface PartBase {
  id: PartId;
  kind: string;
  partNumber?: string;
  manufacturer?: string;
  /** [inferred] — Connor's follow-up: "manf PN, vendor PN". `partNumber`
   * above is the manufacturer's own part number; this is the distributor/
   * vendor's catalog number for the same part, which is very often
   * different (e.g. a Digi-Key or Mouser SKU vs. the TE Connectivity part
   * number itself). */
  vendorPartNumber?: string;
  description?: string;
  url?: string;
  price?: number;
  /** [inferred] — see PartParameter. Replaces the former single `maxRating`. */
  parameters?: PartParameter[];
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

/** [inferred] — not in either reference export; added for Connor's follow-up
 * "make better graphical representations of connectors based of connector
 * type (have sub categories...)". A coarse family of common physical
 * connector housings, not a real part-catalog taxonomy — good enough to
 * pick a recognizably different glyph, with room to grow. */
export type ConnectorHousingShape = 'rectangular' | 'circular' | 'dSub' | 'inline' | 'blockTerminal';

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
  /** [inferred] Physical housing family, drives which glyph the Schematic
   * and Layout canvases draw for connectors using this part. Defaults to
   * 'rectangular' (the original single connector icon) when unset, so
   * every pre-existing document renders exactly as before. */
  housingShape?: ConnectorHousingShape;
  /** [inferred] "...or ways to eventually make custom mini icons for
   * connectors if users want to manually override their appearance" — a
   * short user-typed glyph (emoji or 1-2 characters) that, when set,
   * replaces the housing-shape icon entirely for this part. */
  iconGlyph?: string;
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
  /**
   * [inferred] — Connor: "wire parts gain optional per-unit-length
   * resistance and capacitance fields."
   *
   * Per the document's own `lengthUnit`, not per metre: the wire's BOM
   * quantity is already authored and reported in that unit (see
   * derive/bom.ts), so keeping these in the same unit means the parasitic
   * total is a plain multiply against a length the user can see, with no
   * hidden conversion to get wrong. Ω and F respectively, matching
   * `Parasitics`.
   *
   * These live on the WirePart rather than on `Parasitics` because unlike a
   * component's parasitics they are a property of the *purchased wire*, not
   * of one instance of it: every wire cut from the same spool has the same
   * Ω/length, and only the length differs.
   */
  resistancePerLength?: number;
  capacitancePerLength?: number;
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

/**
 * TYPED FIELDS vs THE OPEN `parameters[]` LIST — read this before adding either.
 *
 * `PartBase.parameters` exists to record whatever a datasheet says, in the
 * user's own words and units. It is deliberately unconstrained, and that is
 * exactly why nothing can validate against it: a rule cannot key off a field
 * whose name the user invented.
 *
 * So the two coexist, and the dividing line is a rule, not a preference:
 *
 *   A field is TYPED if and only if a derive stage or a DRC rule reads it.
 *
 * Everything below is typed because something checks it. A voltage rating
 * nobody checks belongs in `parameters`, not here. Adding a typed field
 * without a corresponding consumer is how a data model rots into a form.
 */

/** Gauge-constrained parts share this shape. The pair is a closed range and
 * both ends are optional: a part that only publishes one end is common, and
 * an absent bound means "unconstrained in that direction", never zero. */
export interface GaugeRange {
  minGauge?: Gauge;
  maxGauge?: Gauge;
}

export interface SplicePart extends PartBase, GaugeRange {
  kind: 'splice';
  spliceKind?: SpliceKind;
}

export interface TerminalPart extends PartBase, GaugeRange {
  kind: 'terminal';
  terminalKind?: TerminalKind;
  /** Stud/screw size. A union because the real world is both: a ring terminal
   * is `{ value: 6, unit: 'mm' }` in one catalog and the string `#8` in
   * another (US screw gauge), and coercing `#8` into a number would silently
   * invent a dimension. Mate size-compatibility compares numerics
   * numerically and strings by exact match — see derive/mates.ts. */
  size?: Gauge | { value: number; unit: LengthUnit } | string;
  /** Quick-connect tabs are the one terminal family with a gender. */
  gender?: 'male' | 'female';
}

export interface ContactPart extends PartBase, GaugeRange {
  kind: 'contact';
  /** How the conductor is attached. Drives which assembly rules apply. */
  terminationType?: 'crimp' | 'solder' | 'other';
  gender?: 'pin' | 'socket';
  /** The seal fitted around this contact where its wire enters the cavity.
   * Referenced from the contact rather than the cavity because the seal is
   * chosen to fit the CONTACT, and the BOM quantity follows contact usage. */
  cavitySealPartId?: PartId;
}

export interface ResistorPart extends PartBase {
  kind: 'resistor';
  /** Stored in base SI (Ω, W) for the same reason `Parasitics` is: there is
   * one physical quantity per field, so a unit selector would only be
   * choosing a display prefix. Format with `formatSi`. */
  resistanceOhms?: number;
  powerWatts?: number;
}

export interface DiodePart extends PartBase {
  kind: 'diode';
  /** Reverse breakdown voltage, V. */
  breakdownVoltage?: number;
  /** Forward current rating, A. */
  forwardCurrent?: number;
}

/** One conductor inside a cable part. Cores carry no `partId` of their own —
 * they are described by the cable they belong to, and giving them one would
 * let a core disagree with its own cable about what it is. */
export interface CableCorePart {
  id: string;
  color: WireColor;
  stripeColor?: WireColor;
  gauge?: Gauge;
}

export interface CablePart extends PartBase {
  kind: 'cable';
  shielded?: boolean;
  /** Per-core detail. `coreCount` is retained only for documents written
   * before this existed; when `cores` is present it is authoritative and the
   * count is `cores.length`. */
  cores?: CableCorePart[];
  coreCount?: number;
}
/** [inferred] — backs `WireGroup.shield.partId` (spec follow-up: shield
 * data model). `coverage` is braid-only (percent, 0-100); `foil`/`served`
 * shields don't have a meaningful coverage figure so it's left blank for
 * those. `drainWire` flags a bare drain conductor run alongside a foil
 * shield for termination, common practice for foil-only constructions. */
export interface ShieldPart extends PartBase {
  kind: 'shield';
  shieldType: ShieldType;
  coverage?: number;
  material?: string;
  outerDiameter?: number;
  drainWire?: boolean;
}
export interface AccessoryPart extends PartBase {
  kind: 'accessory';
  accessoryType?: 'contact' | 'lock' | 'dustCover' | 'backshell' | 'boot' | 'cavitySeal';
}
export interface GenericPart extends PartBase { kind: 'generic' }

export type Part =
  | ConnectorPart | WirePart | CablePart | SplicePart | TerminalPart | ContactPart
  | ResistorPart | DiodePart | CoveringPart | AccessoryPart | ShieldPart | GenericPart;

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
  /** Distributor/vendor catalog number — see PartBase.vendorPartNumber. */
  vendorPartNumber?: string;
  description: string;
  quantity: number;
  unit: 'ea' | 'mm' | 'cm' | 'm' | 'in' | 'ft';
  unitPrice?: number;
  extendedPrice?: number;
  /** Datasheet/vendor page — see PartBase.url. */
  url?: string;
  /** The part's own parameter list, carried through verbatim so the BOM
   * table and CSV can render it without a second lookup into `doc.parts`. */
  parameters?: PartParameter[];
  refdes: string[];
  warnings: string[];
}

/**
 * [inferred] — per-wire parasitic totals (Connor: parasitics on components,
 * and per-unit-length R/C on wire parts). Derived rather than authored: the
 * numbers a user actually wants are `resistancePerLength × length`, and
 * length is itself derived, so computing this anywhere but the derive
 * pipeline would mean duplicating the length logic.
 *
 * `lengthKnown` is false when the wire's length status is `noRoute` or
 * `unplaced` — the R/C figures are then 0 not because the wire is ideal but
 * because there's no length to multiply, and a UI that showed a bare "0 Ω"
 * for an unrouted wire would be actively misleading.
 */
export interface WireParasitics {
  resistanceOhms: number;
  capacitanceFarads: number;
  lengthKnown: boolean;
}

/**
 * [inferred] — Connor's follow-up: "the schematic [should be] bidirectionally
 * convertible to an interconnect table... capture where each signal goes (to
 * and from, if directionality is defined)." One row per wire; `resolved`
 * folds each endpoint's own `SignalDirection` into a single answer for the
 * pair, since direction is authored per-cavity/per-core, not per-wire (see
 * SignalDirection's doc comment) — 'sourceToTarget'/'targetToSource' when the
 * two ends disagree in a consistent way (one's an output, the other's an
 * input), 'bidirectional' when neither end asserts a direction or both
 * assert the same one, and 'conflict' for the nonsensical case of both ends
 * independently claiming to be an output (or both an input) — surfaced
 * rather than silently guessed, so a bad table import is visible instead of
 * quietly wrong. Every wire gets a row, even ones with no signal name on
 * either end (fromSignal/toSignal fall back to undefined, matching how the
 * BOM/Layout tooltips already treat unnamed wires) — the table's whole job
 * is to be a complete, lossless alternate view of the same connectivity the
 * Schematic canvas draws, in both directions of sync (see interconnect.ts's
 * `computeInterconnectTable` doc comment for the reverse direction).
 */
export interface InterconnectRow {
  wireId: WireId;
  wireRefdes: string;
  fromComponentId?: ComponentId;
  fromComponentRefdes: string;
  fromDesignation?: string;
  fromSignal?: string;
  fromDirection?: SignalDirection;
  fromImpedanceMatched?: boolean;
  toComponentId?: ComponentId;
  toComponentRefdes: string;
  toDesignation?: string;
  toSignal?: string;
  toDirection?: SignalDirection;
  toImpedanceMatched?: boolean;
  resolved: 'sourceToTarget' | 'targetToSource' | 'bidirectional' | 'conflict';
  impedanceMatched: boolean;
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
  interconnect: InterconnectRow[];
  /** See WireParasitics. One entry per wire, always present (a wire with no
   * part, or a part with no per-length figures, yields zeros). */
  wireParasitics: Map<WireId, WireParasitics>;
}
