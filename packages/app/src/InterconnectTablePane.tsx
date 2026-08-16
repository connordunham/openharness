/**
 * Interconnect Table pane (Connor: "the schematic [should be]
 * bidirectionally convertible to an interconnect table... captures where
 * each signal goes, to and from, if directionality is defined").
 *
 * Schematic -> Table: the grid below is a live, derived view of
 * `store.derived.interconnect` (core/derive/interconnect.ts) — draw a wire
 * in Schematic and a row appears here with no extra step, same as the BOM
 * pane already does for parts.
 *
 * Table -> Schematic: every cell that isn't purely computed (direction,
 * impedance-matched) is directly editable and writes straight back to the
 * same Cavity fields the Schematic canvas's own row controls edit — and the
 * "+ Add connection" form at the bottom creates whatever connectors/
 * cavities/wire a brand-new row needs (`interconnectEdit.ts`), auto-placed
 * in both Schematic and Layout, so a table built from scratch here "grows"
 * a real schematic exactly the way Connor asked.
 */

import { useState } from 'react';
import type { HarnessStore, SignalDirection, InterconnectRow } from '@openharness/core';
import { theme } from './theme.js';
import { applyInterconnectRow } from './interconnectEdit.js';

interface Props {
  store: HarnessStore;
  hoveredComponentId?: string | null;
  onHoverComponent?: (id: string | null) => void;
}

const RESOLVED_LABEL: Record<InterconnectRow['resolved'], string> = {
  sourceToTarget: '→',
  targetToSource: '←',
  bidirectional: '↔',
  conflict: '⚠ conflict',
};

function updateEndpointDirection(
  store: HarnessStore, componentId: string | undefined, designation: string | undefined, value: SignalDirection,
) {
  if (!componentId) return;
  store.transact('Edit signal direction', (draft) => {
    const c = draft.components[componentId];
    if (c?.type === 'connector') {
      const cav = designation ? c.cavities.find((cv) => cv.designation === designation) : undefined;
      if (cav) cav.direction = value === 'bidirectional' ? undefined : value;
    } else if (c?.type === 'cable') {
      const all = [...c.cores, ...(c.shield ? [c.shield] : [])];
      const core = designation ? all.find((cr) => cr.designation === designation) : undefined;
      if (core) core.direction = value === 'bidirectional' ? undefined : value;
    }
  });
}

function updateEndpointImpedance(
  store: HarnessStore, componentId: string | undefined, designation: string | undefined, checked: boolean,
) {
  if (!componentId) return;
  store.transact('Edit impedance matched', (draft) => {
    const c = draft.components[componentId];
    if (c?.type === 'connector') {
      const cav = designation ? c.cavities.find((cv) => cv.designation === designation) : undefined;
      if (cav) cav.impedanceMatched = checked || undefined;
    } else if (c?.type === 'cable') {
      const all = [...c.cores, ...(c.shield ? [c.shield] : [])];
      const core = designation ? all.find((cr) => cr.designation === designation) : undefined;
      if (core) core.impedanceMatched = checked || undefined;
    }
  });
}

const EMPTY_ADD_FORM = {
  fromRefdes: '', fromDesignation: '', fromSignal: '',
  toRefdes: '', toDesignation: '', toSignal: '',
};

export function InterconnectTablePane({ store, hoveredComponentId, onHoverComponent }: Props) {
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const rows = store.derived.interconnect;

  const addConnection = () => {
    if (!addForm.fromRefdes.trim() || !addForm.toRefdes.trim()) return;
    store.transact('Add interconnect row', (draft) => {
      applyInterconnectRow(draft, {
        fromComponentRefdes: addForm.fromRefdes,
        fromDesignation: addForm.fromDesignation || undefined,
        fromSignal: addForm.fromSignal || undefined,
        toComponentRefdes: addForm.toRefdes,
        toDesignation: addForm.toDesignation || undefined,
        toSignal: addForm.toSignal || undefined,
      }, Object.keys(draft.wires).length);
    });
    setAddForm(EMPTY_ADD_FORM);
  };

  return (
    <div style={s.root}>
      <div style={s.toolbar}>
        <span style={s.toolbarLabel}>Interconnect Table</span>
        <span style={s.hintMuted}>
          Auto-populated from the Schematic — edit direction/impedance here, or add a brand-new connection below.
        </span>
      </div>
      <div style={s.body}>
        {rows.length === 0 ? (
          <p style={s.mutedNote}>No wires yet — draw some in the Schematic pane, or add a connection below.</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Wire</th>
                <th style={s.th}>From</th>
                <th style={s.th}>Signal</th>
                <th style={s.th}>Dir</th>
                <th style={s.th}></th>
                <th style={s.th}>To</th>
                <th style={s.th}>Signal</th>
                <th style={s.th}>Dir</th>
                <th style={s.th}>Impedance matched</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.wireId}
                  style={s.tr(hoveredComponentId === r.fromComponentId || hoveredComponentId === r.toComponentId)}
                  onMouseEnter={() => onHoverComponent?.(r.fromComponentId ?? null)}
                  onMouseLeave={() => onHoverComponent?.(null)}
                >
                  <td style={s.td}>{r.wireRefdes}</td>
                  <td style={s.td}>{r.fromComponentRefdes}{r.fromDesignation ? `.${r.fromDesignation}` : ''}</td>
                  <td style={s.td}>{r.fromSignal ?? <span style={s.dim}>—</span>}</td>
                  <td style={s.td}>
                    <select
                      style={s.dirSelect} value={r.fromDirection ?? 'bidirectional'}
                      onChange={(e) => updateEndpointDirection(store, r.fromComponentId, r.fromDesignation, e.target.value as SignalDirection)}
                    >
                      <option value="bidirectional">↔</option>
                      <option value="output">→ out</option>
                      <option value="input">← in</option>
                    </select>
                  </td>
                  <td style={{ ...s.td, ...s.resolvedCell(r.resolved) }}>{RESOLVED_LABEL[r.resolved]}</td>
                  <td style={s.td}>{r.toComponentRefdes}{r.toDesignation ? `.${r.toDesignation}` : ''}</td>
                  <td style={s.td}>{r.toSignal ?? <span style={s.dim}>—</span>}</td>
                  <td style={s.td}>
                    <select
                      style={s.dirSelect} value={r.toDirection ?? 'bidirectional'}
                      onChange={(e) => updateEndpointDirection(store, r.toComponentId, r.toDesignation, e.target.value as SignalDirection)}
                    >
                      <option value="bidirectional">↔</option>
                      <option value="output">→ out</option>
                      <option value="input">← in</option>
                    </select>
                  </td>
                  <td style={s.td}>
                    <label style={s.zLabel}>
                      <input
                        type="checkbox" checked={!!(r.fromImpedanceMatched || r.toImpedanceMatched)}
                        onChange={(e) => {
                          updateEndpointImpedance(store, r.fromComponentId, r.fromDesignation, e.target.checked);
                          updateEndpointImpedance(store, r.toComponentId, r.toDesignation, e.target.checked);
                        }}
                      />
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={s.addPanel}>
          <div style={s.addTitle}>+ Add connection</div>
          <div style={s.addGrid}>
            <input style={s.input} placeholder="From connector (e.g. C1)" value={addForm.fromRefdes} onChange={(e) => setAddForm((f) => ({ ...f, fromRefdes: e.target.value }))} />
            <input style={s.input} placeholder="Cavity (e.g. 1)" value={addForm.fromDesignation} onChange={(e) => setAddForm((f) => ({ ...f, fromDesignation: e.target.value }))} />
            <input style={s.input} placeholder="Signal name" value={addForm.fromSignal} onChange={(e) => setAddForm((f) => ({ ...f, fromSignal: e.target.value }))} />
            <span style={s.arrow}>→</span>
            <input style={s.input} placeholder="To connector (e.g. C2)" value={addForm.toRefdes} onChange={(e) => setAddForm((f) => ({ ...f, toRefdes: e.target.value }))} />
            <input style={s.input} placeholder="Cavity (e.g. 1)" value={addForm.toDesignation} onChange={(e) => setAddForm((f) => ({ ...f, toDesignation: e.target.value }))} />
            <input style={s.input} placeholder="Signal name" value={addForm.toSignal} onChange={(e) => setAddForm((f) => ({ ...f, toSignal: e.target.value }))} />
          </div>
          <button style={s.addBtn} onClick={addConnection} disabled={!addForm.fromRefdes.trim() || !addForm.toRefdes.trim()}>
            Add connection
          </button>
          <p style={s.mutedNote}>
            Naming a connector that doesn't exist yet creates it (and its cavity) automatically, placed in both Schematic and Layout.
          </p>
        </div>
      </div>
    </div>
  );
}

const s = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', background: theme.color.canvasBg },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
    borderBottom: `1px solid ${theme.color.border}`, background: theme.color.surface, flexWrap: 'wrap',
  },
  toolbarLabel: { fontSize: 11, fontWeight: 600, color: theme.color.textFaint, textTransform: 'uppercase', letterSpacing: 0.4 },
  hintMuted: { color: theme.color.textFaint, fontSize: 11.5 },
  body: { flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 18 },
  mutedNote: { color: theme.color.textMuted, fontSize: 12.5, margin: 0 },

  table: { borderCollapse: 'collapse', width: '100%', fontSize: 12.5 },
  th: {
    textAlign: 'left', padding: '6px 8px', fontSize: 10.5, fontWeight: 600, color: theme.color.textFaint,
    textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: `1px solid ${theme.color.border}`,
  },
  tr: (highlighted: boolean) => ({ background: highlighted ? theme.color.accentSoft : 'transparent' }),
  td: { padding: '6px 8px', borderBottom: `1px solid ${theme.color.border}`, color: theme.color.textStrong, verticalAlign: 'middle' },
  dim: { color: theme.color.textFaint },
  dirSelect: {
    fontSize: 11, color: theme.color.textMuted, border: `1px solid ${theme.color.border}`,
    borderRadius: theme.radius.control, padding: '2px 4px', background: theme.color.surface,
  },
  zLabel: { display: 'flex', justifyContent: 'center' },
  resolvedCell: (resolved: InterconnectRow['resolved']) => ({
    textAlign: 'center' as const, fontWeight: 700,
    color: resolved === 'conflict' ? theme.color.danger : theme.color.textFaint,
  }),

  addPanel: {
    border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.panel, padding: 14,
    background: theme.color.surface, maxWidth: 720,
  },
  addTitle: { fontSize: 12.5, fontWeight: 600, color: theme.color.textStrong, marginBottom: 10 },
  addGrid: { display: 'grid', gridTemplateColumns: '1fr 90px 1fr auto 1fr 90px 1fr', gap: 8, alignItems: 'center' },
  arrow: { textAlign: 'center' as const, color: theme.color.textFaint, fontWeight: 700 },
  input: {
    padding: '6px 8px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control,
    fontSize: 12.5, background: theme.color.canvasBg, color: theme.color.textStrong, boxSizing: 'border-box', width: '100%',
  },
  addBtn: {
    marginTop: 10, padding: '7px 14px', border: `1px solid ${theme.color.accent}`, borderRadius: theme.radius.control,
    background: theme.color.accent, color: '#fff', cursor: 'pointer', fontSize: 12.5, fontWeight: 500,
  },
} satisfies Record<string, React.CSSProperties | ((...args: never[]) => React.CSSProperties)>;
