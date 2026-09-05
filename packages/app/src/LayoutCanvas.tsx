/**
 * Layout pane (spec follow-up request, "Page 2 (layout)"): the physical
 * arrangement of components, connected by Bundles (the physical routing
 * paths, spec §4.4) with optional authored lengths.
 *
 * The important design decision here — and the answer to "ensure it's very
 * easy to translate back and forth from schematic to layout" — is that
 * there is nothing to translate by hand. `computeRoutes` in
 * `@openharness/core/derive/routing.ts` already walks the bundle graph and
 * assigns every wire a shortest-path route automatically the moment both of
 * its endpoint components have a `layoutPosition` and there's a bundle path
 * between them; `computeLengths` turns that into a real length per wire,
 * `exact` if every bundle on the path has an authored length and
 * `lowerBound` (geometric estimate) otherwise. So this pane's whole job is
 * just: let the user place components physically and draw the bundles
 * between them — the wire-level routing and lengths fall out for free, and
 * this pane's Routing sidebar shows the payoff directly.
 *
 * Coordinates on this canvas are physical millimetres, not arbitrary pixel
 * space (the derive layer's geometric-distance fallback assumes
 * `layoutPosition.x/y` are already mm — see `geometricDistanceUm` in
 * routing.ts), so `PX_PER_MM` is the only place display scale lives.
 *
 * Branch points (spec §4.2: "layout-only... never has schematicPosition")
 * are the one component type that only exists here — they're pure layout
 * topology, so they're created from this pane's toolbar, not Schematic's.
 *
 * Routing UI (see connectGesture.ts for the gesture itself): the pane has an
 * explicit tool switcher — Select (V) and Route (C) — because placing and
 * routing are its two verbs and routing used to be reachable only through a
 * 4px handle dimmed to 40% until hover, which meant nothing on screen said
 * the pane could route at all. In Route the whole node body is a bundle
 * source; in Select the handle still is, and now accepts a drag as well as a
 * click. Either way the gesture is shared with Schematic's wire drawing, so
 * both panes take drag-to-connect AND click-then-click, draw a live preview
 * of the thing being created, highlight only the nodes that would actually
 * accept the drop, and cancel on Escape.
 *
 * The sidebar leads with route health rather than a flat length list: an
 * unroutable wire is the most consequential state this pane can be in and it
 * was previously visible only in the Diagnostics pane. Every number there
 * comes from `derived.wireLengths`, so it cannot drift from what the routing
 * engine concluded.
 *
 * Routing nodes (Connor's follow-up: "need to be able to add routing
 * nodes"): a bundle's path is drawn through `Bundle.waypoints` — grabbing
 * the bundle's line and dragging inserts a bend at that point; grabbing an
 * existing bend's handle moves it; right-clicking a handle removes it. This
 * is the field the file header used to flag as "left for a later pass" —
 * it's now the actual routing-node mechanism, distinct from branch points
 * (which are full topology vertices other bundles can also connect to) —
 * a plain waypoint just bends one bundle's own path.
 *
 * Every node you can hover — a placed component or a bundle's waypoint —
 * carries a native `<title>` tooltip listing which wires currently route
 * through it (Connor: "show which wires pass through it... on hover"),
 * computed from `derived.bundleContents` (which wires' routes touch each
 * bundle) rather than tracked separately, so it can never drift from the
 * routing engine's own answer.
 *
 * Connector glyphs + auto-orientation (Connor: "layout connectors should
 * appear as small generalized connector shapes, cable should exit from the
 * back of the connector symbol and these should automatically be oriented
 * in opposite facing directions"): a placed connector/splice/terminal/etc.
 * is drawn as a small plug glyph — a body with a tapered "nose" at the
 * mating face and a short stub at the back where the bundle cable leaves
 * (see `connectorGlyph`). `layoutPosition` is now interpreted as the node's
 * CENTER (it used to be a box's top-left corner). The glyph's base facing
 * angle is never stored — it's recomputed every render from the average
 * direction to whatever it's bundled to (`nodeAngles`), so two connectors
 * bundled only to each other automatically end up facing opposite ways
 * (each one's back/cable-stub points at the other, i.e. their angles are
 * literally 180° apart) with no manual "flip" step, and dragging a node
 * updates both ends' orientation live.
 *
 * On top of that auto-orientation sits the user-authored rotation (Phase 2b,
 * docs/PHASE2-REFINED-DESIGN.md §3): select a connector and press R to
 * rotate it 90° clockwise (Shift+R auto-optimizes — fewest bundle
 * crossings). The offset persists in the existing Component.rotation field
 * (unset reads as 0), turns the glyph — which moves every plugged-in
 * bundle's attach point, so the bundles re-route live — and is labelled on
 * the canvas. The geometry all this runs on (auto angles, attach points,
 * bundle polylines) lives in @openharness/render's layoutOrientation.ts so
 * the optimizer can score candidate rotations without a canvas.
 * Branch points keep their old plain
 * dot rendering (they're topology, not a physical part with a mating
 * face) and keep using `branchOutlinePoint` — the old `outlinePoint` — for
 * where a bundle line touches them.
 *
 * Scope note: this first pass covers placement + bundle authoring + bundle
 * waypoints, which is what makes automatic routing work end to end. A
 * formboard background image is a real spec feature left for a later pass.
 *
 * Visual cleanup (Connor: "the actual routing and connector visuals don't
 * look clean"): bundle lines used to run from raw node CENTER to raw node
 * CENTER, so most of every line was hidden behind the node's own fill and
 * what little showed crossed corners at odd angles for any pair of nodes
 * that weren't roughly on the same row. `outlinePoint()` now clips every
 * bundle line to the node's actual outline (rectangle, or a small circle
 * for branch points) so it visibly plugs into the part it's leaving or
 * entering. Branch points also render as plain junction dots rather than
 * full component boxes, since they're pure layout topology (spec §4.2),
 * not a physical part with an icon and label to show. The per-node
 * "start a bundle" handle is now dimmed until it's actually relevant
 * (hovered/selected, or a connect is already in progress) instead of
 * sitting at full opacity on every node all the time.
 *
 * Cross-pane wire/bundle hover (Connor: "if I highlight a bundle, I want
 * all wires that route through that point to be highlighted and all
 * relevant connectors highlighted"): hovering a bundle's line here reports
 * `hoveredBundleId` up to App.tsx, which Schematic resolves to a wire set
 * via `derived.bundleContents` and highlights (plus their connector
 * endpoints). The relationship runs the other way too — hovering a wire in
 * Schematic reports `hoveredWireId`, and this pane resolves it to the
 * bundle(s) that wire's route actually passes through via
 * `derived.wireRoutes` (not just the wire's two component endpoints, which
 * would miss any intermediate bundle hops) and highlights those bundle
 * lines. Same lifted-state pattern as `hoveredComponentId`/`onHoverComponent`
 * already used for whole-component hover.
 */

import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import type { HarnessStore, HarnessDocument, Component, Point, Endpoint, WireGroup, ShieldTermination, Bundle, Wire, LengthStatus } from '@openharness/core';
import {
  newInstanceId, computeDerivedModel, endpointComponentId, computeRouteAvoidingBundle,
  DEFAULT_BUNDLE_COLOR,
} from '@openharness/core';
import {
  pointRect, emitBundleGeometry, pointAtFraction,
  bundlePolyline, computeNodeAutoAngles, nodeFacingAngle,
  branchOutlinePoint, glyphBodyHalfLen, GLYPH_STUB_LEN, normalizeRotationDegrees,
  canvasToScreen, layoutComponentCardPosition,
  type SceneBundle,
} from '@openharness/render';
import { theme } from './theme.js';
import { ComponentIcon, connectorAppearance } from './icons.js';
import { nextLayoutGrid } from './layoutGrid.js';
import { useCanvasPan } from './canvasPan.js';
import { useCanvasZoom } from './useCanvasZoom.js';
import { layoutContentRects, layoutBundleRects } from './layoutBounds.js';
import { SHIELD_TERMINATION_STYLES } from './shieldConstants.js';
import { useBundleRouting } from './useBundleRouting.js';
import { useConnectorRotation } from './useConnectorRotation.js';
import { rotationActionForKey } from './connectorRotation.js';
import { useConnectGesture } from './useConnectGesture.js';

const PX_PER_MM = 4;
const BRANCH_R = 7;
/** Crossing detection (emitBundleGeometry) ignores intersections this close
 * to a path's attach points: several bundles leave one component from the
 * same stub point and fan out, so a "crossing" right at the node is attach
 * geometry, not a routing conflict. ≈ glyph stub length + branch radius. */
const ENDPOINT_EXCLUSION_PX = 14;

// Generic connector-plug glyph geometry (px, local space before rotation —
// see connectorGlyph). Small and generic on purpose (Connor: "small
// generalized connector shapes"), not per-type accurate artwork. Body
// half-lengths live in render's glyphBodyHalfLen table — ONE spelling shared
// with the bundle-attach math (layoutOrientation.ts), so what's drawn and
// what's computed can't drift apart.
const BODY_HALF_W = 8;
const NOSE_LEN = 6;
const NOSE_HALF_W = 5;
/** Hover/selection ring + hit-target radius — generous enough to cover the
 * glyph at any rotation without having to rotate the hit-target itself. */
const HOVER_R = 24;

type Selection = { kind: 'component'; id: string } | { kind: 'bundle'; id: string } | null;

/** See the `tool` state in LayoutCanvas for why this pane is modal at all. */
export type LayoutTool = 'select' | 'route';

interface Dragging {
  id: string;
  pointerStartX: number;
  pointerStartY: number;
  posStartX: number;
  posStartY: number;
}

/** Dragging a single point within a bundle's `waypoints` array — separate
 * from `Dragging` (which moves a whole component) since it targets an
 * index inside a bundle rather than a component id. */
interface DraggingWaypoint {
  bundleId: string;
  index: number;
  pointerStartX: number;
  pointerStartY: number;
  posStartX: number;
  posStartY: number;
}

function toPx(mm: Point): Point {
  return { x: mm.x * PX_PER_MM, y: mm.y * PX_PER_MM };
}
function toMm(px: Point): Point {
  return { x: px.x / PX_PER_MM, y: px.y / PX_PER_MM };
}

/** Shielded wire groups whose members touch this component — Connor: "add
 * details in the layout to specify shield termination details" (previously
 * a shield's termination was only editable from the Schematic pane's
 * GroupInspector; now the physical Layout pane surfaces the same field on
 * the connector where the shield actually terminates). A wire "touches" the
 * component if either endpoint resolves to this componentId — see core's
 * `endpointComponentId` for the kinds that have none. */
function shieldedGroupsAt(store: HarnessStore, componentId: string): WireGroup[] {
  const touchesComponent = (ep: Endpoint) => endpointComponentId(ep) === componentId;
  return Object.values(store.doc.wireGroups).filter((g) => {
    if (!g.shield) return false;
    return g.memberWireIds.some((wid) => {
      const w = store.doc.wires[wid];
      return !!w && (touchesComponent(w.source) || touchesComponent(w.target));
    });
  });
}

/** Same lazy-init-on-first-edit pattern as SchematicCanvas's own
 * `updateTermination` (GroupInspector) — kept as a standalone function here
 * (rather than a closure over one `group`) since a single connector can
 * touch several different shielded groups at once. */
function updateShieldTermination(store: HarnessStore, groupId: string, mutate: (t: ShieldTermination) => void) {
  store.transact('Edit shield termination', (draft) => {
    const g = draft.wireGroups[groupId];
    if (!g?.shield) return;
    if (!g.shield.termination) g.shield.termination = {};
    mutate(g.shield.termination);
  });
}

/** Squared distance from `p` to the segment `a`-`b`, all in the same space
 * (mm here) — used to find which segment of a bundle's path a click landed
 * nearest to, so a new routing node is inserted in the right place rather
 * than always at the end. */
function distToSegmentSq(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return (p.x - projX) ** 2 + (p.y - projY) ** 2;
}

/** A small decoration drawn on top of a glyph's body/nose — e.g. a splice's
 * junction dot, a diode's cathode band, a terminal's ring. Kept generic
 * (rather than one field per possible decoration) so the render loop can
 * draw any type's extras with one small map, and every builder below only
 * needs to describe *what* to draw, in already-rotated absolute coordinates
 * (each builder has its own `abs()` closure — see connectorGlyph). */
type GlyphDecoration =
  | { kind: 'circle'; cx: number; cy: number; r: number; filled: boolean }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number };

interface ConnectorGlyph {
  bodyPoly: string;
  nosePoly: string;
  /** Where the cable stub line starts (the body's back edge, center). */
  stubStart: Point;
  /** Tip of the cable stub — also where a bundle line attaches, and where
   * the "start a bundle" handle sits, since that's the point wires
   * physically leave this connector from. */
  stubEnd: Point;
  decorations: GlyphDecoration[];
}

/** Shared rotation helper — every glyph builder below wants the same
 * "local (x,y) in a frame facing `angle`, expressed in absolute px" math
 * that connectorGlyph originally had as a private closure. */
function glyphRotator(center: Point, angle: number): (lx: number, ly: number) => Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return (lx: number, ly: number): Point => ({ x: center.x + lx * cos - ly * sin, y: center.y + lx * sin + ly * cos });
}

/** Builds a small generalized connector-plug glyph centered at `center`,
 * rotated by `angle` (radians; 0 = facing right, i.e. cable exits to the
 * east). A tapered "nose" marks the mating face, a short stub marks where
 * the bundle cable leaves the back — see the file header note on
 * auto-orientation for how `angle` itself is derived. Manual trig (rather
 * than an SVG `transform="rotate(...)"`) so the label/icon/handles that key
 * off the same points stay simple to reason about. */
function connectorGlyph(center: Point, angle: number): ConnectorGlyph {
  const abs = glyphRotator(center, angle);
  const hl = glyphBodyHalfLen('connector');
  const hw = BODY_HALF_W;
  const bFT = abs(-hl, -hw);
  const bFB = abs(-hl, hw);
  const bBT = abs(hl, -hw);
  const bBB = abs(hl, hw);
  const nT1 = abs(-hl - NOSE_LEN, -NOSE_HALF_W);
  const nT2 = abs(-hl - NOSE_LEN, NOSE_HALF_W);
  const stubStart = abs(hl, 0);
  const stubEnd = abs(hl + GLYPH_STUB_LEN, 0);
  return {
    bodyPoly: [bFT, bBT, bBB, bFB].map((p) => `${p.x},${p.y}`).join(' '),
    nosePoly: [bFT, nT1, nT2, bFB].map((p) => `${p.x},${p.y}`).join(' '),
    stubStart,
    stubEnd,
    decorations: [],
  };
}

/** Cable glyph: a rounded capsule (approximated with a cut-corner octagon)
 * — reads as a short run of jacketed cable rather than a plug, and has no
 * "nose"/mating-face at all (nosePoly empty), since a cable doesn't mate
 * with anything. */
function cableGlyph(center: Point, angle: number): ConnectorGlyph {
  const abs = glyphRotator(center, angle);
  const hl = glyphBodyHalfLen('cable');
  const hw = 6.5;
  const c = 3.5;
  const pts = [
    abs(-hl + c, -hw), abs(hl - c, -hw), abs(hl, -hw + c), abs(hl, hw - c),
    abs(hl - c, hw), abs(-hl + c, hw), abs(-hl, hw - c), abs(-hl, -hw + c),
  ];
  const stubStart = abs(hl, 0);
  const stubEnd = abs(hl + GLYPH_STUB_LEN, 0);
  return { bodyPoly: pts.map((p) => `${p.x},${p.y}`).join(' '), nosePoly: '', stubStart, stubEnd, decorations: [] };
}

/** Splice glyph: a short thin barrel with a junction dot at the true center
 * — the layout-space equivalent of the schematic splice symbol
 * (spliceSymbol in SchematicCanvas.tsx). Like every other non-connector
 * type here, it still only carries one bundle attach point (the data
 * model's Bundle is a single source->target edge, same simplification the
 * original connector-only glyph already made). */
function spliceGlyph(center: Point, angle: number): ConnectorGlyph {
  const abs = glyphRotator(center, angle);
  const hl = glyphBodyHalfLen('splice');
  const hw = 3;
  const pts = [abs(-hl, -hw), abs(hl, -hw), abs(hl, hw), abs(-hl, hw)];
  const stubStart = abs(hl, 0);
  const stubEnd = abs(hl + GLYPH_STUB_LEN, 0);
  return {
    bodyPoly: pts.map((p) => `${p.x},${p.y}`).join(' '),
    nosePoly: '',
    stubStart,
    stubEnd,
    decorations: [{ kind: 'circle', cx: center.x, cy: center.y, r: 3, filled: true }],
  };
}

/** Terminal glyph: a lead into a ring lug — no filled body polygon at all,
 * just the lead line + ring decorations, matching the schematic terminal
 * symbol's own lead-into-ring shape. Respects Terminal.flipped the same way
 * Connector/Cable do (see file header + schematicScene.ts). */
function terminalGlyph(center: Point, angle: number, flipped: boolean): ConnectorGlyph {
  const facing = flipped ? angle + Math.PI : angle;
  const abs = glyphRotator(center, facing);
  const hl = glyphBodyHalfLen('terminal');
  const ringR = 5.5;
  const ringCenter = abs(-hl, 0);
  const leadStart = abs(-hl + ringR, 0);
  const leadEnd = abs(hl, 0);
  const stubStart = abs(hl, 0);
  const stubEnd = abs(hl + GLYPH_STUB_LEN, 0);
  return {
    bodyPoly: '',
    nosePoly: '',
    stubStart,
    stubEnd,
    decorations: [
      { kind: 'line', x1: leadStart.x, y1: leadStart.y, x2: leadEnd.x, y2: leadEnd.y },
      { kind: 'circle', cx: ringCenter.x, cy: ringCenter.y, r: ringR, filled: false },
    ],
  };
}

/** Resistor glyph: a plain thin rectangular body (an axial resistor's
 * cylinder, seen from the side) with two short cross-bands purely for
 * visual texture — distinguishes it from the diode's single band and from
 * generic's plain square at a glance. */
function resistorGlyph(center: Point, angle: number): ConnectorGlyph {
  const abs = glyphRotator(center, angle);
  const hl = glyphBodyHalfLen('resistor');
  const hw = 4;
  const pts = [abs(-hl, -hw), abs(hl, -hw), abs(hl, hw), abs(-hl, hw)];
  const band = (bx: number): GlyphDecoration => {
    const a = abs(bx, -hw);
    const b = abs(bx, hw);
    return { kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  };
  const stubStart = abs(hl, 0);
  const stubEnd = abs(hl + GLYPH_STUB_LEN, 0);
  return {
    bodyPoly: pts.map((p) => `${p.x},${p.y}`).join(' '),
    nosePoly: '',
    stubStart,
    stubEnd,
    decorations: [band(-3), band(3)],
  };
}

/** Diode glyph: same cylinder as resistorGlyph, but a single cathode band
 * near one end — its side (front vs. back of the body) mirrors
 * TwoTerminal.polarity, so a diode's data already-existing `polarity` field
 * (previously only visible in the Edit tab's dropdown) now shows up
 * physically here too, same tie-in as the schematic diodeSymbol. */
function diodeGlyph(center: Point, angle: number, reverse: boolean): ConnectorGlyph {
  const abs = glyphRotator(center, angle);
  const hl = glyphBodyHalfLen('diode');
  const hw = 4;
  const pts = [abs(-hl, -hw), abs(hl, -hw), abs(hl, hw), abs(-hl, hw)];
  const bandX = reverse ? hl - 2.5 : -hl + 2.5;
  const a = abs(bandX, -hw);
  const b = abs(bandX, hw);
  const stubStart = abs(hl, 0);
  const stubEnd = abs(hl + GLYPH_STUB_LEN, 0);
  return {
    bodyPoly: pts.map((p) => `${p.x},${p.y}`).join(' '),
    nosePoly: '',
    stubStart,
    stubEnd,
    decorations: [{ kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y }],
  };
}

/** Generic glyph: a plain small square — the same honest "no more specific
 * shape known" fallback as the generic ComponentIcon, just at node scale. */
function genericGlyph(center: Point, angle: number): ConnectorGlyph {
  const abs = glyphRotator(center, angle);
  const half = glyphBodyHalfLen('generic');
  const pts = [abs(-half, -half), abs(half, -half), abs(half, half), abs(-half, half)];
  const stubStart = abs(half, 0);
  const stubEnd = abs(half + GLYPH_STUB_LEN, 0);
  return { bodyPoly: pts.map((p) => `${p.x},${p.y}`).join(' '), nosePoly: '', stubStart, stubEnd, decorations: [] };
}

/** Dispatches to the right glyph builder per component type (Connor: "then
 * they should appear automatically as their realistic approximate shape in
 * the layout" — the follow-up to Round 1's connector-only glyph work,
 * extended to every other physical component type). Branch points never
 * reach here — they're rendered as plain dots in the map below, same as
 * before. */
function physicalGlyph(component: Component, center: Point, angle: number): ConnectorGlyph {
  switch (component.type) {
    case 'connector': return connectorGlyph(center, angle);
    case 'cable': return cableGlyph(center, angle);
    case 'splice': return spliceGlyph(center, angle);
    case 'terminal': return terminalGlyph(center, angle, component.flipped === true);
    case 'resistor': return resistorGlyph(center, angle);
    case 'diode': return diodeGlyph(center, angle, component.polarity === 'reverse');
    case 'generic':
    case 'branchPoint':
    default:
      return genericGlyph(center, angle);
  }
}

function wireTooltip(wireIds: string[], doc: HarnessStore['doc']): string {
  if (wireIds.length === 0) return 'No wires route through this node yet.';
  const names = [...new Set(wireIds)].map((id) => doc.wires[id]?.refdes ?? id).sort();
  return `Wires through this node (${names.length}): ${names.join(', ')}`;
}

/** The signal name carried by one end of a wire, if that end lands on a
 * cavity or cable core with one set — the only two Endpoint kinds that
 * actually have a `.signal` field (see Endpoint/Cavity/CableCore in
 * core/types.ts). Everything else (splice/terminal/twoTerminalSide/free)
 * has no signal concept of its own. */
function endpointSignal(ep: Endpoint, doc: HarnessStore['doc']): string | undefined {
  if (ep.kind === 'cavity') {
    const c = doc.components[ep.componentId];
    return c?.type === 'connector' ? c.cavities.find((cv) => cv.id === ep.cavityId)?.signal : undefined;
  }
  if (ep.kind === 'cableCore') {
    const c = doc.components[ep.componentId];
    return c?.type === 'cable' ? c.cores.find((cr) => cr.id === ep.coreId)?.signal : undefined;
  }
  return undefined;
}

/** Connor: "when I hover over wires in the layout, have it list out all the
 * signal names in that bundle" — same shape as wireTooltip above, but
 * resolving each wire to the signal name at whichever end has one (source
 * checked first, falling back to target) instead of just the wire's own
 * refdes. A wire with no signal on either end still shows up, tagged
 * "(unnamed)", so the count in the bundle stays accurate even before every
 * cavity has been named. */
function bundleSignalTooltip(wireIds: string[], doc: HarnessStore['doc']): string {
  if (wireIds.length === 0) return 'No wires route through this bundle yet.';
  const names = [...new Set(wireIds)]
    .map((id) => {
      const w = doc.wires[id];
      if (!w) return id;
      const signal = endpointSignal(w.source, doc) ?? endpointSignal(w.target, doc);
      return signal ?? `${w.refdes} (unnamed)`;
    })
    .sort();
  return `Signals (${names.length}): ${names.join(', ')}`;
}

/** Smooth cable-like path through every point (Connor: "make the layout
 * routing more flowy") — a Catmull-Rom spline converted to cubic Bezier
 * segments (the standard, well-known conversion; tension = 0, factor 1/6),
 * so the curve passes through every waypoint exactly rather than just
 * approaching it, unlike a cheaper "quadratic-through-midpoints" smoothing
 * would. Draggable routing-node handles still sit at the true waypoint
 * positions and the curve now actually threads through them. Falls back to
 * a plain straight segment for 2 points (nothing to smooth). */
function smoothBundlePath(points: Point[]): string {
  if (points.length < 2) return '';
  if (points.length === 2) return `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`;
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`;
  }
  return d;
}

/**
 * Inline pass-through components (Connor: "make layout resistor appear in
 * line... allow user to combine a signal that passes through a discrete
 * component to be added into a bundle, when this happens only one bundle
 * should appear, and the location of the discrete component can be dragged
 * along the line"). A resistor/diode (the only true 2-terminal pass-through
 * component types — a splice is n-ary, a terminal is single-ended, neither
 * "passes through" between exactly two others) that touches EXACTLY two
 * bundles is, automatically and with no extra step, rendered riding along
 * one continuous merged line between its two real neighbours instead of as
 * a separate node with its own two stub-ended bundle lines meeting at it —
 * the same "automatic, not manual" placement philosophy as auto-bundle
 * creation (layoutGrid.ts's `autoRouteInLayout`) and auto-orientation
 * (`nodeAngles` below). Its `layoutPosition` becomes irrelevant for
 * rendering while eligible (still there, just ignored) — position along the
 * merged line is instead `component.custom.inlineT`, a 0..1 fraction of the
 * line's arc length, draggable via the glyph itself. Anything with 0, 1, or
 * 3+ bundles falls back to the ordinary node+glyph rendering untouched.
 */
interface InlinePassThrough {
  component: Component;
  bundleA: Bundle;
  bundleB: Bundle;
  /** The component at the far end of bundleA (the non-R end). */
  otherA: string;
  /** The component at the far end of bundleB (the non-R end). */
  otherB: string;
}

function findInlinePassThroughs(doc: HarnessStore['doc']): Map<string, InlinePassThrough> {
  const result = new Map<string, InlinePassThrough>();
  for (const c of Object.values(doc.components)) {
    if (c.type !== 'resistor' && c.type !== 'diode') continue;
    const touching = Object.values(doc.bundles).filter((b) => b.sourceId === c.id || b.targetId === c.id);
    if (touching.length !== 2) continue;
    const [bundleA, bundleB] = touching as [Bundle, Bundle];
    const otherA = bundleA.sourceId === c.id ? bundleA.targetId : bundleA.sourceId;
    const otherB = bundleB.sourceId === c.id ? bundleB.targetId : bundleB.sourceId;
    if (otherA === otherB) continue; // degenerate (both bundles loop back to the same neighbor) — keep the ordinary rendering
    if (!doc.components[otherA]?.layoutPosition || !doc.components[otherB]?.layoutPosition) continue;
    result.set(c.id, { component: c, bundleA, bundleB, otherA, otherB });
  }
  return result;
}

/** The merged line an inline pass-through component rides along — bundleA's
 * path (reoriented so it always runs `otherA -> R`) followed directly by
 * bundleB's path (reoriented `R -> otherB`), with R itself never appearing
 * as a point: its own two stub attach points are dropped entirely, so
 * bundleA's last interior waypoint connects straight through to bundleB's
 * first one exactly as if they were always one bundle. All in px space
 * (same convention as everything else in this file — see `toPx`). */
function skeletonPointsFor(pair: InlinePassThrough, doc: HarnessStore['doc'], nodeGlyphs: Map<string, ConnectorGlyph>): Point[] {
  const xComp = doc.components[pair.otherA];
  const yComp = doc.components[pair.otherB];
  if (!xComp?.layoutPosition || !yComp?.layoutPosition) return [];
  const xCenter = toPx(xComp.layoutPosition);
  const yCenter = toPx(yComp.layoutPosition);
  const wARaw = (pair.bundleA.waypoints ?? []).map(toPx);
  const wA = pair.bundleA.sourceId === pair.component.id ? [...wARaw].reverse() : wARaw; // now otherA -> R order
  const wBRaw = (pair.bundleB.waypoints ?? []).map(toPx);
  const wB = pair.bundleB.sourceId === pair.component.id ? wBRaw : [...wBRaw].reverse(); // now R -> otherB order
  const xAimAt = wA[0] ?? wB[0] ?? yCenter;
  const yAimAt = wB[wB.length - 1] ?? wA[wA.length - 1] ?? xCenter;
  const xAttach = xComp.type === 'branchPoint' ? branchOutlinePoint(xCenter, xAimAt, BRANCH_R) : (nodeGlyphs.get(xComp.id)?.stubEnd ?? xCenter);
  const yAttach = yComp.type === 'branchPoint' ? branchOutlinePoint(yCenter, yAimAt, BRANCH_R) : (nodeGlyphs.get(yComp.id)?.stubEnd ?? yCenter);
  return [xAttach, ...wA, ...wB, yAttach];
}

/** Stored 0..1 fraction of the skeleton's arc length an inline pass-through
 * component currently sits at — reuses the component's existing free-form
 * `custom` bag (spec §4.2's per-component escape hatch) rather than adding
 * a dedicated schema field, since this value is meaningless outside the
 * "currently eligible for inline rendering" state and has no business being
 * a first-class part of the document model. Defaults to the midpoint. */
function getInlineT(c: Component): number {
  const v = c.custom['inlineT'];
  return typeof v === 'number' && v >= 0 && v <= 1 ? v : 0.5;
}

/** Arc-length fraction (0..1) of the point on `points` closest to `p` — the
 * inverse of `pointAtFraction` (now in @openharness/render), used while
 * dragging an inline component to turn a raw cursor position back into a
 * stored `inlineT`. */
function fractionAtClosestPoint(points: Point[], p: Point): number {
  if (points.length < 2) return 0.5;
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const d = Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
    segLens.push(d);
    total += d;
  }
  let bestDistSq = Infinity;
  let bestT = 0.5;
  let cumulative = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const segT = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const projX = a.x + segT * dx;
    const projY = a.y + segT * dy;
    const distSq = (p.x - projX) ** 2 + (p.y - projY) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestT = total > 0 ? (cumulative + segT * segLens[i]!) / total : 0;
    }
    cumulative += segLens[i]!;
  }
  return bestT;
}

interface Props {
  store: HarnessStore;
  hoveredComponentId?: string | null;
  onHoverComponent?: (id: string | null) => void;
  /** Wire/bundle cross-pane hover — see the Props doc in SchematicCanvas.tsx.
   * Layout is the pane that draws bundles, so it *originates*
   * `hoveredBundleId` (via `onHoverBundle`); `hoveredWireId` only ever
   * arrives from Schematic, and this pane resolves it to the bundle(s) that
   * wire's route passes through via `derived.wireRoutes` — no `onHoverWire`
   * here since there's no individual wire geometry to hover in this pane. */
  hoveredWireId?: string | null;
  hoveredBundleId?: string | null;
  onHoverBundle?: (id: string | null) => void;
}

export function LayoutCanvas({
  store, hoveredComponentId, onHoverComponent, hoveredWireId, hoveredBundleId, onHoverBundle,
}: Props) {
  const [selected, setSelected] = useState<Selection>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [draggingWaypoint, setDraggingWaypoint] = useState<DraggingWaypoint | null>(null);
  const [draggingInline, setDraggingInline] = useState<{ componentId: string } | null>(null);
  /**
   * Which verb the pane is in. This canvas has exactly two primary verbs —
   * place a component, and route a bundle between two of them — and until now
   * both lived in one modeless soup where routing was reachable only through
   * a 4px handle held at 40% opacity until hover. That is a discoverability
   * problem, not a preference: nothing on screen said the pane could route.
   *
   * `select` keeps every existing gesture exactly as it was (including the
   * stub handle, which now drags as well as clicks), so nothing is taken away
   * from someone who already knows the pane; `route` makes the whole node
   * body a bundle source, which is what makes routing a large layout fast.
   */
  const [tool, setTool] = useState<LayoutTool>('select');
  const svgRef = useRef<SVGSVGElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Zoom is per-pane and view-only (T04 contract): the state lives in the
  // shared hook, never in the document. useCanvasPan owns the single wheel
  // listener and classifies each event (B3); zoom events land in the hook's
  // onWheelZoom, pan events scroll the container there.
  const { panX, panY, scale, setContentSize, onWheelZoom, fitTo } = useCanvasZoom(scrollRef);
  const { onBackgroundMouseDown } = useCanvasPan(scrollRef, onWheelZoom);
  // Phase 2a bundle gestures: drag a bundle's line to move all of its routing
  // nodes at once; drag a wire's extraction handle to pull it out of the
  // bundle. All gesture math/document writes live in useBundleRouting — the
  // canvas only feeds pointer events and renders the resulting state.
  const bundleRouting = useBundleRouting(store, scale, PX_PER_MM);

  /** Brief confirmation ring after an auto-optimize (Phase 2b visual
   * feedback) — the id of the connector to highlight, cleared by a timer. */
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), 700);
    return () => clearTimeout(t);
  }, [flashId]);
  /** Click info stashed between mousedown and mouseup on a bundle's line:
   * the click-vs-drag decision happens at release (drag threshold — C9), and
   * a plain click still inserts a routing node exactly as before this
   * gesture existed. */
  const pendingBundleClick = useRef<{ bundleId: string; clickMm: Point; insertAt: number } | null>(null);
  /** Transient notice (e.g. a blocked wire extraction) shown in the toolbar
   * until the next interaction. */
  const [notice, setNotice] = useState<string | null>(null);

  const doc = store.doc;

  /**
   * Bundle creation. Shares one state machine with Schematic's wire drawing
   * (connectGesture.ts), so both panes accept drag-to-connect AND
   * click-then-click, draw a live preview, and cancel on Escape.
   *
   * `canConnect` rejects the two edges the document cannot hold: a bundle
   * from a node to itself, and a second bundle between a pair that already
   * has one (the routing graph is simple — a duplicate edge would add a
   * parallel path Dijkstra would have to tie-break for no modelling gain).
   * The same predicate drives target highlighting, so a node that will not
   * accept the drop never lights up as though it would.
   */
  /** Scroll anchor for the toolbar's route chip → sidebar's unrouted group. */
  const unroutedRef = useRef<HTMLDivElement>(null);


  const bundleExists = useCallback(
    (a: string, b: string) =>
      Object.values(doc.bundles).some(
        (bn) =>
          (bn.sourceId === a && bn.targetId === b) || (bn.sourceId === b && bn.targetId === a),
      ),
    // doc.bundles is replaced wholesale by the store on every transaction.
    [doc.bundles],
  );

  const connect = useConnectGesture<string>({
    samePort: (a, b) => a === b,
    canConnect: (from, to) => from !== to && !bundleExists(from, to),
    onConnect: (fromId, toId) => {
      store.transact('Add bundle', (draft) => {
        const id = newInstanceId();
        const n = Object.keys(draft.bundles).length;
        draft.bundles[id] = {
          id, refdes: `BND${n + 1}`, sourceId: fromId, targetId: toId, custom: {},
        };
      });
      const from = doc.components[fromId];
      const to = doc.components[toId];
      setNotice(`Bundle added: ${from?.refdes ?? fromId} → ${to?.refdes ?? toId}`);
    },
  });
  const derived = computeDerivedModel(doc);

  /**
   * Route health, derived entirely from `derived.wireLengths` — nothing here
   * is tracked separately, so it cannot drift from what the routing engine
   * actually concluded.
   *
   * `noRoute` and `unplaced` are the two actionable statuses and are grouped
   * together as "needs a route": one means the endpoints are placed but no
   * bundle path joins them, the other that a component has not been placed at
   * all. Both are fixed in this pane and both leave the wire with no length.
   * `jumper` and `shield` are deliberately counted as routed — they are
   * terminal answers from routing.ts, not missing ones (a jumper has zero
   * length by definition; a shield drain has no bundle path of its own).
   */
  const routeSummary = useMemo(() => {
    const unroutedWires: { wire: Wire; status: LengthStatus }[] = [];
    const routedWires: { wire: Wire; status: LengthStatus; value: number }[] = [];
    let exact = 0;
    let totalUm = 0;

    for (const wire of Object.values(doc.wires)) {
      const len = derived.wireLengths.get(wire.id);
      const status: LengthStatus = len?.status ?? 'unplaced';
      if (status === 'noRoute' || status === 'unplaced') {
        unroutedWires.push({ wire, status });
        continue;
      }
      const value = len?.value ?? 0;
      routedWires.push({ wire, status, value });
      if (status === 'exact' || status === 'overridden') exact += 1;
      totalUm += value;
    }

    return {
      total: unroutedWires.length + routedWires.length,
      routed: routedWires.length,
      unrouted: unroutedWires.length,
      exact,
      totalUm,
      unroutedWires,
      routedWires,
    };
  }, [doc.wires, derived.wireLengths]);
  // Phase 2b connector orientation: R rotates the selected connector 90°,
  // Shift+R auto-optimizes its stored rotation (fewest bundle crossings).
  // Fed the canvas's own scale/exclusion/branch constants so the optimizer
  // applies the same definition of a crossing as this canvas's conflict
  // indicator (inline pass-throughs remain an accepted approximation — see
  // countWireCrossings in render/connectorOptimization.ts).
  const connectorRotation = useConnectorRotation(doc, store, PX_PER_MM, ENDPOINT_EXCLUSION_PX, BRANCH_R);

  /** True mm-space position of a mousedown/click, using the SVG's own
   * bounding rect — needed (unlike the simple delta-drags elsewhere in this
   * file) to figure out *where along a bundle's path* a new routing node
   * should be inserted. */
  const clientToMm = useCallback((clientX: number, clientY: number): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return toMm({
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale,
    });
  }, [scale]);

  /** Same as `clientToMm`, but in px (this file's on-screen SVG space) —
   * needed for dragging an inline pass-through component, since its
   * position is a fraction along a px-space skeleton polyline rather than
   * an mm-space document coordinate. */
  const clientToPx = useCallback((clientX: number, clientY: number): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale,
    };
  }, [scale]);

  const wiresThroughComponent = useCallback(
    (componentId: string): string[] => {
      const ids: string[] = [];
      for (const b of Object.values(doc.bundles)) {
        if (b.sourceId === componentId || b.targetId === componentId) {
          ids.push(...(derived.bundleContents.get(b.id) ?? []));
        }
      }
      return ids;
    },
    [doc.bundles, derived.bundleContents],
  );

  // Cross-pane wire highlight, resolved to bundles: a wire hovered in
  // Schematic reports its id here; `derived.wireRoutes` (the same table
  // `computeLengths` uses) gives the exact bundle path that wire actually
  // routes through, so every bundle it passes through lights up rather than
  // just its two physical endpoints.
  const highlightedBundleIds = useMemo(() => {
    if (!hoveredWireId) return null;
    const route = derived.wireRoutes.get(hoveredWireId);
    return route ? new Set(route.segments) : null;
  }, [hoveredWireId, derived.wireRoutes]);

  const placed = Object.values(doc.components).filter((c) => !!c.layoutPosition);
  const unplaced = Object.values(doc.components).filter((c) => !c.layoutPosition && c.type !== 'branchPoint');

  // Auto-orientation (see file header): each connector's base facing angle
  // is the average direction, in px space, from its own center to whatever
  // it's bundled to (aimed at the first/last routing waypoint when one
  // exists, so a bent bundle still leaves the glyph pointing the right way).
  // The base angle is never stored — recomputed every render, so dragging
  // either end updates both glyphs' orientation live, and two connectors
  // bundled only to each other land exactly 180° apart with no manual flip.
  // The user-authored rotation (Phase 2b, R key) is stored on the component
  // and applied ON TOP: final angle = auto + rotation. The math itself lives
  // in render (layoutOrientation.ts) so the auto-optimize can score it too.
  const nodeAngles = useMemo(() => {
    const auto = computeNodeAutoAngles(doc, PX_PER_MM);
    const angles = new Map<string, number>();
    for (const c of placed) {
      if (c.type === 'branchPoint') continue;
      angles.set(c.id, nodeFacingAngle(auto.get(c.id) ?? 0, c.rotation));
    }
    return angles;
  }, [doc, placed]);

  const nodeGlyphs = useMemo(() => {
    const glyphs = new Map<string, ConnectorGlyph>();
    for (const c of placed) {
      if (c.type === 'branchPoint' || !c.layoutPosition) continue;
      glyphs.set(c.id, physicalGlyph(c, toPx(c.layoutPosition), nodeAngles.get(c.id) ?? 0));
    }
    return glyphs;
  }, [placed, nodeAngles]);

  // Inline pass-through components (see findInlinePassThroughs' doc
  // comment) — computed from `doc` directly (not `placed`/`nodeGlyphs`)
  // since eligibility only depends on bundle topology, not orientation.
  const inlinePassThroughs = useMemo(() => findInlinePassThroughs(doc), [doc]);
  const absorbedBundleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const pair of inlinePassThroughs.values()) { ids.add(pair.bundleA.id); ids.add(pair.bundleB.id); }
    return ids;
  }, [inlinePassThroughs]);

  /** Bundles this render actually draws, with their resolved px polylines —
   * the same attach-point math the render loop always used (glyph stub tip
   * for ordinary components, circle-edge clip for branch points), shared
   * with the render package (layoutOrientation.bundlePolyline) so the bundle
   * scene builder, the rotation optimizer and this render loop all agree on
   * ONE polyline per bundle. A rotated connector moves its stub tip, so its
   * bundles' polylines — and any crossings — update the same render. */
  const drawableBundles = useMemo(() => {
    const out: { bundle: Bundle; pathD: string; pointsPx: Point[]; waypointsPx: Point[] }[] = [];
    for (const b of Object.values(doc.bundles)) {
      // Bundles absorbed into a merged inline pass-through line are rendered
      // by that line (see below); drawing them here would double them.
      if (absorbedBundleIds.has(b.id)) continue;
      const pointsPx = bundlePolyline(doc, b, nodeAngles, PX_PER_MM, BRANCH_R);
      if (!pointsPx) continue;
      out.push({ bundle: b, pathD: smoothBundlePath(pointsPx), pointsPx, waypointsPx: (b.waypoints ?? []).map(toPx) });
    }
    return out;
  }, [doc, absorbedBundleIds, nodeAngles]);

  // Bundle scene data (Phase 2a): outline width from the DERIVED diameter,
  // membership/gauge labels from the DERIVED contents, crossing detection on
  // the drawn polylines. Recomputed with the document — cheap at pilot scale
  // and never stale, same discipline as `derived` itself above.
  const sceneBundles = emitBundleGeometry(
    doc, derived,
    drawableBundles.map((d) => ({ bundleId: d.bundle.id, points: d.pointsPx })),
    PX_PER_MM, ENDPOINT_EXCLUSION_PX,
  );
  const sceneBundleById = new Map(sceneBundles.map((sb) => [sb.id, sb]));

  const addBranchPoint = useCallback(() => {
    const pos = nextLayoutGrid(store);
    let newId = '';
    store.transact('Add branch point', (draft) => {
      const id = newInstanceId();
      newId = id;
      const refdes = `${draft.settings.refdesPrefixes.branchPoint ?? 'B'}${Object.values(draft.components).filter((c) => c.type === 'branchPoint').length + 1}`;
      draft.components[id] = { id, type: 'branchPoint', refdes, layoutPosition: pos, custom: {} };
    });
    setSelected({ kind: 'component', id: newId });
  }, [store]);

  const placeComponent = useCallback(
    (componentId: string) => {
      const pos = nextLayoutGrid(store);
      store.transact('Place component in layout', (draft) => {
        const c = draft.components[componentId];
        if (c) c.layoutPosition = pos;
      });
      setSelected({ kind: 'component', id: componentId });
    },
    [store],
  );

  const unplaceComponent = useCallback(
    (componentId: string) => {
      store.transact('Remove from layout', (draft) => {
        const c = draft.components[componentId];
        if (c) c.layoutPosition = undefined;
        for (const [bid, b] of Object.entries(draft.bundles)) {
          if (b.sourceId === componentId || b.targetId === componentId) delete draft.bundles[bid];
        }
      });
      setSelected(null);
    },
    [store],
  );

  /** Connector orientation (Phase 2b): plain R rotates the selected
   * connector 90° clockwise, Shift+R auto-optimizes it (fewest bundle
   * crossings). Scoped to THIS pane's canvas container — never a window
   * listener — so a split view with two Layout panes rotates only the
   * focused one, and each pane keeps its own selection. The container is
   * focusable (tabIndex -1) so clicking the canvas or a connector is enough
   * to receive the key; typing R in an inspector input never rotates
   * anything (form-field guard in rotationActionForKey). */
  const onRotationKey = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inFormField = !!target
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);

      // Tool shortcuts. Same form-field guard as rotation — typing "v" in an
      // inspector field must never switch tools. No modifiers, so they don't
      // collide with Ctrl+V.
      if (!inFormField && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'v' || e.key === 'V') {
          e.preventDefault();
          setTool('select');
          connect.cancel();
          return;
        }
        if (e.key === 'c' || e.key === 'C') {
          e.preventDefault();
          setTool('route');
          setNotice(null);
          return;
        }
      }

      const action = rotationActionForKey(e, selected, doc, inFormField);
      // action !== null already implies a connector is selected (that's what
      // rotationActionForKey decides) — re-check explicitly rather than
      // asserting, so the narrowing is compiler-checked.
      if (!action || !selected || selected.kind !== 'component') return;
      e.preventDefault();
      const id = selected.id;
      const refdes = doc.components[id]?.refdes ?? id;
      if (action === 'optimize') {
        const applied = connectorRotation.autoOptimizeConnector(id);
        if (applied === undefined) return;
        setFlashId(id); // brief highlight — the "success" confirmation
        setNotice(`${refdes}: auto-optimized to ${applied}°`);
      } else {
        const applied = connectorRotation.rotateConnector(id, true);
        if (applied === undefined) return;
        setNotice(`${refdes} rotated to ${applied}°`);
      }
    },
    [selected, doc, connectorRotation, connect],
  );

  const onNodeMouseDown = useCallback(
    (component: Component, e: React.MouseEvent) => {
      e.stopPropagation();
      setNotice(null);
      const pos = component.layoutPosition!;

      // A gesture already in flight always wins, whatever the tool: this is
      // the second click of a click-to-connect, and treating it as a fresh
      // node drag would silently discard the source the user picked.
      // In `route` the whole node body is a bundle source, which is the
      // difference between the two tools.
      if (connect.active || tool === 'route') {
        // Deliberately does NOT select: while routing, the user's intent is
        // unambiguous, and popping the component inspector over the canvas
        // buries the drop targets they are aiming at. The gesture's own
        // source highlight already shows what is picked.
        connect.press(component.id, pos, e.clientX, e.clientY);
        return;
      }

      setSelected({ kind: 'component', id: component.id });
      setDragging({ id: component.id, pointerStartX: e.clientX, pointerStartY: e.clientY, posStartX: pos.x, posStartY: pos.y });
    },
    [connect, tool],
  );

  /** Release over a node completes a drag-to-connect. Separate from the
   * window-level mouseup in useConnectGesture, which only ever sees releases
   * over empty canvas — this is the one that knows a node is under the
   * pointer. */
  const onNodeMouseUp = useCallback(
    (component: Component, e: React.MouseEvent) => {
      if (!connect.active) return;
      e.stopPropagation();
      connect.release(component.id);
    },
    [connect],
  );

  /** The routing-node insertion transaction shared by the click-on-line
   * gesture and the legacy straight-bundle drag. */
  const insertWaypoint = useCallback(
    (bundleId: string, insertAt: number, atMm: Point) => {
      store.transact('Add routing node', (draft) => {
        const bd = draft.bundles[bundleId];
        if (!bd) return;
        if (!bd.waypoints) bd.waypoints = [];
        bd.waypoints.splice(insertAt, 0, atMm);
      });
    },
    [store],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // An armed connect gesture takes priority: its preview line has to
      // track the cursor even while the pointer is over a node that would
      // otherwise start its own hover work.
      if (connect.move(e.clientX, e.clientY, clientToMm(e.clientX, e.clientY))) return;
      // Bundle drag / wire extraction gets first refusal — when one is live
      // it consumes the move (and decides for itself whether the pointer has
      // travelled far enough to count as a drag yet).
      if (bundleRouting.updateDrag(e.clientX, e.clientY, clientToPx(e.clientX, e.clientY))) return;
      if (dragging) {
        const dxPx = (e.clientX - dragging.pointerStartX) / scale;
        const dyPx = (e.clientY - dragging.pointerStartY) / scale;
        const dMm = toMm({ x: dxPx, y: dyPx });
        const x = dragging.posStartX + dMm.x;
        const y = dragging.posStartY + dMm.y;
        store.transact('Move component (layout)', (draft) => {
          const c = draft.components[dragging.id];
          if (c) c.layoutPosition = { x, y };
        });
      } else if (draggingWaypoint) {
        const dxPx = (e.clientX - draggingWaypoint.pointerStartX) / scale;
        const dyPx = (e.clientY - draggingWaypoint.pointerStartY) / scale;
        const dMm = toMm({ x: dxPx, y: dyPx });
        const x = draggingWaypoint.posStartX + dMm.x;
        const y = draggingWaypoint.posStartY + dMm.y;
        store.transact('Move routing node', (draft) => {
          const b = draft.bundles[draggingWaypoint.bundleId];
          if (b?.waypoints?.[draggingWaypoint.index]) b.waypoints[draggingWaypoint.index] = { x, y };
        });
      } else if (draggingInline) {
        // Dragging an inline pass-through component (Connor: "the location
        // of the discrete component can be dragged along the line") —
        // project the cursor onto its current skeleton and store the
        // resulting arc-length fraction, rather than a raw x/y (there's no
        // x/y to move; the component doesn't have its own attach points
        // while it's inline, see findInlinePassThroughs' doc comment).
        const pair = inlinePassThroughs.get(draggingInline.componentId);
        if (pair) {
          const skeleton = skeletonPointsFor(pair, doc, nodeGlyphs);
          const t = fractionAtClosestPoint(skeleton, clientToPx(e.clientX, e.clientY));
          store.transact('Move inline component', (draft) => {
            const c = draft.components[draggingInline.componentId];
            if (c) c.custom['inlineT'] = t;
          });
        }
      }
    },
    [dragging, draggingWaypoint, draggingInline, store, inlinePassThroughs, doc, nodeGlyphs, clientToPx, clientToMm, bundleRouting, connect],
  );
  const onMouseUp = useCallback(() => {
    // Finish any bundle gesture first. A release that never crossed the drag
    // threshold is a CLICK on the bundle line → insert the routing node we
    // stashed at press time (the pre-existing behaviour, now gated on the
    // threshold so a drag can mean "move the whole shape" instead). A wire
    // extraction releases past the threshold commit; a blocked one explains
    // itself in the toolbar so the user isn't left guessing.
    const gesture = bundleRouting.endDrag();
    if (gesture) {
      const pending = pendingBundleClick.current;
      pendingBundleClick.current = null;
      if (gesture.gesture === 'click' && pending) {
        insertWaypoint(pending.bundleId, pending.insertAt, pending.clickMm);
      } else if (gesture.gesture === 'wire-extract-blocked') {
        const wire = doc.wires[gesture.wireId];
        const bundle = doc.bundles[gesture.bundleId];
        setNotice(`${wire?.refdes ?? gesture.wireId} can't be extracted from ${bundle?.refdes ?? gesture.bundleId} — it has no route that avoids the bundle.`);
      }
    }
    setDragging(null); setDraggingWaypoint(null); setDraggingInline(null);
  }, [bundleRouting, insertWaypoint, doc]);

  /** Grabbing a bundle's own line (not an existing waypoint handle). Two
   * gestures share this hit target, told apart by pointer travel at release
   * (the drag threshold, never a modifier key — house rule, review C9):
   *
   *  - a bundle WITH routing nodes: press-and-drag translates the whole
   *    routing shape (bundle-level waypoint editing — every bend moves
   *    together, endpoints stay plugged in); a plain click inserts one new
   *    routing node at the click position, in the correct spot along the
   *    path, exactly as before this gesture existed.
   *  - a bundle with NO waypoints has no shape to translate, so it keeps the
   *    original gesture outright: press inserts a node and drags it.
   */
  const onBundleMouseDown = useCallback(
    (bundleId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const bundle = doc.bundles[bundleId];
      const a = bundle && doc.components[bundle.sourceId];
      const b = bundle && doc.components[bundle.targetId];
      if (!bundle || !a?.layoutPosition || !b?.layoutPosition) return;
      setSelected({ kind: 'bundle', id: bundleId });
      setNotice(null);
      const clickMm = clientToMm(e.clientX, e.clientY);
      const pts = [a.layoutPosition, ...(bundle.waypoints ?? []), b.layoutPosition];
      let insertAt = 0;
      let bestDist = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const d = distToSegmentSq(clickMm, pts[i]!, pts[i + 1]!);
        if (d < bestDist) { bestDist = d; insertAt = i; }
      }
      if ((bundle.waypoints ?? []).length === 0) {
        insertWaypoint(bundleId, insertAt, clickMm);
        setDraggingWaypoint({ bundleId, index: insertAt, pointerStartX: e.clientX, pointerStartY: e.clientY, posStartX: clickMm.x, posStartY: clickMm.y });
        return;
      }
      pendingBundleClick.current = { bundleId, clickMm, insertAt };
      bundleRouting.startBundleDrag(bundleId, e.clientX, e.clientY, bundle.waypoints ?? []);
    },
    [doc, store, clientToMm, insertWaypoint, bundleRouting],
  );

  const onWaypointMouseDown = useCallback(
    (bundleId: string, index: number, point: Point, e: React.MouseEvent) => {
      e.stopPropagation();
      setSelected({ kind: 'bundle', id: bundleId });
      setDraggingWaypoint({ bundleId, index, pointerStartX: e.clientX, pointerStartY: e.clientY, posStartX: point.x, posStartY: point.y });
    },
    [],
  );

  const removeWaypoint = useCallback(
    (bundleId: string, index: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      store.transact('Remove routing node', (draft) => {
        const b = draft.bundles[bundleId];
        b?.waypoints?.splice(index, 1);
      });
    },
    [store],
  );

  const deleteBundle = useCallback(
    (bundleId: string) => {
      store.transact('Delete bundle', (draft) => { delete draft.bundles[bundleId]; });
      setSelected(null);
    },
    [store],
  );

  const setBundleLength = useCallback(
    (bundleId: string, mm: number | undefined) => {
      store.transact('Edit bundle length', (draft) => {
        const b = draft.bundles[bundleId];
        if (b) b.length = mm;
      });
    },
    [store],
  );

  /** Bundle outline color (Phase 2a). Stored on the bundle so it survives
   * reload and every view agrees; `undefined` means "use the default" and is
   * collapsed away rather than serialised as an explicit default. */
  const setBundleColor = useCallback(
    (bundleId: string, color: string | undefined) => {
      store.transact('Set bundle color', (draft) => {
        const b = draft.bundles[bundleId];
        if (!b) return;
        if (color === undefined || color === DEFAULT_BUNDLE_COLOR) delete b.color;
        else b.color = color;
      });
    },
    [store],
  );

  /** Free user-facing bundle label (Phase 2a); empty collapses to unset. */
  const setBundleLabel = useCallback(
    (bundleId: string, label: string | undefined) => {
      store.transact('Set bundle label', (draft) => {
        const b = draft.bundles[bundleId];
        if (!b) return;
        const trimmed = label?.trim();
        if (trimmed) b.label = trimmed;
        else delete b.label;
      });
    },
    [store],
  );

  /** Per-segment authored length (Connor: "dimensions between each routing
   * point should be able to be recorded, every single point") — see
   * `bundleAuthoredLength` in core/derive/bundleLength.ts for how this and
   * the whole-bundle `length` field above reconcile when both are present. */
  const setSegmentLength = useCallback(
    (bundleId: string, index: number, mm: number | undefined) => {
      store.transact('Edit segment length', (draft) => {
        const b = draft.bundles[bundleId];
        if (!b) return;
        const expected = (b.waypoints?.length ?? 0) + 1;
        if (!b.segmentLengths || b.segmentLengths.length !== expected) {
          b.segmentLengths = Array.from({ length: expected }, () => undefined);
        }
        b.segmentLengths[index] = mm;
      });
    },
    [store],
  );

  const maxX = Math.max(500, ...placed.map((c) => toPx(c.layoutPosition!).x + HOVER_R + 140));
  const maxY = Math.max(360, ...placed.map((c) => toPx(c.layoutPosition!).y + HOVER_R + 100));

  // Keep the zoom hook's pan/scroll clamp aware of the content extent.
  useEffect(() => {
    setContentSize(maxX, maxY);
  }, [maxX, maxY, setContentSize]);

  // Fit-to-view / fit-to-selection (review B4). Fit-to-view bounds the drawn
  // geometry — placed component centers plus the routing nodes of bundles
  // that are actually drawn (both endpoints placed) — not the whole canvas
  // rect, so an empty corner of a large canvas doesn't shrink the harness
  // into a corner of the fit.
  const fitToView = useCallback(() => {
    const centers = placed.flatMap((c) => {
      if (!c.layoutPosition) return [];
      // An inline pass-through's layoutPosition is vestigial while it rides
      // its merged line (see findInlinePassThroughs); its drawn position is
      // on the skeleton, which the bundle waypoints + neighbour centers
      // below already bound, so the stale coordinate must not stretch the
      // fit.
      if (inlinePassThroughs.has(c.id)) return [];
      return [toPx(c.layoutPosition)];
    });
    const waypoints: Point[] = [];
    for (const b of Object.values(doc.bundles)) {
      const a = doc.components[b.sourceId];
      const t = doc.components[b.targetId];
      if (!a?.layoutPosition || !t?.layoutPosition) continue; // not drawn
      for (const wp of b.waypoints ?? []) waypoints.push(toPx(wp));
    }
    fitTo(layoutContentRects(centers, waypoints));
  }, [placed, doc, inlinePassThroughs, fitTo]);

  const fitToSelection = useCallback(() => {
    if (!selected) return;
    if (selected.kind === 'component') {
      const c = doc.components[selected.id];
      if (!c) return;
      const pair = inlinePassThroughs.get(c.id);
      if (pair) {
        // An inline pass-through's stored layoutPosition is vestigial while
        // it rides its merged line (see findInlinePassThroughs) — fit where
        // it is actually drawn, not where the stale coordinate says.
        const skeleton = skeletonPointsFor(pair, doc, nodeGlyphs);
        if (skeleton.length < 2) return;
        fitTo([pointRect(pointAtFraction(skeleton, getInlineT(c)).point)]);
        return;
      }
      if (!c.layoutPosition) return;
      // A single placed component is point-like — fitToBounds gives it the
      // default 100% zoom and centers it rather than dividing by zero.
      fitTo([pointRect(toPx(c.layoutPosition))]);
      return;
    }
    const b = doc.bundles[selected.id];
    const a = b && doc.components[b.sourceId];
    const t = b && doc.components[b.targetId];
    if (!b || !a?.layoutPosition || !t?.layoutPosition) return;
    fitTo(layoutBundleRects(toPx(a.layoutPosition), toPx(t.layoutPosition), (b.waypoints ?? []).map(toPx)));
  }, [selected, doc, inlinePassThroughs, nodeGlyphs, fitTo]);

  // Inline pass-through components don't have their own position card — see
  // findInlinePassThroughs' doc comment; their `layoutPosition` field is
  // vestigial while eligible, and "Remove from layout" wouldn't remove
  // anything meaningful (removing from the *line* means deleting one of the
  // two bundles, not clearing an unused x/y).
  const selectedComponent = selected?.kind === 'component' && !inlinePassThroughs.has(selected.id) ? doc.components[selected.id] : undefined;
  const selectedBundle = selected?.kind === 'bundle' ? doc.bundles[selected.id] : undefined;

  // Phase 2a inspector data for the selected bundle. Which wires are members
  // (and whether each CAN leave) is derived, never tracked on the wire — see
  // bundleRouting.ts's header for why extraction is a frozen-route override.
  const selectedScene = selectedBundle ? sceneBundleById.get(selectedBundle.id) : undefined;
  const selectedBundleWires = useMemo(() => {
    if (!selectedBundle) return [] as { id: string; refdes: string }[];
    const ids = [...new Set(derived.bundleContents.get(selectedBundle.id) ?? [])];
    return ids.map((id) => ({ id, refdes: doc.wires[id]?.refdes ?? id }));
  }, [selectedBundle, derived.bundleContents, doc.wires]);
  const extractableWires = useMemo(() => {
    const m = new Map<string, boolean>();
    if (selectedBundle) {
      for (const w of selectedBundleWires) {
        m.set(w.id, computeRouteAvoidingBundle(doc, w.id, selectedBundle.id) !== undefined);
      }
    }
    return m;
  }, [selectedBundle, selectedBundleWires, doc]);

  return (
    <div style={s.root}>
      <div style={s.toolbar}>
        <span style={s.toolbarLabel}>Layout</span>
        {/* Tool switcher. The pane's two verbs, said out loud — see the
            `tool` state for why this canvas is modal at all. Keyboard V/C
            because those are where every drawing tool puts select and
            connect, and because reaching for the toolbar mid-route is
            exactly the friction this is meant to remove. */}
        <div style={s.toolGroup} role="radiogroup" aria-label="Layout tool">
          <button
            style={{ ...s.toolBtn, ...(tool === 'select' ? s.toolBtnActive : {}) }}
            onClick={() => { setTool('select'); connect.cancel(); }}
            role="radio" aria-checked={tool === 'select'}
            title="Select and move components (V)"
          >
            Select
          </button>
          <button
            style={{ ...s.toolBtn, ...(tool === 'route' ? s.toolBtnActive : {}) }}
            onClick={() => { setTool('route'); setNotice(null); }}
            role="radio" aria-checked={tool === 'route'}
            title="Route bundles: drag from one component to another (C)"
          >
            Route
          </button>
        </div>
        <span style={s.toolbarDivider} />
        <button style={s.toolbarBtn} onClick={addBranchPoint}>+ Branch point</button>
        {/* Fit-to-view / fit-to-selection (review B4) — view-only, so plain
            toolbar buttons rather than document mutations. */}
        <button style={s.toolbarBtn} onClick={fitToView} title="Zoom and pan so the whole layout is visible">
          Fit view
        </button>
        <button
          style={{ ...s.toolbarBtn, ...(selected === null ? s.toolbarBtnDisabled : {}) }}
          onClick={fitToSelection} disabled={selected === null}
          title={selected ? 'Zoom and pan so the selection is visible' : 'Select a component or bundle first'}
        >
          Fit selection
        </button>
        {unplaced.length > 0 && (
          <div style={s.unplacedGroup}>
            <span style={s.unplacedLabel}>Unplaced ({unplaced.length}):</span>
            {unplaced.map((c) => (
              <button key={c.id} style={s.unplacedChip} onClick={() => placeComponent(c.id)} title="Click to place in layout">
                <ComponentIcon type={c.type} size={11} {...connectorAppearance(c, doc)} /> {c.refdes}
              </button>
            ))}
          </div>
        )}
        {/* Route health, always visible. Every number here was already
            derived and none of it was ever shown — a wire with no path
            through the bundle graph is the single most consequential state
            this pane can be in, and until now you had to open Diagnostics to
            find out you were in it. Clicking scrolls the sidebar's unrouted
            group into view. */}
        {routeSummary.total > 0 && (
          <button
            style={{ ...s.routeChip, ...(routeSummary.unrouted > 0 ? s.routeChipWarn : {}) }}
            onClick={() => unroutedRef.current?.scrollIntoView({ block: 'nearest' })}
            title={routeSummary.unrouted > 0
              ? `${routeSummary.unrouted} wire(s) have no path through the bundle graph — show them`
              : 'Every wire has a route through the bundle graph'}
          >
            {routeSummary.unrouted > 0
              ? `${routeSummary.unrouted} unrouted / ${routeSummary.total}`
              : `${routeSummary.total} routed`}
          </button>
        )}
        {connect.active && (
          <span style={s.hint}>
            Drag to a highlighted component to bundle them, or click one. Escape cancels.
          </span>
        )}
        {!connect.active && notice && <span style={s.hint}>{notice}</span>}
        {!connect.active && !notice && tool === 'route' && (
          <span style={s.hint}>Route: drag from any component to another to bundle them. V returns to Select.</span>
        )}
        {!connect.active && !notice && tool === 'select' && selectedComponent?.type === 'connector' && (
          <span style={s.hint}>Press R to rotate {selectedComponent.refdes} 90° · Shift+R to auto-optimize (fewest crossings).</span>
        )}
        {!connect.active && !notice && tool === 'select' && selectedComponent?.type !== 'connector' && Object.keys(doc.bundles).length > 0 && (
          <span style={s.hintMuted}>Drag a bundle's line to move all its routing nodes, or click it to add one; select a bundle to extract wires. Hover any node to see which wires pass through it.</span>
        )}
      </div>

      <div style={s.body}>
        <div
          ref={scrollRef} style={{ ...s.canvasScroll, outline: 'none' }}
          // Focusable so the pane receives R/Shift+R once the user has
          // clicked it (a click anywhere inside focuses this container) —
          // see onRotationKey for why the listener lives here, not on window.
          tabIndex={-1}
          onKeyDown={onRotationKey}
          onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
          onMouseDown={onBackgroundMouseDown}
        >
          <div style={{ position: 'relative', width: maxX * scale, height: maxY * scale }}>
            <svg
              ref={svgRef}
              width={maxX} height={maxY}
              style={{
                ...s.svg,
                // The pan offsets are part of the transform, not a scroll
                // position: the wheel handler solves zoomViewAboutCursor for
                // exactly this composition (screen = canvas*scale + pan − scroll),
                // so dropping the translate would make every zoom pivot on
                // the top-left corner and throw the computed pan away. Order
                // matters — CSS applies the list right-to-left, so scale
                // first, then the screen-pixel translate.
                transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
                transformOrigin: '0 0',
                transition: 'none',
              }}
              onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
            >
              <defs>
                <pattern id="layout-dot-grid" width={16} height={16} patternUnits="userSpaceOnUse">
                  <circle cx={1} cy={1} r={1} fill={theme.color.gridDot} />
                </pattern>
              </defs>
              <rect x={0} y={0} width={maxX} height={maxY} fill="url(#layout-dot-grid)" />

              {drawableBundles.map(({ bundle: b, pathD, pointsPx, waypointsPx }) => {
                const sb = sceneBundleById.get(b.id);
                if (!sb) return null;
                const isSelected = selected?.kind === 'bundle' && selected.id === b.id;
                const signalNames = bundleSignalTooltip(sb.wireIds, doc);
                // Cross-pane highlight: this bundle is directly hovered, or
                // it's on the route of a wire hovered over in Schematic
                // (Connor: "highlight all wires that route through that
                // point" — the same relationship in reverse).
                const isHighlighted = hoveredBundleId === b.id || !!highlightedBundleIds?.has(b.id);
                // Phase 2a visual feedback: the bundle being dragged
                // ghost-fades while its shape follows the cursor.
                const isBundleDragged = !!bundleRouting.drag?.moved
                  && bundleRouting.drag.kind === 'bundle'
                  && bundleRouting.drag.bundleId === b.id;
                const tooltip = [
                  `${sb.labelText}${b.length !== undefined ? ` · authored length ${b.length} mm` : ''}`,
                  signalNames,
                  'Drag the line to move all routing nodes; click to add one.',
                ].join('\n');
                return (
                  <g key={b.id} opacity={isBundleDragged ? 0.55 : 1}>
                    {/* Fat invisible hit-target — the bundle-outline drag
                        surface (cursor: move). Also the source of cross-pane
                        bundle hover. */}
                    <path d={pathD} fill="none" stroke="transparent"
                      strokeWidth={Math.max(14, sb.outlineWidthPx + 6)}
                      style={{ cursor: 'move' }}
                      onMouseDown={(e) => onBundleMouseDown(b.id, e)}
                      onClick={(e) => { e.stopPropagation(); setSelected({ kind: 'bundle', id: b.id }); }}
                      onMouseEnter={() => onHoverBundle?.(b.id)} onMouseLeave={() => onHoverBundle?.(null)}>
                      <title>{tooltip}</title>
                    </path>
                    {/* Bundle body — the diameter indicator (pain point 3):
                        stroke width is the derived diameter to scale, so a
                        fat run reads as fat. Color is the bundle's own
                        (Phase 2a), brighter on hover/selection. */}
                    <path d={pathD} fill="none" stroke={sb.color}
                      strokeOpacity={isSelected || isHighlighted ? 0.5 : 0.28}
                      strokeWidth={sb.outlineWidthPx} strokeLinecap="round"
                      style={{ pointerEvents: 'none' }} />
                    {/* Conflict indicator: this bundle's path crosses another
                        bundle's path (or its own) — red dashed outline over
                        the body, exact spots marked below. */}
                    {sb.hasCrossing && (
                      <path d={pathD} fill="none" stroke={theme.color.danger}
                        strokeOpacity={0.65} strokeWidth={sb.outlineWidthPx + 3}
                        strokeDasharray="7 5" strokeLinecap="round"
                        style={{ pointerEvents: 'none' }} />
                    )}
                    {isHighlighted && (
                      <path d={pathD} fill="none" stroke={theme.color.warning}
                        strokeOpacity={0.5} strokeWidth={8} strokeLinecap="round"
                        style={{ pointerEvents: 'none' }} />
                    )}
                    <path d={pathD} fill="none"
                      stroke={isSelected || isHighlighted ? theme.color.accent : sb.color}
                      strokeWidth={isSelected || isHighlighted ? 3 : 2}
                      strokeLinecap="round"
                      strokeDasharray={b.length === undefined ? '5 4' : undefined}
                      style={{ pointerEvents: 'none' }} />
                    {sb.crossings.map((c, i) => (
                      <circle key={`cross-${i}`} cx={c.x} cy={c.y} r={4}
                        fill={theme.color.danger} stroke={theme.color.surface} strokeWidth={1.5}
                        style={{ pointerEvents: 'none' }}>
                        <title>{`${b.refdes} crosses another bundle's path here`}</title>
                      </circle>
                    ))}
                    {/* Bundle label: refdes/label, wire count, gauge range,
                        diameter — anchored at the path's midpoint. */}
                    <text x={sb.labelPosition.x} y={sb.labelPosition.y - sb.outlineWidthPx / 2 - 5}
                      textAnchor="middle" fontSize={10.5} fontWeight={600}
                      fill={isSelected || isHighlighted ? theme.color.textStrong : theme.color.textMuted}
                      style={{ pointerEvents: 'none' }}>
                      {sb.labelText}
                    </text>
                    {/* Routing-node handles — draggable, right-click to remove. */}
                    {waypointsPx.map((wp, i) => (
                      <circle
                        key={i} cx={wp.x} cy={wp.y} r={4.5}
                        fill={theme.color.surface}
                        stroke={isSelected ? theme.color.accent : theme.color.textFaint}
                        strokeWidth={2}
                        style={{ cursor: 'grab' }}
                        onMouseDown={(e) => onWaypointMouseDown(b.id, i, b.waypoints![i]!, e)}
                        onContextMenu={(e) => removeWaypoint(b.id, i, e)}
                      >
                        <title>{`Routing node on ${b.refdes} — ${signalNames}\nDrag to move, right-click to remove.`}</title>
                      </circle>
                    ))}
                    {/* Extraction handles — one per wire, visible while the
                        bundle is selected (Phase 2a): drag one off the bundle
                        to extract that wire. The Layout pane draws bundles,
                        not individual wires, so the handles sit spaced along
                        the bundle's own path — one distinct grab target per
                        member wire. Handles are positioned on the control
                        polyline, not the drawn Catmull-Rom spline — an
                        accepted approximation; see the polyline-vs-spline
                        note on emitBundleGeometry. */}
                    {isSelected && sb.wireIds.map((wireId, i) => {
                      const pos = pointAtFraction(pointsPx, (i + 1) / (sb.wireCount + 1)).point;
                      const wireRefdes = doc.wires[wireId]?.refdes ?? wireId;
                      return (
                        <circle
                          key={`extract-${wireId}`} cx={pos.x} cy={pos.y} r={5}
                          fill={theme.color.surface} stroke={sb.color} strokeWidth={2}
                          style={{ cursor: 'grab' }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setNotice(null);
                            bundleRouting.startWireExtract(wireId, b.id, e.clientX, e.clientY);
                          }}
                        >
                          <title>{`${wireRefdes} in ${b.refdes}\nDrag away from the bundle to extract this wire.`}</title>
                        </circle>
                      );
                    })}
                  </g>
                );
              })}

              {/* Wire-extraction drag preview: the grabbed wire's handle
                  follows the cursor; releasing past the drag threshold
                  extracts it (a frozen route around the bundle). */}
              {bundleRouting.drag?.kind === 'wire' && bundleRouting.drag.moved && bundleRouting.dragPointer && (
                <g style={{ pointerEvents: 'none' }}>
                  <circle cx={bundleRouting.dragPointer.x} cy={bundleRouting.dragPointer.y} r={5}
                    fill={theme.color.surface} stroke={theme.color.accent} strokeWidth={2} strokeDasharray="3 2" />
                  <text x={bundleRouting.dragPointer.x + 9} y={bundleRouting.dragPointer.y - 9}
                    fontSize={10.5} fontWeight={600} fill={theme.color.textStrong}>
                    {`${doc.wires[bundleRouting.drag.wireId ?? '']?.refdes ?? ''} — release to extract`}
                  </text>
                </g>
              )}


              {/* Inline pass-through components (Connor: "make layout
                 resistor appear in line... only one bundle should appear,
                 and the location of the discrete component can be dragged
                 along the line") — see findInlinePassThroughs' doc comment.
                 One merged flowy line (smoothBundlePath, same Catmull-Rom
                 curve every other bundle line uses) from the component's
                 real neighbor on one side, through its own two bundles'
                 waypoints with no gap at the old junction point, to its
                 real neighbor on the other side — with the resistor/diode
                 glyph riding at its stored arc-length fraction, oriented to
                 the line's own tangent there. */}
              {[...inlinePassThroughs.values()].map((pair) => {
                const skeleton = skeletonPointsFor(pair, doc, nodeGlyphs);
                if (skeleton.length < 2) return null;
                const t = getInlineT(pair.component);
                const { point: glyphCenter, angle } = pointAtFraction(skeleton, t);
                const glyph = physicalGlyph(pair.component, glyphCenter, angle);
                const pathD = smoothBundlePath(skeleton);
                const isSelected = selected?.kind === 'component' && selected.id === pair.component.id;
                const isHovered = hoveredComponentId === pair.component.id;
                const wireIds = [...(derived.bundleContents.get(pair.bundleA.id) ?? []), ...(derived.bundleContents.get(pair.bundleB.id) ?? [])];
                const signalNames = bundleSignalTooltip(wireIds, doc);
                const strokeColor = isSelected ? theme.color.accent : theme.color.textFaint;
                return (
                  <g
                    key={pair.component.id}
                    onMouseEnter={() => onHoverComponent?.(pair.component.id)}
                    onMouseLeave={() => onHoverComponent?.(null)}
                  >
                    <path d={pathD} fill="none" stroke="transparent" strokeWidth={14} style={{ cursor: 'default' }}>
                      <title>{`${pair.component.refdes} inline on ${pair.bundleA.refdes}/${pair.bundleB.refdes} — ${signalNames}`}</title>
                    </path>
                    <path d={pathD} fill="none" stroke={strokeColor} strokeWidth={isSelected ? 3 : 2} strokeLinecap="round" style={{ pointerEvents: 'none' }} />
                    {isHovered && !isSelected && (
                      <circle cx={glyphCenter.x} cy={glyphCenter.y} r={HOVER_R} fill="none" stroke={theme.color.warning} strokeWidth={2} strokeDasharray="4 3" style={{ pointerEvents: 'none' }} />
                    )}
                    <g
                      onMouseDown={(e) => { e.stopPropagation(); setSelected({ kind: 'component', id: pair.component.id }); setDraggingInline({ componentId: pair.component.id }); }}
                      style={{ cursor: 'grab' }}
                    >
                      <circle cx={glyphCenter.x} cy={glyphCenter.y} r={HOVER_R * 0.6} fill="transparent" />
                      <polygon points={glyph.bodyPoly} fill={theme.color.nodeFill} stroke={strokeColor} strokeWidth={isSelected ? 2 : 1} />
                      {glyph.decorations.map((d, i) =>
                        d.kind === 'line' ? (
                          <line key={i} x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2} stroke={strokeColor} strokeWidth={isSelected ? 2 : 1.3} />
                        ) : (
                          <circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill={d.filled ? strokeColor : theme.color.nodeFill} stroke={strokeColor} strokeWidth={isSelected ? 2 : 1} />
                        ),
                      )}
                    </g>
                    <text x={glyphCenter.x} y={glyphCenter.y - 14} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={theme.color.textStrong} style={{ pointerEvents: 'none' }}>
                      {pair.component.refdes}
                    </text>
                  </g>
                );
              })}

              {placed.map((c) => {
                if (!c.layoutPosition || inlinePassThroughs.has(c.id)) return null;
                const center = toPx(c.layoutPosition);
                const isSelected = selected?.kind === 'component' && selected.id === c.id;
                const isPendingFrom = connect.sourcePort === c.id;
                const isHovered = hoveredComponentId === c.id;
                /* While a connect is armed every other node is either a
                 * legal drop or it isn't, and saying so up front is the
                 * whole difference between "click around and find out" and
                 * a routing UI. Uses the same predicate that gates the
                 * commit, so the highlight can never promise a connection
                 * the gesture would then refuse. */
                const isConnectTarget = connect.isValidTarget(c.id);
                const isConnectReject = connect.active && !isConnectTarget && !isPendingFrom;
                const isBranch = c.type === 'branchPoint';
                const glyph = isBranch ? undefined : nodeGlyphs.get(c.id);
                // Phase 2b rotation label: shown while selected (immediate
                // feedback for R presses — including 0°) and whenever a
                // non-zero rotation is stored, so a rotated connector stays
                // visibly rotated after deselection. Connectors only:
                // rotation is a connector feature (rotateConnector refuses
                // every other type), and a bare "0°" appearing on any
                // selected splice/terminal/cable/resistor was just clutter.
                const rotationDeg = normalizeRotationDegrees(c.rotation ?? 0);
                const showRotation = c.type === 'connector' && (isSelected || (c.rotation !== undefined && rotationDeg !== 0));
                // The little connect-handle used to sit at full opacity on
                // every node all the time — with more than a few parts
                // placed that read as a field of stray circles. Dim it
                // until it's actually relevant (hovered/selected, or a
                // bundle-connect is in progress and every handle is a
                // valid target).
                const handleActive = isHovered || isSelected || isPendingFrom || connect.active;
                return (
                  <g
                    key={c.id}
                    onMouseEnter={() => onHoverComponent?.(c.id)}
                    onMouseLeave={() => onHoverComponent?.(null)}
                    onMouseUp={(e) => onNodeMouseUp(c, e)}
                    opacity={isConnectReject ? 0.4 : 1}
                  >
                    {/* Drop-target ring: solid accent for a node this bundle
                        can land on. Drawn outside the hit target so it never
                        eats the pointer. */}
                    {isConnectTarget && (
                      <circle
                        cx={center.x} cy={center.y} r={isBranch ? BRANCH_R + 7 : HOVER_R + 2}
                        fill={theme.color.accentSoft} stroke={theme.color.accent} strokeWidth={2}
                        style={{ pointerEvents: 'none' }}
                      />
                    )}
                    {isHovered && !isSelected && (
                      <circle
                        cx={center.x} cy={center.y} r={isBranch ? BRANCH_R + 5 : HOVER_R}
                        fill="none" stroke={theme.color.warning} strokeWidth={2} strokeDasharray="4 3"
                        style={{ pointerEvents: 'none' }}
                      />
                    )}
                    {/* Auto-optimize confirmation (Phase 2b): a brief accent
                        ring on the connector whose rotation was optimized. */}
                    {flashId === c.id && (
                      <circle
                        cx={center.x} cy={center.y} r={HOVER_R + 3}
                        fill="none" stroke={theme.color.accent} strokeWidth={2.5}
                        style={{ pointerEvents: 'none' }}
                      />
                    )}
                    {isBranch ? (
                      // Branch points are pure layout topology (spec §4.2),
                      // not a physical part — a plain junction dot reads
                      // much cleaner than a connector glyph with a mating
                      // face and cable stub.
                      <circle
                        cx={center.x} cy={center.y} r={BRANCH_R}
                        fill={theme.color.textFaint}
                        stroke={isPendingFrom || isSelected ? theme.color.accent : theme.color.nodeBorder}
                        strokeWidth={isSelected || isPendingFrom ? 2.5 : 1.5}
                        onMouseDown={(e) => onNodeMouseDown(c, e)}
                        style={{ cursor: 'grab', filter: isSelected ? theme.shadow.selected : undefined }}
                      >
                        <title>{`${c.refdes} — ${wireTooltip(wiresThroughComponent(c.id), doc)}`}</title>
                      </circle>
                    ) : glyph ? (
                      <>
                        {/* Fat invisible hit-target, unrotated, so grabbing
                           the node works the same regardless of which way
                           its glyph is currently facing. */}
                        <circle
                          cx={center.x} cy={center.y} r={HOVER_R} fill="transparent"
                          onMouseDown={(e) => onNodeMouseDown(c, e)}
                          style={{ cursor: 'grab', filter: isSelected ? theme.shadow.selected : undefined }}
                        >
                          <title>{`${c.refdes} — ${wireTooltip(wiresThroughComponent(c.id), doc)}`}</title>
                        </circle>
                        {/* Cable stub — the back of the glyph, auto-facing
                           whatever it's bundled to (see nodeAngles). */}
                        <line
                          x1={glyph.stubStart.x} y1={glyph.stubStart.y} x2={glyph.stubEnd.x} y2={glyph.stubEnd.y}
                          stroke={theme.color.textFaint} strokeWidth={2.5} strokeLinecap="round"
                          style={{ pointerEvents: 'none' }}
                        />
                        {/* Tapered nose — the mating face, opposite the cable stub. */}
                        <polygon
                          points={glyph.nosePoly}
                          fill={theme.color.nodeFill}
                          stroke={isPendingFrom || isSelected ? theme.color.accent : theme.color.nodeBorder}
                          strokeWidth={isSelected || isPendingFrom ? 2 : 1}
                          style={{ pointerEvents: 'none' }}
                        />
                        {/* Body */}
                        <polygon
                          points={glyph.bodyPoly}
                          fill={theme.color.nodeFill}
                          stroke={isPendingFrom || isSelected ? theme.color.accent : theme.color.nodeBorder}
                          strokeWidth={isSelected || isPendingFrom ? 2 : 1}
                          style={{ pointerEvents: 'none' }}
                        />
                        {/* Type-specific decorations — splice's junction
                           dot, terminal's ring, resistor/diode's bands (see
                           physicalGlyph's per-type builders). */}
                        {glyph.decorations.map((d, i) =>
                          d.kind === 'circle' ? (
                            <circle
                              key={i} cx={d.cx} cy={d.cy} r={d.r}
                              fill={d.filled ? (isPendingFrom || isSelected ? theme.color.accent : theme.color.nodeBorder) : theme.color.nodeFill}
                              stroke={isPendingFrom || isSelected ? theme.color.accent : theme.color.nodeBorder}
                              strokeWidth={isSelected || isPendingFrom ? 2 : 1}
                              style={{ pointerEvents: 'none' }}
                            />
                          ) : (
                            <line
                              key={i} x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2}
                              stroke={isPendingFrom || isSelected ? theme.color.accent : theme.color.nodeBorder}
                              strokeWidth={isSelected || isPendingFrom ? 2 : 1.3}
                              style={{ pointerEvents: 'none' }}
                            />
                          ),
                        )}
                      </>
                    ) : null}
                    {!isBranch && (
                      <>
                        <foreignObject x={center.x - 6.5} y={center.y - HOVER_R - 16} width={13} height={13} style={{ pointerEvents: 'none', color: theme.color.textMuted }}>
                          <ComponentIcon type={c.type} size={11} {...connectorAppearance(c, doc)} />
                        </foreignObject>
                        <text x={center.x} y={center.y + HOVER_R + 8} textAnchor="middle" fontSize={11.5} fontWeight={600} fill={theme.color.textStrong} style={{ pointerEvents: 'none' }}>
                          {c.refdes}
                        </text>
                        {showRotation && (
                          <text
                            x={center.x} y={center.y - HOVER_R - 20} textAnchor="middle" fontSize={10} fontWeight={600}
                            fill={isSelected ? theme.color.accent : theme.color.textMuted}
                            style={{ pointerEvents: 'none' }}
                          >
                            {`${rotationDeg}°`}
                          </text>
                        )}
                      </>
                    )}
                    {isBranch && (
                      <text x={center.x + BRANCH_R + 6} y={center.y + 4} fontSize={10.5} fontWeight={600} fill={theme.color.textMuted} style={{ pointerEvents: 'none' }}>
                        {c.refdes}
                      </text>
                    )}
                    {glyph && tool === 'select' && (
                      /* The bundle-source handle. Two circles: a visible 4px
                       * dot, and an invisible 11px one over it that takes the
                       * pointer. The old handle was a 4px hit target — small
                       * enough that missing it and dragging the node instead
                       * was the common outcome — and it only accepted a
                       * click, so the drag people naturally tried did
                       * nothing. It now feeds the same gesture the route tool
                       * does, so drag-to-connect and click-then-click both
                       * work from here without leaving the select tool. */
                      <g style={{ cursor: 'crosshair' }}
                         onMouseDown={(e) => { e.stopPropagation(); setNotice(null); connect.press(c.id, center, e.clientX, e.clientY); }}
                         onMouseUp={(e) => { if (connect.active) { e.stopPropagation(); connect.release(c.id); } }}>
                        <circle cx={glyph.stubEnd.x} cy={glyph.stubEnd.y} r={11} fill="transparent" />
                        <circle
                          cx={glyph.stubEnd.x} cy={glyph.stubEnd.y} r={4} fill={theme.color.nodeFill} stroke={theme.color.accent} strokeWidth={1.3}
                          opacity={handleActive ? 1 : 0.4}
                          style={{ pointerEvents: 'none', transition: 'opacity 100ms ease' }}
                        />
                        <title>Drag to another component to bundle them — or click here, then click the target.</title>
                      </g>
                    )}
                  </g>
                );
              })}
              {/* Preview line for a bundle being drawn. Drawn last so it sits
                  above every node, dashed and non-interactive so it reads as
                  "not yet real" and never steals the drop target's pointer.
                  A straight segment is the honest preview here: a new bundle
                  has no waypoints, so a straight line IS what committing
                  produces. */}
              {connect.preview && (
                <g style={{ pointerEvents: 'none' }}>
                  <line
                    x1={toPx(connect.preview.from).x} y1={toPx(connect.preview.from).y}
                    x2={connect.preview.to.x * PX_PER_MM} y2={connect.preview.to.y * PX_PER_MM}
                    stroke={theme.color.accent} strokeWidth={2} strokeDasharray="6 4" strokeLinecap="round"
                    opacity={0.85}
                  />
                  <circle
                    cx={connect.preview.to.x * PX_PER_MM} cy={connect.preview.to.y * PX_PER_MM} r={3.5}
                    fill={theme.color.accent}
                  />
                </g>
              )}
            </svg>

            {selectedComponent && selectedComponent.layoutPosition && (
              <LayoutComponentCard
                component={selectedComponent}
                doc={doc}
                store={store}
                scale={scale}
                panX={panX}
                panY={panY}
                rotationDeg={selectedComponent.type === 'connector' ? connectorRotation.getRotation(selectedComponent.id) : undefined}
                onUnplace={unplaceComponent}
              />
            )}

            {selectedBundle && (
              <BundleInspector
                bundle={selectedBundle}
                scene={selectedScene}
                wires={selectedBundleWires}
                scale={scale}
                panX={panX}
                panY={panY}
                canExtractWire={(wireId) => extractableWires.get(wireId) === true}
                onSetLength={(mm) => setBundleLength(selectedBundle.id, mm)}
                onSetSegmentLength={(i, mm) => setSegmentLength(selectedBundle.id, i, mm)}
                onSetColor={(color) => setBundleColor(selectedBundle.id, color)}
                onSetLabel={(label) => setBundleLabel(selectedBundle.id, label)}
                onExtractWire={(wireId) => {
                  const done = bundleRouting.extractWire(wireId, selectedBundle.id);
                  if (!done) {
                    const wire = doc.wires[wireId];
                    setNotice(`${wire?.refdes ?? wireId} can't be extracted from ${selectedBundle.refdes} — it has no route that avoids the bundle.`);
                  }
                }}
                onDelete={() => deleteBundle(selectedBundle.id)}
                onClearRoutingNodes={() => store.transact('Clear routing nodes', (draft) => { const b = draft.bundles[selectedBundle.id]; if (b) b.waypoints = []; })}
                onClose={() => setSelected(null)}
              />
            )}
          </div>
        </div>

        {/* Routing panel. Was a flat "Wire lengths" list in document order,
            which buried the only rows that need action — an unrouted wire and
            a fully-measured one looked alike and sorted together. Now the
            summary leads, unrouted wires come first under their own heading,
            and the rest follow. Same data, ordered by what the user has to do
            about it. */}
        <aside style={s.sidebar}>
          <h3 style={s.sidebarTitle}>Routing</h3>
          {routeSummary.total === 0 ? (
            <p style={s.mutedNote}>No wires yet.</p>
          ) : (
            <>
              <dl style={s.summaryGrid}>
                <dt style={s.summaryKey}>Routed</dt>
                <dd style={s.summaryVal}>{routeSummary.routed} / {routeSummary.total}</dd>
                <dt style={s.summaryKey}>Measured</dt>
                <dd style={s.summaryVal} title="Every bundle on the path has an authored length, so this is not an estimate">
                  {routeSummary.exact} / {routeSummary.total}
                </dd>
                <dt style={s.summaryKey}>Total length</dt>
                <dd style={s.summaryVal}>
                  {routeSummary.totalUm > 0 ? `${(routeSummary.totalUm / 1000).toFixed(0)} mm` : '—'}
                </dd>
              </dl>

              {routeSummary.unroutedWires.length > 0 && (
                <div ref={unroutedRef}>
                  <h4 style={s.sidebarGroupTitle}>
                    Needs a route ({routeSummary.unroutedWires.length})
                  </h4>
                  <p style={s.mutedNote}>
                    No path through the bundle graph. Bundle the endpoints — or a chain of
                    components between them — with the Route tool.
                  </p>
                  <div style={s.wireList}>
                    {routeSummary.unroutedWires.map(({ wire, status }) => (
                      <div key={wire.id} style={s.wireRow}>
                        <span style={s.wireRefdes}>{wire.refdes}</span>
                        <span style={s.statusChip(status)}>{status}</span>
                        <span style={s.wireLenVal}>—</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {routeSummary.routedWires.length > 0 && (
                <>
                  <h4 style={s.sidebarGroupTitle}>
                    Routed ({routeSummary.routedWires.length})
                  </h4>
                  <div style={s.wireList}>
                    {routeSummary.routedWires.map(({ wire, status, value }) => (
                      <div key={wire.id} style={s.wireRow}>
                        <span style={s.wireRefdes}>{wire.refdes}</span>
                        <span style={s.statusChip(status)}>{status}</span>
                        <span style={s.wireLenVal}>{value > 0 ? `${(value / 1000).toFixed(0)} mm` : '—'}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

export interface LayoutComponentCardProps {
  component: Component;
  doc: HarnessDocument;
  store: HarnessStore;
  scale?: number;
  panX?: number;
  panY?: number;
  rotationDeg?: number;
  onUnplace?: (componentId: string) => void;
}

export function LayoutComponentCard({
  component,
  doc,
  store,
  scale = 1,
  panX = 0,
  panY = 0,
  rotationDeg,
  onUnplace,
}: LayoutComponentCardProps) {
  if (!component.layoutPosition) return null;
  const pt = toPx(component.layoutPosition);
  const { left, top } = layoutComponentCardPosition(pt, scale, panX, panY, HOVER_R, 22);
  const rotation = rotationDeg ?? (component.rotation !== undefined ? normalizeRotationDegrees(component.rotation) : 0);

  return (
    <div style={{ position: 'absolute', left, top, zIndex: 2 }}>
      <div style={s.card}>
        <div style={s.cardHeader}>
          <ComponentIcon type={component.type} {...connectorAppearance(component, doc)} />
          <span style={s.cardTitle}>{component.refdes}</span>
        </div>
        <div style={s.cardBody}>
          <div style={s.kvRow}><span style={s.kvKey}>x (mm)</span><span style={s.kvVal}>{component.layoutPosition.x.toFixed(1)}</span></div>
          <div style={s.kvRow}><span style={s.kvKey}>y (mm)</span><span style={s.kvVal}>{component.layoutPosition.y.toFixed(1)}</span></div>
          {component.type === 'connector' && (
            <div style={s.kvRow}>
              <span style={s.kvKey}>Rotation</span>
              <span style={s.kvVal}>{rotation}°</span>
            </div>
          )}
          {shieldedGroupsAt(store, component.id).map((g) => (
            <div key={g.id} style={s.shieldSection}>
              <div style={s.sectionLabel}>{g.refdes ? `Shield ${g.refdes} termination` : 'Shield termination'}</div>
              <label style={s.fieldLabel}>Style</label>
              <select
                style={s.input} value={g.shield?.termination?.style ?? ''}
                onChange={(e) => {
                  const v = e.target.value as ShieldTermination['style'];
                  updateShieldTermination(store, g.id, (t) => { t.style = v || undefined; });
                }}
              >
                <option value="">(unspecified)</option>
                {SHIELD_TERMINATION_STYLES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <label style={s.fieldLabel}>Note</label>
              <input
                style={s.input} value={g.shield?.termination?.note ?? ''}
                placeholder="e.g. terminates at backshell, 360° clamp"
                onChange={(e) => { const v = e.target.value; updateShieldTermination(store, g.id, (t) => { t.note = v || undefined; }); }}
              />
            </div>
          ))}
          {onUnplace && (
            <button style={s.dangerBtn} onClick={() => onUnplace(component.id)}>Remove from layout</button>
          )}
        </div>
      </div>
    </div>
  );
}

export function BundleInspector({
  bundle, scene, wires, canExtractWire,
  onSetLength, onSetSegmentLength, onSetColor, onSetLabel, onExtractWire,
  onDelete, onClearRoutingNodes, onClose,
  scale = 1, panX = 0, panY = 0,
}: {
  bundle: { id: string; refdes: string; length?: number; waypoints?: Point[]; segmentLengths?: (number | undefined)[]; color?: string; label?: string };
  /** Scene data (wire count, gauge range, derived diameter) — optional so the
   * inspector still renders for a bundle the scene builder didn't emit. */
  scene?: SceneBundle;
  wires: { id: string; refdes: string }[];
  canExtractWire: (wireId: string) => boolean;
  onSetLength: (mm: number | undefined) => void;
  onSetSegmentLength: (index: number, mm: number | undefined) => void;
  onSetColor: (color: string | undefined) => void;
  onSetLabel: (label: string | undefined) => void;
  onExtractWire: (wireId: string) => void;
  onDelete: () => void;
  onClearRoutingNodes: () => void;
  onClose: () => void;
  scale?: number;
  panX?: number;
  panY?: number;
}) {
  const nodeCount = bundle.waypoints?.length ?? 0;
  const segmentCount = nodeCount + 1;
  const anchor = scene?.labelPosition ?? { x: 20, y: 20 };
  const { x: screenX, y: screenY } = canvasToScreen(anchor.x, anchor.y, scale, panX, panY);
  const top = screenY + 14;
  return (
    <div style={{ position: 'absolute', left: screenX, top, zIndex: 3 }}>
      <div style={s.card}>
        <div style={s.cardHeader}>
          <span style={s.cardTitle}>{bundle.refdes}</span>
          <button style={s.closeBtn} onClick={onClose} title="Close">×</button>
        </div>
        <div style={s.cardBody}>
          {/* Phase 2a bundle properties: outline color + free label. The
              color input can only express the default by picking it, so a
              "reset" link appears once a custom color is authored. */}
          <div style={s.kvRow}>
            <span style={s.kvKey}>Outline color</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="color" value={bundle.color ?? DEFAULT_BUNDLE_COLOR}
                onChange={(e) => onSetColor(e.target.value)}
                style={{ width: 28, height: 22, padding: 0, border: `1px solid ${theme.color.border}`, borderRadius: 4, background: 'transparent', cursor: 'pointer' }}
                title="Bundle outline color"
              />
              {bundle.color !== undefined && (
                <button style={s.linkBtn} onClick={() => onSetColor(undefined)} title="Back to the default outline color">reset</button>
              )}
            </span>
          </div>
          <label style={s.fieldLabel}>Label</label>
          <input
            style={s.input} value={bundle.label ?? ''} placeholder={bundle.refdes}
            onChange={(e) => onSetLabel(e.target.value)}
          />
          {/* Derived bundle facts (read-only): membership, gauge range and
              diameter all come from the derive pipeline, never edited here. */}
          {scene && (
            <div style={s.kvRow}>
              <span style={s.kvKey}>Wires</span>
              <span style={s.kvVal}>
                {scene.wireCount}{scene.gaugeLabel ? ` · ${scene.gaugeLabel}` : ''}{scene.diameterMm > 0 ? ` · Ø ${Number(scene.diameterMm.toPrecision(2))} mm` : ''}
              </span>
            </div>
          )}
          <label style={s.fieldLabel}>Authored length (mm)</label>
          <input
            style={s.input} type="number" step="1" placeholder="using geometric estimate"
            value={bundle.length ?? ''}
            onChange={(e) => { const v = e.target.value; onSetLength(v === '' ? undefined : Number(v)); }}
          />
          {nodeCount > 0 && (
            <div style={s.kvRow}>
              <span style={s.kvKey}>Routing nodes</span>
              <button style={s.linkBtn} onClick={onClearRoutingNodes}>{nodeCount} — clear</button>
            </div>
          )}
          {/* Per-segment recorded lengths (Connor: "dimensions between each
             routing point should be able to be recorded, every single
             point, but the layout can be assumed to be not to scale") —
             only worth showing once there's more than one segment; a
             bundle with no routing nodes has exactly one segment, which is
             just the whole-bundle field above. */}
          {segmentCount > 1 && (
            <>
              <label style={s.fieldLabel}>Segment lengths (mm)</label>
              <div style={s.segmentList}>
                {Array.from({ length: segmentCount }, (_, i) => (
                  <div key={i} style={s.segmentRow}>
                    <span style={s.segmentTag}>{i === 0 ? 'start' : i} → {i === segmentCount - 1 ? 'end' : i + 1}</span>
                    <input
                      style={s.segmentInput} type="number" step="1" placeholder="—"
                      value={bundle.segmentLengths?.[i] ?? ''}
                      onChange={(e) => { const v = e.target.value; onSetSegmentLength(i, v === '' ? undefined : Number(v)); }}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
          {/* Member wires + extraction (Phase 2a): extracting gives the wire a
              frozen route around the bundle. Disabled exactly when the bundle
              is the wire's only way across — the tooltip says why. */}
          {wires.length > 0 && (
            <>
              <label style={s.fieldLabel}>Wires in this bundle</label>
              <div style={s.segmentList}>
                {wires.map((w) => {
                  const canExtract = canExtractWire(w.id);
                  return (
                    <div key={w.id} style={s.segmentRow}>
                      <span style={s.segmentTag}>{w.refdes}</span>
                      <button
                        style={{ ...s.linkBtn, ...(canExtract ? {} : s.toolbarBtnDisabled) }}
                        disabled={!canExtract}
                        onClick={() => onExtractWire(w.id)}
                        title={canExtract ? `Route ${w.refdes} around this bundle` : `${w.refdes} has no route that avoids this bundle`}
                      >
                        Extract
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <button style={s.dangerBtn} onClick={onDelete}>Delete bundle</button>
        </div>
      </div>
    </div>
  );
}

const s = {
  /* `flex: 1, minWidth: 0` matters as much as the height here. App.tsx renders
     every pane inside a flex ROW; without a flex basis this root sized itself
     to its CONTENT, so any document wider than the window pushed the pane past
     the window edge — taking the sidebar off-screen and leaving fit-to-view
     measuring a container far wider than what was actually visible. minWidth:0
     is the half that lets a flex item shrink below its content width at all. */
  root: { display: 'flex', flexDirection: 'column', height: '100%', flex: 1, minWidth: 0, background: theme.color.canvasBg },
  toolbar: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: `1px solid ${theme.color.border}`, background: theme.color.surface, flexWrap: 'wrap' },
  toolbarLabel: { fontSize: 11, fontWeight: 600, color: theme.color.textFaint, textTransform: 'uppercase', letterSpacing: 0.4, marginRight: 4 },
  toolbarBtn: { padding: '6px 11px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control, background: theme.color.surface, color: theme.color.textStrong, cursor: 'pointer', fontSize: 12.5, fontWeight: 500 },
  /** Spread over toolbarBtn for the inert state — "Fit selection" is inert
   * until something is selected. */
  toolbarBtnDisabled: { cursor: 'default', opacity: 0.45 },
  /* Tool switcher: one segmented control, so the two verbs read as a choice
     between each other rather than as two unrelated buttons. */
  toolGroup: { display: 'inline-flex', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control, overflow: 'hidden' },
  toolBtn: { padding: '6px 13px', border: 'none', background: theme.color.surface, color: theme.color.textMuted, cursor: 'pointer', fontSize: 12.5, fontWeight: 500 },
  toolBtnActive: { background: theme.color.accent, color: '#fff', fontWeight: 600 },
  toolbarDivider: { width: 1, alignSelf: 'stretch', margin: '2px 2px', background: theme.color.border },
  /* Route-health chip. Neutral when everything routes, warning-toned the
     moment it doesn't — the one number in this pane worth interrupting for. */
  routeChip: { padding: '4px 10px', border: `1px solid ${theme.color.border}`, borderRadius: 999, background: theme.color.surface, color: theme.color.textMuted, cursor: 'pointer', fontSize: 11.5, fontWeight: 600 },
  routeChipWarn: { borderColor: theme.color.warning, background: theme.color.warningSoft, color: theme.color.textStrong },
  unplacedGroup: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  unplacedLabel: { fontSize: 11.5, color: theme.color.textFaint, fontWeight: 500 },
  unplacedChip: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', border: `1px dashed ${theme.color.border}`, borderRadius: 999, background: 'transparent', color: theme.color.textMuted, cursor: 'pointer', fontSize: 11.5 },
  hint: { color: theme.color.accent, fontSize: 12, fontWeight: 500, marginLeft: 6 },
  hintMuted: { color: theme.color.textFaint, fontSize: 11.5, marginLeft: 6 },

  body: { flex: 1, display: 'flex', minHeight: 0 },
  /* userSelect none: every gesture here is a drag over an SVG that contains
     real text (bundle labels, refdes, cavity names), so without it a drag
     paints the canvas with blue text selection and leaves it there. */
  canvasScroll: { flex: 1, minWidth: 0, overflow: 'auto', cursor: 'grab', userSelect: 'none' },
  svg: { display: 'block' },

  sidebar: { width: 220, borderLeft: `1px solid ${theme.color.border}`, background: theme.color.surface, padding: 14, overflow: 'auto', flexShrink: 0 },
  sidebarTitle: { margin: '0 0 10px 0', fontSize: 12.5, fontWeight: 600, color: theme.color.textStrong },
  mutedNote: { color: theme.color.textMuted, fontSize: 12.5, margin: 0 },
  sidebarGroupTitle: { margin: '16px 0 6px 0', fontSize: 11, fontWeight: 700, color: theme.color.textFaint, textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryGrid: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', margin: '0 0 4px 0', alignItems: 'baseline' },
  summaryKey: { fontSize: 11.5, color: theme.color.textFaint },
  summaryVal: { fontSize: 12.5, fontWeight: 600, color: theme.color.textStrong, margin: 0, textAlign: 'right' },
  wireList: { display: 'flex', flexDirection: 'column', gap: 6 },
  wireRow: { display: 'flex', flexDirection: 'column', gap: 3, paddingBottom: 6, borderBottom: `1px solid ${theme.color.border}` },
  wireRefdes: { fontSize: 12, fontWeight: 600, color: theme.color.textStrong },
  wireLenVal: { fontSize: 11.5, color: theme.color.textFaint },
  statusChip: (status: string) => ({
    display: 'inline-block', alignSelf: 'flex-start', fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 999, textTransform: 'capitalize' as const,
    color: status === 'exact' ? theme.color.info : status === 'noRoute' || status === 'unplaced' ? theme.color.danger : theme.color.warning,
    background: status === 'exact' ? theme.color.infoSoft : status === 'noRoute' || status === 'unplaced' ? theme.color.dangerSoft : theme.color.warningSoft,
  }),

  card: { width: 220, background: theme.color.surface, border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.panel, boxShadow: '0 8px 24px rgba(16,24,40,0.12), 0 1px 3px rgba(16,24,40,0.08)', overflow: 'hidden' },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${theme.color.border}`, color: theme.color.textMuted },
  cardTitle: { fontSize: 13, fontWeight: 600, color: theme.color.textStrong, flex: 1 },
  closeBtn: {
    border: 'none', background: 'transparent', color: theme.color.textFaint, cursor: 'pointer',
    fontSize: 16, lineHeight: 1, padding: '0 2px', flexShrink: 0,
  },
  segmentList: { display: 'flex', flexDirection: 'column', gap: 4 },
  segmentRow: { display: 'flex', alignItems: 'center', gap: 6 },
  segmentTag: { fontSize: 10.5, color: theme.color.textFaint, flex: 1 },
  segmentInput: {
    width: 64, padding: '4px 6px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control,
    fontSize: 11.5, background: theme.color.surface, color: theme.color.textStrong, boxSizing: 'border-box',
  },
  cardBody: { padding: 12, display: 'flex', flexDirection: 'column', gap: 6 },
  kvRow: { display: 'flex', justifyContent: 'space-between', fontSize: 12.5 },
  kvKey: { color: theme.color.textFaint },
  kvVal: { color: theme.color.textStrong, fontWeight: 500 },
  fieldLabel: { fontSize: 11.5, color: theme.color.textFaint, fontWeight: 500 },
  linkBtn: { border: 'none', background: 'transparent', color: theme.color.accent, cursor: 'pointer', fontSize: 12.5, fontWeight: 500, padding: 0 },
  input: { padding: '6px 8px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control, fontSize: 12.5, background: theme.color.surface, color: theme.color.textStrong, boxSizing: 'border-box', width: '100%' },
  sectionLabel: { fontSize: 12, fontWeight: 600, color: theme.color.textStrong, marginTop: 4, marginBottom: 2 },
  shieldSection: { display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 8, borderTop: `1px solid ${theme.color.border}` },
  dangerBtn: { marginTop: 6, padding: '6px 10px', border: `1px solid ${theme.color.dangerBorder}`, borderRadius: theme.radius.control, background: theme.color.dangerSoft, color: theme.color.danger, cursor: 'pointer', fontSize: 12 },
} satisfies Record<string, React.CSSProperties | ((...args: never[]) => React.CSSProperties)>;
