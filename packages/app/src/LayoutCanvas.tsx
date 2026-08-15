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
 * Scope note: this first pass covers placement + bundle authoring, which is
 * what makes automatic routing work end to end. Bundle waypoints (bending a
 * bundle's physical path around obstacles, `Bundle.waypoints`) and a formboard
 * background image are real spec features left for a later pass — the data
 * model already has the field, this UI just draws bundles as straight lines
 * between their two endpoints for now.
 */

import { useCallback, useState } from 'react';
import type { HarnessStore, Component, Point } from '@openharness/core';
import { newInstanceId, computeDerivedModel } from '@openharness/core';
import { theme } from './theme.js';
import { ComponentIcon } from './icons.js';

const PX_PER_MM = 4;
const NODE_W = 76;
const NODE_H = 32;

type Selection = { kind: 'component'; id: string } | { kind: 'bundle'; id: string } | null;

interface Dragging {
  id: string;
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
  const [pendingBundleFrom, setPendingBundleFrom] = useState<string | null>(null);

  const doc = store.doc;
  const derived = computeDerivedModel(doc);

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
      if (!dragging) return;
      const dxPx = e.clientX - dragging.pointerStartX;
      const dyPx = e.clientY - dragging.pointerStartY;
      const dMm = toMm({ x: dxPx, y: dyPx });
      const x = dragging.posStartX + dMm.x;
      const y = dragging.posStartY + dMm.y;
      store.transact('Move component (layout)', (draft) => {
        const c = draft.components[dragging.id];
        if (c) c.layoutPosition = { x, y };
      });
    },
    [dragging, store],
  );
  const onMouseUp = useCallback(() => setDragging(null), []);

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
                <ComponentIcon type={c.type} size={11} /> {c.refdes}
              </button>
            ))}
          </div>
        )}
        {pendingBundleFrom && <span style={s.hint}>Click another component to connect a bundle, or click it again to cancel.</span>}
      </div>

      <div style={s.body}>
        <div style={s.canvasScroll} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
          <div style={{ position: 'relative', width: maxX, height: maxY }}>
            <svg
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
                const from = { x: pa.x + NODE_W / 2, y: pa.y + NODE_H / 2 };
                const to = { x: pt.x + NODE_W / 2, y: pt.y + NODE_H / 2 };
                const isSelected = selected?.kind === 'bundle' && selected.id === b.id;
                return (
                  <g key={b.id}>
                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="transparent" strokeWidth={14}
                      style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setSelected({ kind: 'bundle', id: b.id }); }} />
                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                      stroke={isSelected ? theme.color.accent : theme.color.textFaint}
                      strokeWidth={isSelected ? 3 : 2}
                      strokeDasharray={b.length === undefined ? '5 4' : undefined}
                      style={{ pointerEvents: 'none' }} />
                  </g>
                );
              })}

              {placed.map((c) => {
                const p = toPx(c.layoutPosition!);
                const isSelected = selected?.kind === 'component' && selected.id === c.id;
                const isPendingFrom = pendingBundleFrom === c.id;
                const isHovered = hoveredComponentId === c.id;
                return (
                  <g
                    key={c.id}
                    onMouseEnter={() => onHoverComponent?.(c.id)}
                    onMouseLeave={() => onHoverComponent?.(null)}
                  >
                    {isHovered && !isSelected && (
                      <rect
                        x={p.x - 4} y={p.y - 4} width={NODE_W + 8} height={NODE_H + 8} rx={theme.radius.node + 3}
                        fill="none" stroke={theme.color.warning} strokeWidth={2} strokeDasharray="4 3"
                        style={{ pointerEvents: 'none' }}
                      />
                    )}
                    <rect
                      x={p.x} y={p.y} width={NODE_W} height={NODE_H} rx={theme.radius.node}
                      fill={theme.color.nodeFill}
                      stroke={isPendingFrom ? theme.color.accent : isSelected ? theme.color.accent : theme.color.nodeBorder}
                      strokeWidth={isSelected || isPendingFrom ? 2 : 1}
                      onMouseDown={(e) => onNodeMouseDown(c, e)}
                      style={{ cursor: 'grab', filter: isSelected ? theme.shadow.selected : undefined }}
                    />
                    <foreignObject x={p.x + 5} y={p.y + 4} width={13} height={13} style={{ pointerEvents: 'none', color: theme.color.textMuted }}>
                      <ComponentIcon type={c.type} size={11} />
                    </foreignObject>
                    <text x={p.x + 21} y={p.y + NODE_H / 2 + 4} fontSize={11.5} fontWeight={600} fill={theme.color.textStrong} style={{ pointerEvents: 'none' }}>
                      {c.refdes}
                    </text>
                    <circle
                      cx={p.x + NODE_W} cy={p.y + NODE_H / 2} r={4} fill={theme.color.nodeFill} stroke={theme.color.accent} strokeWidth={1.3}
                      style={{ cursor: 'crosshair' }}
                      onClick={(e) => { e.stopPropagation(); setPendingBundleFrom(pendingBundleFrom === c.id ? null : c.id); }}
                    />
                  </g>
                );
              })}
            </svg>

            {selectedComponent && selectedComponent.layoutPosition && (
              <div style={{ position: 'absolute', left: toPx(selectedComponent.layoutPosition).x, top: toPx(selectedComponent.layoutPosition).y + NODE_H + 8, zIndex: 2 }}>
                <div style={s.card}>
                  <div style={s.cardHeader}>
                    <ComponentIcon type={selectedComponent.type} />
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
              <BundleInspector bundle={selectedBundle} onSetLength={(mm) => setBundleLength(selectedBundle.id, mm)} onDelete={() => deleteBundle(selectedBundle.id)} />
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

function BundleInspector({ bundle, onSetLength, onDelete }: { bundle: { id: string; refdes: string; length?: number }; onSetLength: (mm: number | undefined) => void; onDelete: () => void }) {
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
  input: { padding: '6px 8px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control, fontSize: 12.5, background: theme.color.surface, color: theme.color.textStrong, boxSizing: 'border-box', width: '100%' },
  dangerBtn: { marginTop: 6, padding: '6px 10px', border: `1px solid ${theme.color.dangerBorder}`, borderRadius: theme.radius.control, background: theme.color.dangerSoft, color: theme.color.danger, cursor: 'pointer', fontSize: 12 },
} satisfies Record<string, React.CSSProperties | ((...args: never[]) => React.CSSProperties)>;
