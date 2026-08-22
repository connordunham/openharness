/**
 * The Schematic canvas (spec §7.2) — the first real editing surface, not
 * just a viewer. Every edit here — add a component, draw a wire, rename a
 * refdes, edit a signal, drag a box, delete — goes through
 * `store.transact(...)`, the same call an automation makes (spec §8.3).
 *
 * Editing UX is modeled directly on the reference tool,
 * per Connor's follow-up requests and the confirmed behaviour recorded in
 * HARNESS-DESIGNER-SPEC.md §2.3:
 *   - the component editor is a floating card anchored under the selected
 *     node on the canvas, not a docked side panel;
 *   - a selected connector gets a `− N +` cavity-count stepper floating
 *     above the node, and a flip chevron that mirrors which side wires
 *     exit (Connector.flipped);
 *   - a splice is drawn with two ports, like a two-terminal part, even
 *     though the data model still treats it as one n-ary net endpoint
 *     (spec §3.3/§6.1) — see schematicScene.ts.
 *
 * Wiring core (Connor's "seriously revamp the wiring implementation"
 * request): wires are no longer straight lines — schematicScene now routes
 * every wire on an orthogonal grid with 45°-mitered corners
 * (@openharness/render/routing.ts), and that routed trace *is* the wire's
 * symbol: clicking it opens a properties popup (color, stripe, part/gauge,
 * refdes), and cables are no longer a component you place — they're formed
 * by grouping 2+ wires (shift-click to multi-select, "Group" to bundle),
 * which is also how twisted pairs are captured. A WireGroup with a part
 * attached becomes a real cable; without one it's just a physical twist.
 * This is the same mechanism for both, per Connor's clarification
 * ("allowing group through twisting but also allow for grouping of single
 * wires or multiple pairs") — groups nest via `memberGroupIds`, so pairs
 * can be bundled into a larger jacketed cable.
 *
 * Component coverage: connector, splice, terminal, resistor, and diode are
 * creatable from the toolbar and editable in the floating inspector. The
 * legacy `cable` component type is still rendered/editable for import
 * fidelity (an imported design may already have one) but is deliberately
 * NOT on the "Add" toolbar any more — "cables shouldn't be added like a
 * component, they should be captured in the wiring." Branch points and the
 * bare "generic" type are also left out of the "Add" toolbar.
 */

import { useCallback, useMemo, useState } from 'react';
import { useEffect, useRef } from 'react';
import type {
  HarnessStore, Endpoint, Component, Connector, Point, HarnessDocument,
  SpliceKind, TerminalKind, ConnectorPart, ConnectorConfiguration, ConnectorHousingShape, PartId, WireGroup, WirePart,
  ShieldPart, ShieldType, ShieldTermination, Shield, ShieldModel, Part, SignalDirection, Parasitics,
  Mate,
} from '@openharness/core';
import {
  newInstanceId, newPartId, endpointComponentId, formatSi,
  DEFAULT_SHIELD_POSITION, BACKSHELL_CAVITY_ID,
} from '@openharness/core';
import {
  computeSchematicScene, collectGroupMembers, shieldTerminationMarks, twistCrossoverPaths,
  waypointInsertIndex, segmentIntersectsRect, type SceneNode, type SceneRow, type SceneWire,
  ROW_HEIGHT, HEADER_HEIGHT, clientPointToCanvas, exceedsDragThreshold,
  schematicContentRects, schematicSelectionRects, type SchematicSelectionItem,
} from '@openharness/render';
import { theme } from './theme.js';
import { ComponentIcon, connectorAppearance } from './icons.js';
import { nextLayoutGrid, autoRouteInLayout } from './layoutGrid.js';
import { nextGridPosition, nextRefdes } from './schematicGrid.js';
import { useCanvasPan } from './canvasPan.js';
import { useCanvasZoom } from './useCanvasZoom.js';
import { SHIELD_TYPES, SHIELD_TERMINATION_STYLES, SHIELD_MODELS } from './shieldConstants.js';
import { PartCommonFields, ParasiticsFields } from './partFields.js';
import { SYMBOL_NODE_TYPES, renderNodeSymbol } from './schematicSymbols.js';
import {
  addMateInDraft, deleteMateInDraft, removeMatesOfComponentInDraft,
  setMateTargetCavityInDraft, addMateCavityPairInDraft, updateMateCavityPairInDraft,
  removeMateCavityPairInDraft, clearMateCavityMapInDraft,
} from './mateOps.js';

interface Props {
  store: HarnessStore;
  /** Cross-pane hover highlighting (Layout/BOM/Schematic all share one id
   * via App.tsx) — see the file header note in LayoutCanvas.tsx. Both
   * optional so this component still works standalone (e.g. in tests). */
  hoveredComponentId?: string | null;
  onHoverComponent?: (id: string | null) => void;
  /** Wire/bundle cross-pane hover (Connor: "when I hover over wires or
   * connectors I want that highlighted in the schematic... if I highlight a
   * bundle, I want all wires that route through that point highlighted and
   * all relevant connectors highlighted"). Schematic is the pane that draws
   * individual wires, so it *originates* `hoveredWireId` (via
   * `onHoverWire`); `hoveredBundleId` only ever arrives from Layout (there's
   * nothing to click-and-report here — no `onHoverBundle`), and this pane
   * resolves it to the set of wires+connectors to highlight via
   * `store.derived.bundleContents`. */
  hoveredWireId?: string | null;
  onHoverWire?: (id: string | null) => void;
  hoveredBundleId?: string | null;
}

/**
 * A wire being drawn. `componentId`/`rowId` identify the clicked port so a
 * second click on the same port cancels; for a shield termination node there
 * is no component, so `componentId` carries the group id and `rowId` the
 * reserved SHIELD_ROW marker — the equality check that drives "click the
 * same port again to cancel" only needs the pair to be unique, not to name a
 * real component.
 */
interface PendingWire {
  componentId: string;
  rowId: string;
  endpoint: Endpoint;
}

const SHIELD_ROW = '__shieldNode__';

/**
 * A mate being created by clicking two components in sequence (the same
 * two-click gesture as drawing a wire). `componentId` is the first clicked
 * component; a click on any second component completes the mate. If that
 * second click lands on a connector cavity row, the cavity is passed along
 * too — addMateInDraft is the only place the direction and cavity semantics
 * are interpreted (it keeps the cavity only for terminal-into-connector
 * mates and always writes the terminal as the source).
 */
interface PendingMate {
  componentId: string;
}

type Selection =
  | { kind: 'component'; id: string }
  | { kind: 'note'; id: string }
  | { kind: 'wire'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'mate'; id: string }
  | null;

interface Dragging {
  kind: 'component' | 'note';
  id: string;
  pointerStartX: number;
  pointerStartY: number;
  boxStartX: number;
  boxStartY: number;
}

/**
 * An in-progress drag of one manual wire bend (Connor: reimplement
 * drag-to-bend).
 *
 * `index` is the position in `Wire.schematicWaypoints`, and the waypoint is
 * already in the document by the time this state exists — grabbing a fresh
 * segment inserts the bend first (see `beginBend`), so dragging an existing
 * bend and dragging a newly-created one are the same code path from here on.
 */
interface BendDrag {
  wireId: string;
  index: number;
}

/**
 * A left-drag on empty canvas that hasn't yet been classified. A bend is
 * only created once the pointer actually moves past DRAG_THRESHOLD, so a
 * plain click on a wire still just selects it instead of silently littering
 * the route with zero-offset bends.
 */
interface PendingBend {
  wireId: string;
  origin: Point;
  insertIndex: number;
}

/** Marquee (lasso) selection rectangle, in canvas coordinates. */
interface Lasso {
  origin: Point;
  current: Point;
  /** Shift-drag adds to the existing selection instead of replacing it. */
  additive: boolean;
}

/** Pointer travel (screen px) that separates a click from a drag. A pixel
 * budget, not a canvas-unit one — hand jitter happens in screen pixels
 * regardless of zoom, so the comparison must scale with the view
 * (`exceedsDragThreshold`, review concern C9). */
const DRAG_THRESHOLD = 3;

interface ContextMenuState {
  x: number;
  y: number;
  target: { kind: 'component' | 'wire' | 'group' | 'note' | 'mate'; id: string };
}

const SPLICE_KINDS: SpliceKind[] = ['crimp', 'weld', 'solderSleeve'];
const TERMINAL_KINDS: TerminalKind[] = [
  'ferrule', 'ring', 'spade', 'maleQuickConnect', 'femaleQuickConnect', 'looseWireEnd',
];
const HOUSING_SHAPES: { value: ConnectorHousingShape; label: string }[] = [
  { value: 'rectangular', label: 'Rectangular (multi-pin)' },
  { value: 'circular', label: 'Circular' },
  { value: 'dSub', label: 'D-sub' },
  { value: 'inline', label: 'Inline / bullet' },
  { value: 'blockTerminal', label: 'Terminal block' },
];
const ACCESSORY_SLOTS = [
  { key: 'lockPartId', label: 'Lock', type: 'lock' },
  { key: 'dustCoverPartId', label: 'Dust cover', type: 'dustCover' },
  { key: 'backshellPartId', label: 'Backshell', type: 'backshell' },
  { key: 'bootPartId', label: 'Boot', type: 'boot' },
  { key: 'contactPartId', label: 'Contact', type: 'contact' },
  { key: 'cavitySealPartId', label: 'Cavity seal', type: 'cavitySeal' },
] as const;

/** Standard wire-color palette (auto-assigned round-robin on creation, spec
 * request: "Automatically assign a colour, but allow users to select the
 * wire colour"). These are all valid CSS named colors, so they can be used
 * directly as an SVG `stroke` with no lookup table. */
const WIRE_COLORS = [
  'Black', 'Red', 'White', 'Green', 'Blue', 'Yellow', 'Orange', 'Brown', 'Violet', 'Gray', 'Tan', 'Pink',
] as const;

/**
 * Multi-selection is a flat `Set<string>` of `kind:id` keys rather than a
 * set of tagged objects, because a Set of objects can't dedupe by value —
 * shift-clicking the same wire twice would add two entries. Components join
 * wires and groups in this space now (Connor: "extend shift-click to any
 * component type, currently it only works on wires/groups"), which is why
 * `parseKey`'s union grew a third member.
 */
type SelectableKind = 'wire' | 'group' | 'component' | 'mate';

function wireKey(id: string): string {
  return `wire:${id}`;
}
function groupKey(id: string): string {
  return `group:${id}`;
}
function componentKey(id: string): string {
  return `component:${id}`;
}
function mateKey(id: string): string {
  return `mate:${id}`;
}
function parseKey(key: string): { kind: SelectableKind; id: string } | null {
  const i = key.indexOf(':');
  if (i < 0) return null;
  const kind = key.slice(0, i);
  if (kind !== 'wire' && kind !== 'group' && kind !== 'component' && kind !== 'mate') return null;
  return { kind, id: key.slice(i + 1) };
}

/**
 * Delete a wire and tidy up the group it belonged to. Shared by the
 * single-selection and multi-selection delete paths so the group cleanup —
 * drop the membership, and drop the group entirely once it has no members
 * left — can't be implemented once and forgotten in the other.
 */
function deleteWireInDraft(draft: HarnessDocument, wireId: string): void {
  const wire = draft.wires[wireId];
  const gid = wire?.twistGroupId;
  delete draft.wires[wireId];
  if (!gid) return;
  const group = draft.wireGroups[gid];
  if (!group) return;
  group.memberWireIds = group.memberWireIds.filter((id) => id !== wireId);
  if (group.memberWireIds.length === 0 && group.memberGroupIds.length === 0) delete draft.wireGroups[gid];
}

/** Delete a component and every wire that lands on it. */
function deleteComponentInDraft(draft: HarnessDocument, componentId: string): void {
  delete draft.components[componentId];
  for (const [wireId, wire] of Object.entries(draft.wires)) {
    if (endpointComponentId(wire.source) === componentId || endpointComponentId(wire.target) === componentId) {
      deleteWireInDraft(draft, wireId);
    }
  }
  // A mate naming a deleted component would linger as an invisible, unselectable
  // entry — drop it too (see removeMatesOfComponentInDraft).
  removeMatesOfComponentInDraft(draft, componentId);
}

/** The termination detail for one end of a shield: that end's own override
 * if set, otherwise the shield's shared default. Kept as a function rather
 * than inlined at its two call sites (the canvas and the inspector) so the
 * fallback rule can't drift between what gets drawn and what gets edited. */
function terminationForEnd(shield: Shield, end: 'source' | 'target'): ShieldTermination | undefined {
  return (end === 'source' ? shield.sourceTermination : shield.targetTermination) ?? shield.termination;
}

/** Axis-aligned box from two corners, in either drag direction. */
function lassoRect(l: Lasso): { x: number; y: number; width: number; height: number } {
  const x = Math.min(l.origin.x, l.current.x);
  const y = Math.min(l.origin.y, l.current.y);
  return { x, y, width: Math.abs(l.current.x - l.origin.x), height: Math.abs(l.current.y - l.origin.y) };
}

function rectContainsPoint(r: { x: number; y: number; width: number; height: number }, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

function rectIntersectsRect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

/**
 * A wire is lassoed when ANY point of its routed path falls inside the
 * marquee — not when the whole path does.
 *
 * Requiring full containment sounds tidier and is wrong in practice: a wire
 * runs between two connectors, so a marquee that fully contains the wire
 * almost always contains both connectors too, and there'd be no way to
 * select a group of wires without also selecting everything they attach to.
 * Touch-selection is also what every schematic tool does for traces.
 */
function wireTouchesRect(w: SceneWire, r: { x: number; y: number; width: number; height: number }): boolean {
  return w.routePoints.some((p) => rectContainsPoint(r, p));
}

function rowEndpoint(node: SceneNode, row: SceneRow): Endpoint {
  switch (node.type) {
    case 'connector':
      return { kind: 'cavity', componentId: node.componentId, cavityId: row.rowId };
    case 'cable':
      return { kind: 'cableCore', componentId: node.componentId, coreId: row.rowId };
    case 'splice':
      return { kind: 'splice', componentId: node.componentId };
    case 'terminal':
      return { kind: 'terminalPoint', componentId: node.componentId };
    case 'resistor':
    case 'diode':
      return { kind: 'twoTerminalSide', componentId: node.componentId, side: row.rowId.endsWith('Left') ? 'Left' : 'Right' };
    default:
      return { kind: 'free', point: row.point };
  }
}

/** Click-to-cycle order for the schematic row's direction toggle (Connor:
 * "toggle between bi-directional, input, and output") — undefined reads the
 * same as 'bidirectional' (see SignalDirection's doc comment in
 * core/types.ts), so the cycle starts from there and visits every state in
 * one predictable loop: unset/bidirectional -> output -> input -> back to
 * bidirectional. */
function cycleDirection(current: SignalDirection | undefined): SignalDirection {
  if (current === 'output') return 'input';
  if (current === 'input') return 'bidirectional';
  return 'output';
}

/** Mutates whichever signal-capable row (a connector Cavity or a Cable
 * core/shield — the only two `Component` sub-shapes with a direction/
 * impedanceMatched field, see SceneRow.signalCapable) backs `rowId` on
 * `componentId`. Shared by the direction-cycle and impedance-toggle click
 * handlers below and by the fuller Properties-tab editor further down this
 * file, so both surfaces agree on exactly what they're editing. */
function updateSignalRow(
  draft: HarnessDocument,
  componentId: string,
  rowId: string,
  mutate: (row: { direction?: SignalDirection; impedanceMatched?: boolean }) => void,
) {
  const c = draft.components[componentId];
  if (c?.type === 'connector') {
    const cav = c.cavities.find((cv) => cv.id === rowId);
    if (cav) mutate(cav);
  } else if (c?.type === 'cable') {
    const core = [...c.cores, ...(c.shield ? [c.shield] : [])].find((cr) => cr.id === rowId);
    if (core) mutate(core);
  }
}

/** A component's own part number, or '' if it has none yet — used by the
 * inline part-number label/editor on the default node view (Connor: "modify
 * the part number in the schematic default view without having to click
 * into the properties" — since generalized to every component type, not
 * just connectors, per Connor's later "ensure all relevant features added
 * to the connector objects also appear in the other components"). */
function componentPartNumber(store: HarnessStore, componentId: string): string {
  const c = store.doc.components[componentId];
  const partId = c && 'partId' in c ? c.partId : undefined;
  return partId ? store.doc.parts[partId]?.partNumber ?? '' : '';
}

/** Default refdes for a newly-shielded WireGroup ("SH1", "SH2"...), same
 * auto-fill-if-empty convention as `setKind('cable')` uses for CB1/CB2 —
 * see GroupInspector's `setShielded`. Wire groups aren't a `Component`, so
 * this can't reuse `nextRefdes` (which counts by `Component['type']`). */
function nextShieldRefdes(store: HarnessStore): string {
  const count = Object.values(store.doc.wireGroups).filter((g) => !!g.shield).length;
  return `SH${count + 1}`;
}

/** True if any wire endpoint touches this cavity — used to guard the "−"
 * stepper (spec §2.3: "Add/remove trailing cavities (guarded if wired)"). */
function cavityIsWired(store: HarnessStore, componentId: string, cavityId: string): boolean {
  const touches = (ep: Endpoint) => ep.kind === 'cavity' && ep.componentId === componentId && ep.cavityId === cavityId;
  return Object.values(store.doc.wires).some((w) => touches(w.source) || touches(w.target));
}

function ensureConnectorPart(draft: HarnessDocument, componentId: string): ConnectorPart {
  const c = draft.components[componentId];
  if (!c || c.type !== 'connector') throw new Error('not a connector');
  if (!c.partId) {
    const partId = newPartId();
    const part: ConnectorPart = {
      id: partId, kind: 'connector', numberOfCavities: c.cavities.length,
      designationTemplate: { kind: 'numbers' }, configurations: [], custom: {},
    };
    draft.parts[partId] = part;
    c.partId = partId;
  }
  return draft.parts[c.partId] as ConnectorPart;
}

/** Same lazy-create pattern as ensureConnectorPart, generalized to every
 * other purchasable component type (Connor: "ensure all relevant features
 * added to the connector objects also appear in the other components" —
 * the Properties tab's part fields are the clearest case: every component
 * type should be able to carry a part number/cost/etc., not just
 * connectors). Connector keeps its own dedicated `ensureConnectorPart`
 * (it needs extra defaults — numberOfCavities, designationTemplate,
 * configurations — that don't apply to any other kind), so this only
 * handles the remaining purchasable types. */
function ensureComponentPart(draft: HarnessDocument, componentId: string): Part {
  const c = draft.components[componentId];
  if (!c) throw new Error('no such component');
  if (c.type === 'connector') return ensureConnectorPart(draft, componentId);
  if (c.type === 'branchPoint') throw new Error('branch points have no part');
  if (!c.partId) {
    const partId = newPartId();
    const part: Part =
      c.type === 'splice' ? { id: partId, kind: 'splice', custom: {} }
      : c.type === 'terminal' ? { id: partId, kind: 'terminal', custom: {} }
      : c.type === 'resistor' ? { id: partId, kind: 'resistor', custom: {} }
      : c.type === 'diode' ? { id: partId, kind: 'diode', custom: {} }
      : c.type === 'cable' ? { id: partId, kind: 'cable', custom: {} }
      : { id: partId, kind: 'generic', custom: {} };
    draft.parts[partId] = part;
    c.partId = partId;
  }
  return draft.parts[c.partId]!;
}

/** Same lazy-create pattern as ensureConnectorPart, for a wire's own
 * WirePart (spec §4.5 shape) — the part-number field on the wire-properties
 * popup. */
function ensureWirePart(draft: HarnessDocument, wireId: string): WirePart {
  const w = draft.wires[wireId];
  if (!w) throw new Error('no such wire');
  if (!w.partId) {
    const partId = newPartId();
    const part: WirePart = {
      id: partId, kind: 'wire',
      gauge: w.gauge ?? { value: 0.5, unit: draft.settings.gaugeUnit },
      color: w.color, custom: {},
    };
    draft.parts[partId] = part;
    w.partId = partId;
  }
  return draft.parts[w.partId] as WirePart;
}

export function SchematicCanvas({
  store, hoveredComponentId, onHoverComponent, hoveredWireId, onHoverWire, hoveredBundleId,
}: Props) {
  const [selected, setSelected] = useState<Selection>(null);
  const [multiSelect, setMultiSelect] = useState<Set<string>>(new Set());
  const [pendingWire, setPendingWire] = useState<PendingWire | null>(null);
  // Mate creation is a two-click gesture like wiring (see PendingMate). It is
  // mutually exclusive with a pending wire: both would compete for the same
  // "next port/component click", so starting one cancels the other.
  const [pendingMate, setPendingMate] = useState<PendingMate | null>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'edit' | 'properties'>('edit');
  const [editingCavity, setEditingCavity] = useState<{ componentId: string; cavityId: string } | null>(null);
  // Connor: "I want the ability to flip the connector orientation and
  // modify the part number in the schematic default view without having
  // to click into the properties" — same single-click-to-edit convention
  // as `editingCavity` above, just for the connector's own part number
  // instead of a cavity's signal name. Flip itself needs no state at all
  // (it's a one-click toggle, not an editable field).
  const [editingPartNumber, setEditingPartNumber] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  // Connor's follow-up: "I don't like the drop down menus that appear upon
  // a click... almost no drop down menu needed unless the user right
  // clicks." Plain click now only selects/highlights (see `select()`); the
  // full property card (ComponentInspector/WireInspector/GroupInspector/
  // note editor) only opens when this is explicitly set true, which only
  // happens for (a) right-click -> "Edit" in the context menu, or (b) right
  // after creating a new part via the toolbar, where showing the editor
  // immediately is the whole point of clicking "Add".
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // Manual wire routing (drag-to-bend) and marquee selection. `pendingBend`
  // is a ref, not state: it's read and cleared inside the mousemove handler
  // on the very first move event, and routing it through a state update
  // would mean the handler that needs it still sees the previous render's
  // value on that first move.
  const [bendDrag, setBendDrag] = useState<BendDrag | null>(null);
  const pendingBend = useRef<PendingBend | null>(null);
  const [lasso, setLasso] = useState<Lasso | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // Zoom is per-pane and view-only (T04 contract): the state lives in the
  // shared hook, never in the document. useCanvasPan owns the single wheel
  // listener and classifies each event (B3); zoom events land in the hook's
  // onWheelZoom, pan events scroll the container there.
  const { panX, panY, scale, setContentSize, onWheelZoom, fitTo } = useCanvasZoom(scrollRef);
  const { onBackgroundMouseDown } = useCanvasPan(scrollRef, onWheelZoom);

  /**
   * Pointer position in canvas (SVG user) coordinates.
   *
   * Reads the SVG's own bounding rect rather than the scroll container's
   * `scrollLeft`/`scrollTop`, so it stays correct regardless of how the
   * canvas is positioned inside its scroller. The rect *does* reflect the
   * zoom transform — that is the whole subtlety: it moves with the pan
   * (so the pan cancels in the subtraction) but its distances are scaled,
   * so the offset must be divided by `scale` to recover user units.
   * Skipping that division made every absolute-position interaction —
   * wire bend insert, bend drag, lasso — off by the zoom factor (review
   * B2); node drags divide by `scale` below for the same reason.
   */
  const clientToCanvas = useCallback((clientX: number, clientY: number): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };
    return clientPointToCanvas(clientX, clientY, rect, scale);
  }, [scale]);

  const scene = computeSchematicScene(store.doc);
  const selectedComponent = selected?.kind === 'component' ? store.doc.components[selected.id] : undefined;
  const selectedNote = selected?.kind === 'note' ? store.doc.notes[selected.id] : undefined;
  const selectedWire = selected?.kind === 'wire' ? scene.wires.find((w) => w.wireId === selected.id) : undefined;
  const selectedGroup = selected?.kind === 'group' ? store.doc.wireGroups[selected.id] : undefined;
  const selectedMate = selected?.kind === 'mate' ? store.doc.mates?.[selected.id] : undefined;
  const selectedNode = selectedComponent ? scene.nodes.find((n) => n.componentId === selectedComponent.id) : undefined;
  const selectedSceneNote = selectedNote ? scene.notes.find((n) => n.noteId === selectedNote.id) : undefined;
  const selectedSceneMate = selectedMate ? scene.mates.find((m) => m.mateId === selectedMate.id) : undefined;

  // Wires bundled by their WireGroup (spec: twist/cable grouping), so the
  // canvas can draw a shared "bundle" halo behind every member's own routed
  // trace — the visual cue that they're grouped, and a click target for the
  // group's own properties (distinct from clicking a single member wire).
  const wiresByGroup = useMemo(() => {
    const map = new Map<string, SceneWire[]>();
    for (const w of scene.wires) {
      const gid = store.doc.wires[w.wireId]?.twistGroupId;
      if (!gid) continue;
      const arr = map.get(gid);
      if (arr) arr.push(w);
      else map.set(gid, [w]);
    }
    return map;
  }, [scene.wires, store.doc.wires]);

  /**
   * Like `wiresByGroup`, but following nested `memberGroupIds` — a shield on
   * a jacketed cable containing two twisted pairs has no direct member wires
   * of its own, so the direct map above returns nothing for it and its
   * termination mark would silently fail to draw. The halo and twist glyph
   * deliberately keep using the direct map: a nested group draws its own
   * halo, and stacking the parent's on top would double every line.
   */
  const deepWiresByGroup = useMemo(() => {
    const byId = new Map(scene.wires.map((w) => [w.wireId, w]));
    const map = new Map<string, SceneWire[]>();
    for (const group of Object.values(store.doc.wireGroups)) {
      const members = collectGroupMembers(store.doc, group, new Set())
        .map((id) => byId.get(id))
        .filter((w): w is SceneWire => !!w);
      if (members.length > 0) map.set(group.id, members);
    }
    return map;
  }, [scene.wires, store.doc]);

  // Cross-pane wire/bundle highlighting (Connor: "if I highlight a bundle, I
  // want all wires that route through that point to be highlighted and all
  // relevant connectors highlighted"). A hovered bundle (from Layout)
  // resolves to every wire whose route passes through it via
  // `derived.bundleContents` — the same lookup Layout's own "wires through
  // this node" tooltip already uses, so this can never disagree with it. A
  // directly-hovered wire (originating right here, or reported back from
  // Layout highlighting a single wire's route) is just itself. Either way,
  // the wires' own endpoints (skipping `free` endpoints, which have no
  // component) give the connector set to highlight.
  const highlightedWireIds = useMemo(() => {
    if (hoveredWireId) return new Set([hoveredWireId]);
    if (hoveredBundleId) return new Set(store.derived.bundleContents.get(hoveredBundleId) ?? []);
    return null;
  }, [hoveredWireId, hoveredBundleId, store.derived.bundleContents]);

  const highlightedComponentIds = useMemo(() => {
    if (!highlightedWireIds) return null;
    const ids = new Set<string>();
    for (const wireId of highlightedWireIds) {
      const w = store.doc.wires[wireId];
      if (!w) continue;
      const src = endpointComponentId(w.source);
      const tgt = endpointComponentId(w.target);
      if (src) ids.add(src);
      if (tgt) ids.add(tgt);
    }
    return ids;
  }, [highlightedWireIds, store.doc.wires]);

  const select = useCallback((sel: Selection) => {
    setSelected(sel);
    setMultiSelect(new Set());
    setInspectorTab('edit');
    setContextMenu(null);
    setInspectorOpen(false);
  }, []);

  /** Like `select`, but also opens the full property card — used only for
   * the explicit "just added this" and "right-click -> Edit" flows. */
  const selectAndEdit = useCallback((sel: Selection) => {
    setSelected(sel);
    setMultiSelect(new Set());
    setInspectorTab('edit');
    setContextMenu(null);
    setInspectorOpen(true);
  }, []);

  const addConnector = useCallback(() => {
    const pos = nextGridPosition(store);
    // Auto-place in Layout too (Connor: "layout place should happen by
    // default as connectors are placed in schematic") — no separate manual
    // placement step needed; the Layout pane's "Unplaced" chip is now only
    // for components that got un-placed on purpose.
    const layoutPos = nextLayoutGrid(store);
    let newId = '';
    store.transact('Add connector', (draft) => {
      const id = newInstanceId();
      newId = id;
      const refdes = nextRefdes(store, draft.settings.refdesPrefixes.connector ?? 'C', 'connector');
      draft.components[id] = {
        id, type: 'connector', refdes,
        cavities: [
          { id: newInstanceId(), designation: '1', custom: {} },
          { id: newInstanceId(), designation: '2', custom: {} },
        ],
        schematicPosition: pos,
        layoutPosition: layoutPos,
        custom: {},
      };
    });
    selectAndEdit({ kind: 'component', id: newId });
  }, [store, selectAndEdit]);

  const addSplice = useCallback(() => {
    const pos = nextGridPosition(store);
    const layoutPos = nextLayoutGrid(store);
    let newId = '';
    store.transact('Add splice', (draft) => {
      const id = newInstanceId();
      newId = id;
      const refdes = nextRefdes(store, draft.settings.refdesPrefixes.splice ?? 'S', 'splice');
      draft.components[id] = { id, type: 'splice', refdes, spliceKind: 'crimp', schematicPosition: pos, layoutPosition: layoutPos, custom: {} };
    });
    selectAndEdit({ kind: 'component', id: newId });
  }, [store, selectAndEdit]);

  const addTerminal = useCallback(() => {
    const pos = nextGridPosition(store);
    const layoutPos = nextLayoutGrid(store);
    let newId = '';
    store.transact('Add terminal', (draft) => {
      const id = newInstanceId();
      newId = id;
      const refdes = nextRefdes(store, draft.settings.refdesPrefixes.terminal ?? 'T', 'terminal');
      draft.components[id] = { id, type: 'terminal', refdes, terminalKind: 'ferrule', schematicPosition: pos, layoutPosition: layoutPos, custom: {} };
    });
    selectAndEdit({ kind: 'component', id: newId });
  }, [store, selectAndEdit]);

  const addTwoTerminal = useCallback((type: 'resistor' | 'diode') => {
    const pos = nextGridPosition(store);
    const layoutPos = nextLayoutGrid(store);
    let newId = '';
    store.transact(`Add ${type}`, (draft) => {
      const id = newInstanceId();
      newId = id;
      const refdes = nextRefdes(store, draft.settings.refdesPrefixes[type] ?? (type === 'resistor' ? 'R' : 'D'), type);
      draft.components[id] = { id, type, refdes, schematicPosition: pos, layoutPosition: layoutPos, custom: {} };
    });
    selectAndEdit({ kind: 'component', id: newId });
  }, [store, selectAndEdit]);

  const addNote = useCallback(() => {
    const pos = nextGridPosition(store);
    let newId = '';
    store.transact('Add note', (draft) => {
      const id = newInstanceId();
      newId = id;
      draft.notes[id] = { id, schematicPosition: pos, text: 'Note' };
    });
    selectAndEdit({ kind: 'note', id: newId });
  }, [store, selectAndEdit]);

  const duplicateComponent = useCallback(
    (componentId: string) => {
      const original = store.doc.components[componentId];
      if (!original) return;
      let newId = '';
      store.transact('Duplicate component', (draft) => {
        const id = newInstanceId();
        newId = id;
        const refdes = nextRefdes(store, draft.settings.refdesPrefixes[original.type] ?? original.refdes.replace(/\d+$/, ''), original.type);
        const pos = original.schematicPosition ? { x: original.schematicPosition.x + 24, y: original.schematicPosition.y + 24 } : nextGridPosition(store);
        const clone: Component = {
          ...structuredClone(original),
          id,
          refdes,
          schematicPosition: pos,
          partId: undefined,
        } as Component;
        if (clone.type === 'connector') {
          clone.cavities = clone.cavities.map((cav) => ({ ...cav, id: newInstanceId() }));
        }
        if (clone.type === 'cable') {
          clone.cores = clone.cores.map((core) => ({ ...core, id: newInstanceId() }));
        }
        draft.components[id] = clone;
      });
      selectAndEdit({ kind: 'component', id: newId });
    },
    [store, selectAndEdit],
  );

  /**
   * Start creating a mate from a component (right-click -> "Create mate").
   * Cancels any pending wire — the two gestures share the "next click wins"
   * slot and can't both be live.
   */
  const beginMate = useCallback((componentId: string) => {
    setPendingWire(null);
    setPendingMate({ componentId });
  }, []);

  /**
   * Complete a pending mate against a second component. The actual direction
   * normalisation and cavity semantics live in addMateInDraft; this just
   * drives the transaction and selects the result. Completing against the
   * same component the gesture started on cancels it (same convention as
   * clicking the same port twice cancels a wire).
   */
  const completeMate = useCallback(
    (targetComponentId: string, cavityId?: string) => {
      if (!pendingMate) return;
      const sourceComponentId = pendingMate.componentId;
      setPendingMate(null);
      if (sourceComponentId === targetComponentId) return;
      let newId: string | null = null;
      store.transact('Add mate', (draft) => {
        newId = addMateInDraft(draft, sourceComponentId, targetComponentId, cavityId);
      });
      if (newId) selectAndEdit({ kind: 'mate', id: newId });
    },
    [pendingMate, store, selectAndEdit],
  );

  const onRowClick = useCallback(
    (node: SceneNode, row: SceneRow) => {
      // While a mate is pending, a port click completes it against the port's
      // component — remembering the cavity in case it's terminal-into-
      // connector (addMateInDraft decides whether the cavity applies).
      if (pendingMate) {
        const cavityId = node.type === 'connector' && row.rowId !== BACKSHELL_CAVITY_ID ? row.rowId : undefined;
        completeMate(node.componentId, cavityId);
        return;
      }
      const endpoint = rowEndpoint(node, row);
      if (!pendingWire) {
        setPendingWire({ componentId: node.componentId, rowId: row.rowId, endpoint });
        return;
      }
      if (pendingWire.componentId === node.componentId && pendingWire.rowId === row.rowId) {
        setPendingWire(null); // clicked the same row again -> cancel
        return;
      }
      store.transact('Add wire', (draft) => {
        const id = newInstanceId();
        const n = Object.values(draft.wires).length;
        const color = WIRE_COLORS[n % WIRE_COLORS.length]!;
        draft.wires[id] = {
          id, refdes: `W${n + 1}`, color,
          source: pendingWire.endpoint, target: endpoint, custom: {},
        };
        // Connor: "all routing in schematic should appear automatically in
        // the layout as well" — see autoRouteInLayout's doc comment.
        const srcComponentId = endpointComponentId(pendingWire.endpoint);
        const tgtComponentId = endpointComponentId(endpoint);
        if (srcComponentId && tgtComponentId) autoRouteInLayout(draft, srcComponentId, tgtComponentId);
      });
      setPendingWire(null);
    },
    [pendingWire, pendingMate, completeMate, store],
  );

  // Shift-click seeds the multi-select set from whatever's already singly
  // `selected` (spec follow-up: plain-click-then-shift-click, the normal OS
  // convention for extending a selection, was silently dropping the first
  // click — shift-click only ever toggled the *new* item, so a lone
  // shift-click after a plain click produced a 1-item set that could never
  // reach the size-2 "Group" threshold). Seeding once here, on the first
  // shift-click after a plain click, makes click-then-shift-click behave the
  // way people expect; repeated shift-clicks after that just toggle as before.
  const seedMultiSelectFromSingle = useCallback(
    (next: Set<string>) => {
      if (next.size > 0) return;
      if (selected?.kind === 'wire') next.add(wireKey(selected.id));
      else if (selected?.kind === 'group') next.add(groupKey(selected.id));
      else if (selected?.kind === 'component') next.add(componentKey(selected.id));
      else if (selected?.kind === 'mate') next.add(mateKey(selected.id));
    },
    [selected],
  );

  /**
   * The one shift-click path for every selectable kind. Previously each kind
   * had its own near-identical handler and only wires and groups had one at
   * all, which is exactly why shift-clicking a connector did nothing
   * (Connor: "extend shift-click to any component type").
   */
  const toggleInMultiSelect = useCallback(
    (key: string) => {
      setMultiSelect((prev) => {
        const next = new Set(prev);
        seedMultiSelectFromSingle(next);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      });
    },
    [seedMultiSelectFromSingle],
  );

  const selectSingle = useCallback((sel: NonNullable<Selection>) => {
    setMultiSelect(new Set());
    setSelected(sel);
    setInspectorTab('edit');
    setInspectorOpen(false);
  }, []);

  const onWireClick = useCallback(
    (wireId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setContextMenu(null);
      if (e.shiftKey) { toggleInMultiSelect(wireKey(wireId)); return; }
      selectSingle({ kind: 'wire', id: wireId });
    },
    [toggleInMultiSelect, selectSingle],
  );

  const onGroupHaloClick = useCallback(
    (groupId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setContextMenu(null);
      if (e.shiftKey) { toggleInMultiSelect(groupKey(groupId)); return; }
      selectSingle({ kind: 'group', id: groupId });
    },
    [toggleInMultiSelect, selectSingle],
  );

  const onMateClick = useCallback(
    (mateId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setContextMenu(null);
      if (e.shiftKey) { toggleInMultiSelect(mateKey(mateId)); return; }
      selectSingle({ kind: 'mate', id: mateId });
    },
    [toggleInMultiSelect, selectSingle],
  );

  const onMateContextMenu = useCallback((mateId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMultiSelect(new Set());
    setSelected({ kind: 'mate', id: mateId });
    setInspectorOpen(false);
    setContextMenu({ x: e.clientX, y: e.clientY, target: { kind: 'mate', id: mateId } });
  }, []);

  // ---------------------------------------------------------------------
  // Manual wire routing — drag-to-bend
  // ---------------------------------------------------------------------

  /**
   * Mousedown on a wire's hit-target. This does NOT create a bend: it only
   * records where the pointer went down and which segment it landed on. The
   * bend is created on the first mousemove past DRAG_THRESHOLD (see
   * `onMouseMove`), so a plain click still selects the wire rather than
   * dropping an invisible zero-offset bend into the route every time anyone
   * clicks a trace.
   */
  const onWireMouseDown = useCallback(
    (wireId: string, e: React.MouseEvent) => {
      if (e.button !== 0 || e.shiftKey) return;
      e.stopPropagation();
      const wire = store.doc.wires[wireId];
      const sceneWire = scene.wires.find((w) => w.wireId === wireId);
      if (!wire || !sceneWire || sceneWire.degraded) return;
      const origin = clientToCanvas(e.clientX, e.clientY);
      const insertIndex = waypointInsertIndex(
        sceneWire.from, sceneWire.fromDir, sceneWire.to, sceneWire.toDir,
        wire.schematicWaypoints ?? [], origin,
        store.doc.settings.schematicExitStub === undefined ? {} : { stub: store.doc.settings.schematicExitStub },
      );
      pendingBend.current = { wireId, origin, insertIndex };
    },
    [store.doc, scene.wires, clientToCanvas],
  );

  const removeBend = useCallback(
    (wireId: string, index: number) => {
      store.transact('Remove wire bend', (draft) => {
        const w = draft.wires[wireId];
        if (!w?.schematicWaypoints) return;
        w.schematicWaypoints.splice(index, 1);
        // Back to fully auto-routed once the last bend is gone. Storing an
        // empty array instead would be a second way to spell "auto", and the
        // scene builder would have to know about both.
        if (w.schematicWaypoints.length === 0) w.schematicWaypoints = undefined;
      });
    },
    [store],
  );

  /** Mousedown directly on an existing bend handle — no threshold needed,
   * the user has unambiguously grabbed a specific bend. */
  const onBendMouseDown = useCallback(
    (wireId: string, index: number, e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      // Alt-click removes the bend instead of moving it — the standard
      // "alt to delete a node" gesture from path editors, and the reason
      // there's no separate delete affordance cluttering each handle.
      if (e.altKey) { removeBend(wireId, index); return; }
      setContextMenu(null);
      setSelected({ kind: 'wire', id: wireId });
      setBendDrag({ wireId, index });
    },
    [removeBend],
  );

  const clearBends = useCallback(
    (wireId: string) => {
      store.transact('Auto-route wire', (draft) => {
        const w = draft.wires[wireId];
        if (w) w.schematicWaypoints = undefined;
      });
    },
    [store],
  );

  /**
   * Clicking a shield's termination node starts (or finishes) a wire the
   * same way clicking a cavity does — it feeds the identical `pendingWire`
   * state machine, so a drain wire is an ordinary wire in every respect
   * afterwards: it appears in nets, in the interconnect table, and in the
   * BOM. The only thing special about it is its endpoint kind.
   */
  const onShieldNodeClick = useCallback(
    (groupId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const endpoint: Endpoint = { kind: 'shieldNode', groupId };
      if (!pendingWire) {
        setPendingWire({ componentId: groupId, rowId: SHIELD_ROW, endpoint });
        return;
      }
      if (pendingWire.componentId === groupId && pendingWire.rowId === SHIELD_ROW) {
        setPendingWire(null);
        return;
      }
      store.transact('Add shield drain wire', (draft) => {
        const id = newInstanceId();
        const n = Object.values(draft.wires).length;
        draft.wires[id] = {
          id, refdes: `W${n + 1}`, color: 'Green',
          source: pendingWire.endpoint, target: endpoint, custom: {},
        };
      });
      setPendingWire(null);
    },
    [pendingWire, store],
  );

  const groupSelection = useCallback(() => {
    if (multiSelect.size < 1) return;
    const wireIds: string[] = [];
    const groupIds: string[] = [];
    for (const key of multiSelect) {
      const parsed = parseKey(key);
      if (!parsed) continue;
      if (parsed.kind === 'wire') wireIds.push(parsed.id);
      else if (parsed.kind === 'group') groupIds.push(parsed.id);
      // Components and mates cannot be WireGroup members — a lasso that caught
      // them alongside wires still groups the wires, and ignores the rest.
      // (Previously every non-wire key landed in memberGroupIds, which
      // silently stored component ids there.)
    }
    if (wireIds.length + groupIds.length === 0) return;
    // A twist only means something for 2+ conductors — a lone wire can't
    // twist around itself. Grouping just one wire defaults to `kind:
    // 'cable'` instead, which is exactly the shape a single shielded
    // conductor (coax-style) needs (Connor: "allow single wires to be
    // grouped into a part but not twisted" — for the shield feature).
    const totalMembers = wireIds.length + groupIds.length;
    let newId = '';
    store.transact('Group wires', (draft) => {
      const id = newInstanceId();
      newId = id;
      const group: WireGroup = {
        id, kind: totalMembers >= 2 ? 'twist' : 'cable', memberWireIds: wireIds, memberGroupIds: groupIds, custom: {},
      };
      draft.wireGroups[id] = group;
      for (const wid of wireIds) {
        const w = draft.wires[wid];
        if (w) w.twistGroupId = id;
      }
    });
    setMultiSelect(new Set());
    setSelected({ kind: 'group', id: newId });
    setInspectorOpen(true);
  }, [multiSelect, store]);

  /** Direct entry point for wrapping a single already-selected wire in its
   * own `kind: 'cable'` group, from the WireInspector's "Group this wire"
   * button — the discoverable path to single-wire grouping, since a plain
   * click never touches `multiSelect` (only shift-click does). */
  const groupSingleWire = useCallback(
    (wireId: string) => {
      let newId = '';
      store.transact('Group wire', (draft) => {
        const id = newInstanceId();
        newId = id;
        draft.wireGroups[id] = { id, kind: 'cable', memberWireIds: [wireId], memberGroupIds: [], custom: {} };
        const w = draft.wires[wireId];
        if (w) w.twistGroupId = id;
      });
      setSelected({ kind: 'group', id: newId });
      setInspectorOpen(true);
    },
    [store],
  );

  const ungroupWires = useCallback(
    (groupId: string) => {
      store.transact('Ungroup wires', (draft) => {
        const group = draft.wireGroups[groupId];
        if (!group) return;
        for (const wid of group.memberWireIds) {
          const w = draft.wires[wid];
          if (w && w.twistGroupId === groupId) w.twistGroupId = undefined;
        }
        delete draft.wireGroups[groupId];
      });
      setSelected(null);
    },
    [store],
  );

  const removeWireFromGroup = useCallback(
    (groupId: string, wireId: string) => {
      store.transact('Remove wire from group', (draft) => {
        const group = draft.wireGroups[groupId];
        if (!group) return;
        group.memberWireIds = group.memberWireIds.filter((id) => id !== wireId);
        const w = draft.wires[wireId];
        if (w) w.twistGroupId = undefined;
        if (group.memberWireIds.length === 0 && group.memberGroupIds.length === 0) delete draft.wireGroups[groupId];
      });
    },
    [store],
  );

  const onNodeMouseDown = useCallback(
    (node: SceneNode, e: React.MouseEvent) => {
      e.stopPropagation();
      setContextMenu(null);
      // While a mate is pending, clicking any component box completes the
      // mate against it (clicking the starting component cancels, per
      // completeMate) instead of selecting/dragging the node.
      if (pendingMate) { completeMate(node.componentId); return; }
      // Shift-click extends the selection instead of starting a drag
      // (Connor: "extend shift-click to any component type"). Starting a
      // drag as well would move the node the instant the user nudged the
      // mouse while building a selection.
      if (e.shiftKey) { toggleInMultiSelect(componentKey(node.componentId)); return; }
      select({ kind: 'component', id: node.componentId });
      setDragging({
        kind: 'component', id: node.componentId,
        pointerStartX: e.clientX, pointerStartY: e.clientY,
        boxStartX: node.x, boxStartY: node.y,
      });
    },
    [select, toggleInMultiSelect, pendingMate, completeMate],
  );

  const onNodeContextMenu = useCallback((node: SceneNode, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    select({ kind: 'component', id: node.componentId });
    setContextMenu({ x: e.clientX, y: e.clientY, target: { kind: 'component', id: node.componentId } });
  }, [select]);

  const onWireContextMenu = useCallback((wireId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMultiSelect(new Set());
    setSelected({ kind: 'wire', id: wireId });
    setInspectorOpen(false);
    setContextMenu({ x: e.clientX, y: e.clientY, target: { kind: 'wire', id: wireId } });
  }, []);

  const onGroupContextMenu = useCallback((groupId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMultiSelect(new Set());
    setSelected({ kind: 'group', id: groupId });
    setInspectorOpen(false);
    setContextMenu({ x: e.clientX, y: e.clientY, target: { kind: 'group', id: groupId } });
  }, []);

  const onNoteContextMenu = useCallback((noteId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMultiSelect(new Set());
    setInspectorOpen(false);
    setSelected({ kind: 'note', id: noteId });
    setContextMenu({ x: e.clientX, y: e.clientY, target: { kind: 'note', id: noteId } });
  }, []);

  const onNoteMouseDown = useCallback(
    (noteId: string, x: number, y: number, e: React.MouseEvent) => {
      e.stopPropagation();
      setContextMenu(null);
      select({ kind: 'note', id: noteId });
      setDragging({ kind: 'note', id: noteId, pointerStartX: e.clientX, pointerStartY: e.clientY, boxStartX: x, boxStartY: y });
    },
    [select],
  );

  /**
   * Left-drag on empty canvas is a marquee selection (Connor: "lasso-drag to
   * select multiple wires").
   *
   * Panning moves to ALT+drag and middle-drag, which `useCanvasPan` now
   * accepts. Two gestures can't both own plain left-drag on the background,
   * and lassoing is the one being asked for; panning keeps the mouse wheel
   * and the scrollbars besides. `stopPropagation` is what actually prevents
   * the pan handler on the scroll container from also firing.
   */
  const onBackgroundDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0 || e.altKey) return; // let it bubble to useCanvasPan
      e.stopPropagation();
      const origin = clientToCanvas(e.clientX, e.clientY);
      setContextMenu(null);
      setLasso({ origin, current: origin, additive: e.shiftKey });
    },
    [clientToCanvas],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (lasso) {
        setLasso({ ...lasso, current: clientToCanvas(e.clientX, e.clientY) });
        return;
      }

      // A wire mousedown that has now travelled far enough to be a drag:
      // create the bend and hand off to the bend-drag branch below. Doing
      // this here rather than on mousedown is what keeps a plain click on a
      // trace from silently inserting a bend. The travel test runs in
      // screen pixels (C9): `p` and the origin are canvas points, so the
      // canvas-unit delta is scaled before comparison — at 25% zoom the
      // old canvas-unit test read 1 px of jitter as 4 units and bent the
      // wire on a plain click.
      const pending = pendingBend.current;
      if (pending && !bendDrag) {
        const p = clientToCanvas(e.clientX, e.clientY);
        if (exceedsDragThreshold(p.x - pending.origin.x, p.y - pending.origin.y, scale, DRAG_THRESHOLD)) {
          store.transact('Bend wire', (draft) => {
            const w = draft.wires[pending.wireId];
            if (!w) return;
            if (!w.schematicWaypoints) w.schematicWaypoints = [];
            w.schematicWaypoints.splice(pending.insertIndex, 0, p);
          });
          setBendDrag({ wireId: pending.wireId, index: pending.insertIndex });
          pendingBend.current = null;
          return;
        }
      }

      if (bendDrag) {
        const p = clientToCanvas(e.clientX, e.clientY);
        store.transact('Move wire bend', (draft) => {
          const w = draft.wires[bendDrag.wireId];
          const wp = w?.schematicWaypoints;
          if (!wp || !wp[bendDrag.index]) return;
          wp[bendDrag.index] = p;
        });
        return;
      }

      if (!dragging) return;
      const dx = (e.clientX - dragging.pointerStartX) / scale;
      const dy = (e.clientY - dragging.pointerStartY) / scale;
      const x = dragging.boxStartX + dx;
      const y = dragging.boxStartY + dy;
      if (dragging.kind === 'component') {
        store.transact('Move component', (draft) => {
          const c = draft.components[dragging.id];
          if (c) c.schematicPosition = { x, y };
        });
      } else {
        store.transact('Move note', (draft) => {
          const n = draft.notes[dragging.id];
          if (n) n.schematicPosition = { x, y };
        });
      }
    },
    [dragging, store, lasso, bendDrag, clientToCanvas, scale],
  );

  /** Everything the marquee currently covers, as multi-select keys. */
  const lassoHits = useCallback(
    (l: Lasso): string[] => {
      const r = lassoRect(l);
      const keys: string[] = [];
      for (const w of scene.wires) {
        if (!w.degraded && wireTouchesRect(w, r)) keys.push(wireKey(w.wireId));
      }
      for (const n of scene.nodes) {
        if (rectIntersectsRect(r, { x: n.x, y: n.y, width: n.width, height: n.height })) {
          keys.push(componentKey(n.componentId));
        }
      }
      // A mate is one straight segment — exact segment/rect clip, see
      // segmentIntersectsRect for why sampling points isn't enough.
      for (const m of scene.mates) {
        if (segmentIntersectsRect(m.from, m.to, r)) keys.push(mateKey(m.mateId));
      }
      return keys;
    },
    [scene.wires, scene.nodes, scene.mates],
  );

  const onMouseUp = useCallback(() => {
    if (lasso) {
      const r = lassoRect(lasso);
      // A marquee that never actually opened is a click on empty canvas —
      // deselect, matching what clicking the background did before lassoing
      // existed. It also cancels a pending mate: clicking nothing is the
      // natural "never mind" for the two-click gesture. "Never opened" is
      // the same screen-pixel test as the wire-bend click guard (C9): the
      // lasso rect is in canvas units, so at 25% zoom the old canvas-unit
      // comparison read 2 px of jitter as an 8-unit marquee and ran a
      // selection instead of deselecting.
      if (!exceedsDragThreshold(r.width, r.height, scale, DRAG_THRESHOLD)) {
        setSelected(null);
        setMultiSelect(new Set());
        setPendingMate(null);
      } else {
        const hits = lassoHits(lasso);
        setMultiSelect((prev) => {
          const next = lasso.additive ? new Set(prev) : new Set<string>();
          for (const k of hits) next.add(k);
          return next;
        });
        setSelected(null);
      }
      setLasso(null);
    }
    pendingBend.current = null;
    setBendDrag(null);
    setDragging(null);
  }, [lasso, lassoHits, scale]);

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    if (selected.kind === 'note') {
      store.transact('Delete note', (draft) => {
        delete draft.notes[selected.id];
      });
    } else if (selected.kind === 'wire') {
      store.transact('Delete wire', (draft) => {
        const wire = draft.wires[selected.id];
        const gid = wire?.twistGroupId;
        delete draft.wires[selected.id];
        if (gid) {
          const group = draft.wireGroups[gid];
          if (group) {
            group.memberWireIds = group.memberWireIds.filter((id) => id !== selected.id);
            if (group.memberWireIds.length === 0 && group.memberGroupIds.length === 0) delete draft.wireGroups[gid];
          }
        }
      });
    } else if (selected.kind === 'group') {
      store.transact('Delete group (keep wires)', (draft) => {
        const group = draft.wireGroups[selected.id];
        if (!group) return;
        for (const wid of group.memberWireIds) {
          const w = draft.wires[wid];
          if (w && w.twistGroupId === selected.id) w.twistGroupId = undefined;
        }
        delete draft.wireGroups[selected.id];
      });
    } else if (selected.kind === 'mate') {
      store.transact('Delete mate', (draft) => {
        deleteMateInDraft(draft, selected.id);
      });
    } else {
      store.transact('Delete component', (draft) => {
        deleteComponentInDraft(draft, selected.id);
      });
    }
    setSelected(null);
  }, [selected, store]);

  /**
   * Delete everything in the multi-selection in ONE transaction, so undo
   * puts it all back with a single Ctrl-Z rather than making the user press
   * it once per lassoed item. Order matters: wires first, then groups, then
   * components — deleting a component also deletes its wires, and doing
   * components first would leave the wire pass iterating ids that no longer
   * exist (harmless, but it would also silently skip the group cleanup those
   * wires needed). Mates last: deleteComponentInDraft already drops the
   * deleted components' mates, so a mate deleted twice is a no-op.
   */
  const deleteMultiSelection = useCallback(() => {
    if (multiSelect.size === 0) return;
    const wires: string[] = [];
    const groups: string[] = [];
    const components: string[] = [];
    const mates: string[] = [];
    for (const key of multiSelect) {
      const parsed = parseKey(key);
      if (!parsed) continue;
      if (parsed.kind === 'wire') wires.push(parsed.id);
      else if (parsed.kind === 'group') groups.push(parsed.id);
      else if (parsed.kind === 'mate') mates.push(parsed.id);
      else components.push(parsed.id);
    }
    store.transact(`Delete ${multiSelect.size} item${multiSelect.size === 1 ? '' : 's'}`, (draft) => {
      for (const wireId of wires) deleteWireInDraft(draft, wireId);
      for (const groupId of groups) {
        const group = draft.wireGroups[groupId];
        if (!group) continue;
        for (const wid of group.memberWireIds) {
          const w = draft.wires[wid];
          if (w && w.twistGroupId === groupId) w.twistGroupId = undefined;
        }
        delete draft.wireGroups[groupId];
      }
      for (const componentId of components) deleteComponentInDraft(draft, componentId);
      for (const mateId of mates) deleteMateInDraft(draft, mateId);
    });
    setMultiSelect(new Set());
    setSelected(null);
  }, [multiSelect, store]);

  const maxX = Math.max(
    600,
    ...scene.nodes.map((n) => n.x + n.width + 260),
    ...scene.notes.map((n) => n.point.x + 260),
  );
  const maxY = Math.max(
    420,
    ...scene.nodes.map((n) => n.y + n.height + 220),
    ...scene.notes.map((n) => n.point.y + 200),
  );

  // Keep the zoom hook's pan/scroll clamp aware of the content extent.
  useEffect(() => {
    setContentSize(maxX, maxY);
  }, [maxX, maxY, setContentSize]);

  // Fit-to-view / fit-to-selection (review B4): the rect collection is pure
  // scene geometry (render/sceneBounds), the scale+pan+scroll solve is
  // `fitView` in zoomGeometry, and `fitTo` applies the result to this pane's
  // zoom state + scroll container. Fit-to-selection prefers the multi-select
  // set when it's non-empty (a lasso clears the single selection, and a
  // single click clears the multi set, so the two are normally exclusive —
  // preferring multiSelect makes the shift-click-adjust case predictable).
  const fitToView = useCallback(() => {
    fitTo(schematicContentRects(scene));
  }, [fitTo, scene]);

  const hasSelection = multiSelect.size > 0 || selected !== null;

  const fitToSelection = useCallback(() => {
    const items: SchematicSelectionItem[] = [];
    if (multiSelect.size > 0) {
      for (const key of multiSelect) {
        const parsed = parseKey(key);
        if (parsed) items.push(parsed);
      }
    } else if (selected) {
      items.push(selected);
    }
    fitTo(schematicSelectionRects(scene, store.doc, items));
  }, [fitTo, scene, store.doc, multiSelect, selected]);

  // Centroid of the current multi-selection, so the floating "Group" action
  // button appears roughly where the selected traces are, not pinned to a
  // fixed corner. Single-wire selections can be grouped too (Connor:
  // "allow single wires to be grouped into a part but not twisted") — a
  // lone wire wrapped in a `kind: 'cable'` group is exactly the shape a
  // coax-style single-conductor shield needs (see groupSelection below).
  let groupBtnPos: Point | null = null;
  if (multiSelect.size >= 1) {
    let sx = 0, sy = 0, n = 0;
    for (const key of multiSelect) {
      const parsed = parseKey(key);
      if (!parsed) continue;
      if (parsed.kind === 'wire') {
        const w = scene.wires.find((sw) => sw.wireId === parsed.id);
        if (w) { sx += w.midpoint.x; sy += w.midpoint.y; n++; }
      } else if (parsed.kind === 'component') {
        const nd = scene.nodes.find((sn) => sn.componentId === parsed.id);
        if (nd) { sx += nd.x + nd.width / 2; sy += nd.y + nd.height / 2; n++; }
      } else if (parsed.kind === 'mate') {
        const m = scene.mates.find((sm) => sm.mateId === parsed.id);
        if (m) { sx += m.midpoint.x; sy += m.midpoint.y; n++; }
      } else {
        const g = store.doc.wireGroups[parsed.id];
        const members = g ? wiresByGroup.get(g.id) : undefined;
        const rep = members?.[0];
        if (rep) { sx += rep.midpoint.x; sy += rep.midpoint.y; n++; }
      }
    }
    if (n > 0) groupBtnPos = { x: sx / n, y: sy / n - 40 };
  }

  /** How much of the current multi-selection each floating action applies
   * to. "Groupable" is wires and existing groups only — a connector or a mate
   * can't be a member of a WireGroup, so a lasso that caught both wires and
   * their connectors must still offer "Group" for the wires rather than going
   * inert. */
  const twistStyle = store.doc.settings.twistedPairStyle ?? 'ieee315';

  const selectionCounts = (() => {
    let groupable = 0;
    for (const key of multiSelect) {
      const parsed = parseKey(key);
      if (parsed && (parsed.kind === 'wire' || parsed.kind === 'group')) groupable++;
    }
    return { groupable, total: multiSelect.size };
  })();

  return (
    <div style={s.root} onClick={() => setContextMenu(null)}>
      <div style={s.addToolbar}>
        <span style={s.addToolbarLabel}>Add</span>
        <AddButton icon="connector" label="Connector" onClick={addConnector} />
        <AddButton icon="splice" label="Splice" onClick={addSplice} />
        <AddButton icon="terminal" label="Terminal" onClick={addTerminal} />
        <AddButton icon="resistor" label="Resistor" onClick={() => addTwoTerminal('resistor')} />
        <AddButton icon="diode" label="Diode" onClick={() => addTwoTerminal('diode')} />
        <AddButton icon="note" label="Note" onClick={addNote} />
        {/* Fit-to-view / fit-to-selection (review B4) — view-only, so plain
            buttons on the toolbar rather than document mutations. */}
        <button style={s.viewBtn(true)} onClick={fitToView} title="Zoom and pan so the whole harness is visible">
          Fit view
        </button>
        <button
          style={s.viewBtn(hasSelection)} onClick={fitToSelection} disabled={!hasSelection}
          title={hasSelection ? 'Zoom and pan so the selection is visible' : 'Select something first'}
        >
          Fit selection
        </button>
        {pendingWire && (
          <span style={s.wireHint}>Click a port to finish the wire, or click it again to cancel.</span>
        )}
        {pendingMate && (
          <span style={s.wireHint}>
            Click another connector or terminal to create the mate — click the same one again, or empty space, to cancel.
          </span>
        )}
        {!pendingWire && !pendingMate && multiSelect.size === 0 && (
          <span style={s.wireHint}>
            Drag a wire to bend it · alt-click a bend to remove · drag empty space to lasso · alt-drag to pan
          </span>
        )}
        {multiSelect.size >= 1 && (
          <span style={s.wireHint}>
            {multiSelect.size} selected — shift-click to adjust
            {selectionCounts.groupable >= 1 ? ', or "Group" on the canvas' : ''}.
          </span>
        )}
      </div>
      <div
        ref={scrollRef} style={s.canvasScroll}
        onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
        onMouseDown={onBackgroundMouseDown}
      >
        <div style={{ position: 'relative', width: maxX * scale, height: maxY * scale }}>
          <svg
            ref={svgRef}
            width={maxX} height={maxY}
            style={{
              ...s.canvasSvg,
              // Order matters: CSS applies the transform list right-to-left,
              // so this scales about the origin first and then shifts by the
              // pan offsets — which are in *screen* pixels, exactly what the
              // wheel handler's zoomViewAboutCursor solves for (together with
              // the container scroll; the two always sum to keep the zoomed
              // point under the cursor). Omitting the translate makes every
              // zoom pivot on the top-left corner and throws the computed
              // pan away (the point under the cursor jumps on every wheel
              // step).
              transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
              transformOrigin: '0 0',
              transition: 'none',
            }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) onBackgroundDown(e); }}
            onClick={(e) => {
              // Only deselect on clicks that land on the svg background
              // itself. Clicking a node fires onMouseDown (which selects) and
              // then a synthesized click that bubbles up here —
              // stopPropagation() on the mousedown handler does NOT stop that
              // click, so without this target check every node click would
              // immediately deselect itself right after selecting.
              //
              // Background clicks now clear the selection in `onMouseUp`
              // (the degenerate-marquee case), so this only has to handle
              // the case where no marquee was started at all — e.g. an
              // alt-click that went to the pan handler.
              if (e.target === e.currentTarget && !lasso && e.altKey) {
                setSelected(null);
                setMultiSelect(new Set());
                setPendingMate(null);
              }
            }}
          >
            <defs>
              <pattern id="dot-grid" width={16} height={16} patternUnits="userSpaceOnUse">
                <circle cx={1} cy={1} r={1} fill={theme.color.gridDot} />
              </pattern>
            </defs>
            {/* `pointerEvents: none` matters: this rect covers the whole
               canvas, so while it accepted pointer events every background
               click had it as `e.target` and the svg's own
               `e.target === e.currentTarget` background test could never be
               true — clicking empty canvas silently failed to deselect, and
               a marquee started on the grid would never have begun either. */}
            <rect x={0} y={0} width={maxX} height={maxY} fill="url(#dot-grid)" style={{ pointerEvents: 'none' }} />

            {/* Bundle halos — one wide, translucent underlay per WireGroup,
               drawn from its first member's routed path. This is a
               deliberate v1 simplification (each grouped wire keeps its own
               individually-routed trace; the halo is the "these are
               bundled" visual cue and the group's click target) rather than
               full single-trunk-with-fanout geometry — see file header. */}
            {[...wiresByGroup.entries()].map(([groupId, members]) => {
              const rep = members[0];
              if (!rep) return null;
              const group = store.doc.wireGroups[groupId];
              const isSelected = selected?.kind === 'group' && selected.id === groupId;
              const isMulti = multiSelect.has(groupKey(groupId));
              const haloColor = isSelected || isMulti ? theme.color.accent : theme.color.textFaint;
              // Twisted is now its own flag, not an inference from `kind`
              // (Connor: "decouple the twisted visual from the group's
              // kind"). The `?? kind === 'twist'` fallback covers a document
              // loaded by a build without the migration; `migrateLegacyFields`
              // normally fills this in at load.
              const isTwist = group?.twisted ?? group?.kind === 'twist';
              const isShielded = !!group?.shield;
              const shieldPart = group?.shield?.partId ? (store.doc.parts[group.shield.partId] as ShieldPart | undefined) : undefined;
              const shieldLabel = shieldPart
                ? SHIELD_TYPES.find((t) => t.value === shieldPart.shieldType)?.label ?? 'Shielded'
                : 'Shielded';
              return (
                <g key={`halo:${groupId}`}>
                  <path
                    d={rep.path}
                    fill="none"
                    stroke={haloColor}
                    strokeOpacity={isSelected || isMulti ? 0.35 : 0.22}
                    strokeWidth={members.length > 1 ? 10 : 8}
                    strokeLinecap="round"
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => onGroupHaloClick(groupId, e)}
                    onContextMenu={(e) => onGroupContextMenu(groupId, e)}
                  >
                    <title>
                      {group?.kind === 'cable' ? `Cable ${group.refdes ?? ''}` : 'Wire group'} ({members.length} wire{members.length === 1 ? '' : 's'})
                      {isTwist ? ' — twisted' : ''}
                      {isShielded ? ` — ${shieldLabel}` : ''}
                    </title>
                  </path>
                  {/* Twisted-pair visual (Connor: "show twisted pairs as
                     twisted wires... crossing over back and forth once
                     right at the connector exit... as short as possible so
                     it fits between the shield and the connector") — a
                     short crossover glyph at EACH end where the members
                     leave a connector, not a continuous twist down the whole
                     run. Which glyph is drawn now follows the project's
                     `twistedPairStyle` setting (IEEE 315 vs IEC 60617-3);
                     see twistCrossoverPaths in @openharness/render. */}
                  {isTwist && [
                    ...twistCrossoverPaths(members, 'from', twistStyle),
                    ...twistCrossoverPaths(members, 'to', twistStyle),
                  ].map((d, i) => (
                    <path
                      key={i}
                      d={d}
                      fill="none"
                      stroke={isSelected || isMulti ? theme.color.accent : theme.color.textMuted}
                      strokeOpacity={0.85} strokeWidth={1.2} strokeLinecap="round"
                      style={{ pointerEvents: 'none' }}
                    />
                  ))}
                </g>
              );
            })}

            {scene.wires.map((w) => {
              const isSelected = selected?.kind === 'wire' && selected.id === w.wireId;
              const isMulti = multiSelect.has(wireKey(w.wireId));
              // Cross-pane highlight: either this exact wire is hovered
              // (locally, or reported back from Layout), or it's one of the
              // wires routed through a bundle hovered in Layout.
              const isHighlighted = !!highlightedWireIds?.has(w.wireId);
              return (
                <g key={w.wireId}>
                  {/* Fat invisible hit-target, easier to grab than the thin
                     trace. Three jobs: cross-pane wire hover (see the
                     onHoverWire prop), click-to-select, and — since
                     drag-to-bend came back — press-and-drag to add a bend.
                     The click and the drag share this one target and are
                     told apart by pointer travel, not by a modifier; see
                     onWireMouseDown. */}
                  <path d={w.path} fill="none" stroke="transparent" strokeWidth={12}
                    style={{ cursor: w.degraded ? 'pointer' : 'grab' }}
                    onMouseDown={(e) => onWireMouseDown(w.wireId, e)}
                    onClick={(e) => onWireClick(w.wireId, e)} onContextMenu={(e) => onWireContextMenu(w.wireId, e)}
                    onMouseEnter={() => onHoverWire?.(w.wireId)} onMouseLeave={() => onHoverWire?.(null)} />
                  {isHighlighted && (
                    <path
                      d={w.path} fill="none" stroke={theme.color.warning}
                      strokeOpacity={0.5} strokeWidth={7} strokeLinecap="round"
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                  <path
                    d={w.path} fill="none"
                    stroke={w.degraded ? theme.color.danger : w.color}
                    strokeWidth={isSelected || isMulti || isHighlighted ? 3 : 2}
                    strokeLinecap="round"
                    strokeDasharray={w.degraded ? '4 3' : undefined}
                    style={{ pointerEvents: 'none' }}
                  />
                  {w.stripeColor && (
                    <path
                      d={w.path} fill="none" stroke={w.stripeColor}
                      strokeWidth={isSelected || isMulti ? 1.2 : 0.9}
                      strokeDasharray="6 6" strokeLinecap="round"
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                  {(isSelected || isMulti) && (
                    <circle cx={w.midpoint.x} cy={w.midpoint.y} r={3.5} fill={theme.color.accent} style={{ pointerEvents: 'none' }} />
                  )}
                  {/* Manual bend handles. Shown while the wire is selected or
                     hovered rather than always: a busy schematic where every
                     bent wire displays permanent handles reads as clutter,
                     and the handles are only actionable for the wire you're
                     working on anyway. */}
                  {(isSelected || isHighlighted || hoveredWireId === w.wireId) && w.manualWaypoints.map((p, i) => (
                    <circle
                      key={`bend:${i}`}
                      cx={p.x} cy={p.y}
                      r={bendDrag?.wireId === w.wireId && bendDrag.index === i ? 6 : 4.5}
                      fill={theme.color.canvasBg}
                      stroke={theme.color.accent}
                      strokeWidth={1.6}
                      style={{ cursor: 'move' }}
                      onMouseDown={(e) => onBendMouseDown(w.wireId, i, e)}
                    >
                      <title>Drag to move this bend · alt-click to remove it</title>
                    </circle>
                  ))}
                </g>
              );
            })}

            {/* Mates (T02) — dashed and distinctly coloured because a mate is
                a mating relationship, NOT a conductor: no wire, no length, no
                net trace. Drawn under the nodes (like wires) so the component
                boxes own the pointer wherever they overlap; the visible span
                is the part between the boxes, which reads as "these two plug
                into each other". The fat transparent line is the hit target —
                click selects, shift-click multi-selects, right-click opens
                the menu, same contract as a wire's trace. */}
            {scene.mates.map((m) => {
              const isSelected = (selected?.kind === 'mate' && selected.id === m.mateId)
                || multiSelect.has(mateKey(m.mateId));
              const color = isSelected ? theme.color.accent : theme.color.mate;
              return (
                <g key={`mate:${m.mateId}`}>
                  <line
                    x1={m.from.x} y1={m.from.y} x2={m.to.x} y2={m.to.y}
                    stroke="transparent" strokeWidth={12}
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => onMateClick(m.mateId, e)}
                    onContextMenu={(e) => onMateContextMenu(m.mateId, e)}
                  >
                    <title>
                      {`${m.sourceRefdes} ↔ ${m.targetRefdes} — mate (${m.mapped ? 'explicit cavity map' : 'positional pairing, the default'})`}
                    </title>
                  </line>
                  <line
                    x1={m.from.x} y1={m.from.y} x2={m.to.x} y2={m.to.y}
                    stroke={color}
                    strokeWidth={isSelected ? 2.4 : 1.6}
                    strokeDasharray="6 4"
                    strokeLinecap="round"
                    style={{ pointerEvents: 'none' }}
                  />
                  {/* Endpoint ticks so the direction of the join is legible
                      even where the boxes crowd the line. */}
                  <circle cx={m.from.x} cy={m.from.y} r={3} fill={color} style={{ pointerEvents: 'none' }} />
                  <circle cx={m.to.x} cy={m.to.y} r={3} fill={color} style={{ pointerEvents: 'none' }} />
                  <text
                    x={m.midpoint.x} y={m.midpoint.y - 6}
                    textAnchor="middle" fontSize={9.5} fontWeight={600}
                    fill={color} style={{ pointerEvents: 'none' }}
                  >
                    {m.mapped ? 'mate · mapped' : 'mate'}
                  </text>
                </g>
              );
            })}

            {scene.notes.map((note) => {
              const isSelected = selected?.kind === 'note' && selected.id === note.noteId;
              const width = 180;
              const height = 56;
              return (
                <g key={note.noteId}>
                  <rect
                    x={note.point.x} y={note.point.y} width={width} height={height} rx={theme.radius.node}
                    fill={theme.color.noteFill}
                    stroke={isSelected ? theme.color.accent : theme.color.noteBorder}
                    strokeWidth={isSelected ? 2 : 1}
                    style={{ cursor: 'grab', filter: isSelected ? theme.shadow.selected : undefined }}
                    onMouseDown={(e) => onNoteMouseDown(note.noteId, note.point.x, note.point.y, e)}
                    onContextMenu={(e) => onNoteContextMenu(note.noteId, e)}
                  />
                  <foreignObject x={note.point.x + 8} y={note.point.y + 6} width={width - 16} height={height - 12} style={{ pointerEvents: 'none' }}>
                    <div style={s.noteText}>{note.text}</div>
                  </foreignObject>
                </g>
              );
            })}

            {scene.nodes.map((node) => {
              // A node reads as selected whether it was clicked directly or
              // caught by a shift-click/lasso — the two used to be different
              // states with only the first drawing an outline, so a lassoed
              // connector gave no feedback that it was about to be deleted.
              const isSelected = (selected?.kind === 'component' && selected.id === node.componentId)
                || multiSelect.has(componentKey(node.componentId));
              // Direct hover (this node itself, from any pane) or an
              // indirect one — this connector is an endpoint of a wire
              // highlighted via hoveredWireId/hoveredBundleId (see above).
              const isHovered = hoveredComponentId === node.componentId || !!highlightedComponentIds?.has(node.componentId);
              return (
                <g
                  key={node.componentId}
                  onMouseEnter={() => onHoverComponent?.(node.componentId)}
                  onMouseLeave={() => onHoverComponent?.(null)}
                >
                  {isHovered && !isSelected && (
                    <rect
                      x={node.x - 4} y={node.y - 4} width={node.width + 8} height={node.height + 8} rx={theme.radius.node + 3}
                      fill="none" stroke={theme.color.warning} strokeWidth={2} strokeDasharray="4 3"
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                  {SYMBOL_NODE_TYPES.has(node.type) ? (
                    <>
                      {/* Real schematic symbol instead of a labeled box
                         (Connor: "add them as symbols in the schematic
                         instead of generic blocks") — the rect below is
                         purely an invisible drag/select/right-click hit
                         target the same size as the old box, not a visible
                         border, except for a light dashed outline while
                         selected so there's still a clear selection
                         indicator without reintroducing "generic block". */}
                      <rect
                        x={node.x} y={node.y} width={node.width} height={node.height}
                        fill="transparent"
                        stroke={isSelected ? theme.color.accent : 'transparent'}
                        strokeWidth={1.4}
                        strokeDasharray={isSelected ? '3 3' : undefined}
                        onMouseDown={(e) => onNodeMouseDown(node, e)}
                        onContextMenu={(e) => onNodeContextMenu(node, e)}
                        style={{ cursor: 'grab' }}
                      />
                      {renderNodeSymbol(node, isSelected ? theme.color.accent : theme.color.textStrong, store.doc)}
                      <text
                        x={node.x + node.width / 2} y={node.y - 6} textAnchor="middle"
                        fontSize={11} fontWeight={600} fill={theme.color.textStrong} style={{ pointerEvents: 'none' }}
                      >
                        {node.refdes}
                      </text>
                    </>
                  ) : (
                    <>
                      <rect
                        x={node.x} y={node.y} width={node.width} height={node.height} rx={theme.radius.node}
                        fill={theme.color.nodeFill}
                        stroke={isSelected ? theme.color.accent : theme.color.nodeBorder}
                        strokeWidth={isSelected ? 2 : 1}
                        onMouseDown={(e) => onNodeMouseDown(node, e)}
                        onContextMenu={(e) => onNodeContextMenu(node, e)}
                        style={{ cursor: 'grab', filter: isSelected ? theme.shadow.selected : undefined }}
                      />
                      {node.rows.length > 0 && (
                        <line
                          x1={node.x} y1={node.y + HEADER_HEIGHT} x2={node.x + node.width} y2={node.y + HEADER_HEIGHT}
                          stroke={isSelected ? theme.color.accent : theme.color.nodeBorder}
                          strokeWidth={1} style={{ pointerEvents: 'none' }}
                        />
                      )}
                      <foreignObject x={node.x + 6} y={node.y + 3} width={16} height={16} style={{ pointerEvents: 'none', color: theme.color.textMuted }}>
                        <ComponentIcon type={node.type} size={13} {...connectorAppearance(store.doc.components[node.componentId], store.doc)} />
                      </foreignObject>
                      <text x={node.x + 24} y={node.y + HEADER_HEIGHT - 7} fontSize={12} fontWeight={600} fill={theme.color.textStrong} style={{ pointerEvents: 'none' }}>
                        {node.refdes}
                      </text>
                    </>
                  )}
                  {/* Connor: "I want the ability too flip the connector orientation and
                     modify the part number in the schematic default view without have to
                     click into the properites" — both live right on the node now, no
                     inspector needed. ComponentInspector keeps its own flip button too
                     (same mutation, just a slower path via right-click -> Edit).
                     Extended to every type with a single directional port (Connor's
                     follow-up: "ensure all relevant features added to the connector
                     objects also appear in the other components") — terminal has
                     exactly that shape (see Terminal.flipped in core/types.ts); splice/
                     resistor/diode are inherently two-sided (L+R at once) so flipping
                     has nothing to mean for them. */}
                  {(node.type === 'connector' || node.type === 'cable' || node.type === 'terminal') && (
                    <g
                      onClick={(e) => {
                        e.stopPropagation();
                        store.transact('Flip component', (draft) => {
                          const c = draft.components[node.componentId];
                          if (c && (c.type === 'connector' || c.type === 'cable' || c.type === 'terminal')) c.flipped = !c.flipped;
                        });
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <circle
                        cx={node.x + node.width - 10} cy={node.y - 10} r={8}
                        fill={theme.color.nodeFill} stroke={theme.color.nodeBorder} strokeWidth={1}
                        opacity={isHovered || isSelected ? 1 : 0.35}
                        style={{ transition: 'opacity 120ms ease' }}
                      />
                      <text
                        x={node.x + node.width - 10} y={node.y - 6.5} fontSize={10} textAnchor="middle"
                        fill={theme.color.textMuted} opacity={isHovered || isSelected ? 1 : 0.35}
                        style={{ pointerEvents: 'none', transition: 'opacity 120ms ease' }}
                      >
                        ⇄
                      </text>
                      <title>Flip which side wires exit</title>
                    </g>
                  )}
                  {/* Inline part-number editing — likewise extended to every
                     purchasable type via the generic `ensureComponentPart`
                     (connector still resolves through its own
                     `ensureConnectorPart` inside that helper). Symbol-drawn
                     types (see SYMBOL_NODE_TYPES) have no header band to sit
                     in, so their label/editor sits just under the box
                     instead of in the top-right corner. */}
                  {node.type !== 'branchPoint' && (() => {
                    const isSymbol = SYMBOL_NODE_TYPES.has(node.type);
                    const labelX = isSymbol ? node.x + node.width / 2 : node.x + node.width - 20;
                    const labelY = isSymbol ? node.y + node.height + 12 : node.y + HEADER_HEIGHT - 7;
                    const anchor = isSymbol ? 'middle' : 'end';
                    return editingPartNumber === node.componentId ? (
                      <foreignObject
                        x={isSymbol ? node.x : node.x + 24}
                        y={isSymbol ? node.y + node.height + 3 : node.y + HEADER_HEIGHT - 19}
                        width={isSymbol ? node.width : node.width - 30}
                        height={16}
                      >
                        <InlineSignalInput
                          initialValue={componentPartNumber(store, node.componentId)}
                          onCommit={(value) => {
                            store.transact('Edit part number', (draft) => {
                              const p = ensureComponentPart(draft, node.componentId);
                              p.partNumber = value || undefined;
                            });
                            setEditingPartNumber(null);
                          }}
                          onCancel={() => setEditingPartNumber(null)}
                        />
                      </foreignObject>
                    ) : (
                      <text
                        x={labelX} y={labelY}
                        fontSize={10} textAnchor={anchor} fill={theme.color.textFaint}
                        style={{ cursor: 'text' }}
                        onClick={(e) => { e.stopPropagation(); setEditingPartNumber(node.componentId); }}
                      >
                        {componentPartNumber(store, node.componentId) || '(part #)'}
                      </text>
                    );
                  })()}
                  {node.rows.map((row, i) => {
                    const isConnector = node.type === 'connector';
                    // The backshell row is a connector row but not a cavity,
                    // so it has no signal to name — offering "(click to
                    // name)" there would open an editor that writes to a
                    // cavity that doesn't exist. See BACKSHELL_CAVITY_ID.
                    const nameable = isConnector && row.rowId !== BACKSHELL_CAVITY_ID;
                    const isEditing = nameable && editingCavity?.componentId === node.componentId && editingCavity.cavityId === row.rowId;
                    const labelY = node.y + HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT * 0.68;
                    return (
                      <g key={row.rowId}>
                        {isEditing ? (
                          <foreignObject x={node.x + 6} y={node.y + HEADER_HEIGHT + i * ROW_HEIGHT + 2} width={node.width - 12} height={ROW_HEIGHT - 4}>
                            <InlineSignalInput
                              initialValue={row.signal ?? ''}
                              onCommit={(value) => {
                                store.transact('Edit cavity signal', (draft) => {
                                  const c = draft.components[node.componentId];
                                  if (c?.type === 'connector') {
                                    const cav = c.cavities.find((cv) => cv.id === row.rowId);
                                    if (cav) cav.signal = value || undefined;
                                  }
                                });
                                setEditingCavity(null);
                              }}
                              onCancel={() => setEditingCavity(null)}
                            />
                          </foreignObject>
                        ) : (
                          <text
                            x={node.x + 8}
                            y={labelY}
                            fontSize={11} fill={theme.color.textMuted}
                            style={{ cursor: nameable ? 'text' : 'default' }}
                            onClick={(e) => {
                              if (!nameable) return;
                              e.stopPropagation();
                              setEditingCavity({ componentId: node.componentId, cavityId: row.rowId });
                            }}
                          >
                            {row.label}{row.signal ? `  ·  ${row.signal}` : nameable ? '  ·  (click to name)' : ''}
                          </text>
                        )}
                        <circle
                          cx={row.point.x} cy={row.point.y} r={5}
                          fill={pendingWire?.componentId === node.componentId && pendingWire.rowId === row.rowId ? theme.color.accent : theme.color.nodeFill}
                          stroke={theme.color.accent} strokeWidth={1.5}
                          style={{ cursor: 'crosshair' }}
                          onClick={(e) => { e.stopPropagation(); onRowClick(node, row); }}
                        />
                        {/* Direction toggle + impedance-matched chip (Connor:
                           "a clean ui interface on signal of each connector
                           that allows the user to toggle between
                           bi-directional, input, and output plus a separate
                           field for whether the signal is impedance
                           matched") — only on rows backed by a real
                           Cavity/CableCore (SceneRow.signalCapable); splice/
                           terminal/two-terminal ports have no signal
                           direction concept. Small abstract glyphs (↔/→/←)
                           rather than a dropdown so they fit inline on the
                           row without a popup — the *physically* oriented
                           indicator (which way, given this row's actual
                           left/right exit) is the separate triangle drawn at
                           the pin itself, just below. */}
                        {row.signalCapable && (() => {
                          const inward = row.dir === 'right' ? -1 : 1;
                          const cy = row.point.y;
                          const zX = row.point.x + inward * 26;
                          const dirX = row.point.x + inward * 13;
                          const dirGlyph = row.direction === 'output' ? '→' : row.direction === 'input' ? '←' : '↔';
                          const zActive = !!row.impedanceMatched;
                          return (
                            <g>
                              <g
                                onClick={(e) => {
                                  e.stopPropagation();
                                  store.transact('Toggle impedance matched', (draft) => {
                                    updateSignalRow(draft, node.componentId, row.rowId, (r) => { r.impedanceMatched = !r.impedanceMatched; });
                                  });
                                }}
                                style={{ cursor: 'pointer' }}
                              >
                                <title>{zActive ? 'Impedance matched — click to clear' : 'Mark impedance matched'}</title>
                                <rect
                                  x={zX - 6} y={cy - 6} width={12} height={12} rx={2}
                                  fill={zActive ? theme.color.accent : theme.color.canvasBg}
                                  stroke={zActive ? theme.color.accent : theme.color.border} strokeWidth={1}
                                />
                                <text x={zX} y={cy + 3} fontSize={8} fontWeight={700} textAnchor="middle" fill={zActive ? '#fff' : theme.color.textFaint}>Z</text>
                              </g>
                              <g
                                onClick={(e) => {
                                  e.stopPropagation();
                                  store.transact('Cycle signal direction', (draft) => {
                                    updateSignalRow(draft, node.componentId, row.rowId, (r) => { r.direction = cycleDirection(r.direction); });
                                  });
                                }}
                                style={{ cursor: 'pointer' }}
                              >
                                <title>{`Direction: ${row.direction ?? 'bidirectional'} — click to change`}</title>
                                <circle cx={dirX} cy={cy} r={7} fill={theme.color.canvasBg} stroke={theme.color.border} strokeWidth={1} />
                                <text x={dirX} y={cy + 3} fontSize={9} textAnchor="middle" fill={theme.color.textMuted}>{dirGlyph}</text>
                              </g>
                            </g>
                          );
                        })()}
                        {/* Exit-direction triangle (Connor: "the direction of
                           the signal should appear as a small visual element
                           right where the signal exits the connector — small
                           triangle indicating respective direction") — points
                           away from the box for an output, toward it for an
                           input, and is omitted entirely for
                           bidirectional/unset (the plain circle already
                           covers that default case, same as before this
                           feature existed). */}
                        {row.signalCapable && row.direction && row.direction !== 'bidirectional' && (() => {
                          const facingRight = row.dir === 'right';
                          const pointsRight = row.direction === 'output' ? facingRight : !facingRight;
                          const tipX = row.point.x + (pointsRight ? 9 : -9);
                          const baseX = row.point.x + (pointsRight ? 2 : -2);
                          return (
                            <polygon
                              points={`${tipX},${row.point.y} ${baseX},${row.point.y - 4} ${baseX},${row.point.y + 4}`}
                              fill={theme.color.accent}
                              style={{ pointerEvents: 'none' }}
                            />
                          );
                        })()}
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* Shield termination marks (Connor: "shields should appear ...
               at each end" / "should show how shield terminations [are
               done]") — deliberately the LAST thing drawn in the SVG (after
               every node box), so a mark that ends up geometrically close to
               a connector — e.g. on a short wire run — is never hidden behind
               it (an earlier version lived inside the halo pass, which paints
               BEFORE nodes, so the far-end mark could vanish under the
               destination connector's box).

               Three things changed here alongside the shield work:
                 - position along the run is user-controlled (Shield.position,
                   measured as a fraction of arc length — see
                   shieldTerminationMarks);
                 - each end can have its own termination style/note, falling
                   back to the shared one;
                 - when the shield has a termination node, each mark carries a
                   wirable port a drain wire can actually be drawn from. */}
            {[...deepWiresByGroup.entries()].map(([groupId, members]) => {
              const group = store.doc.wireGroups[groupId];
              const shield = group?.shield;
              if (!group || !shield) return null;
              const isSelected = selected?.kind === 'group' && selected.id === groupId;
              const isMulti = multiSelect.has(groupKey(groupId));
              const color = isSelected || isMulti ? theme.color.accent : theme.color.textMuted;
              const shieldPart = shield.partId ? (store.doc.parts[shield.partId] as ShieldPart | undefined) : undefined;
              const shieldLabel = shieldPart
                ? SHIELD_TYPES.find((t) => t.value === shieldPart.shieldType)?.label ?? 'Shielded'
                : 'Shielded';
              const marks = shieldTerminationMarks(members, shield.position ?? DEFAULT_SHIELD_POSITION);
              return (
                <g key={`shieldterm:${groupId}`}>
                  {marks.map((mark) => {
                    // Per-end termination, falling back to the shared one —
                    // a shield legitimately pigtails at one connector and
                    // lands on a 360° backshell at the other.
                    const term = terminationForEnd(shield, mark.end);
                    const termStyleLabel = term?.style
                      ? SHIELD_TERMINATION_STYLES.find((t) => t.value === term.style)?.label
                      : undefined;
                    return (
                      <g key={mark.end}>
                        <ellipse
                          cx={mark.center.x} cy={mark.center.y} rx={mark.rx} ry={mark.ry}
                          fill="none"
                          stroke={color}
                          strokeWidth={1.4}
                          strokeDasharray="4 3"
                          style={{ cursor: 'pointer' }}
                          onClick={(e) => onGroupHaloClick(groupId, e)}
                          onContextMenu={(e) => onGroupContextMenu(groupId, e)}
                        >
                          <title>
                            {`${group.refdes ?? 'Shield'} — ${shieldLabel} termination (${mark.end} end)`}
                            {termStyleLabel ? ` — ${termStyleLabel}` : ''}
                            {term?.note ? `: ${term.note}` : ''}
                          </title>
                        </ellipse>
                        {/* Termination-style glyph, pointing outward (away
                           from the open wire span, toward the connector this
                           end terminates at). */}
                        {term?.style === 'pigtail' && (
                          <path
                            d={`M ${mark.center.x + mark.dir * mark.rx} ${mark.center.y} q ${mark.dir * 9} -7 ${mark.dir * 15} 3`}
                            fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round"
                            style={{ pointerEvents: 'none' }}
                          />
                        )}
                        {term?.style === 'lugTo360' && (
                          <>
                            <line
                              x1={mark.center.x + mark.dir * mark.rx} y1={mark.center.y}
                              x2={mark.center.x + mark.dir * (mark.rx + 10)} y2={mark.center.y}
                              stroke={color} strokeWidth={1.4} style={{ pointerEvents: 'none' }}
                            />
                            <circle
                              cx={mark.center.x + mark.dir * (mark.rx + 13)} cy={mark.center.y} r={3}
                              fill={color} style={{ pointerEvents: 'none' }}
                            />
                          </>
                        )}
                        {term?.style === 'drainWire' && (
                          <line
                            x1={mark.center.x + mark.dir * mark.rx} y1={mark.center.y}
                            x2={mark.center.x + mark.dir * (mark.rx + 16)} y2={mark.center.y}
                            stroke={color} strokeWidth={1.2} strokeDasharray="1 2" strokeLinecap="round"
                            style={{ pointerEvents: 'none' }}
                          />
                        )}
                        {/* The wirable termination node (Connor: "a
                           termination connection node on the shield
                           itself"). Drawn as a port, and clicked like a port
                           — onShieldNodeClick feeds the same
                           pending-wire state machine every cavity uses, so a
                           drain wire is drawn exactly the way any other wire
                           is. Only the source-end node is wirable: the
                           endpoint model has one shieldNode per group (a
                           shield is one conductor), so offering two would
                           imply two nets where there is one. */}
                        {shield.terminationNode && (
                          <circle
                            cx={mark.nodePoint.x} cy={mark.nodePoint.y} r={5}
                            fill={pendingWire?.componentId === groupId ? theme.color.accent : theme.color.nodeFill}
                            stroke={theme.color.accent} strokeWidth={1.5}
                            style={{ cursor: mark.end === 'source' ? 'crosshair' : 'default' }}
                            onClick={(e) => { if (mark.end === 'source') onShieldNodeClick(groupId, e); }}
                          >
                            <title>
                              {mark.end === 'source'
                                ? `${group.refdes ?? 'Shield'} termination node — click to wire a drain`
                                : `${group.refdes ?? 'Shield'} termination (far end)`}
                            </title>
                          </circle>
                        )}
                        <text
                          x={mark.labelPoint.x} y={mark.labelPoint.y} textAnchor="middle"
                          fontSize={11} fontWeight={600} fill={color}
                          style={{ pointerEvents: 'none' }}
                        >
                          {group.refdes ?? 'SHIELD'}
                        </text>
                        {termStyleLabel && (
                          <text
                            x={mark.labelPoint.x} y={mark.labelPoint.y - 12} textAnchor="middle"
                            fontSize={9} fill={color}
                            style={{ pointerEvents: 'none' }}
                          >
                            {termStyleLabel}
                          </text>
                        )}
                        {term?.note && (
                          <text
                            x={mark.labelPoint.x} y={mark.center.y + mark.ry + 13} textAnchor="middle"
                            fontSize={9.5} fontStyle="italic" fill={theme.color.textFaint}
                            style={{ pointerEvents: 'none' }}
                          >
                            {term.note}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* Marquee selection rectangle (Connor: "lasso-drag to select
               multiple wires"). Drawn last so it sits above everything it is
               selecting, and non-interactive so it can't swallow the
               mouseup that ends the drag. */}
            {lasso && (() => {
              const r = lassoRect(lasso);
              return (
                <rect
                  x={r.x} y={r.y} width={r.width} height={r.height}
                  fill={theme.color.accent} fillOpacity={0.08}
                  stroke={theme.color.accent} strokeWidth={1} strokeDasharray="4 3"
                  style={{ pointerEvents: 'none' }}
                />
              );
            })()}
          </svg>

          {groupBtnPos && (
            <div style={{ ...s.selectionActions, left: groupBtnPos.x - 44, top: groupBtnPos.y }}>
              {selectionCounts.groupable >= 1 && (
                <button style={s.groupActionBtn} onClick={groupSelection}>
                  Group {selectionCounts.groupable}
                </button>
              )}
              <button style={s.deleteActionBtn} onClick={deleteMultiSelection}>
                Delete {selectionCounts.total}
              </button>
            </div>
          )}

          {selectedComponent && selectedNode && (
            <>
              {selectedComponent.type === 'connector' && (
                <CavityStepper
                  store={store}
                  connector={selectedComponent}
                  node={selectedNode}
                />
              )}
              {inspectorOpen && (
                <div style={{ position: 'absolute', left: selectedNode.x, top: selectedNode.y + selectedNode.height + 10, zIndex: 2 }}>
                  <ComponentInspector
                    store={store}
                    component={selectedComponent}
                    tab={inspectorTab}
                    onTabChange={setInspectorTab}
                    onDelete={deleteSelected}
                    onClose={() => setInspectorOpen(false)}
                  />
                </div>
              )}
            </>
          )}

          {selectedNote && selectedSceneNote && inspectorOpen && (
            <div style={{ position: 'absolute', left: selectedSceneNote.point.x, top: selectedSceneNote.point.y + 64, zIndex: 2 }}>
              <div style={s.card}>
                <div style={s.cardHeader}>
                  <ComponentIcon type="note" />
                  <span style={s.cardTitle}>Note</span>
                  <button style={s.closeBtn} onClick={() => setInspectorOpen(false)} title="Close">×</button>
                </div>
                <div style={s.cardBody}>
                  <textarea
                    style={s.textarea}
                    value={selectedNote.text}
                    autoFocus
                    onChange={(e) => {
                      const value = e.target.value;
                      store.transact('Edit note text', (draft) => {
                        const n = draft.notes[selectedNote.id];
                        if (n) n.text = value;
                      });
                    }}
                  />
                  <button style={s.deleteBtn} onClick={deleteSelected}>Delete</button>
                </div>
              </div>
            </div>
          )}

          {selectedWire && selected?.kind === 'wire' && inspectorOpen && (
            <div style={{ position: 'absolute', left: selectedWire.midpoint.x, top: selectedWire.midpoint.y + 14, zIndex: 3 }}>
              <WireInspector
                store={store}
                wire={selectedWire}
                onDelete={deleteSelected}
                onClose={() => setInspectorOpen(false)}
                onUngroupWire={
                  store.doc.wires[selectedWire.wireId]?.twistGroupId
                    ? () => removeWireFromGroup(store.doc.wires[selectedWire.wireId]!.twistGroupId!, selectedWire.wireId)
                    : undefined
                }
                onGroupAlone={
                  store.doc.wires[selectedWire.wireId]?.twistGroupId
                    ? undefined
                    : () => groupSingleWire(selectedWire.wireId)
                }
                onAutoRoute={
                  selectedWire.manualWaypoints.length > 0 ? () => clearBends(selectedWire.wireId) : undefined
                }
              />
            </div>
          )}

          {selectedGroup && selected?.kind === 'group' && inspectorOpen && (
            <div
              style={{
                position: 'absolute',
                left: (wiresByGroup.get(selectedGroup.id)?.[0]?.midpoint.x ?? 40),
                top: (wiresByGroup.get(selectedGroup.id)?.[0]?.midpoint.y ?? 40) + 14,
                zIndex: 3,
              }}
            >
              <GroupInspector
                store={store}
                group={selectedGroup}
                memberWires={wiresByGroup.get(selectedGroup.id) ?? []}
                onUngroup={() => ungroupWires(selectedGroup.id)}
                onRemoveMember={(wid) => removeWireFromGroup(selectedGroup.id, wid)}
                onClose={() => setInspectorOpen(false)}
              />
            </div>
          )}

          {selectedMate && selectedSceneMate && selected?.kind === 'mate' && inspectorOpen && (
            <div style={{ position: 'absolute', left: selectedSceneMate.midpoint.x, top: selectedSceneMate.midpoint.y + 14, zIndex: 3 }}>
              <MateInspector
                store={store}
                mate={selectedMate}
                onDelete={deleteSelected}
                onClose={() => setInspectorOpen(false)}
              />
            </div>
          )}

          {contextMenu && (
            <ContextMenu
              state={contextMenu}
              store={store}
              onClose={() => setContextMenu(null)}
              onEdit={() => setInspectorOpen(true)}
              onDuplicate={duplicateComponent}
              onDelete={deleteSelected}
              onUngroupWire={removeWireFromGroup}
              onUngroup={ungroupWires}
              onAutoRoute={clearBends}
              onStartMate={beginMate}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function AddButton({ icon, label, onClick }: { icon: Component['type'] | 'note'; label: string; onClick: () => void }) {
  return (
    <button style={s.addBtn} onClick={onClick}>
      <ComponentIcon type={icon} />
      <span>{label}</span>
    </button>
  );
}

/** Uncontrolled-ish text input used for double-click-to-edit signal names
 * directly on the schematic node (spec request: "let users edit the signal
 * names right in the schematic part, no need for a drop down menu"). Commits
 * on Enter/blur, cancels on Escape. */
function InlineSignalInput({ initialValue, onCommit, onCancel }: { initialValue: string; onCommit: (value: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      defaultValue={initialValue}
      style={s.inlineSignalInput}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); onCommit((e.target as HTMLInputElement).value); }
        else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
    />
  );
}

/** The Properties-tab counterpart of the on-canvas direction/impedance
 * controls (see the row-rendering block above) — a real dropdown + checkbox
 * instead of tiny click-to-cycle glyphs, for anyone who'd rather not guess
 * what an arrow icon means. Both surfaces edit the exact same two fields;
 * `onChange` receives a mutator so the caller (a connector's cavity or a
 * cable's core — the only two row shapes with a direction) can apply it to
 * whichever one it actually owns without this component needing to know. */
function SignalDirectionRow({
  direction, impedanceMatched, onChange,
}: {
  direction: SignalDirection | undefined;
  impedanceMatched: boolean | undefined;
  onChange: (mutate: (row: { direction?: SignalDirection; impedanceMatched?: boolean }) => void) => void;
}) {
  return (
    <div style={s.signalSubRow}>
      <select
        style={s.dirSelect}
        value={direction ?? 'bidirectional'}
        onChange={(e) => {
          const value = e.target.value as SignalDirection;
          onChange((row) => { row.direction = value === 'bidirectional' ? undefined : value; });
        }}
      >
        <option value="bidirectional">Bidirectional</option>
        <option value="output">Output</option>
        <option value="input">Input</option>
      </select>
      <label style={s.zCheckLabel}>
        <input
          type="checkbox" checked={!!impedanceMatched}
          onChange={(e) => { const checked = e.target.checked; onChange((row) => { row.impedanceMatched = checked || undefined; }); }}
        />
        Impedance matched
      </label>
    </div>
  );
}

/** The `− N +` stepper the reference app floats above a selected connector
 * (spec §2.3). Removing is guarded: it only ever drops the trailing cavity,
 * and refuses if that cavity has a wire on it. */
function CavityStepper({ store, connector, node }: { store: HarnessStore; connector: Connector; node: SceneNode }) {
  const count = connector.cavities.length;
  const lastCavity = connector.cavities[count - 1];
  const removeDisabled = count <= 0 || (!!lastCavity && cavityIsWired(store, connector.id, lastCavity.id));

  return (
    <div style={{ position: 'absolute', left: node.x, top: node.y - 38, zIndex: 2 }}>
      <div style={s.stepperPill}>
        <button
          style={s.stepperBtn}
          disabled={removeDisabled}
          title={removeDisabled ? 'Last cavity is wired — disconnect it first' : 'Remove last cavity'}
          onClick={() => {
            store.transact('Remove cavity', (draft) => {
              const c = draft.components[connector.id];
              if (c?.type === 'connector' && c.cavities.length > 0) c.cavities.pop();
            });
          }}
        >
          −
        </button>
        <span style={s.stepperCount}>{count}</span>
        <button
          style={s.stepperBtn}
          onClick={() => {
            store.transact('Add cavity', (draft) => {
              const c = draft.components[connector.id];
              if (c?.type === 'connector') {
                c.cavities.push({ id: newInstanceId(), designation: String(c.cavities.length + 1), custom: {} });
              }
            });
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}

function ComponentInspector({
  store, component, tab, onTabChange, onDelete, onClose,
}: {
  store: HarnessStore;
  component: Component;
  tab: 'edit' | 'properties';
  onTabChange: (t: 'edit' | 'properties') => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <ComponentIcon type={component.type} {...connectorAppearance(component, store.doc)} />
        <input
          style={s.titleInput}
          value={component.refdes}
          onChange={(e) => {
            const value = e.target.value;
            store.transact('Rename component', (draft) => {
              const c = draft.components[component.id];
              if (c) c.refdes = value;
            });
          }}
        />
        {(component.type === 'connector' || component.type === 'cable') && (
          <button
            style={s.flipBtn}
            title="Flip which side wires exit"
            onClick={() => {
              store.transact('Flip component', (draft) => {
                const c = draft.components[component.id];
                if (c && (c.type === 'connector' || c.type === 'cable')) c.flipped = !c.flipped;
              });
            }}
          >
            »
          </button>
        )}
        <button style={s.closeBtn} onClick={onClose} title="Close">×</button>
      </div>

      {/* Connor: "ensure all relevant features added to the connector
         objects also appear in the other components" — the Properties tab
         (part number/cost/etc., previously connector-only) now shows for
         every purchasable type. Branch points aren't purchasable (no
         schematic presence at all — see schematicScene.ts) so they keep
         just the single Edit surface. */}
      {component.type !== 'branchPoint' && (
        <div style={s.tabRow}>
          <button style={s.tabBtn(tab === 'edit')} onClick={() => onTabChange('edit')}>Edit</button>
          <button style={s.tabBtn(tab === 'properties')} onClick={() => onTabChange('properties')}>Properties</button>
        </div>
      )}

      <div style={s.cardBody}>
        {tab === 'properties' && component.type === 'connector' ? (
          <ConnectorProperties store={store} component={component} />
        ) : tab === 'properties' && component.type !== 'branchPoint' ? (
          <ComponentProperties store={store} component={component} />
        ) : (
          <ComponentEditFields store={store} component={component} />
        )}
        <button style={s.deleteBtn} onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

/** The Properties tab for every purchasable component type that isn't a
 * connector (which has its own richer `ConnectorProperties` — gender,
 * housing shape, configurations, etc.). Just the shared part fields for
 * now; type-specific catalog attributes (spliceKind, terminalKind,
 * polarity) stay on the Edit tab where they already lived, since those are
 * per-instance physical-variant choices rather than catalog/purchasing
 * data. */
function ComponentProperties({ store, component }: { store: HarnessStore; component: Component }) {
  const part = component.partId ? store.doc.parts[component.partId] : undefined;
  const updatePart = useCallback(
    (mutate: (p: Part) => void) => {
      store.transact('Edit part', (draft) => {
        const p = ensureComponentPart(draft, component.id);
        mutate(p);
      });
    },
    [store, component.id],
  );
  const updateParasitics = useCallback(
    (mutate: (p: Parasitics) => void) => {
      store.transact('Edit parasitics', (draft) => {
        const c = draft.components[component.id];
        if (!c) return;
        if (!c.parasitics) c.parasitics = {};
        mutate(c.parasitics);
        // Collapse a fully-blank parasitics object back to undefined so
        // clearing every field returns the component to exactly the state it
        // had before anyone opened this section — otherwise the .ohd gains a
        // permanent empty `"parasitics": {}` that shows up in every diff.
        const p = c.parasitics;
        if (p.resistanceOhms === undefined && p.capacitanceFarads === undefined && p.inductanceHenries === undefined) {
          c.parasitics = undefined;
        }
      });
    },
    [store, component.id],
  );
  const showParasitics = store.doc.settings.showParasitics === true;
  return (
    <>
      <PartCommonFields part={part} onUpdate={updatePart} />
      {/* Connor: parasitics "should default to zero and be hidden in the
          properties tab unless a 'show parasitics' checkbox is toggled". The
          checkbox is project-level (settings.showParasitics), so the choice
          survives reload and every Properties surface agrees; it's offered
          right here rather than buried in a settings pane because this is
          where someone realises they want it. */}
      <label style={s.checkboxRow}>
        <input
          type="checkbox" checked={showParasitics}
          onChange={(e) => {
            const v = e.target.checked;
            store.transact('Toggle show parasitics', (draft) => { draft.settings.showParasitics = v; });
          }}
        />
        Show parasitics
      </label>
      {showParasitics && (
        <>
          <div style={s.sectionLabel}>Parasitics</div>
          <ParasiticsFields parasitics={component.parasitics} onUpdate={updateParasitics} />
        </>
      )}
    </>
  );
}

function ComponentEditFields({ store, component }: { store: HarnessStore; component: Component }) {
  return (
    <>
      {component.type === 'connector' && (
        <label style={s.checkboxRow}>
          <input
            type="checkbox" checked={component.backshellTermination === true}
            onChange={(e) => {
              const v = e.target.checked;
              store.transact(v ? 'Add backshell termination' : 'Remove backshell termination', (draft) => {
                const c = draft.components[component.id];
                if (c?.type === 'connector') c.backshellTermination = v || undefined;
              });
            }}
          />
          Backshell termination (BS contact)
        </label>
      )}

      {component.type === 'connector' && (
        <div style={s.rowList}>
          {component.cavities.map((cavity, i) => (
            <div key={cavity.id} style={s.signalRowGroup}>
              <div style={s.signalRow}>
                <span style={s.signalRowTag}>{cavity.designation}</span>
                <input
                  style={s.signalInput}
                  placeholder="Signal"
                  value={cavity.signal ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    store.transact('Edit cavity signal', (draft) => {
                      const c = draft.components[component.id];
                      if (c?.type === 'connector') c.cavities[i]!.signal = value || undefined;
                    });
                  }}
                />
              </div>
              <SignalDirectionRow
                direction={cavity.direction}
                impedanceMatched={cavity.impedanceMatched}
                onChange={(mutate) => {
                  store.transact('Edit signal direction', (draft) => {
                    const c = draft.components[component.id];
                    if (c?.type === 'connector') mutate(c.cavities[i]!);
                  });
                }}
              />
            </div>
          ))}
        </div>
      )}

      {component.type === 'cable' && (
        <>
          <div style={s.sectionLabel}>Cores</div>
          {component.cores.map((core, i) => (
            <div key={core.id} style={s.signalRowGroup}>
              <div style={s.subRow}>
                <span style={s.subRowTag}>{core.designation ?? i + 1}</span>
                <input
                  style={s.input} placeholder="color" value={core.color}
                  onChange={(e) => {
                    const value = e.target.value;
                    store.transact('Edit core color', (draft) => {
                      const c = draft.components[component.id];
                      if (c?.type === 'cable') c.cores[i]!.color = value;
                    });
                  }}
                />
                <input
                  style={s.input} placeholder="signal" value={core.signal ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    store.transact('Edit core signal', (draft) => {
                      const c = draft.components[component.id];
                      if (c?.type === 'cable') c.cores[i]!.signal = value || undefined;
                    });
                  }}
                />
              </div>
              <SignalDirectionRow
                direction={core.direction}
                impedanceMatched={core.impedanceMatched}
                onChange={(mutate) => {
                  store.transact('Edit signal direction', (draft) => {
                    const c = draft.components[component.id];
                    if (c?.type === 'cable') mutate(c.cores[i]!);
                  });
                }}
              />
            </div>
          ))}
          <button
            style={s.addRowBtn}
            onClick={() => {
              store.transact('Add core', (draft) => {
                const c = draft.components[component.id];
                if (c?.type === 'cable') c.cores.push({ id: newInstanceId(), color: 'White', designation: String(c.cores.length + 1) });
              });
            }}
          >
            + Core
          </button>
        </>
      )}

      {component.type === 'splice' && (
        <>
          <label style={s.fieldLabel}>Splice kind</label>
          <select
            style={s.input} value={component.spliceKind ?? 'crimp'}
            onChange={(e) => {
              const value = e.target.value as SpliceKind;
              store.transact('Edit splice kind', (draft) => {
                const c = draft.components[component.id];
                if (c?.type === 'splice') c.spliceKind = value;
              });
            }}
          >
            {SPLICE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </>
      )}

      {component.type === 'terminal' && (
        <>
          <label style={s.fieldLabel}>Terminal kind</label>
          <select
            style={s.input} value={component.terminalKind}
            onChange={(e) => {
              const value = e.target.value as TerminalKind;
              store.transact('Edit terminal kind', (draft) => {
                const c = draft.components[component.id];
                if (c?.type === 'terminal') c.terminalKind = value;
              });
            }}
          >
            {TERMINAL_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </>
      )}

      {component.type === 'diode' && (
        <>
          <label style={s.fieldLabel}>Polarity</label>
          <select
            style={s.input} value={component.polarity ?? 'forward'}
            onChange={(e) => {
              const value = e.target.value as 'forward' | 'reverse';
              store.transact('Edit diode polarity', (draft) => {
                const c = draft.components[component.id];
                if (c?.type === 'diode') c.polarity = value;
              });
            }}
          >
            <option value="forward">forward</option>
            <option value="reverse">reverse</option>
          </select>
        </>
      )}
    </>
  );
}

/** Wire-properties popup — opened by clicking a routed trace on the canvas
 * (spec request: "add details to wire properties by clicking on the routed
 * trace, this serves as the symbol in the schematic"). Color/stripe are
 * swatch pickers over the same auto-assigned palette; part/gauge/refdes are
 * plain fields since there's no standalone parts-library browser yet. */
function WireInspector({
  store, wire, onDelete, onUngroupWire, onGroupAlone, onAutoRoute, onClose,
}: {
  store: HarnessStore;
  wire: SceneWire;
  onDelete: () => void;
  onUngroupWire?: () => void;
  onGroupAlone?: () => void;
  /** Discards every manual bend and hands the wire back to the auto-router.
   * Present only when there is something to discard. */
  onAutoRoute?: () => void;
  onClose: () => void;
}) {
  const docWire = store.doc.wires[wire.wireId];
  if (!docWire) return null;
  const wirePart = docWire.partId ? (store.doc.parts[docWire.partId] as WirePart | undefined) : undefined;

  const setColor = (color: string) => {
    store.transact('Edit wire color', (draft) => {
      const w = draft.wires[wire.wireId];
      if (w) w.color = color;
    });
  };
  const setStripe = (color: string | undefined) => {
    store.transact('Edit wire stripe', (draft) => {
      const w = draft.wires[wire.wireId];
      if (w) w.stripeColor = color;
    });
  };
  const setGauge = (value: number) => {
    store.transact('Edit wire gauge', (draft) => {
      const w = draft.wires[wire.wireId];
      if (w) w.gauge = { value, unit: draft.settings.gaugeUnit };
    });
  };
  const updateWirePart = (mutate: (p: Part) => void) => {
    store.transact('Edit wire part', (draft) => {
      const p = ensureWirePart(draft, wire.wireId);
      mutate(p);
    });
  };

  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: wire.color, border: `1px solid ${theme.color.border}`, flexShrink: 0 }} />
        <input
          style={s.titleInput}
          value={docWire.refdes}
          onChange={(e) => {
            const value = e.target.value;
            store.transact('Rename wire', (draft) => {
              const w = draft.wires[wire.wireId];
              if (w) w.refdes = value;
            });
          }}
        />
        <button style={s.closeBtn} onClick={onClose} title="Close">×</button>
      </div>
      <div style={s.cardBody}>
        <label style={s.fieldLabel}>Color</label>
        <div style={s.swatchRow}>
          {WIRE_COLORS.map((c) => (
            <button
              key={c} title={c}
              style={{ ...s.swatch, background: c, boxShadow: wire.color === c ? `0 0 0 2px ${theme.color.accent}` : undefined }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>

        <label style={s.checkboxRow}>
          <input type="checkbox" checked={!!docWire.stripeColor} onChange={(e) => setStripe(e.target.checked ? (docWire.stripeColor ?? WIRE_COLORS[0]) : undefined)} />
          Color strip
        </label>
        {docWire.stripeColor && (
          <div style={s.swatchRow}>
            {WIRE_COLORS.map((c) => (
              <button
                key={c} title={c}
                style={{ ...s.swatch, background: c, boxShadow: docWire.stripeColor === c ? `0 0 0 2px ${theme.color.accent}` : undefined }}
                onClick={() => setStripe(c)}
              />
            ))}
          </div>
        )}

        <label style={s.fieldLabel}>Gauge ({store.doc.settings.gaugeUnit})</label>
        <input
          style={s.input} type="number" step="0.01" placeholder="e.g. 0.5" value={docWire.gauge?.value ?? ''}
          onChange={(e) => {
            const value = e.target.value;
            if (value === '') { store.transact('Clear wire gauge', (draft) => { const w = draft.wires[wire.wireId]; if (w) w.gauge = undefined; }); return; }
            setGauge(Number(value));
          }}
        />
        <PartCommonFields part={wirePart} onUpdate={updateWirePart} costLabel="Cost (per unit length)" />

        {/* Per-unit-length parasitics on the WIRE PART (Connor: "wire parts
            gain optional per-unit-length resistance and capacitance
            fields"). Shown behind the same project-level "show parasitics"
            switch as component parasitics, and in the document's own length
            unit — see WirePart.resistancePerLength for why that unit and not
            per-metre. The derived total underneath is the point of entering
            them at all: it's the number the user actually wants, and it can
            only be computed once the wire has a routed length. */}
        {store.doc.settings.showParasitics && (
          <>
            <div style={s.sectionLabel}>Parasitics (per {store.doc.settings.lengthUnit})</div>
            <label style={s.fieldLabel}>Resistance (Ω/{store.doc.settings.lengthUnit})</label>
            <input
              style={s.input} type="number" step="any" placeholder="0"
              value={wirePart?.resistancePerLength ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                updateWirePart((p) => {
                  if (p.kind === 'wire') p.resistancePerLength = v === '' ? undefined : Number(v);
                });
              }}
            />
            <label style={s.fieldLabel}>Capacitance (F/{store.doc.settings.lengthUnit})</label>
            <input
              style={s.input} type="number" step="any" placeholder="0"
              value={wirePart?.capacitancePerLength ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                updateWirePart((p) => {
                  if (p.kind === 'wire') p.capacitancePerLength = v === '' ? undefined : Number(v);
                });
              }}
            />
            {(() => {
              const par = store.derived.wireParasitics.get(wire.wireId);
              if (!par) return null;
              return (
                <div style={s.derivedNote}>
                  {par.lengthKnown
                    ? `Total: ${formatSi(par.resistanceOhms, 'Ω')} · ${formatSi(par.capacitanceFarads, 'F')}`
                    : 'Total unavailable — this wire has no routed length yet.'}
                </div>
              );
            })()}
          </>
        )}

        {/* Manual routing (Connor: reimplement drag-to-bend). Drag the trace
            on the canvas to add a bend; this is the way back. */}
        <div style={s.sectionLabel}>Routing</div>
        <div style={s.derivedNote}>
          {wire.manualWaypoints.length === 0
            ? 'Auto-routed. Drag the wire on the canvas to bend it.'
            : `${wire.manualWaypoints.length} manual bend${wire.manualWaypoints.length === 1 ? '' : 's'} — alt-click a handle to remove one.`}
        </div>
        {onAutoRoute && (
          <button style={s.addRowBtn} onClick={onAutoRoute}>Reset to auto-route</button>
        )}

        {onUngroupWire && (
          <button style={s.addRowBtn} onClick={onUngroupWire}>Remove from group</button>
        )}
        {onGroupAlone && (
          <button style={s.addRowBtn} onClick={onGroupAlone} title="Wrap this wire in its own group — e.g. to add a shield">
            Group this wire (for shielding)
          </button>
        )}
        <button style={s.deleteBtn} onClick={onDelete}>Delete wire</button>
      </div>
    </div>
  );
}

/** Group-properties popup — opened by clicking a bundle halo, or via the
 * "Group" action after multi-selecting wires. The same structure covers
 * both cases from Connor's clarified model: `kind:'twist'` is a physical
 * bundle only; toggling to `kind:'cable'` and filling in part fields turns
 * it into a real BOM line, sourced from the parts list. */
function GroupInspector({
  store, group, memberWires, onUngroup, onRemoveMember, onClose,
}: {
  store: HarnessStore;
  group: WireGroup;
  memberWires: SceneWire[];
  onUngroup: () => void;
  onRemoveMember: (wireId: string) => void;
  onClose: () => void;
}) {
  const cablePart = group.partId ? store.doc.parts[group.partId] : undefined;
  const shieldPart = group.shield?.partId ? (store.doc.parts[group.shield.partId] as ShieldPart | undefined) : undefined;

  /** Shielding is orthogonal to twist/cable `kind` (any group can be
   * shielded — see the `WireGroup.shield` doc comment). Toggling it on
   * eagerly creates a `ShieldPart` the same way `setKind('cable')` eagerly
   * creates a `CablePart` below, rather than lazily on first field edit —
   * simpler, and every other field in this card follows the same "the part
   * IS where you manually define things" convention once it exists. */
  const setShielded = (shielded: boolean) => {
    store.transact(shielded ? 'Add shield' : 'Remove shield', (draft) => {
      const g = draft.wireGroups[group.id];
      if (!g) return;
      if (shielded) {
        const partId = newPartId();
        draft.parts[partId] = { id: partId, kind: 'shield', shieldType: 'braid', custom: {} };
        g.shield = { partId };
        if (!g.refdes) g.refdes = nextShieldRefdes(store);
      } else {
        g.shield = undefined;
      }
    });
  };

  const updateShieldPart = (mutate: (p: ShieldPart) => void) => {
    store.transact('Edit shield', (draft) => {
      const g = draft.wireGroups[group.id];
      if (!g?.shield?.partId) return;
      const p = draft.parts[g.shield.partId];
      if (p) mutate(p as ShieldPart);
    });
  };

  /** Shield termination (Connor: "shields should ... show how shield
   * terminations [are done] ... text notes that can point to the
   * backshell") — `group.shield.termination` mirrors the same
   * lazy-init-on-first-edit pattern the rest of this card avoids (everything
   * else here eagerly creates its target), because unlike the ShieldPart
   * itself, termination has no meaningful "on" toggle of its own — it just
   * starts empty and fills in as fields are set. */
  const updateTermination = (mutate: (t: ShieldTermination) => void) => {
    store.transact('Edit shield termination', (draft) => {
      const g = draft.wireGroups[group.id];
      if (!g?.shield) return;
      if (!g.shield.termination) g.shield.termination = {};
      mutate(g.shield.termination);
    });
  };

  /** Per-end termination override. Creates the object on first edit and
   * clears it back to undefined when the user selects "(same as both ends)",
   * so an untouched override never appears in the serialised document. */
  const updateEndTermination = (end: 'source' | 'target', mutate: (t: ShieldTermination) => void) => {
    store.transact('Edit shield end termination', (draft) => {
      const g = draft.wireGroups[group.id];
      if (!g?.shield) return;
      const key = end === 'source' ? 'sourceTermination' : 'targetTermination';
      if (!g.shield[key]) g.shield[key] = {};
      mutate(g.shield[key]!);
      const t = g.shield[key]!;
      if (t.style === undefined && t.note === undefined) g.shield[key] = undefined;
    });
  };

  const setKind = (kind: 'twist' | 'cable') => {
    store.transact('Set group kind', (draft) => {
      const g = draft.wireGroups[group.id];
      if (!g) return;
      g.kind = kind;
      if (kind === 'cable' && !g.partId) {
        const partId = newPartId();
        draft.parts[partId] = { id: partId, kind: 'cable', custom: {} };
        g.partId = partId;
        if (!g.refdes) g.refdes = nextRefdes(store, draft.settings.refdesPrefixes.cable ?? 'CB', 'cable');
      }
    });
  };

  const updateCablePart = (mutate: (p: Part) => void) => {
    store.transact('Edit cable part', (draft) => {
      const g = draft.wireGroups[group.id];
      if (!g?.partId) return;
      const p = draft.parts[g.partId];
      if (p) mutate(p);
    });
  };

  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <ComponentIcon type="cable" />
        <input
          style={s.titleInput}
          value={group.refdes ?? ''}
          placeholder={group.kind === 'cable' ? 'CB1' : 'Twist group'}
          onChange={(e) => {
            const value = e.target.value;
            store.transact('Rename group', (draft) => {
              const g = draft.wireGroups[group.id];
              if (g) g.refdes = value;
            });
          }}
        />
        <button style={s.closeBtn} onClick={onClose} title="Close">×</button>
      </div>
      <div style={s.cardBody}>
        {/* `kind` is now purely commercial — does this grouping become a
            BOM line? — and the twisted checkbox below is the physical fact.
            They used to be the same control, which meant giving a twisted
            pair a cable part number silently un-twisted its drawing. */}
        <div style={s.tabRow}>
          <button style={s.tabBtn(group.kind === 'twist')} onClick={() => setKind('twist')}>Bundle</button>
          <button style={s.tabBtn(group.kind === 'cable')} onClick={() => setKind('cable')}>Cable</button>
        </div>
        <label style={s.checkboxRow}>
          <input
            type="checkbox"
            checked={group.twisted ?? group.kind === 'twist'}
            disabled={memberWires.length < 2}
            onChange={(e) => {
              const v = e.target.checked;
              store.transact(v ? 'Mark twisted' : 'Clear twisted', (draft) => {
                const g = draft.wireGroups[group.id];
                if (g) g.twisted = v;
              });
            }}
          />
          Twisted
          {memberWires.length < 2 && <span style={s.hintInline}> (needs 2+ wires)</span>}
        </label>

        {group.kind === 'cable' && (
          <>
            <PartCommonFields part={cablePart} onUpdate={updateCablePart} />
            <label style={s.fieldLabel}>Jacket color</label>
            <div style={s.swatchRow}>
              {WIRE_COLORS.map((c) => (
                <button
                  key={c} title={c}
                  style={{ ...s.swatch, background: c, boxShadow: group.color === c ? `0 0 0 2px ${theme.color.accent}` : undefined }}
                  onClick={() => store.transact('Set cable jacket color', (draft) => { const g = draft.wireGroups[group.id]; if (g) g.color = c; })}
                />
              ))}
            </div>
          </>
        )}

        <div style={s.sectionLabel}>Shield</div>
        <label style={s.checkboxRow}>
          <input type="checkbox" checked={!!group.shield} onChange={(e) => setShielded(e.target.checked)} />
          Shielded
        </label>
        {group.shield && shieldPart && (
          <>
            <label style={s.fieldLabel}>Shield type</label>
            <select
              style={s.input} value={shieldPart.shieldType}
              onChange={(e) => { const v = e.target.value as ShieldType; updateShieldPart((p) => { p.shieldType = v; }); }}
            >
              {SHIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <PartCommonFields part={shieldPart} onUpdate={(mutate) => updateShieldPart(mutate)} />
            {(shieldPart.shieldType === 'braid' || shieldPart.shieldType === 'foilBraid') && (
              <>
                <label style={s.fieldLabel}>Coverage (%)</label>
                <input
                  style={s.input} type="number" min={0} max={100} value={shieldPart.coverage ?? ''}
                  onChange={(e) => { const v = e.target.value; updateShieldPart((p) => { p.coverage = v === '' ? undefined : Number(v); }); }}
                />
              </>
            )}
            <label style={s.fieldLabel}>Material</label>
            <input
              style={s.input} value={shieldPart.material ?? ''} placeholder="e.g. tinned copper"
              onChange={(e) => { const v = e.target.value; updateShieldPart((p) => { p.material = v || undefined; }); }}
            />
            <label style={s.checkboxRow}>
              <input
                type="checkbox" checked={!!shieldPart.drainWire}
                onChange={(e) => { const v = e.target.checked; updateShieldPart((p) => { p.drainWire = v; }); }}
              />
              Drain wire
            </label>

            {/* How the shield is documented and costed — see ShieldModel.
                This is the only shield control that changes the BOM. */}
            <label style={s.fieldLabel}>Model</label>
            <select
              style={s.input} value={group.shield.model ?? 'standalonePart'}
              onChange={(e) => {
                const v = e.target.value as ShieldModel;
                store.transact('Set shield model', (draft) => {
                  const g = draft.wireGroups[group.id];
                  if (g?.shield) g.shield.model = v;
                });
              }}
            >
              {SHIELD_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <div style={s.derivedNote}>
              {(group.shield.model ?? 'standalonePart') === 'standalonePart'
                ? 'Rolls up as its own BOM line.'
                : (group.shield.model === 'ipc620WireTermination'
                  ? 'IPC/WHMA-A-620: documented against the conductor, so no separate BOM line.'
                  : 'Custom: described by hand, no BOM line generated.')}
            </div>

            {/* Position along the run (Connor: "user-controlled position
                along the wire run (wrapping at the connector)"). A fraction
                of arc length from each end, so 0% sits at the connector face
                and 50% at mid-span — see shieldTerminationMarks. */}
            <label style={s.fieldLabel}>
              Position along run ({Math.round((group.shield.position ?? DEFAULT_SHIELD_POSITION) * 100)}% from each end)
            </label>
            <input
              style={s.input} type="range" min={0} max={49} step={1}
              value={Math.round((group.shield.position ?? DEFAULT_SHIELD_POSITION) * 100)}
              onChange={(e) => {
                const v = Number(e.target.value) / 100;
                store.transact('Move shield', (draft) => {
                  const g = draft.wireGroups[group.id];
                  if (g?.shield) g.shield.position = v;
                });
              }}
            />

            <label style={s.checkboxRow}>
              <input
                type="checkbox" checked={!!group.shield.terminationNode}
                onChange={(e) => {
                  const v = e.target.checked;
                  store.transact(v ? 'Add shield termination node' : 'Remove shield termination node', (draft) => {
                    const g = draft.wireGroups[group.id];
                    if (g?.shield) g.shield.terminationNode = v || undefined;
                  });
                }}
              />
              Termination node (wirable drain)
            </label>
            {group.shield.terminationNode && (
              <div style={s.derivedNote}>
                Click the node on the shield mark, then a cavity, to draw the drain wire.
              </div>
            )}

            {/* Shared termination, then per-end overrides. The shared one is
                what most shields need; the overrides exist because a shield
                genuinely can pigtail at one end and land on a 360° backshell
                at the other. */}
            <label style={s.fieldLabel}>Termination (both ends)</label>
            <select
              style={s.input} value={group.shield.termination?.style ?? ''}
              onChange={(e) => {
                const v = e.target.value as ShieldTermination['style'];
                updateTermination((t) => { t.style = v || undefined; });
              }}
            >
              <option value="">(unspecified)</option>
              {SHIELD_TERMINATION_STYLES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <label style={s.fieldLabel}>Note (e.g. pointer to backshell)</label>
            <input
              style={s.input} value={group.shield.termination?.note ?? ''}
              placeholder="e.g. terminates at J1 backshell, 360° clamp"
              onChange={(e) => { const v = e.target.value; updateTermination((t) => { t.note = v || undefined; }); }}
            />

            {(['source', 'target'] as const).map((end) => (
              <div key={end}>
                <label style={s.fieldLabel}>{end === 'source' ? 'Source end override' : 'Target end override'}</label>
                <select
                  style={s.input}
                  value={(end === 'source' ? group.shield?.sourceTermination : group.shield?.targetTermination)?.style ?? ''}
                  onChange={(e) => {
                    const v = e.target.value as ShieldTermination['style'];
                    updateEndTermination(end, (t) => { t.style = v || undefined; });
                  }}
                >
                  <option value="">(same as both ends)</option>
                  {SHIELD_TERMINATION_STYLES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            ))}
          </>
        )}

        <div style={s.sectionLabel}>Members ({memberWires.length})</div>
        {memberWires.map((w) => (
          <div key={w.wireId} style={s.subRow}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: w.color, border: `1px solid ${theme.color.border}`, flexShrink: 0 }} />
            <span style={{ ...s.subRowTag, width: 'auto', flex: 1 }}>{w.refdes}</span>
            <button style={s.removeChip} title="Remove from group" onClick={() => onRemoveMember(w.wireId)}>×</button>
          </div>
        ))}

        <button style={s.deleteBtn} onClick={onUngroup}>Ungroup</button>
      </div>
    </div>
  );
}

/**
 * Mate properties (T02): which two components are mated, and — the heart of
 * it — how their cavities correspond. Positional pairing (nth to nth) is only
 * a DEFAULT, never an assertion (DOMAIN-DECISIONS D3): an explicit cavity map
 * overrides it entirely, and any cavity the map does not name stays UNPAIRED
 * rather than falling back to positional. Both the receiving cavity (for a
 * terminal mated into a connector) and the map itself are editable here,
 * because D3 requires the user to be able to override the default.
 */
function MateInspector({
  store, mate, onDelete, onClose,
}: {
  store: HarnessStore;
  mate: Mate;
  onDelete: () => void;
  onClose: () => void;
}) {
  const source = store.doc.components[mate.sourceId];
  const target = store.doc.components[mate.targetId];
  const sourceCavities = source?.type === 'connector' ? source.cavities : [];
  const targetCavities = target?.type === 'connector' ? target.cavities : [];
  const isTerminalIntoConnector = source?.type === 'terminal' && target?.type === 'connector';
  const isConnectorToConnector = source?.type === 'connector' && target?.type === 'connector';
  const cavityMap = mate.cavityMap ?? [];

  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <span style={{ ...s.cardTitle, color: theme.color.mate }}>Mate</span>
        <span style={{ fontSize: 12, color: theme.color.textMuted }}>
          {source?.refdes ?? '?'} ↔ {target?.refdes ?? '?'}
        </span>
        <button style={s.closeBtn} onClick={onClose} title="Close">×</button>
      </div>
      <div style={s.cardBody}>
        {isTerminalIntoConnector && (
          <>
            <label style={s.fieldLabel}>Cavity receiving the terminal ({target?.refdes})</label>
            <select
              style={s.input}
              value={mate.targetCavityId ?? ''}
              onChange={(e) => {
                const value = e.target.value || undefined;
                store.transact('Set mate cavity', (draft) => {
                  setMateTargetCavityInDraft(draft, mate.id, value);
                });
              }}
            >
              <option value="">— choose a cavity —</option>
              {targetCavities.map((cav) => (
                <option key={cav.id} value={cav.id}>{cav.designation}</option>
              ))}
            </select>
            <div style={s.derivedNote}>
              A terminal has one port, so the connector end says which cavity
              receives it. Until a cavity is chosen the two stay on separate nets.
            </div>
          </>
        )}

        {isConnectorToConnector && (
          <>
            <div style={s.sectionLabel}>Cavity pairing</div>
            <div style={s.derivedNote}>
              {cavityMap.length === 0
                ? 'Positional (nth cavity to nth cavity) — the default, not an assertion. Add pairs below to override; any cavity you don\u2019t name stays unpaired.'
                : `Explicit map — overrides positional entirely. ${cavityMap.length} pair${cavityMap.length === 1 ? '' : 's'} named; every other cavity is unpaired.`}
            </div>
            {cavityMap.map((pair, i) => (
              <div key={i} style={s.subRow}>
                <select
                  style={{ ...s.input, flex: 1 }}
                  value={pair.sourceCavityId}
                  onChange={(e) => {
                    const value = e.target.value;
                    store.transact('Edit mate cavity pair', (draft) => {
                      updateMateCavityPairInDraft(draft, mate.id, i, { sourceCavityId: value });
                    });
                  }}
                >
                  {sourceCavities.map((cav) => (
                    <option key={cav.id} value={cav.id}>{source?.refdes}:{cav.designation}</option>
                  ))}
                </select>
                <span style={{ color: theme.color.textFaint }}>↔</span>
                <select
                  style={{ ...s.input, flex: 1 }}
                  value={pair.targetCavityId}
                  onChange={(e) => {
                    const value = e.target.value;
                    store.transact('Edit mate cavity pair', (draft) => {
                      updateMateCavityPairInDraft(draft, mate.id, i, { targetCavityId: value });
                    });
                  }}
                >
                  {targetCavities.map((cav) => (
                    <option key={cav.id} value={cav.id}>{target?.refdes}:{cav.designation}</option>
                  ))}
                </select>
                <button
                  style={s.removeChip} title="Remove this pair"
                  onClick={() => {
                    store.transact('Remove mate cavity pair', (draft) => {
                      removeMateCavityPairInDraft(draft, mate.id, i);
                    });
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              style={s.addRowBtn}
              disabled={sourceCavities.length === 0 || targetCavities.length === 0}
              onClick={() => {
                // Default the new pair to the first not-yet-used cavity on each
                // side, purely as a starting point the dropdowns can change —
                // this is a UI convenience, never an inferred pairing (D3).
                const usedSource = new Set(cavityMap.map((p) => p.sourceCavityId));
                const usedTarget = new Set(cavityMap.map((p) => p.targetCavityId));
                const sc = sourceCavities.find((c) => !usedSource.has(c.id)) ?? sourceCavities[0];
                const tc = targetCavities.find((c) => !usedTarget.has(c.id)) ?? targetCavities[0];
                if (!sc || !tc) return;
                store.transact('Add mate cavity pair', (draft) => {
                  addMateCavityPairInDraft(draft, mate.id, sc.id, tc.id);
                });
              }}
            >
              + Add cavity pair
            </button>
            {cavityMap.length > 0 && (
              <button
                style={s.addRowBtn}
                onClick={() => {
                  store.transact('Clear mate cavity map', (draft) => {
                    clearMateCavityMapInDraft(draft, mate.id);
                  });
                }}
              >
                Clear map (back to positional)
              </button>
            )}
          </>
        )}

        {!isTerminalIntoConnector && !isConnectorToConnector && (
          <div style={s.derivedNote}>
            {source?.type} ↔ {target?.type}: no cavity pairing applies to this mate.
          </div>
        )}

        <button style={s.deleteBtn} onClick={onDelete}>Delete mate</button>
      </div>
    </div>
  );
}

/** Generic right-click context menu, wired to component nodes, wires,
 * groups, and notes (spec request: "each component has a drop down menu
 * when it is right clicked so we can add new features as we go forward";
 * Connor's follow-up: "I don't like the drop down menus that appear upon a
 * click... almost no drop down menu needed unless the user right clicks").
 * Plain click now only selects/highlights (see `select()` in the parent) —
 * this menu, and its "Edit" item specifically, is the only way to open the
 * full property card. Item set stays small and real per target kind. */
function ContextMenu({
  state, store, onClose, onEdit, onDuplicate, onDelete, onUngroupWire, onUngroup, onAutoRoute, onStartMate,
}: {
  state: ContextMenuState;
  store: HarnessStore;
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: (componentId: string) => void;
  onDelete: () => void;
  onUngroupWire: (groupId: string, wireId: string) => void;
  onUngroup: (groupId: string) => void;
  onAutoRoute: (wireId: string) => void;
  onStartMate: (componentId: string) => void;
}) {
  const items: { label: string; onClick: () => void; danger?: boolean }[] = [];
  items.push({ label: 'Edit', onClick: () => { onEdit(); onClose(); } });

  if (state.target.kind === 'component') {
    const component = store.doc.components[state.target.id];
    items.push({ label: 'Duplicate', onClick: () => { onDuplicate(state.target.id); onClose(); } });
    if (component && (component.type === 'connector' || component.type === 'cable')) {
      items.push({
        label: 'Flip', onClick: () => {
          store.transact('Flip component', (draft) => {
            const c = draft.components[state.target.id];
            if (c && (c.type === 'connector' || c.type === 'cable')) c.flipped = !c.flipped;
          });
          onClose();
        },
      });
    }
    // Mates join connectors/terminals (see Mate in core/types.ts) — the other
    // component types have nothing to mate with, so the entry only appears
    // where it can do something.
    if (component && (component.type === 'connector' || component.type === 'terminal')) {
      items.push({ label: 'Create mate', onClick: () => { onStartMate(state.target.id); onClose(); } });
    }
    items.push({ label: 'Delete', danger: true, onClick: () => { onDelete(); onClose(); } });
  } else if (state.target.kind === 'wire') {
    const wire = store.doc.wires[state.target.id];
    if (wire?.schematicWaypoints?.length) {
      items.push({ label: 'Reset to auto-route', onClick: () => { onAutoRoute(state.target.id); onClose(); } });
    }
    if (wire?.twistGroupId) {
      items.push({ label: 'Remove from group', onClick: () => { onUngroupWire(wire.twistGroupId!, state.target.id); onClose(); } });
    }
    items.push({ label: 'Delete wire', danger: true, onClick: () => { onDelete(); onClose(); } });
  } else if (state.target.kind === 'group') {
    items.push({ label: 'Ungroup', onClick: () => { onUngroup(state.target.id); onClose(); } });
  } else if (state.target.kind === 'mate') {
    items.push({ label: 'Delete mate', danger: true, onClick: () => { onDelete(); onClose(); } });
  } else {
    items.push({ label: 'Delete note', danger: true, onClick: () => { onDelete(); onClose(); } });
  }

  return (
    <>
      <div style={s.contextMenuOverlay} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div style={{ ...s.contextMenu, left: state.x, top: state.y }}>
        {items.map((item) => (
          <button
            key={item.label}
            style={{ ...s.contextMenuItem, color: item.danger ? theme.color.danger : theme.color.textStrong }}
            onClick={item.onClick}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}

/** Connector "Properties" tab (spec §2.6: confirmed connector part editor
 * fields) — part identity plus named configurations, each a bundle of
 * accessory part references (lock / dust cover / backshell / boot /
 * contact / cavity seal) so the BOM can pick the right hardware for a
 * given build variant. Accessory fields are lightweight: typing a part
 * number here creates or updates a minimal AccessoryPart, since there is
 * no standalone parts-library browser yet (spec §2.6 describes one; out of
 * scope for this pass). */
function ConnectorProperties({ store, component }: { store: HarnessStore; component: Connector }) {
  const part = component.partId ? (store.doc.parts[component.partId] as ConnectorPart | undefined) : undefined;

  const updatePart = useCallback(
    (mutate: (part: ConnectorPart) => void) => {
      store.transact('Edit connector part', (draft) => {
        const p = ensureConnectorPart(draft, component.id);
        mutate(p);
      });
    },
    [store, component.id],
  );

  return (
    <>
      <PartCommonFields part={part} onUpdate={(mutate) => updatePart(mutate)} />
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={s.fieldLabel}>Gender</label>
          <select
            style={s.input} value={part?.gender ?? ''}
            onChange={(e) => { const v = e.target.value as ConnectorPart['gender']; updatePart((p) => { p.gender = v || undefined; }); }}
          >
            <option value="">—</option>
            <option value="male">male</option>
            <option value="female">female</option>
            <option value="hermaphroditic">hermaphroditic</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={s.fieldLabel}>Color</label>
          <input
            style={s.input} value={part?.color ?? ''}
            onChange={(e) => { const v = e.target.value; updatePart((p) => { p.color = v || undefined; }); }}
          />
        </div>
      </div>
      <label style={s.checkboxRow}>
        <input
          type="checkbox" checked={part?.hasShell ?? false}
          onChange={(e) => { const v = e.target.checked; updatePart((p) => { p.hasShell = v; }); }}
        />
        Has shell
      </label>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label style={s.fieldLabel}>Housing shape</label>
          <select
            style={s.input} value={part?.housingShape ?? 'rectangular'}
            onChange={(e) => { const v = e.target.value as ConnectorHousingShape; updatePart((p) => { p.housingShape = v; }); }}
          >
            {HOUSING_SHAPES.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
          </select>
        </div>
        <div style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control, color: theme.color.textMuted, flexShrink: 0 }} title="Preview">
          <ComponentIcon type="connector" size={16} housingShape={part?.housingShape} glyph={part?.iconGlyph} />
        </div>
      </div>
      <label style={s.fieldLabel}>Custom icon (optional — overrides housing shape)</label>
      <input
        style={s.input} value={part?.iconGlyph ?? ''} maxLength={3} placeholder="e.g. a short glyph or emoji"
        onChange={(e) => { const v = e.target.value; updatePart((p) => { p.iconGlyph = v || undefined; }); }}
      />

      <div style={s.sectionLabel}>Configurations</div>
      {(part?.configurations ?? []).map((config) => (
        <ConfigurationCard
          key={config.id}
          store={store}
          component={component}
          config={config}
          active={component.configurationId === config.id}
          onUse={() => {
            store.transact('Set connector configuration', (draft) => {
              const c = draft.components[component.id];
              if (c?.type === 'connector') c.configurationId = config.id;
            });
          }}
        />
      ))}
      <button
        style={s.addRowBtn}
        onClick={() => {
          store.transact('Add configuration', (draft) => {
            const p = ensureConnectorPart(draft, component.id);
            const n = p.configurations.length + 1;
            p.configurations.push({ id: newInstanceId(), name: `Configuration ${n}` });
          });
        }}
      >
        + Add configuration
      </button>
    </>
  );
}

function ConfigurationCard({
  store, component, config, active, onUse,
}: {
  store: HarnessStore;
  component: Connector;
  config: ConnectorConfiguration;
  active: boolean;
  onUse: () => void;
}) {
  const partNumberOf = (id: PartId | undefined) => (id ? store.doc.parts[id]?.partNumber ?? '' : '');

  const setSlot = useCallback(
    (key: (typeof ACCESSORY_SLOTS)[number]['key'], accessoryType: (typeof ACCESSORY_SLOTS)[number]['type'], partNumber: string) => {
      store.transact('Edit configuration accessory', (draft) => {
        const p = ensureConnectorPart(draft, component.id);
        const cfg = p.configurations.find((c) => c.id === config.id);
        if (!cfg) return;
        if (!partNumber) { cfg[key] = undefined; return; }
        const existingId = cfg[key];
        const partId = existingId ?? newPartId();
        draft.parts[partId] = { id: partId, kind: 'accessory', accessoryType, partNumber, custom: {} };
        cfg[key] = partId;
      });
    },
    [store, component.id, config.id],
  );

  return (
    <div style={s.configCard(active)}>
      <div style={s.configHeader}>
        <input
          style={s.configNameInput}
          value={config.name}
          onChange={(e) => {
            const value = e.target.value;
            store.transact('Rename configuration', (draft) => {
              const p = ensureConnectorPart(draft, component.id);
              const cfg = p.configurations.find((c) => c.id === config.id);
              if (cfg) cfg.name = value;
            });
          }}
        />
        <button style={s.useBtn(active)} onClick={onUse}>{active ? 'Active' : 'Use'}</button>
      </div>
      {ACCESSORY_SLOTS.map((slot) => (
        <div key={slot.key} style={s.subRow}>
          <span style={s.accessoryLabel}>{slot.label}</span>
          <input
            style={s.input} placeholder="part number"
            value={partNumberOf(config[slot.key])}
            onChange={(e) => setSlot(slot.key, slot.type, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}

const s = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', background: theme.color.canvasBg },
  addToolbar: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px',
    borderBottom: `1px solid ${theme.color.border}`, background: theme.color.surface, flexWrap: 'wrap',
  },
  addToolbarLabel: { fontSize: 11, fontWeight: 600, color: theme.color.textFaint, textTransform: 'uppercase', letterSpacing: 0.4, marginRight: 4 },
  addBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '6px 11px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control,
    background: theme.color.surface, color: theme.color.textStrong, cursor: 'pointer', fontSize: 12.5, fontWeight: 500,
  },
  /** Fit-view buttons read like addBtn but carry their own disabled state —
   * "Fit selection" is inert until something is selected. */
  viewBtn: (enabled: boolean) => ({
    padding: '6px 11px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control,
    background: theme.color.surface, color: theme.color.textStrong, fontSize: 12.5, fontWeight: 500,
    cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.45,
  }),
  wireHint: { color: theme.color.accent, fontSize: 12, marginLeft: 8, fontWeight: 500 },
  canvasScroll: { flex: 1, overflow: 'auto', cursor: 'grab' },
  canvasSvg: { display: 'block' },

  derivedNote: { fontSize: 11, color: theme.color.textFaint, lineHeight: 1.45 },
  hintInline: { fontSize: 10.5, color: theme.color.textFaint },
  selectionActions: { position: 'absolute', zIndex: 4, display: 'flex', gap: 6 },
  groupActionBtn: {
    padding: '6px 14px', borderRadius: 999,
    border: 'none', background: theme.color.accent, color: '#fff', fontSize: 12.5, fontWeight: 600,
    cursor: 'pointer', boxShadow: '0 4px 12px rgba(16,24,40,0.2)',
  },
  deleteActionBtn: {
    padding: '6px 14px', borderRadius: 999,
    border: `1px solid ${theme.color.border}`, background: theme.color.surface, color: theme.color.danger,
    fontSize: 12.5, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 12px rgba(16,24,40,0.14)',
  },

  card: {
    width: 264, background: theme.color.surface, border: `1px solid ${theme.color.border}`,
    borderRadius: theme.radius.panel, boxShadow: '0 8px 24px rgba(16,24,40,0.12), 0 1px 3px rgba(16,24,40,0.08)',
    overflow: 'hidden',
  },
  cardHeader: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
    borderBottom: `1px solid ${theme.color.border}`, color: theme.color.textMuted,
  },
  cardTitle: { fontSize: 13, fontWeight: 600, color: theme.color.textStrong },
  titleInput: {
    flex: 1, border: 'none', background: 'transparent', fontSize: 13.5, fontWeight: 600,
    color: theme.color.textStrong, padding: '2px 4px', borderRadius: 4, minWidth: 0,
  },
  flipBtn: {
    border: `1px solid ${theme.color.border}`, background: theme.color.surface, borderRadius: 5,
    width: 24, height: 24, cursor: 'pointer', color: theme.color.textMuted, fontSize: 13, lineHeight: 1,
    flexShrink: 0,
  },
  closeBtn: {
    border: 'none', background: 'transparent', borderRadius: 5,
    width: 22, height: 22, cursor: 'pointer', color: theme.color.textFaint, fontSize: 16, lineHeight: 1,
    flexShrink: 0,
  },
  tabRow: { display: 'flex', gap: 2, padding: '8px 12px 0 12px' },
  tabBtn: (active: boolean) => ({
    flex: 1, padding: '6px 0', border: 'none', borderBottom: `2px solid ${active ? theme.color.accent : 'transparent'}`,
    background: 'transparent', color: active ? theme.color.accent : theme.color.textMuted,
    cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
  }),
  cardBody: { padding: 12, maxHeight: 360, overflowY: 'auto' },

  rowList: { display: 'flex', flexDirection: 'column', gap: 1 },
  signalRowGroup: { display: 'flex', flexDirection: 'column' },
  signalRow: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px',
    borderRadius: 6,
  },
  signalSubRow: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px 6px 32px',
  },
  dirSelect: {
    fontSize: 10.5, color: theme.color.textMuted, border: `1px solid ${theme.color.border}`,
    borderRadius: theme.radius.control, padding: '2px 4px', background: theme.color.surface,
  },
  zCheckLabel: {
    display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: theme.color.textFaint, cursor: 'pointer',
  },
  signalRowTag: {
    width: 18, textAlign: 'center', fontSize: 11.5, fontWeight: 700, color: theme.color.accent,
    background: theme.color.accentSoft, borderRadius: 4, padding: '2px 0', flexShrink: 0,
  },
  signalInput: {
    flex: 1, border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control,
    padding: '6px 8px', fontSize: 13, color: theme.color.textStrong, minWidth: 0,
  },
  inlineSignalInput: {
    width: '100%', height: '100%', border: `1px solid ${theme.color.accent}`, borderRadius: 4,
    padding: '0 4px', fontSize: 11, boxSizing: 'border-box', background: theme.color.surface, color: theme.color.textStrong,
  },

  fieldLabel: { display: 'block', fontSize: 11.5, color: theme.color.textFaint, marginBottom: 4, marginTop: 10, fontWeight: 500 },
  sectionLabel: { fontSize: 12, fontWeight: 600, color: theme.color.textStrong, marginTop: 16, marginBottom: 8 },
  input: {
    width: '100%', padding: '6px 8px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control,
    fontSize: 12.5, boxSizing: 'border-box', background: theme.color.surface, color: theme.color.textStrong,
  },
  textarea: {
    width: '100%', minHeight: 80, padding: '7px 9px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control,
    fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical', color: theme.color.textStrong,
  },
  subRow: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 },
  subRowTag: { fontSize: 11, color: theme.color.textFaint, width: 60, flexShrink: 0 },
  accessoryLabel: { fontSize: 11, color: theme.color.textFaint, width: 68, flexShrink: 0 },
  addRowBtn: {
    marginTop: 8, width: '100%', padding: '6px 10px', border: `1px dashed ${theme.color.border}`, borderRadius: theme.radius.control,
    background: 'transparent', color: theme.color.textMuted, cursor: 'pointer', fontSize: 12.5,
  },
  deleteBtn: {
    marginTop: 16, width: '100%', padding: '7px 10px', border: `1px solid ${theme.color.dangerBorder}`,
    borderRadius: theme.radius.control, background: theme.color.dangerSoft, color: theme.color.danger,
    cursor: 'pointer', fontSize: 12.5, fontWeight: 500,
  },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: theme.color.textStrong, marginTop: 12 },

  swatchRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  swatch: {
    width: 20, height: 20, borderRadius: '50%', border: `1px solid ${theme.color.border}`,
    cursor: 'pointer', padding: 0,
  },
  removeChip: {
    width: 18, height: 18, borderRadius: '50%', border: `1px solid ${theme.color.border}`, background: theme.color.canvasBg,
    color: theme.color.textMuted, cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0, flexShrink: 0,
  },

  configCard: (active: boolean) => ({
    border: `1px solid ${active ? theme.color.accent : theme.color.border}`, borderRadius: theme.radius.control,
    padding: 8, marginBottom: 8, background: active ? theme.color.accentSoft : theme.color.canvasBg,
  }),
  configHeader: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 },
  configNameInput: {
    flex: 1, border: 'none', background: 'transparent', fontSize: 12.5, fontWeight: 600, color: theme.color.textStrong,
    padding: '2px 2px', minWidth: 0,
  },
  useBtn: (active: boolean) => ({
    padding: '3px 8px', borderRadius: 999, border: `1px solid ${active ? theme.color.accent : theme.color.border}`,
    background: active ? theme.color.accent : theme.color.surface, color: active ? '#fff' : theme.color.textMuted,
    fontSize: 10.5, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
  }),

  stepperPill: {
    display: 'flex', alignItems: 'center', gap: 8, background: theme.color.surface,
    border: `1px solid ${theme.color.border}`, borderRadius: 999, padding: '4px 8px',
    boxShadow: '0 2px 8px rgba(16,24,40,0.12)',
  },
  stepperBtn: {
    width: 20, height: 20, borderRadius: '50%', border: `1px solid ${theme.color.border}`, background: theme.color.canvasBg,
    color: theme.color.textStrong, cursor: 'pointer', fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0,
  },
  stepperCount: { fontSize: 12.5, fontWeight: 700, color: theme.color.textStrong, minWidth: 14, textAlign: 'center' },

  noteText: {
    fontSize: 12, color: theme.color.textStrong, lineHeight: 1.4, whiteSpace: 'pre-wrap', overflow: 'hidden',
    fontFamily: 'inherit',
  },

  contextMenuOverlay: { position: 'fixed', inset: 0, zIndex: 10 },
  contextMenu: {
    position: 'fixed', zIndex: 11, minWidth: 160, background: theme.color.surface,
    border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control,
    boxShadow: '0 8px 24px rgba(16,24,40,0.16)', padding: 4, display: 'flex', flexDirection: 'column',
  },
  contextMenuItem: {
    textAlign: 'left', padding: '7px 10px', border: 'none', background: 'transparent',
    fontSize: 12.5, cursor: 'pointer', borderRadius: 6,
  },
} satisfies Record<string, React.CSSProperties | ((...args: never[]) => React.CSSProperties)>;
