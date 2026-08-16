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

import { useCallback, useMemo, useRef, useState } from 'react';
import type { HarnessStore, Component, Point } from '@openharness/core';
import { newInstanceId, computeDerivedModel } from '@openharness/core';
import { theme } from './theme.js';
import { ComponentIcon, connectorAppearance } from './icons.js';
import { nextLayoutGrid } from './layoutGrid.js';
import { useCanvasPan } from './canvasPan.js';

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

interface ConnectorGlyph {
  bodyPoly: string;
  nosePoly: string;
  /** Where the cable stub line starts (the body's back edge, center). */
  stubStart: Point;
  /** Tip of the cable stub — also where a bundle line attaches, and where
   * the "start a bundle" handle sits, since that's the point wires
   * physically leave this connector from. */
  stubEnd: Point;
}

/** Builds a small generalized connector-plug glyph centered at `center`,
 * rotated by `angle` (radians; 0 = facing right, i.e. cable exits to the
 * east). A tapered "nose" marks the mating face, a short stub marks where
 * the bundle cable leaves the back — see the file header note on
 * auto-orientation for how `angle` itself is derived. Manual trig (rather
 * than an SVG `transform="rotate(...)"`) so the label/icon/handles that key
 * off the same points stay simple to reason about. */
function connectorGlyph(center: Point, angle: number): ConnectorGlyph {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const abs = (lx: number, ly: number): Point => ({ x: center.x + lx * cos - ly * sin, y: center.y + lx * sin + ly * cos });
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
  };
}

function wireTooltip(wireIds: string[], doc: HarnessStore['doc']): string {
  if (wireIds.length === 0) return 'No wires route through this node yet.';
  const names = [...new Set(wireIds)].map((id) => doc.wires[id]?.refdes ?? id).sort();
  return `Wires through this node (${names.length}): ${names.join(', ')}`;
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
  const [pendingBundleFrom, setPendingBundleFrom] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { onBackgroundMouseDown } = useCanvasPan(scrollRef);

  const doc = store.doc;
  const derived = computeDerivedModel(doc);

  /** True mm-space position of a mousedown/click, using the SVG's own
   * bounding rect — needed (unlike the simple delta-drags elsewhere in this
   * file) to figure out *where along a bundle's path* a new routing node
   * should be inserted. */
  const clientToMm = useCallback((clientX: number, clientY: number): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return toMm({ x: clientX - rect.left, y: clientY - rect.top });
  }, []);

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
      glyphs.set(c.id, connectorGlyph(toPx(c.layoutPosition), nodeAngles.get(c.id) ?? 0));
    }
    return glyphs;
  }, [placed, nodeAngles]);

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
        const dxPx = e.clientX - dragging.pointerStartX;
        const dyPx = e.clientY - dragging.pointerStartY;
        const dMm = toMm({ x: dxPx, y: dyPx });
        const x = dragging.posStartX + dMm.x;
        const y = dragging.posStartY + dMm.y;
        store.transact('Move component (layout)', (draft) => {
          const c = draft.components[dragging.id];
          if (c) c.layoutPosition = { x, y };
        });
      } else if (draggingWaypoint) {
        const dxPx = e.clientX - draggingWaypoint.pointerStartX;
        const dyPx = e.clientY - draggingWaypoint.pointerStartY;
        const dMm = toMm({ x: dxPx, y: dyPx });
        const x = draggingWaypoint.posStartX + dMm.x;
        const y = draggingWaypoint.posStartY + dMm.y;
        store.transact('Move routing node', (draft) => {
          const b = draft.bundles[draggingWaypoint.bundleId];
          if (b?.waypoints?.[draggingWaypoint.index]) b.waypoints[draggingWaypoint.index] = { x, y };
        });
      }
    },
    [dragging, draggingWaypoint, store],
  );
  const onMouseUp = useCallback(() => { setDragging(null); setDraggingWaypoint(null); }, []);

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

  const maxX = Math.max(500, ...placed.map((c) => toPx(c.layoutPosition!).x + HOVER_R + 140));
  const maxY = Math.max(360, ...placed.map((c) => toPx(c.layoutPosition!).y + HOVER_R + 100));

  const selectedComponent = selected?.kind === 'component' ? doc.components[selected.id] : undefined;
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
          <div style={{ position: 'relative', width: maxX, height: maxY }}>
            <svg
              ref={svgRef}
              width={maxX} height={maxY} style={s.svg}
              onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
            >
              <defs>
                <pattern id="layout-dot-grid" width={16} height={16} patternUnits="userSpaceOnUse">
                  <circle cx={1} cy={1} r={1} fill={theme.color.gridDot} />
                </pattern>
              </defs>
              <rect x={0} y={0} width={maxX} height={maxY} fill="url(#layout-dot-grid)" />

              {Object.values(doc.bundles).map((b) => {
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
                const polyStr = polyPoints.map((p) => `${p.x},${p.y}`).join(' ');
                const isSelected = selected?.kind === 'bundle' && selected.id === b.id;
                const wireNames = wireTooltip(derived.bundleContents.get(b.id) ?? [], doc);
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
                    <polyline points={polyStr} fill="none" stroke="transparent" strokeWidth={14}
                      style={{ cursor: 'crosshair' }}
                      onMouseDown={(e) => onBundleMouseDown(b.id, e)}
                      onClick={(e) => { e.stopPropagation(); setSelected({ kind: 'bundle', id: b.id }); }}
                      onMouseEnter={() => onHoverBundle?.(b.id)} onMouseLeave={() => onHoverBundle?.(null)}>
                      <title>{`${b.refdes} — ${wireNames}`}</title>
                    </polyline>
                    {isHighlighted && (
                      <polyline points={polyStr} fill="none" stroke={theme.color.warning}
                        strokeOpacity={0.5} strokeWidth={8} strokeLinecap="round"
                        style={{ pointerEvents: 'none' }} />
                    )}
                    <polyline points={polyStr} fill="none"
                      stroke={isSelected || isHighlighted ? theme.color.accent : theme.color.textFaint}
                      strokeWidth={isSelected || isHighlighted ? 3 : 2}
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
                        <title>{`Routing node on ${b.refdes} — ${wireNames}\nDrag to move, right-click to remove.`}</title>
                      </circle>
                    ))}
                  </g>
                );
              })}

              {placed.map((c) => {
                if (!c.layoutPosition) return null;
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
                    <button style={s.dangerBtn} onClick={() => unplaceComponent(selectedComponent.id)}>Remove from layout</button>
                  </div>
                </div>
              </div>
            )}

            {selectedBundle && (
              <BundleInspector
                bundle={selectedBundle}
                onSetLength={(mm) => setBundleLength(selectedBundle.id, mm)}
                onDelete={() => deleteBundle(selectedBundle.id)}
                onClearRoutingNodes={() => store.transact('Clear routing nodes', (draft) => { const b = draft.bundles[selectedBundle.id]; if (b) b.waypoints = []; })}
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
  bundle, onSetLength, onDelete, onClearRoutingNodes,
}: {
  bundle: { id: string; refdes: string; length?: number; waypoints?: Point[] };
  onSetLength: (mm: number | undefined) => void;
  onDelete: () => void;
  onClearRoutingNodes: () => void;
}) {
  const nodeCount = bundle.waypoints?.length ?? 0;
  return (
    <div style={{ position: 'absolute', left: 20, top: 20, zIndex: 3 }}>
      <div style={s.card}>
        <div style={s.cardHeader}>
          <span style={s.cardTitle}>{bundle.refdes}</span>
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
  cardTitle: { fontSize: 13, fontWeight: 600, color: theme.color.textStrong },
  cardBody: { padding: 12, display: 'flex', flexDirection: 'column', gap: 6 },
  kvRow: { display: 'flex', justifyContent: 'space-between', fontSize: 12.5 },
  kvKey: { color: theme.color.textFaint },
  kvVal: { color: theme.color.textStrong, fontWeight: 500 },
  fieldLabel: { fontSize: 11.5, color: theme.color.textFaint, fontWeight: 500 },
  linkBtn: { border: 'none', background: 'transparent', color: theme.color.accent, cursor: 'pointer', fontSize: 12.5, fontWeight: 500, padding: 0 },
  input: { padding: '6px 8px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control, fontSize: 12.5, background: theme.color.surface, color: theme.color.textStrong, boxSizing: 'border-box', width: '100%' },
  dangerBtn: { marginTop: 6, padding: '6px 10px', border: `1px solid ${theme.color.dangerBorder}`, borderRadius: theme.radius.control, background: theme.color.dangerSoft, color: theme.color.danger, cursor: 'pointer', fontSize: 12 },
} satisfies Record<string, React.CSSProperties | ((...args: never[]) => React.CSSProperties)>;
