/**
 * The Schematic canvas (spec §7.2) — the first real editing surface, not
 * just a viewer. Every edit here — add connector, draw a wire, rename a
 * refdes, edit a signal, drag a box, delete — goes through
 * `store.transact(...)`, the same call an automation makes (spec §8.3).
 *
 * Scoped deliberately for this pass: straight-line wires (not the real
 * app's orthogonal fan-out, spec §7.2), click-click to wire rather than
 * drag-to-wire, and no splice/terminal/resistor/cable *creation* toolbar
 * buttons yet (only connectors) — but all of those component types already
 * render and can be wired to, since @openharness/render's scene builder
 * handles them (see schematicScene.ts). Extending "Add X" to the rest is a
 * small, mechanical follow-up once this shape is proven out.
 */

import { useCallback, useState } from 'react';
import type { HarnessStore, Endpoint, Component } from '@openharness/core';
import { newInstanceId } from '@openharness/core';
import { computeSchematicScene, type SceneNode, type SceneRow, ROW_HEIGHT, HEADER_HEIGHT } from '@openharness/render';

interface Props {
  store: HarnessStore;
}

interface PendingWire {
  componentId: string;
  rowId: string;
  endpoint: Endpoint;
}

interface Dragging {
  componentId: string;
  pointerStartX: number;
  pointerStartY: number;
  boxStartX: number;
  boxStartY: number;
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

function nextRefdes(store: HarnessStore, prefix: string, type: Component['type']): string {
  const count = Object.values(store.doc.components).filter((c) => c.type === type).length;
  return `${prefix}${count + 1}`;
}

export function SchematicCanvas({ store }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingWire, setPendingWire] = useState<PendingWire | null>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);

  const scene = computeSchematicScene(store.doc);
  const selected = selectedId ? store.doc.components[selectedId] : undefined;

  const addConnector = useCallback(() => {
    store.transact('Add connector', (draft) => {
      const id = newInstanceId();
      const refdes = nextRefdes(store, draft.settings.refdesPrefixes.connector ?? 'C', 'connector');
      const n = Object.values(draft.components).filter((c) => c.type === 'connector').length;
      draft.components[id] = {
        id, type: 'connector', refdes,
        cavities: [
          { id: newInstanceId(), designation: '1', custom: {} },
          { id: newInstanceId(), designation: '2', custom: {} },
        ],
        schematicPosition: { x: 40 + (n % 4) * 220, y: 40 + Math.floor(n / 4) * 160 },
        custom: {},
      };
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
      setSelectedId(node.componentId);
      setDragging({
        componentId: node.componentId,
        pointerStartX: e.clientX, pointerStartY: e.clientY,
        boxStartX: node.x, boxStartY: node.y,
      });
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
      store.transact('Move component', (draft) => {
        const c = draft.components[dragging.componentId];
        if (c) c.schematicPosition = { x, y };
      });
    },
    [dragging, store],
  );

  const onMouseUp = useCallback(() => setDragging(null), []);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    store.transact('Delete component', (draft) => {
      delete draft.components[selectedId];
      for (const [wireId, wire] of Object.entries(draft.wires)) {
        const touches = (ep: Endpoint) => 'componentId' in ep && ep.componentId === selectedId;
        if (touches(wire.source) || touches(wire.target)) delete draft.wires[wireId];
      }
    });
    setSelectedId(null);
  }, [selectedId, store]);

  const maxX = Math.max(400, ...scene.nodes.map((n) => n.x + n.width + 40));
  const maxY = Math.max(300, ...scene.nodes.map((n) => n.y + n.height + 40));

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 8, borderBottom: '1px solid #eee', display: 'flex', gap: 8 }}>
          <button style={btnStyle} onClick={addConnector}>+ Connector</button>
          {pendingWire && <span style={{ color: '#175cd3', fontSize: 12, alignSelf: 'center' }}>Click a cavity/pin to finish the wire, or click it again to cancel.</span>}
        </div>
        <div style={{ flex: 1, overflow: 'auto' }} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
          <svg
            width={maxX}
            height={maxY}
            onClick={(e) => {
              // Only deselect on clicks that land on the svg background itself.
              // Clicking a node fires onMouseDown (which selects) and then a
              // synthesized click that bubbles up here — stopPropagation() on
              // the mousedown handler does NOT stop that click, so without
              // this target check every node click immediately deselects
              // itself right after selecting. Caught by driving the app
              // interactively; no unit test exercises this DOM event nuance.
              if (e.target === e.currentTarget) setSelectedId(null);
            }}
          >
            {scene.wires.map((w) => (
              <line
                key={w.wireId}
                x1={w.from.x} y1={w.from.y} x2={w.to.x} y2={w.to.y}
                stroke={w.degraded ? '#d92d20' : w.color}
                strokeWidth={2}
                strokeDasharray={w.degraded ? '4 3' : undefined}
              />
            ))}
            {scene.nodes.map((node) => (
              <g key={node.componentId}>
                <rect
                  x={node.x} y={node.y} width={node.width} height={node.height}
                  fill="#fff" stroke={selectedId === node.componentId ? '#175cd3' : '#999'}
                  strokeWidth={selectedId === node.componentId ? 2 : 1}
                  onMouseDown={(e) => onNodeMouseDown(node, e)}
                  style={{ cursor: 'grab' }}
                />
                <text x={node.x + 6} y={node.y + HEADER_HEIGHT - 6} fontSize={12} fontWeight={600} style={{ pointerEvents: 'none' }}>
                  {node.refdes}
                </text>
                {node.rows.map((row, i) => (
                  <g key={row.rowId}>
                    <text x={node.x + 6} y={node.y + HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT * 0.7} fontSize={11} style={{ pointerEvents: 'none' }}>
                      {row.label}{row.signal ? `  (${row.signal})` : ''}
                    </text>
                    <circle
                      cx={row.point.x} cy={row.point.y} r={5}
                      fill={pendingWire?.componentId === node.componentId && pendingWire.rowId === row.rowId ? '#175cd3' : '#fff'}
                      stroke="#175cd3" strokeWidth={1.5}
                      style={{ cursor: 'crosshair' }}
                      onClick={(e) => { e.stopPropagation(); onRowClick(node, row); }}
                    />
                  </g>
                ))}
              </g>
            ))}
          </svg>
        </div>
      </div>

      {selected && (
        <div style={{ width: 260, borderLeft: '1px solid #eee', padding: 16, overflow: 'auto' }}>
          <h4 style={{ marginTop: 0 }}>{selected.type}</h4>
          <label style={{ fontSize: 12, color: '#666' }}>Refdes</label>
          <input
            style={inputStyle}
            value={selected.refdes}
            onChange={(e) => {
              const value = e.target.value;
              store.transact('Rename component', (draft) => {
                const c = draft.components[selected.id];
                if (c) c.refdes = value;
              });
            }}
          />
          {selected.type === 'connector' && (
            <>
              <h5>Cavities</h5>
              {selected.cavities.map((cavity, i) => (
                <div key={cavity.id} style={{ marginBottom: 6 }}>
                  <label style={{ fontSize: 11, color: '#666' }}>{cavity.designation}</label>
                  <input
                    style={inputStyle}
                    placeholder="signal"
                    value={cavity.signal ?? ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      store.transact('Edit cavity signal', (draft) => {
                        const c = draft.components[selected.id];
                        if (c?.type === 'connector') c.cavities[i]!.signal = value || undefined;
                      });
                    }}
                  />
                </div>
              ))}
              <button
                style={{ ...btnStyle, marginTop: 4 }}
                onClick={() => {
                  store.transact('Add cavity', (draft) => {
                    const c = draft.components[selected.id];
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
          <button style={{ ...btnStyle, marginTop: 16, color: '#b42318', borderColor: '#fecdca' }} onClick={deleteSelected}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = { padding: '5px 10px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 13 };
const inputStyle: React.CSSProperties = { width: '100%', padding: '4px 6px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13, marginTop: 2, marginBottom: 4, boxSizing: 'border-box' };
