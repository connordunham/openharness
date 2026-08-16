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
 */

import { useCallback, useRef, useState } from 'react';
import type { HarnessStore, Component, Point } from '@openharness/core';
import { newInstanceId, computeDerivedModel } from '@openharness/core';
import { theme } from './theme.js';
import { ComponentIcon, connectorAppearance } from './icons.js';

const PX_PER_MM = 4;
const NODE_W = 76;
const NODE_H = 32;
const BRANCH_R = 7;

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

/** Point on a node's actual outline where a bundle line to `otherCenter`
 * should visibly terminate (Connor: "the actual routing and connector
 * visuals do[n't] look clean"). Bundle lines used to run from raw node
 * CENTER to raw node CENTER — hidden behind the fill for most of their
 * length, then reappearing wherever that straight line happened to cross
 * the rectangle's boundary, which crossed corners at odd angles for any
 * pair of nodes that weren't roughly on the same row. This clips the line
 * to the real outline instead: a rectangle for ordinary components, a
 * small circle for branch points (rendered as plain topology dots, not
 * boxes — see the placed-node render below), so every bundle visibly
 * plugs into the edge of the part it's leaving/entering. */
function outlinePoint(node: Component, topLeft: Point, otherCenter: Point): Point {
  const cx = topLeft.x + NODE_W / 2;
  const cy = topLeft.y + NODE_H / 2;
  const dx = otherCenter.x - cx;
  const dy = otherCenter.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  if (node.type === 'branchPoint') {
    const len = Math.hypot(dx, dy);
    return { x: cx + (dx / len) * BRANCH_R, y: cy + (dy / len) * BRANCH_R };
  }
  const halfW = NODE_W / 2;
  const halfH = NODE_H / 2;
  const tx = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

function wireTooltip(wireIds: string[], doc: HarnessStore['doc']): string {
  if (wireIds.length === 0) return 'No wires route through this node yet.';
  const names = [...new Set(wireIds)].map((id) => doc.wires[id]?.refdes ?? id).sort();
  return `Wires through this node (${names.length}): ${names.join(', ')}`;
}

function nextLayoutGrid(store: HarnessStore): Point {
  const placed = Object.values(store.doc.components).filter((c) => !!c.layoutPosition).length;
  return { x: 20 + (placed % 5) * 60, y: 20 + Math.floor(placed / 5) * 50 };
}

interface Props {
  store: HarnessStore;
  hoveredComponentId?: string | null;
  onHoverComponent?: (id: string | null) => void;
}

export function LayoutCanvas({ store, hoveredComponentId, onHoverComponent }: Props) {
  const [selected, setSelected] = useState<Selection>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [draggingWaypoint, setDraggingWaypoint] = useState<DraggingWaypoint | null>(null);
  const [pendingBundleFrom, setPendingBundleFrom] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

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

  const placed = Object.values(doc.components).filter((c) => !!c.layoutPosition);
  const unplaced = Object.values(doc.components).filter((c) => !c.layoutPosition && c.type !== 'branchPoint');

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

  const maxX = Math.max(500, ...placed.map((c) => toPx(c.layoutPosition!).x + NODE_W + 120));
  const maxY = Math.max(360, ...placed.map((c) => toPx(c.layoutPosition!).y + NODE_H + 80));

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
        <div style={s.canvasScroll} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
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
                // Clip to each node's real outline (see outlinePoint) rather
                // than raw center-to-center, aiming at the first/last bend
                // (or the other node's center if there are no bends) so the
                // line still points the right direction when routed through
                // waypoints.
                const aAimAt = waypointsPx[0] ?? { x: pt.x + NODE_W / 2, y: pt.y + NODE_H / 2 };
                const tAimAt = waypointsPx[waypointsPx.length - 1] ?? { x: pa.x + NODE_W / 2, y: pa.y + NODE_H / 2 };
                const from = outlinePoint(a, pa, aAimAt);
                const to = outlinePoint(t, pt, tAimAt);
                const polyPoints = [from, ...waypointsPx, to];
                const polyStr = polyPoints.map((p) => `${p.x},${p.y}`).join(' ');
                const isSelected = selected?.kind === 'bundle' && selected.id === b.id;
                const wireNames = wireTooltip(derived.bundleContents.get(b.id) ?? [], doc);
                return (
                  <g key={b.id}>
                    {/* Fat invisible hit-target; grabbing anywhere on it (off
                       an existing routing-node handle) inserts a new bend. */}
                    <polyline points={polyStr} fill="none" stroke="transparent" strokeWidth={14}
                      style={{ cursor: 'crosshair' }}
                      onMouseDown={(e) => onBundleMouseDown(b.id, e)}
                      onClick={(e) => { e.stopPropagation(); setSelected({ kind: 'bundle', id: b.id }); }}>
                      <title>{`${b.refdes} — ${wireNames}`}</title>
                    </polyline>
                    <polyline points={polyStr} fill="none"
                      stroke={isSelected ? theme.color.accent : theme.color.textFaint}
                      strokeWidth={isSelected ? 3 : 2}
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
                const p = toPx(c.layoutPosition!);
                const isSelected = selected?.kind === 'component' && selected.id === c.id;
                const isPendingFrom = pendingBundleFrom === c.id;
                const isHovered = hoveredComponentId === c.id;
                const isBranch = c.type === 'branchPoint';
                const cx = p.x + NODE_W / 2;
                const cy = p.y + NODE_H / 2;
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
                      isBranch ? (
                        <circle
                          cx={cx} cy={cy} r={BRANCH_R + 5}
                          fill="none" stroke={theme.color.warning} strokeWidth={2} strokeDasharray="4 3"
                          style={{ pointerEvents: 'none' }}
                        />
                      ) : (
                        <rect
                          x={p.x - 4} y={p.y - 4} width={NODE_W + 8} height={NODE_H + 8} rx={theme.radius.node + 3}
                          fill="none" stroke={theme.color.warning} strokeWidth={2} strokeDasharray="4 3"
                          style={{ pointerEvents: 'none' }}
                        />
                      )
                    )}
                    {isBranch ? (
                      // Branch points are pure layout topology (spec §4.2),
                      // not a physical part — a plain junction dot reads
                      // much cleaner than a full component box with an
                      // icon and label crammed into it.
                      <circle
                        cx={cx} cy={cy} r={BRANCH_R}
                        fill={theme.color.textFaint}
                        stroke={isPendingFrom || isSelected ? theme.color.accent : theme.color.nodeBorder}
                        strokeWidth={isSelected || isPendingFrom ? 2.5 : 1.5}
                        onMouseDown={(e) => onNodeMouseDown(c, e)}
                        style={{ cursor: 'grab', filter: isSelected ? theme.shadow.selected : undefined }}
                      >
                        <title>{`${c.refdes} — ${wireTooltip(wiresThroughComponent(c.id), doc)}`}</title>
                      </circle>
                    ) : (
                      <rect
                        x={p.x} y={p.y} width={NODE_W} height={NODE_H} rx={theme.radius.node}
                        fill={theme.color.nodeFill}
                        stroke={isPendingFrom ? theme.color.accent : isSelected ? theme.color.accent : theme.color.nodeBorder}
                        strokeWidth={isSelected || isPendingFrom ? 2 : 1}
                        onMouseDown={(e) => onNodeMouseDown(c, e)}
                        style={{ cursor: 'grab', filter: isSelected ? theme.shadow.selected : undefined }}
                      >
                        <title>{`${c.refdes} — ${wireTooltip(wiresThroughComponent(c.id), doc)}`}</title>
                      </rect>
                    )}
                    {!isBranch && (
                      <>
                        <foreignObject x={p.x + 5} y={p.y + 4} width={13} height={13} style={{ pointerEvents: 'none', color: theme.color.textMuted }}>
                          <ComponentIcon type={c.type} size={11} {...connectorAppearance(c, doc)} />
                        </foreignObject>
                        <text x={p.x + 21} y={p.y + NODE_H / 2 + 4} fontSize={11.5} fontWeight={600} fill={theme.color.textStrong} style={{ pointerEvents: 'none' }}>
                          {c.refdes}
                        </text>
                      </>
                    )}
                    {isBranch && (
                      <text x={cx + BRANCH_R + 6} y={cy + 4} fontSize={10.5} fontWeight={600} fill={theme.color.textMuted} style={{ pointerEvents: 'none' }}>
                        {c.refdes}
                      </text>
                    )}
                    <circle
                      cx={p.x + NODE_W} cy={p.y + NODE_H / 2} r={4} fill={theme.color.nodeFill} stroke={theme.color.accent} strokeWidth={1.3}
                      opacity={handleActive ? 1 : 0.4}
                      style={{ cursor: 'crosshair', transition: 'opacity 100ms ease' }}
                      onClick={(e) => { e.stopPropagation(); setPendingBundleFrom(pendingBundleFrom === c.id ? null : c.id); }}
                    >
                      <title>Click to start a bundle from here.</title>
                    </circle>
                  </g>
                );
              })}
            </svg>

            {selectedComponent && selectedComponent.layoutPosition && (
              <div style={{ position: 'absolute', left: toPx(selectedComponent.layoutPosition).x, top: toPx(selectedComponent.layoutPosition).y + NODE_H + 8, zIndex: 2 }}>
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
  canvasScroll: { flex: 1, overflow: 'auto' },
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
