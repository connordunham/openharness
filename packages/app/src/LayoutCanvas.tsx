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
 * this pane's "Wire lengths" sidebar shows the payoff directly.
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
 * CENTER (it used to be a box's top-left corner). The glyph's rotation
 * angle is never stored — it's recomputed every render from the average
 * direction to whatever it's bundled to (`nodeAngles`), so two connectors
 * bundled only to each other automatically end up facing opposite ways
 * (each one's back/cable-stub points at the other, i.e. their angles are
 * literally 180° apart) with no manual "flip" step, and dragging a node
 * updates both ends' orientation live. Branch points keep their old plain
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
import type { HarnessStore, Component, Point, Endpoint, WireGroup, ShieldTermination, Bundle } from '@openharness/core';
import { newInstanceId, computeDerivedModel, endpointComponentId } from '@openharness/core';
import { theme } from './theme.js';
import { ComponentIcon, connectorAppearance } from './icons.js';
import { nextLayoutGrid } from './layoutGrid.js';
import { useCanvasPan } from './canvasPan.js';
import { useCanvasZoom } from './useCanvasZoom.js';
import { SHIELD_TERMINATION_STYLES } from './shieldConstants.js';

const PX_PER_MM = 4;
const BRANCH_R = 7;

// Generic connector-plug glyph geometry (px, local space before rotation —
// see connectorGlyph). Small and generic on purpose (Connor: "small
// generalized connector shapes"), not per-type accurate artwork.
const BODY_HALF_LEN = 12;
const BODY_HALF_W = 8;
const NOSE_LEN = 6;
const NOSE_HALF_W = 5;
const STUB_LEN = 10;
/** Hover/selection ring + hit-target radius — generous enough to cover the
 * glyph at any rotation without having to rotate the hit-target itself. */
const HOVER_R = 24;

type Selection = { kind: 'component'; id: string } | { kind: 'bundle'; id: string } | null;

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

/** Point on a branch point's little circle where a bundle line to
 * `otherCenter`/`aimAt` should visibly terminate — branch points are pure
 * layout topology (spec §4.2), rendered as plain dots, so this is just
 * circle-edge math (no orientation to account for, unlike connectorGlyph). */
function branchOutlinePoint(center: Point, aimAt: Point): Point {
  const dx = aimAt.x - center.x;
  const dy = aimAt.y - center.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return center;
  return { x: center.x + (dx / len) * BRANCH_R, y: center.y + (dy / len) * BRANCH_R };
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
  const hl = BODY_HALF_LEN;
  const hw = BODY_HALF_W;
  const bFT = abs(-hl, -hw);
  const bFB = abs(-hl, hw);
  const bBT = abs(hl, -hw);
  const bBB = abs(hl, hw);
  const nT1 = abs(-hl - NOSE_LEN, -NOSE_HALF_W);
  const nT2 = abs(-hl - NOSE_LEN, NOSE_HALF_W);
  const stubStart = abs(hl, 0);
  const stubEnd = abs(hl + STUB_LEN, 0);
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
  const hl = 11;
  const hw = 6.5;
  const c = 3.5;
  const pts = [
    abs(-hl + c, -hw), abs(hl - c, -hw), abs(hl, -hw + c), abs(hl, hw - c),
    abs(hl - c, hw), abs(-hl + c, hw), abs(-hl, hw - c), abs(-hl, -hw + c),
  ];
  const stubStart = abs(hl, 0);
  const stubEnd = abs(hl + STUB_LEN, 0);
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
  const hl = 8;
  const hw = 3;
  const pts = [abs(-hl, -hw), abs(hl, -hw), abs(hl, hw), abs(-hl, hw)];
  const stubStart = abs(hl, 0);
  const stubEnd = abs(hl + STUB_LEN, 0);
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
  const hl = 7;
  const ringR = 5.5;
  const ringCenter = abs(-hl, 0);
  const leadStart = abs(-hl + ringR, 0);
  const leadEnd = abs(hl, 0);
  const stubStart = abs(hl, 0);
  const stubEnd = abs(hl + STUB_LEN, 0);
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
  const hl = 10;
  const hw = 4;
  const pts = [abs(-hl, -hw), abs(hl, -hw), abs(hl, hw), abs(-hl, hw)];
  const band = (bx: number): GlyphDecoration => {
    const a = abs(bx, -hw);
    const b = abs(bx, hw);
    return { kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  };
  const stubStart = abs(hl, 0);
  const stubEnd = abs(hl + STUB_LEN, 0);
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
  const hl = 10;
  const hw = 4;
  const pts = [abs(-hl, -hw), abs(hl, -hw), abs(hl, hw), abs(-hl, hw)];
  const bandX = reverse ? hl - 2.5 : -hl + 2.5;
  const a = abs(bandX, -hw);
  const b = abs(bandX, hw);
  const stubStart = abs(hl, 0);
  const stubEnd = abs(hl + STUB_LEN, 0);
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
  const half = 7;
  const pts = [abs(-half, -half), abs(half, -half), abs(half, half), abs(-half, half)];
  const stubStart = abs(half, 0);
  const stubEnd = abs(half + STUB_LEN, 0);
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
  const xAttach = xComp.type === 'branchPoint' ? branchOutlinePoint(xCenter, xAimAt) : (nodeGlyphs.get(xComp.id)?.stubEnd ?? xCenter);
  const yAttach = yComp.type === 'branchPoint' ? branchOutlinePoint(yCenter, yAimAt) : (nodeGlyphs.get(yComp.id)?.stubEnd ?? yCenter);
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

/** Point + tangent angle at arc-length fraction `t` (0..1) along a polyline. */
function pointAtFraction(points: Point[], t: number): { point: Point; angle: number } {
  if (points.length === 0) return { point: { x: 0, y: 0 }, angle: 0 };
  if (points.length === 1) return { point: points[0]!, angle: 0 };
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const d = Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
    segLens.push(d);
    total += d;
  }
  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < segLens.length; i++) {
    const len = segLens[i]!;
    if (target <= len || i === segLens.length - 1) {
      const frac = len > 0 ? target / len : 0;
      const a = points[i]!;
      const b = points[i + 1]!;
      return { point: { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac }, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    target -= len;
  }
  return { point: points[points.length - 1]!, angle: 0 };
}

/** Arc-length fraction (0..1) of the point on `points` closest to `p` — the
 * inverse of `pointAtFraction`, used while dragging an inline component to
 * turn a raw cursor position back into a stored `inlineT`. */
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
  const [pendingBundleFrom, setPendingBundleFrom] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Zoom is per-pane and view-only (T04 contract): the state lives in the
  // shared hook, never in the document. useCanvasPan owns the single wheel
  // listener and classifies each event (B3); zoom events land in the hook's
  // onWheelZoom, pan events scroll the container there.
  const { panX, panY, scale, setContentSize, onWheelZoom } = useCanvasZoom(scrollRef);
  const { onBackgroundMouseDown } = useCanvasPan(scrollRef, onWheelZoom);

  const doc = store.doc;
  const derived = computeDerivedModel(doc);

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

  // Auto-orientation (see file header): each connector's facing angle is the
  // average direction, in px space, from its own center to whatever it's
  // bundled to (aimed at the first/last routing waypoint when one exists, so
  // a bent bundle still leaves the glyph pointing the right way). Never
  // stored — recomputed every render, so dragging either end updates both
  // glyphs' orientation live, and two connectors bundled only to each other
  // land exactly 180° apart with no manual flip.
  const nodeAngles = useMemo(() => {
    const centersPx = new Map<string, Point>();
    for (const c of placed) if (c.layoutPosition) centersPx.set(c.id, toPx(c.layoutPosition));
    const angles = new Map<string, number>();
    for (const c of placed) {
      if (c.type === 'branchPoint') continue;
      const center = centersPx.get(c.id);
      if (!center) continue;
      let sx = 0, sy = 0, n = 0;
      for (const b of Object.values(doc.bundles)) {
        const isSource = b.sourceId === c.id;
        const otherId = isSource ? b.targetId : b.targetId === c.id ? b.sourceId : null;
        if (!otherId) continue;
        const otherCenter = centersPx.get(otherId);
        if (!otherCenter) continue;
        const waypointsPx = (b.waypoints ?? []).map(toPx);
        const aimAt = (isSource ? waypointsPx[0] : waypointsPx[waypointsPx.length - 1]) ?? otherCenter;
        const dx = aimAt.x - center.x;
        const dy = aimAt.y - center.y;
        const len = Math.hypot(dx, dy);
        if (len > 0) { sx += dx / len; sy += dy / len; n++; }
      }
      angles.set(c.id, n > 0 ? Math.atan2(sy, sx) : 0);
    }
    return angles;
  }, [placed, doc.bundles]);

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

  const onNodeMouseDown = useCallback(
    (component: Component, e: React.MouseEvent) => {
      e.stopPropagation();
      if (pendingBundleFrom) {
        if (pendingBundleFrom === component.id) { setPendingBundleFrom(null); return; }
        store.transact('Add bundle', (draft) => {
          const id = newInstanceId();
          const n = Object.keys(draft.bundles).length;
          draft.bundles[id] = { id, refdes: `BND${n + 1}`, sourceId: pendingBundleFrom, targetId: component.id, custom: {} };
        });
        setPendingBundleFrom(null);
        return;
      }
      setSelected({ kind: 'component', id: component.id });
      const pos = component.layoutPosition!;
      setDragging({ id: component.id, pointerStartX: e.clientX, pointerStartY: e.clientY, posStartX: pos.x, posStartY: pos.y });
    },
    [pendingBundleFrom, store],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
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
    [dragging, draggingWaypoint, draggingInline, store, inlinePassThroughs, doc, nodeGlyphs, clientToPx],
  );
  const onMouseUp = useCallback(() => { setDragging(null); setDraggingWaypoint(null); setDraggingInline(null); }, []);

  /** Grabbing a bundle's own line (not an existing waypoint handle) inserts
   * a new routing node at the click position, in the correct spot along the
   * path — found by comparing the click to every existing segment
   * (source -> waypoints... -> target) and picking the nearest one. */
  const onBundleMouseDown = useCallback(
    (bundleId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const bundle = doc.bundles[bundleId];
      const a = bundle && doc.components[bundle.sourceId];
      const b = bundle && doc.components[bundle.targetId];
      if (!bundle || !a?.layoutPosition || !b?.layoutPosition) return;
      setSelected({ kind: 'bundle', id: bundleId });
      const clickMm = clientToMm(e.clientX, e.clientY);
      const pts = [a.layoutPosition, ...(bundle.waypoints ?? []), b.layoutPosition];
      let insertAt = 0;
      let bestDist = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const d = distToSegmentSq(clickMm, pts[i]!, pts[i + 1]!);
        if (d < bestDist) { bestDist = d; insertAt = i; }
      }
      store.transact('Add routing node', (draft) => {
        const bd = draft.bundles[bundleId];
        if (!bd) return;
        if (!bd.waypoints) bd.waypoints = [];
        bd.waypoints.splice(insertAt, 0, clickMm);
      });
      setDraggingWaypoint({ bundleId, index: insertAt, pointerStartX: e.clientX, pointerStartY: e.clientY, posStartX: clickMm.x, posStartY: clickMm.y });
    },
    [doc, store, clientToMm],
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

  // Inline pass-through components don't have their own position card — see
  // findInlinePassThroughs' doc comment; their `layoutPosition` field is
  // vestigial while eligible, and "Remove from layout" wouldn't remove
  // anything meaningful (removing from the *line* means deleting one of the
  // two bundles, not clearing an unused x/y).
  const selectedComponent = selected?.kind === 'component' && !inlinePassThroughs.has(selected.id) ? doc.components[selected.id] : undefined;
  const selectedBundle = selected?.kind === 'bundle' ? doc.bundles[selected.id] : undefined;

  return (
    <div style={s.root}>
      <div style={s.toolbar}>
        <span style={s.toolbarLabel}>Layout</span>
        <button style={s.toolbarBtn} onClick={addBranchPoint}>+ Branch point</button>
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
        {pendingBundleFrom && <span style={s.hint}>Click another component to connect a bundle, or click it again to cancel.</span>}
        {!pendingBundleFrom && Object.keys(doc.bundles).length > 0 && (
          <span style={s.hintMuted}>Drag a bundle's line to add a routing node; hover any node to see which wires pass through it.</span>
        )}
      </div>

      <div style={s.body}>
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

              {Object.values(doc.bundles).map((b) => {
                // Skip bundles absorbed into a merged inline pass-through
                // line (rendered separately, below the node loop) —
                // drawing them here too would duplicate the line.
                if (absorbedBundleIds.has(b.id)) return null;
                const a = doc.components[b.sourceId];
                const t = doc.components[b.targetId];
                if (!a?.layoutPosition || !t?.layoutPosition) return null;
                const pa = toPx(a.layoutPosition);
                const pt = toPx(t.layoutPosition);
                const waypointsPx = (b.waypoints ?? []).map(toPx);
                // Ordinary connectors attach at their glyph's cable-stub tip
                // (the fixed point wires leave from, given the glyph's own
                // auto-computed orientation); branch points have no facing
                // and just clip to their little circle, aimed at the
                // first/last bend (or the other end) so the line still
                // points the right direction through waypoints.
                const aAimAt = waypointsPx[0] ?? { x: pt.x, y: pt.y };
                const tAimAt = waypointsPx[waypointsPx.length - 1] ?? { x: pa.x, y: pa.y };
                const from = a.type === 'branchPoint' ? branchOutlinePoint(pa, aAimAt) : (nodeGlyphs.get(a.id)?.stubEnd ?? pa);
                const to = t.type === 'branchPoint' ? branchOutlinePoint(pt, tAimAt) : (nodeGlyphs.get(t.id)?.stubEnd ?? pt);
                const polyPoints = [from, ...waypointsPx, to];
                // Smooth spline instead of a sharp-angled polyline (Connor:
                // "make the layout routing more flowy") — see
                // smoothBundlePath's doc comment.
                const pathD = smoothBundlePath(polyPoints);
                const isSelected = selected?.kind === 'bundle' && selected.id === b.id;
                const signalNames = bundleSignalTooltip(derived.bundleContents.get(b.id) ?? [], doc);
                // Cross-pane highlight: this bundle is directly hovered, or
                // it's on the route of a wire hovered over in Schematic
                // (Connor: "highlight all wires that route through that
                // point" — the same relationship in reverse).
                const isHighlighted = hoveredBundleId === b.id || !!highlightedBundleIds?.has(b.id);
                return (
                  <g key={b.id}>
                    {/* Fat invisible hit-target; grabbing anywhere on it (off
                       an existing routing-node handle) inserts a new bend.
                       Also the source of cross-pane bundle hover. */}
                    <path d={pathD} fill="none" stroke="transparent" strokeWidth={14}
                      style={{ cursor: 'crosshair' }}
                      onMouseDown={(e) => onBundleMouseDown(b.id, e)}
                      onClick={(e) => { e.stopPropagation(); setSelected({ kind: 'bundle', id: b.id }); }}
                      onMouseEnter={() => onHoverBundle?.(b.id)} onMouseLeave={() => onHoverBundle?.(null)}>
                      <title>{`${b.refdes} — ${signalNames}`}</title>
                    </path>
                    {isHighlighted && (
                      <path d={pathD} fill="none" stroke={theme.color.warning}
                        strokeOpacity={0.5} strokeWidth={8} strokeLinecap="round"
                        style={{ pointerEvents: 'none' }} />
                    )}
                    <path d={pathD} fill="none"
                      stroke={isSelected || isHighlighted ? theme.color.accent : theme.color.textFaint}
                      strokeWidth={isSelected || isHighlighted ? 3 : 2}
                      strokeLinecap="round"
                      strokeDasharray={b.length === undefined ? '5 4' : undefined}
                      style={{ pointerEvents: 'none' }} />
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
                  </g>
                );
              })}

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
                const isPendingFrom = pendingBundleFrom === c.id;
                const isHovered = hoveredComponentId === c.id;
                const isBranch = c.type === 'branchPoint';
                const glyph = isBranch ? undefined : nodeGlyphs.get(c.id);
                // The little connect-handle used to sit at full opacity on
                // every node all the time — with more than a few parts
                // placed that read as a field of stray circles. Dim it
                // until it's actually relevant (hovered/selected, or a
                // bundle-connect is in progress and every handle is a
                // valid target).
                const handleActive = isHovered || isSelected || isPendingFrom || !!pendingBundleFrom;
                return (
                  <g
                    key={c.id}
                    onMouseEnter={() => onHoverComponent?.(c.id)}
                    onMouseLeave={() => onHoverComponent?.(null)}
                  >
                    {isHovered && !isSelected && (
                      <circle
                        cx={center.x} cy={center.y} r={isBranch ? BRANCH_R + 5 : HOVER_R}
                        fill="none" stroke={theme.color.warning} strokeWidth={2} strokeDasharray="4 3"
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
                      </>
                    )}
                    {isBranch && (
                      <text x={center.x + BRANCH_R + 6} y={center.y + 4} fontSize={10.5} fontWeight={600} fill={theme.color.textMuted} style={{ pointerEvents: 'none' }}>
                        {c.refdes}
                      </text>
                    )}
                    {glyph && (
                      <circle
                        cx={glyph.stubEnd.x} cy={glyph.stubEnd.y} r={4} fill={theme.color.nodeFill} stroke={theme.color.accent} strokeWidth={1.3}
                        opacity={handleActive ? 1 : 0.4}
                        style={{ cursor: 'crosshair', transition: 'opacity 100ms ease' }}
                        onClick={(e) => { e.stopPropagation(); setPendingBundleFrom(pendingBundleFrom === c.id ? null : c.id); }}
                      >
                        <title>Click to start a bundle from here.</title>
                      </circle>
                    )}
                  </g>
                );
              })}
            </svg>

            {selectedComponent && selectedComponent.layoutPosition && (
              <div style={{ position: 'absolute', left: toPx(selectedComponent.layoutPosition).x - 30, top: toPx(selectedComponent.layoutPosition).y + HOVER_R + 22, zIndex: 2 }}>
                <div style={s.card}>
                  <div style={s.cardHeader}>
                    <ComponentIcon type={selectedComponent.type} {...connectorAppearance(selectedComponent, doc)} />
                    <span style={s.cardTitle}>{selectedComponent.refdes}</span>
                  </div>
                  <div style={s.cardBody}>
                    <div style={s.kvRow}><span style={s.kvKey}>x (mm)</span><span style={s.kvVal}>{selectedComponent.layoutPosition.x.toFixed(1)}</span></div>
                    <div style={s.kvRow}><span style={s.kvKey}>y (mm)</span><span style={s.kvVal}>{selectedComponent.layoutPosition.y.toFixed(1)}</span></div>
                    {shieldedGroupsAt(store, selectedComponent.id).map((g) => (
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
                    <button style={s.dangerBtn} onClick={() => unplaceComponent(selectedComponent.id)}>Remove from layout</button>
                  </div>
                </div>
              </div>
            )}

            {selectedBundle && (
              <BundleInspector
                bundle={selectedBundle}
                onSetLength={(mm) => setBundleLength(selectedBundle.id, mm)}
                onSetSegmentLength={(i, mm) => setSegmentLength(selectedBundle.id, i, mm)}
                onDelete={() => deleteBundle(selectedBundle.id)}
                onClearRoutingNodes={() => store.transact('Clear routing nodes', (draft) => { const b = draft.bundles[selectedBundle.id]; if (b) b.waypoints = []; })}
                onClose={() => setSelected(null)}
              />
            )}
          </div>
        </div>

        <aside style={s.sidebar}>
          <h3 style={s.sidebarTitle}>Wire lengths</h3>
          {Object.keys(doc.wires).length === 0 ? (
            <p style={s.mutedNote}>No wires yet.</p>
          ) : (
            <div style={s.wireList}>
              {Object.values(doc.wires).map((w) => {
                const len = derived.wireLengths.get(w.id);
                return (
                  <div key={w.id} style={s.wireRow}>
                    <span style={s.wireRefdes}>{w.refdes}</span>
                    <span style={s.statusChip(len?.status ?? 'unplaced')}>{len?.status ?? 'unplaced'}</span>
                    <span style={s.wireLenVal}>{len && len.value > 0 ? `${(len.value / 1000).toFixed(0)} mm` : '—'}</span>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function BundleInspector({
  bundle, onSetLength, onSetSegmentLength, onDelete, onClearRoutingNodes, onClose,
}: {
  bundle: { id: string; refdes: string; length?: number; waypoints?: Point[]; segmentLengths?: (number | undefined)[] };
  onSetLength: (mm: number | undefined) => void;
  onSetSegmentLength: (index: number, mm: number | undefined) => void;
  onDelete: () => void;
  onClearRoutingNodes: () => void;
  onClose: () => void;
}) {
  const nodeCount = bundle.waypoints?.length ?? 0;
  const segmentCount = nodeCount + 1;
  return (
    <div style={{ position: 'absolute', left: 20, top: 20, zIndex: 3 }}>
      <div style={s.card}>
        <div style={s.cardHeader}>
          <span style={s.cardTitle}>{bundle.refdes}</span>
          <button style={s.closeBtn} onClick={onClose} title="Close">×</button>
        </div>
        <div style={s.cardBody}>
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
          <button style={s.dangerBtn} onClick={onDelete}>Delete bundle</button>
        </div>
      </div>
    </div>
  );
}

const s = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', background: theme.color.canvasBg },
  toolbar: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: `1px solid ${theme.color.border}`, background: theme.color.surface, flexWrap: 'wrap' },
  toolbarLabel: { fontSize: 11, fontWeight: 600, color: theme.color.textFaint, textTransform: 'uppercase', letterSpacing: 0.4, marginRight: 4 },
  toolbarBtn: { padding: '6px 11px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control, background: theme.color.surface, color: theme.color.textStrong, cursor: 'pointer', fontSize: 12.5, fontWeight: 500 },
  unplacedGroup: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  unplacedLabel: { fontSize: 11.5, color: theme.color.textFaint, fontWeight: 500 },
  unplacedChip: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', border: `1px dashed ${theme.color.border}`, borderRadius: 999, background: 'transparent', color: theme.color.textMuted, cursor: 'pointer', fontSize: 11.5 },
  hint: { color: theme.color.accent, fontSize: 12, fontWeight: 500, marginLeft: 6 },
  hintMuted: { color: theme.color.textFaint, fontSize: 11.5, marginLeft: 6 },

  body: { flex: 1, display: 'flex', minHeight: 0 },
  canvasScroll: { flex: 1, overflow: 'auto', cursor: 'grab' },
  svg: { display: 'block' },

  sidebar: { width: 220, borderLeft: `1px solid ${theme.color.border}`, background: theme.color.surface, padding: 14, overflow: 'auto', flexShrink: 0 },
  sidebarTitle: { margin: '0 0 10px 0', fontSize: 12.5, fontWeight: 600, color: theme.color.textStrong },
  mutedNote: { color: theme.color.textMuted, fontSize: 12.5, margin: 0 },
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
