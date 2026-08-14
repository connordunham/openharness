/**
 * The Schematic canvas (spec §7.2) — the first real editing surface, not
 * just a viewer. Every edit here — add a component, draw a wire, rename a
 * refdes, edit a signal, drag a box, delete — goes through
 * `store.transact(...)`, the same call an automation makes (spec §8.3).
 *
 * Component coverage: connector, splice, terminal, resistor, diode, cable,
 * and note are all creatable from the toolbar and editable in the side
 * panel. Branch points and the bare "generic" type are deliberately left
 * out of the "Add" toolbar: a BranchPoint's `schematicPosition` is typed as
 * always-`undefined` (spec §4.2) — it is structurally layout-only and can
 * never render here (see schematicScene.ts's buildNode) — and "generic" has
 * no defined rows/ports to wire to, so exposing it here would just be a
 * button that draws an empty box. Both remain fully supported by the data
 * model and derive pipeline for when the Layout view lands.
 *
 * Scoped deliberately for this pass: straight-line wires (not the real
 * app's orthogonal fan-out, spec §7.2), click-click to wire rather than
 * drag-to-wire.
 */

import { useCallback, useState } from 'react';
import type { HarnessStore, Endpoint, Component, Point, SpliceKind, TerminalKind } from '@openharness/core';
import { newInstanceId } from '@openharness/core';
import { computeSchematicScene, type SceneNode, type SceneRow, ROW_HEIGHT, HEADER_HEIGHT } from '@openharness/render';
import { theme } from './theme.js';

interface Props {
  store: HarnessStore;
}

interface PendingWire {
  componentId: string;
  rowId: string;
  endpoint: Endpoint;
}

type Selection = { kind: 'component'; id: string } | { kind: 'note'; id: string } | null;

interface Dragging {
  kind: 'component' | 'note';
  id: string;
  pointerStartX: number;
  pointerStartY: number;
  boxStartX: number;
  boxStartY: number;
}

const SPLICE_KINDS: SpliceKind[] = ['crimp', 'weld', 'solderSleeve'];
const TERMINAL_KINDS: TerminalKind[] = [
  'ferrule', 'ring', 'spade', 'maleQuickConnect', 'femaleQuickConnect', 'looseWireEnd',
];

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

function nextRefdes(store: HarnessStore, prefix: string, type: Component['type']): string {
  const count = Object.values(store.doc.components).filter((c) => c.type === type).length;
  return `${prefix}${count + 1}`;
}

/** Rough grid placement shared by every "Add X" action, so mixed component
 * types don't stack on top of each other. Not layout-quality (spec §7.3
 * territory), just enough that a freshly-added part is visible and clear
 * of its neighbors. */
function nextGridPosition(store: HarnessStore): Point {
  const placed =
    Object.values(store.doc.components).filter((c) => !!c.schematicPosition).length +
    Object.keys(store.doc.notes).length;
  return { x: 40 + (placed % 4) * 220, y: 40 + Math.floor(placed / 4) * 160 };
}

export function SchematicCanvas({ store }: Props) {
  const [selected, setSelected] = useState<Selection>(null);
  const [pendingWire, setPendingWire] = useState<PendingWire | null>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);

  const scene = computeSchematicScene(store.doc);
  const selectedComponent = selected?.kind === 'component' ? store.doc.components[selected.id] : undefined;
  const selectedNote = selected?.kind === 'note' ? store.doc.notes[selected.id] : undefined;

  const addConnector = useCallback(() => {
    const pos = nextGridPosition(store);
    store.transact('Add connector', (draft) => {
      const id = newInstanceId();
      const refdes = nextRefdes(store, draft.settings.refdesPrefixes.connector ?? 'C', 'connector');
      draft.components[id] = {
        id, type: 'connector', refdes,
        cavities: [
          { id: newInstanceId(), designation: '1', custom: {} },
          { id: newInstanceId(), designation: '2', custom: {} },
        ],
        schematicPosition: pos,
        custom: {},
      };
    });
  }, [store]);

  const addSplice = useCallback(() => {
    const pos = nextGridPosition(store);
    store.transact('Add splice', (draft) => {
      const id = newInstanceId();
      const refdes = nextRefdes(store, draft.settings.refdesPrefixes.splice ?? 'S', 'splice');
      draft.components[id] = { id, type: 'splice', refdes, spliceKind: 'crimp', schematicPosition: pos, custom: {} };
    });
  }, [store]);

  const addTerminal = useCallback(() => {
    const pos = nextGridPosition(store);
    store.transact('Add terminal', (draft) => {
      const id = newInstanceId();
      const refdes = nextRefdes(store, draft.settings.refdesPrefixes.terminal ?? 'T', 'terminal');
      draft.components[id] = { id, type: 'terminal', refdes, terminalKind: 'ferrule', schematicPosition: pos, custom: {} };
    });
  }, [store]);

  const addTwoTerminal = useCallback((type: 'resistor' | 'diode') => {
    const pos = nextGridPosition(store);
    store.transact(`Add ${type}`, (draft) => {
      const id = newInstanceId();
      const refdes = nextRefdes(store, draft.settings.refdesPrefixes[type] ?? (type === 'resistor' ? 'R' : 'D'), type);
      draft.components[id] = { id, type, refdes, schematicPosition: pos, custom: {} };
    });
  }, [store]);

  const addCable = useCallback(() => {
    const pos = nextGridPosition(store);
    store.transact('Add cable', (draft) => {
      const id = newInstanceId();
      const refdes = nextRefdes(store, draft.settings.refdesPrefixes.cable ?? 'CB', 'cable');
      draft.components[id] = {
        id, type: 'cable', refdes,
        cores: [
          { id: newInstanceId(), color: 'Black', designation: '1' },
          { id: newInstanceId(), color: 'Red', designation: '2' },
        ],
        schematicPosition: pos,
        custom: {},
      };
    });
  }, [store]);

  const addNote = useCallback(() => {
    const pos = nextGridPosition(store);
    store.transact('Add note', (draft) => {
      const id = newInstanceId();
      draft.notes[id] = { id, schematicPosition: pos, text: 'Note' };
    });
  }, [store]);

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
        draft.wires[id] = {
          id, refdes: `W${n + 1}`, color: 'Black',
          source: pendingWire.endpoint, target: endpoint, custom: {},
        };
      });
      setPendingWire(null);
    },
    [pendingWire, store],
  );

  const onNodeMouseDown = useCallback(
    (node: SceneNode, e: React.MouseEvent) => {
      e.stopPropagation();
      setSelected({ kind: 'component', id: node.componentId });
      setDragging({
        kind: 'component', id: node.componentId,
        pointerStartX: e.clientX, pointerStartY: e.clientY,
        boxStartX: node.x, boxStartY: node.y,
      });
    },
    [],
  );

  const onNoteMouseDown = useCallback(
    (noteId: string, x: number, y: number, e: React.MouseEvent) => {
      e.stopPropagation();
      setSelected({ kind: 'note', id: noteId });
      setDragging({ kind: 'note', id: noteId, pointerStartX: e.clientX, pointerStartY: e.clientY, boxStartX: x, boxStartY: y });
    },
    [],
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
      } else {
        store.transact('Move note', (draft) => {
          const n = draft.notes[dragging.id];
          if (n) n.schematicPosition = { x, y };
        });
      }
    },
    [dragging, store],
  );

  const onMouseUp = useCallback(() => setDragging(null), []);

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    if (selected.kind === 'note') {
      store.transact('Delete note', (draft) => {
        delete draft.notes[selected.id];
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
    500,
    ...scene.nodes.map((n) => n.x + n.width + 40),
    ...scene.notes.map((n) => n.point.x + 200),
  );
  const maxY = Math.max(
    360,
    ...scene.nodes.map((n) => n.y + n.height + 40),
    ...scene.notes.map((n) => n.point.y + 80),
  );

  return (
    <div style={s.root}>
      <div style={s.canvasColumn}>
        <div style={s.addToolbar}>
          <span style={s.addToolbarLabel}>Add</span>
          <button style={s.addBtn} onClick={addConnector}>+ Connector</button>
          <button style={s.addBtn} onClick={addSplice}>+ Splice</button>
          <button style={s.addBtn} onClick={addTerminal}>+ Terminal</button>
          <button style={s.addBtn} onClick={() => addTwoTerminal('resistor')}>+ Resistor</button>
          <button style={s.addBtn} onClick={() => addTwoTerminal('diode')}>+ Diode</button>
          <button style={s.addBtn} onClick={addCable}>+ Cable</button>
          <button style={s.addBtn} onClick={addNote}>+ Note</button>
          {pendingWire && (
            <span style={s.wireHint}>Click a port to finish the wire, or click it again to cancel.</span>
          )}
        </div>
        <div style={s.canvasScroll} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
          <svg
            width={maxX}
            height={maxY}
            style={s.canvasSvg}
            onClick={(e) => {
              // Only deselect on clicks that land on the svg background itself.
              // Clicking a node fires onMouseDown (which selects) and then a
              // synthesized click that bubbles up here — stopPropagation() on
              // the mousedown handler does NOT stop that click, so without
              // this target check every node click immediately deselects
              // itself right after selecting. Caught by driving the app
              // interactively; no unit test exercises this DOM event nuance.
              if (e.target === e.currentTarget) setSelected(null);
            }}
          >
            <defs>
              <pattern id="dot-grid" width={16} height={16} patternUnits="userSpaceOnUse">
                <circle cx={1} cy={1} r={1} fill={theme.color.gridDot} />
              </pattern>
            </defs>
            <rect x={0} y={0} width={maxX} height={maxY} fill="url(#dot-grid)" />

            {scene.wires.map((w) => (
              <line
                key={w.wireId}
                x1={w.from.x} y1={w.from.y} x2={w.to.x} y2={w.to.y}
                stroke={w.degraded ? theme.color.danger : w.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeDasharray={w.degraded ? '4 3' : undefined}
              />
            ))}

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
                  />
                  <foreignObject x={note.point.x + 8} y={note.point.y + 6} width={width - 16} height={height - 12} style={{ pointerEvents: 'none' }}>
                    <div style={s.noteText}>{note.text}</div>
                  </foreignObject>
                </g>
              );
            })}

            {scene.nodes.map((node) => {
              const isSelected = selected?.kind === 'component' && selected.id === node.componentId;
              return (
                <g key={node.componentId}>
                  <rect
                    x={node.x} y={node.y} width={node.width} height={node.height} rx={theme.radius.node}
                    fill={theme.color.nodeFill}
                    stroke={isSelected ? theme.color.accent : theme.color.nodeBorder}
                    strokeWidth={isSelected ? 2 : 1}
                    onMouseDown={(e) => onNodeMouseDown(node, e)}
                    style={{ cursor: 'grab', filter: isSelected ? theme.shadow.selected : undefined }}
                  />
                  {node.rows.length > 0 && (
                    <line
                      x1={node.x} y1={node.y + HEADER_HEIGHT} x2={node.x + node.width} y2={node.y + HEADER_HEIGHT}
                      stroke={isSelected ? theme.color.accent : theme.color.nodeBorder}
                      strokeWidth={1}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                  <text x={node.x + 8} y={node.y + HEADER_HEIGHT - 7} fontSize={12} fontWeight={600} fill={theme.color.textStrong} style={{ pointerEvents: 'none' }}>
                    {node.refdes}
                  </text>
                  {node.rows.map((row, i) => (
                    <g key={row.rowId}>
                      <text
                        x={node.x + 8}
                        y={node.y + HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT * 0.68}
                        fontSize={11}
                        fill={theme.color.textMuted}
                        style={{ pointerEvents: 'none' }}
                      >
                        {row.label}{row.signal ? `  ·  ${row.signal}` : ''}
                      </text>
                      <circle
                        cx={row.point.x} cy={row.point.y} r={5}
                        fill={pendingWire?.componentId === node.componentId && pendingWire.rowId === row.rowId ? theme.color.accent : theme.color.nodeFill}
                        stroke={theme.color.accent} strokeWidth={1.5}
                        style={{ cursor: 'crosshair' }}
                        onClick={(e) => { e.stopPropagation(); onRowClick(node, row); }}
                      />
                    </g>
                  ))}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {(selectedComponent || selectedNote) && (
        <div style={s.panel}>
          {selectedComponent && (
            <ComponentInspector
              key={selectedComponent.id}
              store={store}
              component={selectedComponent}
              onDelete={deleteSelected}
            />
          )}
          {selectedNote && (
            <div>
              <div style={s.panelKicker}>Note</div>
              <label style={s.fieldLabel}>Text</label>
              <textarea
                style={s.textarea}
                value={selectedNote.text}
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
          )}
        </div>
      )}
    </div>
  );
}

function ComponentInspector({
  store, component, onDelete,
}: {
  store: HarnessStore;
  component: Component;
  onDelete: () => void;
}) {
  return (
    <div>
      <div style={s.panelKicker}>{typeLabel(component.type)}</div>
      <label style={s.fieldLabel}>Refdes</label>
      <input
        style={s.input}
        value={component.refdes}
        onChange={(e) => {
          const value = e.target.value;
          store.transact('Rename component', (draft) => {
            const c = draft.components[component.id];
            if (c) c.refdes = value;
          });
        }}
      />

      {component.type === 'connector' && (
        <>
          <div style={s.sectionLabel}>Cavities</div>
          {component.cavities.map((cavity, i) => (
            <div key={cavity.id} style={s.subRow}>
              <span style={s.subRowTag}>{cavity.designation}</span>
              <input
                style={s.input}
                placeholder="signal"
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
          <button
            style={s.addRowBtn}
            onClick={() => {
              store.transact('Add cavity', (draft) => {
                const c = draft.components[component.id];
                if (c?.type === 'connector') {
                  c.cavities.push({ id: newInstanceId(), designation: String(c.cavities.length + 1), custom: {} });
                }
              });
            }}
          >
            + Cavity
          </button>
        </>
      )}

      {component.type === 'cable' && (
        <>
          <div style={s.sectionLabel}>Cores</div>
          {component.cores.map((core, i) => (
            <div key={core.id} style={s.subRow}>
              <span style={s.subRowTag}>{core.designation ?? i + 1}</span>
              <input
                style={s.input}
                placeholder="color"
                value={core.color}
                onChange={(e) => {
                  const value = e.target.value;
                  store.transact('Edit core color', (draft) => {
                    const c = draft.components[component.id];
                    if (c?.type === 'cable') c.cores[i]!.color = value;
                  });
                }}
              />
              <input
                style={s.input}
                placeholder="signal"
                value={core.signal ?? ''}
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
                if (c?.type === 'cable') {
                  c.cores.push({ id: newInstanceId(), color: 'White', designation: String(c.cores.length + 1) });
                }
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
            style={s.input}
            value={component.spliceKind ?? 'crimp'}
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
            style={s.input}
            value={component.terminalKind}
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
            style={s.input}
            value={component.polarity ?? 'forward'}
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

      <button style={s.deleteBtn} onClick={onDelete}>Delete</button>
    </div>
  );
}

function typeLabel(type: Component['type']): string {
  switch (type) {
    case 'connector': return 'Connector';
    case 'splice': return 'Splice';
    case 'terminal': return 'Terminal';
    case 'resistor': return 'Resistor';
    case 'diode': return 'Diode';
    case 'cable': return 'Cable';
    case 'branchPoint': return 'Branch point';
    case 'generic': return 'Component';
  }
}

const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', height: '100%', background: theme.color.canvasBg },
  canvasColumn: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  addToolbar: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px',
    borderBottom: `1px solid ${theme.color.border}`, background: theme.color.surface, flexWrap: 'wrap',
  },
  addToolbarLabel: { fontSize: 11, fontWeight: 600, color: theme.color.textFaint, textTransform: 'uppercase', letterSpacing: 0.4, marginRight: 4 },
  addBtn: {
    padding: '6px 11px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control,
    background: theme.color.surface, color: theme.color.textStrong, cursor: 'pointer', fontSize: 12.5, fontWeight: 500,
  },
  wireHint: { color: theme.color.accent, fontSize: 12, marginLeft: 8, fontWeight: 500 },
  canvasScroll: { flex: 1, overflow: 'auto' },
  canvasSvg: { display: 'block' },
  panel: {
    width: 280, borderLeft: `1px solid ${theme.color.border}`, padding: 20, overflow: 'auto',
    background: theme.color.surface,
  },
  panelKicker: { fontSize: 11, fontWeight: 700, color: theme.color.accent, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 },
  fieldLabel: { display: 'block', fontSize: 11.5, color: theme.color.textFaint, marginBottom: 4, marginTop: 12, fontWeight: 500 },
  sectionLabel: { fontSize: 12, fontWeight: 600, color: theme.color.textStrong, marginTop: 20, marginBottom: 8 },
  input: {
    width: '100%', padding: '7px 9px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control,
    fontSize: 13, boxSizing: 'border-box', background: theme.color.surface, color: theme.color.textStrong,
    outlineColor: theme.color.accent,
  },
  textarea: {
    width: '100%', minHeight: 80, padding: '7px 9px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control,
    fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical', color: theme.color.textStrong,
  },
  subRow: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 },
  subRowTag: { fontSize: 11, color: theme.color.textFaint, width: 18, flexShrink: 0, fontVariantNumeric: 'tabular-nums' },
  addRowBtn: {
    marginTop: 4, padding: '5px 10px', border: `1px dashed ${theme.color.border}`, borderRadius: theme.radius.control,
    background: 'transparent', color: theme.color.textMuted, cursor: 'pointer', fontSize: 12.5,
  },
  deleteBtn: {
    marginTop: 24, width: '100%', padding: '8px 10px', border: `1px solid ${theme.color.dangerBorder}`,
    borderRadius: theme.radius.control, background: theme.color.dangerSoft, color: theme.color.danger,
    cursor: 'pointer', fontSize: 13, fontWeight: 500,
  },
  noteText: {
    fontSize: 12, color: theme.color.textStrong, lineHeight: 1.4, whiteSpace: 'pre-wrap', overflow: 'hidden',
    fontFamily: 'inherit',
  },
};
