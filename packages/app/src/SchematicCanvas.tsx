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
  SpliceKind, TerminalKind, ConnectorPart, ConnectorConfiguration, PartId, WireGroup, WirePart,
} from '@openharness/core';
import { newInstanceId, newPartId } from '@openharness/core';
import { computeSchematicScene, type SceneNode, type SceneRow, type SceneWire, ROW_HEIGHT, HEADER_HEIGHT } from '@openharness/render';
import { theme } from './theme.js';
import { ComponentIcon } from './icons.js';

interface Props {
  store: HarnessStore;
  /** Cross-pane hover highlighting (Layout/BOM/Schematic all share one id
   * via App.tsx) — see the file header note in LayoutCanvas.tsx. Both
   * optional so this component still works standalone (e.g. in tests). */
  hoveredComponentId?: string | null;
  onHoverComponent?: (id: string | null) => void;
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
  kind: 'component' | 'note';
  id: string;
  pointerStartX: number;
  pointerStartY: number;
  boxStartX: number;
  boxStartY: number;
}

interface ContextMenuState {
  x: number;
  y: number;
  target: { kind: 'component' | 'wire' | 'group'; id: string };
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

export function SchematicCanvas({ store, hoveredComponentId, onHoverComponent }: Props) {
  const [selected, setSelected] = useState<Selection>(null);
  const [multiSelect, setMultiSelect] = useState<Set<string>>(new Set());
  const [pendingWire, setPendingWire] = useState<PendingWire | null>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'edit' | 'properties'>('edit');
  const [editingCavity, setEditingCavity] = useState<{ componentId: string; cavityId: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

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

  const select = useCallback((sel: Selection) => {
    setSelected(sel);
    setMultiSelect(new Set());
    setInspectorTab('edit');
    setContextMenu(null);
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
      select({ kind: 'component', id: newId });
    },
    [store, select],
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
    },
    [seedMultiSelectFromSingle],
  );

  const groupSelection = useCallback(() => {
    if (multiSelect.size < 2) return;
    const wireIds: string[] = [];
    const groupIds: string[] = [];
    for (const key of multiSelect) {
      const parsed = parseKey(key);
      if (!parsed) continue;
      if (parsed.kind === 'wire') wireIds.push(parsed.id);
      else groupIds.push(parsed.id);
    }
    let newId = '';
    store.transact('Group wires', (draft) => {
      const id = newInstanceId();
      newId = id;
      const group: WireGroup = {
        id, kind: 'twist', memberWireIds: wireIds, memberGroupIds: groupIds, custom: {},
      };
      draft.wireGroups[id] = group;
      for (const wid of wireIds) {
        const w = draft.wires[wid];
        if (w) w.twistGroupId = id;
      }
    });
    setMultiSelect(new Set());
    setSelected({ kind: 'group', id: newId });
  }, [multiSelect, store]);

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
    setContextMenu({ x: e.clientX, y: e.clientY, target: { kind: 'wire', id: wireId } });
  }, []);

  const onGroupContextMenu = useCallback((groupId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMultiSelect(new Set());
    setSelected({ kind: 'group', id: groupId });
    setContextMenu({ x: e.clientX, y: e.clientY, target: { kind: 'group', id: groupId } });
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
  // fixed corner.
  let groupBtnPos: Point | null = null;
  if (multiSelect.size >= 2) {
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
        {multiSelect.size >= 2 && (
          <span style={s.wireHint}>{multiSelect.size} selected — click "Group" on the canvas, or shift-click to adjust.</span>
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
              return (
                <path
                  key={`halo:${groupId}`}
                  d={rep.path}
                  fill="none"
                  stroke={isSelected || isMulti ? theme.color.accent : theme.color.textFaint}
                  strokeOpacity={isSelected || isMulti ? 0.35 : 0.22}
                  strokeWidth={members.length > 1 ? 10 : 8}
                  strokeLinecap="round"
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => onGroupHaloClick(groupId, e)}
                  onContextMenu={(e) => onGroupContextMenu(groupId, e)}
                >
                  <title>{group?.kind === 'cable' ? `Cable ${group.refdes ?? ''}` : 'Twisted group'} ({members.length} wire{members.length === 1 ? '' : 's'})</title>
                </path>
              );
            })}

            {scene.wires.map((w) => {
              const isSelected = selected?.kind === 'wire' && selected.id === w.wireId;
              const isMulti = multiSelect.has(wireKey(w.wireId));
              return (
                <g key={w.wireId}>
                  {/* Fat invisible hit-target, easier to click than the thin trace. */}
                  <path d={w.path} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }}
                    onClick={(e) => onWireClick(w.wireId, e)} onContextMenu={(e) => onWireContextMenu(w.wireId, e)} />
                  <path
                    d={w.path} fill="none"
                    stroke={w.degraded ? theme.color.danger : w.color}
                    strokeWidth={isSelected || isMulti ? 3 : 2}
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
                  {(isSelected || isMulti) && (
                    <circle cx={w.midpoint.x} cy={w.midpoint.y} r={3.5} fill={theme.color.accent} style={{ pointerEvents: 'none' }} />
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
                  />
                  <foreignObject x={note.point.x + 8} y={note.point.y + 6} width={width - 16} height={height - 12} style={{ pointerEvents: 'none' }}>
                    <div style={s.noteText}>{note.text}</div>
                  </foreignObject>
                </g>
              );
            })}

            {scene.nodes.map((node) => {
              const isSelected = selected?.kind === 'component' && selected.id === node.componentId;
              const isHovered = hoveredComponentId === node.componentId;
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
                    <ComponentIcon type={node.type} size={13} />
                  </foreignObject>
                  <text x={node.x + 24} y={node.y + HEADER_HEIGHT - 7} fontSize={12} fontWeight={600} fill={theme.color.textStrong} style={{ pointerEvents: 'none' }}>
                    {node.refdes}
                  </text>
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
                            onDoubleClick={(e) => {
                              if (!isConnector) return;
                              e.stopPropagation();
                              setEditingCavity({ componentId: node.componentId, cavityId: row.rowId });
                            }}
                          >
                            {row.label}{row.signal ? `  ·  ${row.signal}` : isConnector ? '  ·  (double-click to name)' : ''}
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

          {selectedWire && selected?.kind === 'wire' && (
            <div style={{ position: 'absolute', left: selectedWire.midpoint.x, top: selectedWire.midpoint.y + 14, zIndex: 3 }}>
              <WireInspector
                store={store}
                wire={selectedWire}
                onDelete={deleteSelected}
                onUngroupWire={
                  store.doc.wires[selectedWire.wireId]?.twistGroupId
                    ? () => removeWireFromGroup(store.doc.wires[selectedWire.wireId]!.twistGroupId!, selectedWire.wireId)
                    : undefined
                }
              />
            </div>
          )}

          {selectedGroup && selected?.kind === 'group' && (
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
              />
            </div>
          )}

          {contextMenu && (
            <ContextMenu
              state={contextMenu}
              store={store}
              onClose={() => setContextMenu(null)}
              onDuplicate={duplicateComponent}
              onDelete={deleteSelected}
              onUngroupWire={removeWireFromGroup}
              onUngroup={ungroupWires}
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

/** Wire-properties popup — opened by clicking a routed trace on the canvas
 * (spec request: "add details to wire properties by clicking on the routed
 * trace, this serves as the symbol in the schematic"). Color/stripe are
 * swatch pickers over the same auto-assigned palette; part/gauge/refdes are
 * plain fields since there's no standalone parts-library browser yet. */
function WireInspector({
  store, wire, onDelete, onUngroupWire,
}: {
  store: HarnessStore;
  wire: SceneWire;
  onDelete: () => void;
  onUngroupWire?: () => void;
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
  const setPartNumber = (partNumber: string) => {
    store.transact('Edit wire part number', (draft) => {
      const p = ensureWirePart(draft, wire.wireId);
      p.partNumber = partNumber || undefined;
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
        <label style={s.fieldLabel}>Part number</label>
        <input
          style={s.input} placeholder="Wire part number" value={wirePart?.partNumber ?? ''}
          onChange={(e) => setPartNumber(e.target.value)}
        />

        {onUngroupWire && (
          <button style={s.addRowBtn} onClick={onUngroupWire}>Remove from group</button>
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
  store, group, memberWires, onUngroup, onRemoveMember,
}: {
  store: HarnessStore;
  group: WireGroup;
  memberWires: SceneWire[];
  onUngroup: () => void;
  onRemoveMember: (wireId: string) => void;
}) {
  const cablePart = group.partId ? store.doc.parts[group.partId] : undefined;

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

  const updateCablePart = (mutate: (p: { partNumber?: string; manufacturer?: string }) => void) => {
    store.transact('Edit cable part', (draft) => {
      const g = draft.wireGroups[group.id];
      if (!g?.partId) return;
      const p = draft.parts[g.partId];
      if (p) mutate(p as { partNumber?: string; manufacturer?: string });
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
      </div>
      <div style={s.cardBody}>
        <div style={s.tabRow}>
          <button style={s.tabBtn(group.kind === 'twist')} onClick={() => setKind('twist')}>Twist</button>
          <button style={s.tabBtn(group.kind === 'cable')} onClick={() => setKind('cable')}>Cable</button>
        </div>

        {group.kind === 'cable' && (
          <>
            <label style={s.fieldLabel}>Part number</label>
            <input
              style={s.input} value={cablePart?.partNumber ?? ''}
              onChange={(e) => { const v = e.target.value; updateCablePart((p) => { p.partNumber = v || undefined; }); }}
            />
            <label style={s.fieldLabel}>Manufacturer</label>
            <input
              style={s.input} value={cablePart?.manufacturer ?? ''}
              onChange={(e) => { const v = e.target.value; updateCablePart((p) => { p.manufacturer = v || undefined; }); }}
            />
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

/** Generic right-click context menu, wired to component nodes, wires, and
 * groups (spec request: "each component has a drop down menu when it is
 * right clicked so we can add new features as we go forward"). Item set is
 * deliberately small and real today (Edit / Duplicate / Flip / Delete /
 * Ungroup) with room to extend per target kind. */
function ContextMenu({
  state, store, onClose, onDuplicate, onDelete, onUngroupWire, onUngroup,
}: {
  state: ContextMenuState;
  store: HarnessStore;
  onClose: () => void;
  onDuplicate: (componentId: string) => void;
  onDelete: () => void;
  onUngroupWire: (groupId: string, wireId: string) => void;
  onUngroup: (groupId: string) => void;
}) {
  const items: { label: string; onClick: () => void; danger?: boolean }[] = [];

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
    items.push({ label: 'Delete wire', danger: true, onClick: () => { onDelete(); onClose(); } });
  } else {
    items.push({ label: 'Ungroup', onClick: () => { onUngroup(state.target.id); onClose(); } });
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
