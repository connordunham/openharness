/**
 * The Schematic canvas (spec §7.2) — the first real editing surface, not
 * just a viewer. Every edit here — add a component, draw a wire, rename a
 * refdes, edit a signal, drag a box, delete — goes through
 * `store.transact(...)`, the same call an automation makes (spec §8.3).
 *
 * Editing UX is modeled directly on the reference app (the reference tool),
 * per Connor's follow-up request and the confirmed behaviour recorded in
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
 * Component coverage: connector, splice, terminal, resistor, diode, cable,
 * and note are all creatable from the toolbar and editable in the floating
 * inspector. Branch points and the bare "generic" type are deliberately
 * left out of the "Add" toolbar — see the comment above the toolbar JSX.
 */

import { useCallback, useState } from 'react';
import type {
  HarnessStore, Endpoint, Component, Connector, Point, HarnessDocument,
  SpliceKind, TerminalKind, ConnectorPart, ConnectorConfiguration, PartId,
} from '@openharness/core';
import { newInstanceId, newPartId } from '@openharness/core';
import { computeSchematicScene, type SceneNode, type SceneRow, ROW_HEIGHT, HEADER_HEIGHT } from '@openharness/render';
import { theme } from './theme.js';
import { ComponentIcon } from './icons.js';

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
const ACCESSORY_SLOTS = [
  { key: 'lockPartId', label: 'Lock', type: 'lock' },
  { key: 'dustCoverPartId', label: 'Dust cover', type: 'dustCover' },
  { key: 'backshellPartId', label: 'Backshell', type: 'backshell' },
  { key: 'bootPartId', label: 'Boot', type: 'boot' },
  { key: 'contactPartId', label: 'Contact', type: 'contact' },
  { key: 'cavitySealPartId', label: 'Cavity seal', type: 'cavitySeal' },
] as const;

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
 * types don't stack on top of each other. */
function nextGridPosition(store: HarnessStore): Point {
  const placed =
    Object.values(store.doc.components).filter((c) => !!c.schematicPosition).length +
    Object.keys(store.doc.notes).length;
  return { x: 60 + (placed % 4) * 230, y: 70 + Math.floor(placed / 4) * 180 };
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

export function SchematicCanvas({ store }: Props) {
  const [selected, setSelected] = useState<Selection>(null);
  const [pendingWire, setPendingWire] = useState<PendingWire | null>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'edit' | 'properties'>('edit');

  const scene = computeSchematicScene(store.doc);
  const selectedComponent = selected?.kind === 'component' ? store.doc.components[selected.id] : undefined;
  const selectedNote = selected?.kind === 'note' ? store.doc.notes[selected.id] : undefined;
  const selectedNode = selectedComponent ? scene.nodes.find((n) => n.componentId === selectedComponent.id) : undefined;
  const selectedSceneNote = selectedNote ? scene.notes.find((n) => n.noteId === selectedNote.id) : undefined;

  const select = useCallback((sel: Selection) => {
    setSelected(sel);
    setInspectorTab('edit');
  }, []);

  const addConnector = useCallback(() => {
    const pos = nextGridPosition(store);
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
        custom: {},
      };
    });
    select({ kind: 'component', id: newId });
  }, [store, select]);

  const addSplice = useCallback(() => {
    const pos = nextGridPosition(store);
    let newId = '';
    store.transact('Add splice', (draft) => {
      const id = newInstanceId();
      newId = id;
      const refdes = nextRefdes(store, draft.settings.refdesPrefixes.splice ?? 'S', 'splice');
      draft.components[id] = { id, type: 'splice', refdes, spliceKind: 'crimp', schematicPosition: pos, custom: {} };
    });
    select({ kind: 'component', id: newId });
  }, [store, select]);

  const addTerminal = useCallback(() => {
    const pos = nextGridPosition(store);
    let newId = '';
    store.transact('Add terminal', (draft) => {
      const id = newInstanceId();
      newId = id;
      const refdes = nextRefdes(store, draft.settings.refdesPrefixes.terminal ?? 'T', 'terminal');
      draft.components[id] = { id, type: 'terminal', refdes, terminalKind: 'ferrule', schematicPosition: pos, custom: {} };
    });
    select({ kind: 'component', id: newId });
  }, [store, select]);

  const addTwoTerminal = useCallback((type: 'resistor' | 'diode') => {
    const pos = nextGridPosition(store);
    let newId = '';
    store.transact(`Add ${type}`, (draft) => {
      const id = newInstanceId();
      newId = id;
      const refdes = nextRefdes(store, draft.settings.refdesPrefixes[type] ?? (type === 'resistor' ? 'R' : 'D'), type);
      draft.components[id] = { id, type, refdes, schematicPosition: pos, custom: {} };
    });
    select({ kind: 'component', id: newId });
  }, [store, select]);

  const addCable = useCallback(() => {
    const pos = nextGridPosition(store);
    let newId = '';
    store.transact('Add cable', (draft) => {
      const id = newInstanceId();
      newId = id;
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
    select({ kind: 'component', id: newId });
  }, [store, select]);

  const addNote = useCallback(() => {
    const pos = nextGridPosition(store);
    let newId = '';
    store.transact('Add note', (draft) => {
      const id = newInstanceId();
      newId = id;
      draft.notes[id] = { id, schematicPosition: pos, text: 'Note' };
    });
    select({ kind: 'note', id: newId });
  }, [store, select]);

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
      select({ kind: 'component', id: node.componentId });
      setDragging({
        kind: 'component', id: node.componentId,
        pointerStartX: e.clientX, pointerStartY: e.clientY,
        boxStartX: node.x, boxStartY: node.y,
      });
    },
    [select],
  );

  const onNoteMouseDown = useCallback(
    (noteId: string, x: number, y: number, e: React.MouseEvent) => {
      e.stopPropagation();
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
    600,
    ...scene.nodes.map((n) => n.x + n.width + 260),
    ...scene.notes.map((n) => n.point.x + 260),
  );
  const maxY = Math.max(
    420,
    ...scene.nodes.map((n) => n.y + n.height + 220),
    ...scene.notes.map((n) => n.point.y + 200),
  );

  return (
    <div style={s.root}>
      <div style={s.addToolbar}>
        <span style={s.addToolbarLabel}>Add</span>
        <AddButton icon="connector" label="Connector" onClick={addConnector} />
        <AddButton icon="splice" label="Splice" onClick={addSplice} />
        <AddButton icon="terminal" label="Terminal" onClick={addTerminal} />
        <AddButton icon="resistor" label="Resistor" onClick={() => addTwoTerminal('resistor')} />
        <AddButton icon="diode" label="Diode" onClick={() => addTwoTerminal('diode')} />
        <AddButton icon="cable" label="Cable" onClick={addCable} />
        <AddButton icon="note" label="Note" onClick={addNote} />
        {pendingWire && (
          <span style={s.wireHint}>Click a port to finish the wire, or click it again to cancel.</span>
        )}
      </div>
      <div style={s.canvasScroll} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
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
                strokeWidth={2} strokeLinecap="round"
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
                      strokeWidth={1} style={{ pointerEvents: 'none' }}
                    />
                  )}
                  <foreignObject x={node.x + 6} y={node.y + 3} width={16} height={16} style={{ pointerEvents: 'none', color: theme.color.textMuted }}>
                    <ComponentIcon type={node.type} size={13} />
                  </foreignObject>
                  <text x={node.x + 24} y={node.y + HEADER_HEIGHT - 7} fontSize={12} fontWeight={600} fill={theme.color.textStrong} style={{ pointerEvents: 'none' }}>
                    {node.refdes}
                  </text>
                  {node.rows.map((row, i) => (
                    <g key={row.rowId}>
                      <text
                        x={node.x + 8}
                        y={node.y + HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT * 0.68}
                        fontSize={11} fill={theme.color.textMuted}
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

          {selectedComponent && selectedNode && (
            <>
              {selectedComponent.type === 'connector' && (
                <CavityStepper
                  store={store}
                  connector={selectedComponent}
                  node={selectedNode}
                />
              )}
              <div style={{ position: 'absolute', left: selectedNode.x, top: selectedNode.y + selectedNode.height + 10, zIndex: 2 }}>
                <ComponentInspector
                  store={store}
                  component={selectedComponent}
                  tab={inspectorTab}
                  onTabChange={setInspectorTab}
                  onDelete={deleteSelected}
                />
              </div>
            </>
          )}

          {selectedNote && selectedSceneNote && (
            <div style={{ position: 'absolute', left: selectedSceneNote.point.x, top: selectedSceneNote.point.y + 64, zIndex: 2 }}>
              <div style={s.card}>
                <div style={s.cardHeader}>
                  <ComponentIcon type="note" />
                  <span style={s.cardTitle}>Note</span>
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
  store, component, tab, onTabChange, onDelete,
}: {
  store: HarnessStore;
  component: Component;
  tab: 'edit' | 'properties';
  onTabChange: (t: 'edit' | 'properties') => void;
  onDelete: () => void;
}) {
  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <ComponentIcon type={component.type} />
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
      </div>

      {component.type === 'connector' && (
        <div style={s.tabRow}>
          <button style={s.tabBtn(tab === 'edit')} onClick={() => onTabChange('edit')}>Edit</button>
          <button style={s.tabBtn(tab === 'properties')} onClick={() => onTabChange('properties')}>Properties</button>
        </div>
      )}

      <div style={s.cardBody}>
        {component.type === 'connector' && tab === 'properties' ? (
          <ConnectorProperties store={store} component={component} />
        ) : (
          <ComponentEditFields store={store} component={component} />
        )}
        <button style={s.deleteBtn} onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
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
      <label style={s.fieldLabel}>Part number</label>
      <input
        style={s.input} value={part?.partNumber ?? ''}
        onChange={(e) => { const v = e.target.value; updatePart((p) => { p.partNumber = v || undefined; }); }}
      />
      <label style={s.fieldLabel}>Manufacturer</label>
      <input
        style={s.input} value={part?.manufacturer ?? ''}
        onChange={(e) => { const v = e.target.value; updatePart((p) => { p.manufacturer = v || undefined; }); }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
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
  canvasScroll: { flex: 1, overflow: 'auto' },
  canvasSvg: { display: 'block' },

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
} satisfies Record<string, React.CSSProperties | ((...args: never[]) => React.CSSProperties)>;
