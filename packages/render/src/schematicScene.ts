/**
 * Schematic scene builder (spec §5.1, §7.2). Pure function: HarnessDocument
 * in, a positioned scene graph out. No DOM, no canvas, no React — this is
 * what makes it reusable for both the interactive GUI canvas and (later)
 * PDF export (spec §9), and safe for an automation to call directly (e.g.
 * to render a preview) without pulling in any UI framework.
 *
 * Layout within a component box is intentionally simple for this first pass
 * — a single exit point per row rather than the real app's left/right
 * fanning (spec §7.2) — good enough to see and edit connectivity; the
 * fancier routing is a rendering-quality improvement, not a data-model one.
 */

import type { HarnessDocument, Component, Endpoint, Point } from '@openharness/core';

export const ROW_HEIGHT = 22;
export const HEADER_HEIGHT = 24;
export const BOX_WIDTH = 160;

export interface SceneRow {
  /** Cavity id, core id, or a synthetic single-row id for splice/terminal/two-terminal. */
  rowId: string;
  label: string;
  signal?: string;
  point: Point;
}

export interface SceneNode {
  componentId: string;
  type: Component['type'];
  refdes: string;
  label?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rows: SceneRow[];
}

export interface SceneWire {
  wireId: string;
  refdes: string;
  color: string;
  stripeColor?: string;
  from: Point;
  to: Point;
  /** True if either endpoint couldn't be resolved to a real point (dangling reference). */
  degraded: boolean;
}

export interface SceneNote {
  noteId: string;
  point: Point;
  text: string;
}

export interface SchematicScene {
  nodes: SceneNode[];
  wires: SceneWire[];
  notes: SceneNote[];
}

export function computeSchematicScene(doc: HarnessDocument): SchematicScene {
  const nodes: SceneNode[] = [];

  for (const component of Object.values(doc.components)) {
    const node = buildNode(component);
    if (node) nodes.push(node);
  }

  const nodesById = new Map(nodes.map((n) => [n.componentId, n]));
  const rowPointIndex = buildRowPointIndex(nodes);

  const wires: SceneWire[] = Object.values(doc.wires).map((wire) => {
    const from = resolvePoint(wire.source, rowPointIndex);
    const to = resolvePoint(wire.target, rowPointIndex);
    return {
      wireId: wire.id,
      refdes: wire.refdes,
      color: wire.color,
      stripeColor: wire.stripeColor,
      from: from ?? { x: 0, y: 0 },
      to: to ?? { x: 0, y: 0 },
      degraded: !from || !to,
    };
  });

  const notes: SceneNote[] = Object.values(doc.notes).map((note) => ({
    noteId: note.id,
    point: note.schematicPosition,
    text: note.text,
  }));

  void nodesById; // kept for callers that want node lookup alongside the scene
  return { nodes, wires, notes };
}

function buildNode(component: Component): SceneNode | null {
  const pos = component.schematicPosition;
  if (!pos) return null; // branch points, and anything not yet placed on this canvas

  switch (component.type) {
    case 'connector': {
      const flipped = component.flipped === true;
      const exitX = flipped ? pos.x : pos.x + BOX_WIDTH;
      const rows: SceneRow[] = component.cavities.map((cavity, i) => ({
        rowId: cavity.id,
        label: cavity.designation,
        signal: cavity.signal,
        point: { x: exitX, y: pos.y + HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2 },
      }));
      return {
        componentId: component.id, type: component.type, refdes: component.refdes, label: component.label,
        x: pos.x, y: pos.y, width: BOX_WIDTH, height: HEADER_HEIGHT + Math.max(1, rows.length) * ROW_HEIGHT,
        rows,
      };
    }
    case 'cable': {
      const flipped = component.flipped === true;
      const exitX = flipped ? pos.x : pos.x + BOX_WIDTH;
      const all = [...component.cores, ...(component.shield ? [component.shield] : [])];
      const rows: SceneRow[] = all.map((core, i) => ({
        rowId: core.id,
        label: core.designation ?? String(i + 1),
        signal: core.signal,
        point: { x: exitX, y: pos.y + HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2 },
      }));
      return {
        componentId: component.id, type: component.type, refdes: component.refdes, label: component.label,
        x: pos.x, y: pos.y, width: BOX_WIDTH, height: HEADER_HEIGHT + Math.max(1, rows.length) * ROW_HEIGHT,
        rows,
      };
    }
    case 'splice': {
      // Drawn with a port on each side, like a two-terminal part (Connor's
      // request: "the splice should have two connections on either end like
      // a resistor"). Structurally a splice stays an n-ary hyper-node — any
      // number of wires can land on either port and they're all on the same
      // net (spec §3.3/§6.1: "Splices have one handle for all wires"). Both
      // rows resolve to the same underlying `{kind:'splice'}` endpoint; see
      // resolvePoint() below, which picks whichever row is present rather
      // than requiring an exact componentId-keyed row.
      const height = HEADER_HEIGHT + ROW_HEIGHT;
      const width = BOX_WIDTH * 0.7;
      return {
        componentId: component.id, type: component.type, refdes: component.refdes, label: component.label,
        x: pos.x, y: pos.y, width, height,
        rows: [
          { rowId: `${component.id}:Left`, label: 'L', point: { x: pos.x, y: pos.y + height / 2 } },
          { rowId: `${component.id}:Right`, label: 'R', point: { x: pos.x + width, y: pos.y + height / 2 } },
        ],
      };
    }
    case 'terminal': {
      const height = HEADER_HEIGHT + ROW_HEIGHT;
      return {
        componentId: component.id, type: component.type, refdes: component.refdes, label: component.label,
        x: pos.x, y: pos.y, width: BOX_WIDTH * 0.6, height,
        rows: [{ rowId: component.id, label: component.terminalKind, point: { x: pos.x + BOX_WIDTH * 0.6, y: pos.y + height / 2 } }],
      };
    }
    case 'resistor':
    case 'diode': {
      const height = HEADER_HEIGHT + ROW_HEIGHT;
      const width = BOX_WIDTH * 0.7;
      return {
        componentId: component.id, type: component.type, refdes: component.refdes, label: component.label,
        x: pos.x, y: pos.y, width, height,
        rows: [
          { rowId: `${component.id}:Left`, label: 'L', point: { x: pos.x, y: pos.y + height / 2 } },
          { rowId: `${component.id}:Right`, label: 'R', point: { x: pos.x + width, y: pos.y + height / 2 } },
        ],
      };
    }
    case 'generic': {
      const height = HEADER_HEIGHT + ROW_HEIGHT;
      return {
        componentId: component.id, type: component.type, refdes: component.refdes, label: component.label,
        x: pos.x, y: pos.y, width: BOX_WIDTH * 0.6, height, rows: [],
      };
    }
    // No `case 'branchPoint'` here: TS narrows it away entirely after the
    // `if (!pos) return null` guard above, since BranchPoint.schematicPosition
    // is typed as always-undefined (spec §4.2) — a branch point can never
    // reach this switch. Confirmed exhaustive by the compiler, not asserted.
  }
}

/** rowId -> point, per component, so wire endpoints can be resolved without re-walking every node. */
function buildRowPointIndex(nodes: SceneNode[]): Map<string, Map<string, Point>> {
  const index = new Map<string, Map<string, Point>>();
  for (const node of nodes) {
    const rowMap = new Map<string, Point>();
    for (const row of node.rows) rowMap.set(row.rowId, row.point);
    index.set(node.componentId, rowMap);
  }
  return index;
}

function resolvePoint(endpoint: Endpoint, index: Map<string, Map<string, Point>>): Point | null {
  switch (endpoint.kind) {
    case 'cavity':
      return index.get(endpoint.componentId)?.get(endpoint.cavityId) ?? null;
    case 'cableCore':
      return index.get(endpoint.componentId)?.get(endpoint.coreId) ?? null;
    case 'splice':
    case 'terminalPoint': {
      // Splice rows are keyed `${id}:Left` / `${id}:Right` (two visual ports
      // on one n-ary net endpoint, see buildNode above), and a terminal's
      // single row is keyed by its own componentId — neither is guaranteed
      // to equal `endpoint.componentId` exactly, so pick whichever row this
      // component has rather than requiring an exact key match.
      const rowMap = index.get(endpoint.componentId);
      if (!rowMap) return null;
      const first = rowMap.values().next();
      return first.done ? null : first.value;
    }
    case 'twoTerminalSide':
      return index.get(endpoint.componentId)?.get(`${endpoint.componentId}:${endpoint.side}`) ?? null;
    case 'free':
      return endpoint.point;
  }
}
