/**
 * The Schematic canvas (spec §7.2) — the first real editing surface, not
 * just a viewer. Every edit here — add a component, draw a wire, rename a
 * refdes, edit a signal, drag a box, delete — goes through
 * `store.transact(...)`, the same call an automation makes (spec §8.3).
 *
 * Editing UX is modeled directly on the reference app (the reference tool),
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
  ShieldPart, ShieldType, ShieldTermination, Part,
} from '@openharness/core';
import { newInstanceId, newPartId } from '@openharness/core';
import { computeSchematicScene, type SceneNode, type SceneRow, type SceneWire, ROW_HEIGHT, HEADER_HEIGHT } from '@openharness/render';
import { theme } from './theme.js';
import { ComponentIcon, connectorAppearance } from './icons.js';
import { nextLayoutGrid } from './layoutGrid.js';
import { useCanvasPan } from './canvasPan.js';
import { SHIELD_TYPES, SHIELD_TERMINATION_STYLES } from './shieldConstants.js';
import { PartCommonFields } from './partFields.js';

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

interface PendingWire {
  componentId: string;
  rowId: string;
  endpoint: Endpoint;
}

type Selection =
  | { kind: 'component'; id: string }
  | { kind: 'note'; id: string }
  | { kind: 'wire'; id: string }
  | { kind: 'group'; id: string }
  | null;

interface Dragging {
  kind: 'component' | 'note' | 'wire';
  id: string;
  pointerStartX: number;
  pointerStartY: number;
  boxStartX: number;
  boxStartY: number;
}

interface ContextMenuState {
  x: number;
  y: number;
  target: { kind: 'component' | 'wire' | 'group' | 'note'; id: string };
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

function wireKey(id: string): string {
  return `wire:${id}`;
}
function groupKey(id: string): string {
  return `group:${id}`;
}
function parseKey(key: string): { kind: 'wire' | 'group'; id: string } | null {
  const i = key.indexOf(':');
  if (i < 0) return null;
  const kind = key.slice(0, i);
  if (kind !== 'wire' && kind !== 'group') return null;
  return { kind, id: key.slice(i + 1) };
}

/** How far a shield termination ellipse sits inset from the connector face
 * (see `shieldTerminations`) — also the outer bound for `TWIST_ZONE_LEN`
 * below, so a twist crossover glyph never reaches far enough to collide
 * with a shield mark on the same wire. */
const SHIELD_INSET = 26;

/** Length (px, along each wire's own route) of the twisted-pair crossover
 * glyph at each connector exit — kept comfortably under `SHIELD_INSET` so it
 * always fits between the connector and a shield mark, per Connor: "as
 * short as possible so it fits between the shield and the connector". */
const TWIST_ZONE_LEN = 16;

/** Point at cumulative arc length `targetLen` along a polyline, starting
 * from `points[0]` — used to find where a twist crossover glyph should
 * rejoin the wire's real, un-perturbed path. Clamps to the last point if
 * the wire is shorter than `targetLen` (a very short run between adjacent
 * components). */
function pointAtArcLength(points: Point[], targetLen: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0]!;
  let remaining = targetLen;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen === 0) continue;
    if (remaining <= segLen) {
      const t = remaining / segLen;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= segLen;
  }
  return points[points.length - 1]!;
}

/** Twisted-pair visual (Connor: "show twisted pairs as twisted wires...
 * with the wires crossing over back and forth once right at the connector
 * exit... as short as possible so it fits between the shield and the
 * connector"). A previous full-length sinusoidal overlay read as a
 * continuous twist along the whole run rather than a localized cue at the
 * termination — this instead draws one short "X" crossover glyph at EACH
 * end where the group's members leave a connector: adjacent members (by
 * their actual pin order at that end) swap sides once, over `TWIST_ZONE_LEN`
 * px, then the glyph ends exactly where the real, straight wire trace
 * resumes (the underlying trace/hit-target is never touched). Only draws
 * anything for 2+ members — a lone wire can't twist around itself. */
function twistCrossoverPaths(members: SceneWire[], end: 'from' | 'to'): string[] {
  if (members.length < 2) return [];
  const anchors = members.map((m) => {
    const pts = end === 'from' ? m.routePoints : [...m.routePoints].reverse();
    return { pin: pts[0]!, zoneEnd: pointAtArcLength(pts, TWIST_ZONE_LEN) };
  });
  // Order by lateral (row) position so adjacent-in-space members cross with
  // each other, not with whichever member happens to be next in the array.
  const order = anchors
    .map((a, i) => ({ i, key: a.pin.y }))
    .sort((a, b) => a.key - b.key)
    .map((o) => o.i);

  const paths: string[] = [];
  for (let k = 0; k < order.length - 1; k++) {
    const a = anchors[order[k]!]!;
    const b = anchors[order[k + 1]!]!;
    // `a` swings over to where `b` straightens out, and vice versa — a
    // single crossing, each back on its own row by TWIST_ZONE_LEN out.
    paths.push(`M ${a.pin.x} ${a.pin.y} L ${b.zoneEnd.x} ${b.zoneEnd.y}`);
    paths.push(`M ${b.pin.x} ${b.pin.y} L ${a.zoneEnd.x} ${a.zoneEnd.y}`);
  }
  return paths;
}

/** Component types drawn as real schematic symbols instead of the generic
 * labeled box (Connor: "improve the other components. add them as symbols
 * in the schematic instead of generic blocks"). Each of these already had a
 * tiny 16x16 decorative icon in `icons.tsx`, but the actual node body was
 * still just a plain rounded rectangle — this scales that same symbol
 * language up to be the node itself, the same move Layout's `connectorGlyph`
 * already made for connectors (see LayoutCanvas.tsx). `connector`/`cable`/
 * `generic` keep the labeled-box treatment: a connector's cavity list and a
 * cable's core list both need real row space a symbol can't provide, and
 * `generic` has no more specific shape to draw. */
const SYMBOL_NODE_TYPES = new Set<Component['type']>(['splice', 'terminal', 'resistor', 'diode']);

/** Splice symbol: a straight through-wire with a junction dot at the
 * midpoint — the standard schematic convention for "these wires are
 * electrically the same node," matching the two-port L/R shape
 * schematicScene.ts already gives a Splice component. */
function spliceSymbol(x: number, y: number, w: number, h: number) {
  const cy = y + h / 2;
  return { lineD: `M ${x} ${cy} L ${x + w} ${cy}`, dotCx: x + w / 2, dotCy: cy, dotR: Math.min(h * 0.28, 5) };
}

/** Terminal symbol: a stub lead into a ring — the single-port lug shape
 * (spec §7.2's "ring terminal"), reused for every TerminalKind since the
 * kind itself is already surfaced as text via SceneRow.label. Ports sit on
 * the right unless flipped (see schematicScene.ts's Terminal handling). */
function terminalSymbol(x: number, y: number, w: number, h: number, flipped: boolean) {
  const cy = y + h / 2;
  const ringR = Math.min(h * 0.34, 6.5);
  const ringCx = flipped ? x + w * 0.28 : x + w * 0.72;
  const leadFrom = flipped ? x + w : x;
  const leadTo = flipped ? ringCx + ringR : ringCx - ringR;
  return { leadD: `M ${leadFrom} ${cy} L ${leadTo} ${cy}`, ringCx, ringCy: cy, ringR };
}

/** Resistor symbol: the classic zigzag between two stub leads — geometry
 * lifted directly from the ComponentIcon 'resistor' glyph (icons.tsx) and
 * rescaled from its fixed 16x16 icon space to the node's actual (x,y,w,h),
 * so the full-size schematic symbol and the small toolbar/header icon read
 * as the same shape at different sizes. */
function resistorSymbol(x: number, y: number, w: number, h: number) {
  const cy = y + h / 2;
  const amp = Math.min(h * 0.4375, 8);
  const zx0 = x + w * 0.219;
  const zx1 = x + w * 0.781;
  const fr = [0, 0.167, 0.389, 0.611, 0.833, 1];
  const pts = fr.map((f, i) => {
    const px = zx0 + (zx1 - zx0) * f;
    const py = i === 0 || i === fr.length - 1 ? cy : i % 2 === 1 ? cy - amp : cy + amp;
    return `${px},${py}`;
  });
  return {
    leftStubD: `M ${x} ${cy} L ${zx0} ${cy}`,
    zigzagPoints: pts.join(' '),
    rightStubD: `M ${zx1} ${cy} L ${x + w} ${cy}`,
  };
}

/** Diode symbol: triangle + cathode bar, also lifted from the ComponentIcon
 * 'diode' glyph and rescaled the same way as resistorSymbol. `reverse`
 * mirrors the whole shape left-right so `TwoTerminal.polarity === 'reverse'`
 * (already a field on the data model, previously invisible in the
 * schematic) actually shows up as a flipped diode instead of only being
 * readable from the Edit tab's dropdown. */
function diodeSymbol(x: number, y: number, w: number, h: number, reverse: boolean) {
  const cy = y + h / 2;
  const amp = Math.min(h * 0.4375, 8);
  const baseF = reverse ? 0.6875 : 0.3125;
  const apexF = reverse ? 0.344 : 0.656;
  const baseX = x + w * baseF;
  const apexX = x + w * apexF;
  return {
    leftStubD: `M ${x} ${cy} L ${Math.min(baseX, apexX)} ${cy}`,
    trianglePoints: `${baseX},${cy - amp} ${baseX},${cy + amp} ${apexX},${cy}`,
    barD: `M ${apexX} ${cy - amp} L ${apexX} ${cy + amp}`,
    rightStubD: `M ${Math.max(baseX, apexX)} ${cy} L ${x + w} ${cy}`,
  };
}

/** Renders the actual symbol for one SYMBOL_NODE_TYPES node — a plain
 * function (not a component) so it can be called directly inside the
 * scene.nodes.map JSX without an extra component-boundary/key wrapper. */
function renderNodeSymbol(node: SceneNode, color: string, doc: HarnessDocument) {
  const { x, y, width: w, height: h } = node;
  const strokeProps = { stroke: color, strokeWidth: 1.6, style: { pointerEvents: 'none' as const } };
  switch (node.type) {
    case 'splice': {
      const sym = spliceSymbol(x, y, w, h);
      return (
        <g>
          <path d={sym.lineD} fill="none" {...strokeProps} />
          <circle cx={sym.dotCx} cy={sym.dotCy} r={sym.dotR} fill={color} style={{ pointerEvents: 'none' }} />
        </g>
      );
    }
    case 'terminal': {
      const component = doc.components[node.componentId];
      const flipped = component?.type === 'terminal' && component.flipped === true;
      const sym = terminalSymbol(x, y, w, h, flipped);
      return (
        <g>
          <path d={sym.leadD} fill="none" {...strokeProps} />
          <circle cx={sym.ringCx} cy={sym.ringCy} r={sym.ringR} fill="none" {...strokeProps} />
        </g>
      );
    }
    case 'resistor': {
      const sym = resistorSymbol(x, y, w, h);
      return (
        <g>
          <path d={sym.leftStubD} fill="none" {...strokeProps} />
          <polyline points={sym.zigzagPoints} fill="none" strokeLinejoin="round" {...strokeProps} />
          <path d={sym.rightStubD} fill="none" {...strokeProps} />
        </g>
      );
    }
    case 'diode': {
      const component = doc.components[node.componentId];
      const reverse = component?.type === 'diode' && component.polarity === 'reverse';
      const sym = diodeSymbol(x, y, w, h, reverse);
      return (
        <g>
          <path d={sym.leftStubD} fill="none" {...strokeProps} />
          <polygon points={sym.trianglePoints} fill="none" strokeLinejoin="round" {...strokeProps} />
          <path d={sym.barD} fill="none" {...strokeProps} />
          <path d={sym.rightStubD} fill="none" {...strokeProps} />
        </g>
      );
    }
    default:
      return null;
  }
}

/** One shield termination mark — a dashed ellipse encircling the group's
 * member wires near one end of the run, plus the point its label sits at,
 * and which physical end (`from`/`to`) it represents (so the render pass
 * can look up that end's termination style/note — a shield's two ends can
 * terminate differently, e.g. a pigtail at one connector and a drain wire
 * at the other, but `WireGroup.shield.termination` is a single field today;
 * see the render pass for how that's handled). See `shieldTerminations`
 * below for how the two (one per end) are built. */
interface ShieldTerminationMark {
  center: Point;
  rx: number;
  ry: number;
  labelPoint: Point;
  /** Which way the mark is inset from its connector face (+1/-1 along x) —
   * used to orient the small termination-style glyph (pigtail/lug/drain)
   * so it points outward from the ellipse, away from the open wire span. */
  dir: 1 | -1;
}

/** Shield termination marks (Connor: "shields should appear ... at each
 * end" / "should show how shield terminations [are done]") — a dashed
 * ellipse encircling the shielded group's member wires near EACH end of the
 * run, not a shaded tube running the full length. Built straight from each
 * member wire's own `from`/`to` endpoint (already resolved by the routing
 * engine, per-row), rather than the routed path, since what needs encircling
 * is "the wires at this end", not a point along a bend. The ellipse sits
 * offset inward from the connector face by `INSET` so it doesn't overlap the
 * node itself — matching the reference image, where the dashed oval sits a
 * short distance out from the pins, not right on them. (The render pass
 * that uses this still draws AFTER every node box, specifically so a mark
 * that ends up geometrically close to a connector — e.g. a short wire run —
 * is never hidden behind it.) */
function shieldTerminations(members: SceneWire[]): ShieldTerminationMark[] {
  if (members.length === 0) return [];
  const INSET = SHIELD_INSET;
  const build = (pick: (w: SceneWire) => Point, otherPick: (w: SceneWire) => Point): ShieldTerminationMark => {
    const pts = members.map(pick);
    const others = members.map(otherPick);
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const avgX = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const avgOtherX = others.reduce((s, p) => s + p.x, 0) / others.length;
    const avgY = (minY + maxY) / 2;
    const dir: 1 | -1 = avgOtherX >= avgX ? 1 : -1; // inset toward the other end
    return {
      center: { x: avgX + dir * INSET, y: avgY },
      rx: 15,
      ry: Math.max(16, (maxY - minY) / 2 + 9),
      labelPoint: { x: avgX + dir * INSET, y: minY - 12 },
      dir,
    };
  };
  return [build((w) => w.from, (w) => w.to), build((w) => w.to, (w) => w.from)];
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

/** Component id an Endpoint resolves to, or undefined for a `free` endpoint
 * (a floating point with no component at all) — used by `autoRouteInLayout`
 * below to find the two components a freshly-drawn wire actually connects. */
function endpointComponentId(ep: Endpoint): string | undefined {
  return ep.kind === 'free' ? undefined : ep.componentId;
}

/** Same grid formula as `nextLayoutGrid` (layoutGrid.ts), but reading the
 * in-flight `draft` instead of `store.doc` — needed here because a single
 * wire can require placing BOTH of its components in the same transact
 * (`nextLayoutGrid(store)` would read the same stale `store.doc` twice and
 * hand back the same slot for both). */
function nextLayoutGridFromDraft(draft: HarnessDocument): Point {
  const placed = Object.values(draft.components).filter((c) => !!c.layoutPosition).length;
  return { x: 20 + (placed % 5) * 60, y: 20 + Math.floor(placed / 5) * 50 };
}

/** Connor: "all routing in schematic should appear automatically in the
 * layout as well" — the same "automatic" philosophy as auto-placement
 * (nextLayoutGrid) and auto-orientation (LayoutCanvas's nodeAngles),
 * extended from "the component exists in Layout" to "the physical route
 * between two connected components exists in Layout too." Called right
 * after a wire is drawn between two components in Schematic: makes sure
 * both ends are placed (defensive — they're normally already placed by the
 * "Add X" actions' own auto-placement, but an imported or programmatically
 * created component might not be), then makes sure a Bundle directly
 * connects them, unless one already does (in either direction). Doesn't
 * touch branch points — those are pure layout topology the user places and
 * wires up deliberately (spec §4.2), not something to auto-route through. */
function autoRouteInLayout(draft: HarnessDocument, componentIdA: string, componentIdB: string): void {
  if (componentIdA === componentIdB) return;
  const a = draft.components[componentIdA];
  const b = draft.components[componentIdB];
  if (!a || !b || a.type === 'branchPoint' || b.type === 'branchPoint') return;
  if (!a.layoutPosition) a.layoutPosition = nextLayoutGridFromDraft(draft);
  if (!b.layoutPosition) b.layoutPosition = nextLayoutGridFromDraft(draft);
  const alreadyRouted = Object.values(draft.bundles).some(
    (bd) => (bd.sourceId === componentIdA && bd.targetId === componentIdB) || (bd.sourceId === componentIdB && bd.targetId === componentIdA),
  );
  if (!alreadyRouted) {
    const id = newInstanceId();
    const n = Object.keys(draft.bundles).length;
    draft.bundles[id] = { id, refdes: `BND${n + 1}`, sourceId: componentIdA, targetId: componentIdB, custom: {} };
  }
}

function nextRefdes(store: HarnessStore, prefix: string, type: Component['type']): string {
  const count = Object.values(store.doc.components).filter((c) => c.type === type).length;
  return `${prefix}${count + 1}`;
}

/** Rough grid placement shared by every "Add X" action, so mixed component
 * types don't stack on top of each other. */
function nextGridPosition(store: HarnessStore): Point {
  const placed =
    Object.values(store.doc.components).filter((c) => !!c.schematicPosition).length +
    Object.keys(store.doc.notes).length;
  return { x: 60 + (placed % 4) * 230, y: 70 + Math.floor(placed / 4) * 180 };
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const { onBackgroundMouseDown } = useCanvasPan(scrollRef);

  const scene = computeSchematicScene(store.doc);
  const selectedComponent = selected?.kind === 'component' ? store.doc.components[selected.id] : undefined;
  const selectedNote = selected?.kind === 'note' ? store.doc.notes[selected.id] : undefined;
  const selectedWire = selected?.kind === 'wire' ? scene.wires.find((w) => w.wireId === selected.id) : undefined;
  const selectedGroup = selected?.kind === 'group' ? store.doc.wireGroups[selected.id] : undefined;
  const selectedNode = selectedComponent ? scene.nodes.find((n) => n.componentId === selectedComponent.id) : undefined;
  const selectedSceneNote = selectedNote ? scene.notes.find((n) => n.noteId === selectedNote.id) : undefined;

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
      if (w.source.kind !== 'free') ids.add(w.source.componentId);
      if (w.target.kind !== 'free') ids.add(w.target.componentId);
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

  const onRowClick = useCallback(
    (node: SceneNode, row: SceneRow) => {
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
    [pendingWire, store],
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
    },
    [selected],
  );

  const onWireClick = useCallback(
    (wireId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setContextMenu(null);
      if (e.shiftKey) {
        setMultiSelect((prev) => {
          const next = new Set(prev);
          seedMultiSelectFromSingle(next);
          const key = wireKey(wireId);
          if (next.has(key)) next.delete(key); else next.add(key);
          return next;
        });
        return;
      }
      setMultiSelect(new Set());
      setSelected({ kind: 'wire', id: wireId });
      setInspectorTab('edit');
      setInspectorOpen(false);
    },
    [seedMultiSelectFromSingle],
  );

  const onGroupHaloClick = useCallback(
    (groupId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setContextMenu(null);
      if (e.shiftKey) {
        setMultiSelect((prev) => {
          const next = new Set(prev);
          seedMultiSelectFromSingle(next);
          const key = groupKey(groupId);
          if (next.has(key)) next.delete(key); else next.add(key);
          return next;
        });
        return;
      }
      setMultiSelect(new Set());
      setSelected({ kind: 'group', id: groupId });
      setInspectorTab('edit');
      setInspectorOpen(false);
    },
    [seedMultiSelectFromSingle],
  );

  const groupSelection = useCallback(() => {
    if (multiSelect.size < 1) return;
    const wireIds: string[] = [];
    const groupIds: string[] = [];
    for (const key of multiSelect) {
      const parsed = parseKey(key);
      if (!parsed) continue;
      if (parsed.kind === 'wire') wireIds.push(parsed.id);
      else groupIds.push(parsed.id);
    }
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
      select({ kind: 'component', id: node.componentId });
      setDragging({
        kind: 'component', id: node.componentId,
        pointerStartX: e.clientX, pointerStartY: e.clientY,
        boxStartX: node.x, boxStartY: node.y,
      });
    },
    [select],
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

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - dragging.pointerStartX;
      const dy = e.clientY - dragging.pointerStartY;
      const x = dragging.boxStartX + dx;
      const y = dragging.boxStartY + dy;
      if (dragging.kind === 'component') {
        store.transact('Move component', (draft) => {
          const c = draft.components[dragging.id];
          if (c) c.schematicPosition = { x, y };
        });
      } else if (dragging.kind === 'note') {
        store.transact('Move note', (draft) => {
          const n = draft.notes[dragging.id];
          if (n) n.schematicPosition = { x, y };
        });
      } else {
        store.transact('Bend wire', (draft) => {
          const w = draft.wires[dragging.id];
          if (w) w.schematicWaypoint = { x, y };
        });
      }
    },
    [dragging, store],
  );

  const onMouseUp = useCallback(() => setDragging(null), []);

  // Manual wire routing (spec follow-up: "can't drag wires around manually
  // to place them as I wish"). Grabbing the wire's own trace starts (or
  // continues dragging) a single manual bend point — see
  // Wire.schematicWaypoint and schematicScene.ts for how it overrides the
  // 45°-diagonal auto-router once set. Starting position is approximated as
  // the wire's current midpoint since there's no click->schematic-space
  // coordinate conversion here (same 1:1-pixel-delta convention every other
  // drag in this file already relies on) — it snaps to the cursor within
  // the same gesture on the first mousemove, so this reads as "grab and
  // bend" in practice.
  const onWireMouseDown = useCallback(
    (wire: SceneWire, e: React.MouseEvent) => {
      // Shift is reserved for multi-select (onWireClick's shift branch) —
      // bail out so this doesn't fight over `selected`/`multiSelect` state.
      if (e.button !== 0 || e.shiftKey) return;
      e.stopPropagation();
      setContextMenu(null);
      setMultiSelect(new Set());
      setSelected({ kind: 'wire', id: wire.wireId });
      setInspectorTab('edit');
      setInspectorOpen(false);
      const start = wire.manualWaypoint ?? wire.midpoint;
      setDragging({ kind: 'wire', id: wire.wireId, pointerStartX: e.clientX, pointerStartY: e.clientY, boxStartX: start.x, boxStartY: start.y });
    },
    [],
  );

  const resetWireRouting = useCallback(
    (wireId: string) => {
      store.transact('Reset wire routing', (draft) => {
        const w = draft.wires[wireId];
        if (w) w.schematicWaypoint = undefined;
      });
    },
    [store],
  );

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
    } else {
      store.transact('Delete component', (draft) => {
        delete draft.components[selected.id];
        for (const [wireId, wire] of Object.entries(draft.wires)) {
          const touches = (ep: Endpoint) => 'componentId' in ep && ep.componentId === selected.id;
          if (touches(wire.source) || touches(wire.target)) delete draft.wires[wireId];
        }
      });
    }
    setSelected(null);
  }, [selected, store]);

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
      } else {
        const g = store.doc.wireGroups[parsed.id];
        const members = g ? wiresByGroup.get(g.id) : undefined;
        const rep = members?.[0];
        if (rep) { sx += rep.midpoint.x; sy += rep.midpoint.y; n++; }
      }
    }
    if (n > 0) groupBtnPos = { x: sx / n, y: sy / n - 40 };
  }

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
        {pendingWire && (
          <span style={s.wireHint}>Click a port to finish the wire, or click it again to cancel.</span>
        )}
        {multiSelect.size >= 1 && (
          <span style={s.wireHint}>
            {multiSelect.size} selected — click "Group" on the canvas
            {multiSelect.size === 1 ? ' to wrap it (e.g. for a shield)' : ''}, or shift-click to adjust.
          </span>
        )}
      </div>
      <div
        ref={scrollRef} style={s.canvasScroll}
        onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
        onMouseDown={onBackgroundMouseDown}
      >
        <div style={{ position: 'relative', width: maxX, height: maxY }}>
          <svg
            width={maxX} height={maxY} style={s.canvasSvg}
            onClick={(e) => {
              // Only deselect on clicks that land on the svg background itself.
              // Clicking a node fires onMouseDown (which selects) and then a
              // synthesized click that bubbles up here — stopPropagation() on
              // the mousedown handler does NOT stop that click, so without
              // this target check every node click immediately deselects
              // itself right after selecting.
              if (e.target === e.currentTarget) {
                setSelected(null);
                setMultiSelect(new Set());
              }
            }}
          >
            <defs>
              <pattern id="dot-grid" width={16} height={16} patternUnits="userSpaceOnUse">
                <circle cx={1} cy={1} r={1} fill={theme.color.gridDot} />
              </pattern>
            </defs>
            <rect x={0} y={0} width={maxX} height={maxY} fill="url(#dot-grid)" />

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
              const isTwist = group?.kind === 'twist';
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
                      {group?.kind === 'cable' ? `Cable ${group.refdes ?? ''}` : 'Twisted pair'} ({members.length} wire{members.length === 1 ? '' : 's'})
                      {isShielded ? ` — ${shieldLabel}` : ''}
                    </title>
                  </path>
                  {/* Twisted-pair visual (Connor: "show twisted pairs as
                     twisted wires... crossing over back and forth once
                     right at the connector exit... as short as possible so
                     it fits between the shield and the connector") — a
                     short "X" crossover glyph at EACH end where the members
                     leave a connector, not a continuous twist down the
                     whole run (see twistCrossoverPaths). */}
                  {isTwist && [...twistCrossoverPaths(members, 'from'), ...twistCrossoverPaths(members, 'to')].map((d, i) => (
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
                  {/* Fat invisible hit-target, easier to click (or grab-and-drag
                     to bend, see onWireMouseDown) than the thin trace. Also the
                     source of cross-pane wire hover — see onHoverWire prop. */}
                  <path d={w.path} fill="none" stroke="transparent" strokeWidth={12}
                    style={{ cursor: w.degraded ? 'pointer' : 'grab' }}
                    onMouseDown={(e) => !w.degraded && onWireMouseDown(w, e)}
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
                  {(isSelected || isMulti) && !w.manualWaypoint && (
                    <circle cx={w.midpoint.x} cy={w.midpoint.y} r={3.5} fill={theme.color.accent} style={{ pointerEvents: 'none' }} />
                  )}
                  {/* Manual-bend drag handle (spec follow-up: "drag wires
                     around manually") — only shown once a wire has been
                     bent, so untouched auto-routed wires stay uncluttered. */}
                  {w.manualWaypoint && (
                    <circle
                      cx={w.manualWaypoint.x} cy={w.manualWaypoint.y} r={5}
                      fill={theme.color.surface}
                      stroke={isSelected || isMulti ? theme.color.accent : theme.color.textFaint}
                      strokeWidth={2}
                      style={{ cursor: 'grab' }}
                      onMouseDown={(e) => onWireMouseDown(w, e)}
                      onClick={(e) => onWireClick(w.wireId, e)}
                      onContextMenu={(e) => onWireContextMenu(w.wireId, e)}
                    >
                      <title>Drag to move the bend, or right-click the wire → "Reset routing" to go back to auto-routing.</title>
                    </circle>
                  )}
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
              const isSelected = selected?.kind === 'component' && selected.id === node.componentId;
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
                    const isEditing = isConnector && editingCavity?.componentId === node.componentId && editingCavity.cavityId === row.rowId;
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
                            style={{ cursor: isConnector ? 'text' : 'default' }}
                            onClick={(e) => {
                              if (!isConnector) return;
                              e.stopPropagation();
                              setEditingCavity({ componentId: node.componentId, cavityId: row.rowId });
                            }}
                          >
                            {row.label}{row.signal ? `  ·  ${row.signal}` : isConnector ? '  ·  (click to name)' : ''}
                          </text>
                        )}
                        <circle
                          cx={row.point.x} cy={row.point.y} r={5}
                          fill={pendingWire?.componentId === node.componentId && pendingWire.rowId === row.rowId ? theme.color.accent : theme.color.nodeFill}
                          stroke={theme.color.accent} strokeWidth={1.5}
                          style={{ cursor: 'crosshair' }}
                          onClick={(e) => { e.stopPropagation(); onRowClick(node, row); }}
                        />
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* Shield termination marks (Connor: "shields should appear ...
               at each end" / "should show how shield terminations [are
               done]") — deliberately the LAST thing drawn in the SVG (after
               every node box), so a mark that ends up geometrically close
               to a connector — e.g. on a short wire run — is never hidden
               behind it (the earlier version lived inside the halo pass,
               which paints BEFORE nodes, so the far-end mark could vanish
               under the destination connector's box; see file header on
               `shieldTerminations`). Shows the termination style
               (pigtail/lug-to-360°/drain wire) as a small glyph plus label,
               and any free-text note (e.g. "terminates at J1 backshell")
               underneath — the schematic-visual and text-note forms Connor
               originally asked for alongside the data model itself. */}
            {[...wiresByGroup.entries()].map(([groupId, members]) => {
              const group = store.doc.wireGroups[groupId];
              if (!group?.shield) return null;
              const isSelected = selected?.kind === 'group' && selected.id === groupId;
              const isMulti = multiSelect.has(groupKey(groupId));
              const color = isSelected || isMulti ? theme.color.accent : theme.color.textMuted;
              const shieldPart = group.shield.partId ? (store.doc.parts[group.shield.partId] as ShieldPart | undefined) : undefined;
              const shieldLabel = shieldPart
                ? SHIELD_TYPES.find((t) => t.value === shieldPart.shieldType)?.label ?? 'Shielded'
                : 'Shielded';
              const term = group.shield.termination;
              const termStyleLabel = term?.style ? SHIELD_TERMINATION_STYLES.find((t) => t.value === term.style)?.label : undefined;
              const marks = shieldTerminations(members);
              return (
                <g key={`shieldterm:${groupId}`}>
                  {marks.map((mark, i) => (
                    <g key={i}>
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
                          {`${group.refdes ?? 'Shield'} — ${shieldLabel} termination`}
                          {termStyleLabel ? ` (${termStyleLabel})` : ''}
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
                    </g>
                  ))}
                  {term?.note && marks[0] && (
                    <text
                      x={marks[0].labelPoint.x} y={marks[0].center.y + marks[0].ry + 13} textAnchor="middle"
                      fontSize={9.5} fontStyle="italic" fill={theme.color.textFaint}
                      style={{ pointerEvents: 'none' }}
                    >
                      {term.note}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {groupBtnPos && (
            <button
              style={{ ...s.groupActionBtn, left: groupBtnPos.x - 34, top: groupBtnPos.y }}
              onClick={groupSelection}
            >
              Group {multiSelect.size}
            </button>
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
              onResetWireRouting={resetWireRouting}
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
  return <PartCommonFields part={part} onUpdate={updatePart} />;
}

function ComponentEditFields({ store, component }: { store: HarnessStore; component: Component }) {
  return (
    <>
      {component.type === 'connector' && (
        <div style={s.rowList}>
          {component.cavities.map((cavity, i) => (
            <div key={cavity.id} style={s.signalRow}>
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
          ))}
        </div>
      )}

      {component.type === 'cable' && (
        <>
          <div style={s.sectionLabel}>Cores</div>
          {component.cores.map((core, i) => (
            <div key={core.id} style={s.subRow}>
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
  store, wire, onDelete, onUngroupWire, onGroupAlone, onClose,
}: {
  store: HarnessStore;
  wire: SceneWire;
  onDelete: () => void;
  onUngroupWire?: () => void;
  onGroupAlone?: () => void;
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
        <div style={s.tabRow}>
          <button style={s.tabBtn(group.kind === 'twist')} onClick={() => setKind('twist')}>Twist</button>
          <button style={s.tabBtn(group.kind === 'cable')} onClick={() => setKind('cable')}>Cable</button>
        </div>

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

            <label style={s.fieldLabel}>Termination</label>
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

/** Generic right-click context menu, wired to component nodes, wires,
 * groups, and notes (spec request: "each component has a drop down menu
 * when it is right clicked so we can add new features as we go forward";
 * Connor's follow-up: "I don't like the drop down menus that appear upon a
 * click... almost no drop down menu needed unless the user right clicks").
 * Plain click now only selects/highlights (see `select()` in the parent) —
 * this menu, and its "Edit" item specifically, is the only way to open the
 * full property card. Item set stays small and real per target kind. */
function ContextMenu({
  state, store, onClose, onEdit, onDuplicate, onDelete, onUngroupWire, onUngroup, onResetWireRouting,
}: {
  state: ContextMenuState;
  store: HarnessStore;
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: (componentId: string) => void;
  onDelete: () => void;
  onUngroupWire: (groupId: string, wireId: string) => void;
  onUngroup: (groupId: string) => void;
  onResetWireRouting: (wireId: string) => void;
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
    items.push({ label: 'Delete', danger: true, onClick: () => { onDelete(); onClose(); } });
  } else if (state.target.kind === 'wire') {
    const wire = store.doc.wires[state.target.id];
    if (wire?.twistGroupId) {
      items.push({ label: 'Remove from group', onClick: () => { onUngroupWire(wire.twistGroupId!, state.target.id); onClose(); } });
    }
    if (wire?.schematicWaypoint) {
      items.push({ label: 'Reset routing', onClick: () => { onResetWireRouting(state.target.id); onClose(); } });
    }
    items.push({ label: 'Delete wire', danger: true, onClick: () => { onDelete(); onClose(); } });
  } else if (state.target.kind === 'group') {
    items.push({ label: 'Ungroup', onClick: () => { onUngroup(state.target.id); onClose(); } });
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
  wireHint: { color: theme.color.accent, fontSize: 12, marginLeft: 8, fontWeight: 500 },
  canvasScroll: { flex: 1, overflow: 'auto', cursor: 'grab' },
  canvasSvg: { display: 'block' },

  groupActionBtn: {
    position: 'absolute', zIndex: 4, padding: '6px 14px', borderRadius: 999,
    border: 'none', background: theme.color.accent, color: '#fff', fontSize: 12.5, fontWeight: 600,
    cursor: 'pointer', boxShadow: '0 4px 12px rgba(16,24,40,0.2)',
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
  signalRow: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px',
    borderRadius: 6,
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
