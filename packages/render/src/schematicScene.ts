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

import type { HarnessDocument, Component, Endpoint, Point, SignalDirection, WireGroup } from '@openharness/core';
import { BACKSHELL_CAVITY_ID, DEFAULT_SHIELD_POSITION } from '@openharness/core';
import { computeRoutedPath, computeManualRoutedPath, pathMidpoint, pointsToPathD, type ExitDir } from './routing.js';
import { shieldTerminationMarks } from './overlays.js';
import { normalizeRotationDegrees } from './connectorOptimization.js';

export const ROW_HEIGHT = 22;
export const HEADER_HEIGHT = 24;
export const BOX_WIDTH = 160;

export interface SceneRow {
  /** Cavity id, core id, or a synthetic single-row id for splice/terminal/two-terminal. */
  rowId: string;
  label: string;
  signal?: string;
  point: Point;
  /** Which way this port's lead physically points — see routing.ts. */
  dir: ExitDir;
  /** Set only for rows backed by a real Cavity/CableCore (connector
   * cavities, cable cores) — undefined for splice/terminal/two-terminal
   * single-port rows, which have no signal-direction concept of their own
   * (Connor: "add directionality to the pins defined on each connector").
   * `signalCapable` is the discriminator the app uses to decide whether to
   * draw the direction-toggle/impedance controls and exit-direction
   * triangle on this row at all — it's true even when `direction` itself is
   * unset (unset just means "not specified yet", still a settable field). */
  signalCapable: boolean;
  direction?: SignalDirection;
  impedanceMatched?: boolean;
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
  /** Each port's exit direction, carried on the wire so a caller that wants
   * to re-run the router — the canvas does, to work out where a newly
   * dragged bend belongs — doesn't have to re-resolve both endpoints
   * against the row index to recover them. */
  fromDir: ExitDir;
  toDir: ExitDir;
  /** True if either endpoint couldn't be resolved to a real point (dangling reference). */
  degraded: boolean;
  /** Route between `from` and `to` with 45°-diagonal lane offsets (routing.ts). */
  routePoints: Point[];
  /** Same route, pre-serialized as an SVG path `d` for direct rendering. */
  path: string;
  /** Midpoint along the route — anchors the wire-properties popup on its trace. */
  midpoint: Point;
  /** The wire's manual bends, if any (Wire.schematicWaypoints) — the app
   * renders a draggable handle at each so they can be moved or removed.
   * Empty means this wire is auto-routed. */
  manualWaypoints: Point[];
}

/**
 * A shield termination node: a wirable port belonging to a WireGroup rather
 * than to any Component (see Endpoint's `shieldNode` case). Emitted only for
 * groups that have `shield.terminationNode` set, and only when at least one
 * member wire could actually be placed — an unplaced group has no run to
 * hang a node on.
 */
export interface SceneShieldNode {
  groupId: string;
  refdes: string;
  /** One per end of the run, in the same order as `shieldTerminationMarks`. */
  points: Point[];
  /** Where a drain wire attaches — the node closest to the source end.
   * A single anchor keeps the endpoint model simple (one `shieldNode`
   * endpoint per group, matching how net extraction keys it) while both
   * points are still drawn, so the shield reads as terminated at both ends. */
  anchor: Point;
}

export interface SceneNote {
  noteId: string;
  point: Point;
  text: string;
}

/**
 * A mate drawn on the schematic (T02). A mate is NOT a conductor — no wire,
 * no length, no BOM line (see Mate in core/types.ts) — so it gets its own
 * scene shape instead of reusing SceneWire: it joins the *centers* of the two
 * component boxes rather than two wirable ports, and there is nothing to
 * route. The canvas draws it dashed and distinctly coloured so it reads as a
 * mating relationship, never as a trace.
 */
export interface SceneMate {
  mateId: string;
  sourceId: string;
  targetId: string;
  /** Refdes of each end, carried on the scene (same reason SceneWire carries
   * refdes) so a drawing surface can label the mate without re-resolving the
   * document — the GUI tooltip today, PDF export later. */
  sourceRefdes: string;
  targetRefdes: string;
  /** Centre of the source component's box. */
  from: Point;
  /** Centre of the target component's box. */
  to: Point;
  /** Midpoint of the segment — anchors the on-canvas label and the inspector. */
  midpoint: Point;
  /** True when the mate carries a non-empty explicit cavityMap, which
   * overrides positional pairing entirely (DOMAIN-DECISIONS D3). Mirrors the
   * exact condition net extraction uses (`cavityMap && length > 0`) so the
   * drawing can never advertise a different pairing mode than the one the
   * derived model actually applies. */
  mapped: boolean;
}

export interface SchematicScene {
  nodes: SceneNode[];
  wires: SceneWire[];
  notes: SceneNote[];
  shieldNodes: SceneShieldNode[];
  mates: SceneMate[];
}

export function computeSchematicScene(doc: HarnessDocument): SchematicScene {
  const nodes: SceneNode[] = [];
  const stub = doc.settings.schematicExitStub;
  const routeOpts = stub === undefined ? {} : { stub };

  for (const component of Object.values(doc.components)) {
    const node = buildNode(component);
    if (node) nodes.push(node);
  }

  const rowIndex = buildRowIndex(nodes);

  /**
   * Wires are built in two passes because a shield termination node's
   * position is derived from the routed paths of the group's *member* wires,
   * and a drain wire targeting that node is not itself a member. Pass one
   * routes everything that resolves against component rows alone; the shield
   * node anchors are then computed from those routes; pass two routes the
   * drain wires that were waiting on them.
   *
   * A drain wire can't itself be a member of the group it terminates (it
   * connects the shield to something else), so this terminates in exactly
   * two passes — there is no chain to iterate to a fixed point.
   */
  const buildWire = (wire: HarnessDocument['wires'][string], shieldAnchors: Map<string, Anchor>): SceneWire => {
    const from = resolveAnchor(wire.source, rowIndex, shieldAnchors);
    const to = resolveAnchor(wire.target, rowIndex, shieldAnchors);
    const degraded = !from || !to;
    const fromPoint = from?.point ?? { x: 0, y: 0 };
    const toPoint = to?.point ?? { x: 0, y: 0 };
    const manualWaypoints = wire.schematicWaypoints ?? [];
    // A degraded (dangling) wire has nothing sensible to route between —
    // draw it as a straight line so it's still visible as broken, rather
    // than running the elbow router on a meaningless anchor.
    const routed = degraded
      ? { points: [fromPoint, toPoint], d: pointsToPathD([fromPoint, toPoint]) }
      : manualWaypoints.length > 0
        // Manual override (Connor: reimplement drag-to-bend) — the user's
        // own bends, with the port stubs still enforced at either end. See
        // computeManualRoutePoints for why the stubs aren't negotiable.
        ? computeManualRoutedPath(fromPoint, from!.dir, toPoint, to!.dir, manualWaypoints, routeOpts)
        : computeRoutedPath(fromPoint, from!.dir, toPoint, to!.dir, routeOpts);
    return {
      wireId: wire.id,
      refdes: wire.refdes,
      color: wire.color,
      stripeColor: wire.stripeColor,
      from: fromPoint,
      to: toPoint,
      fromDir: from?.dir ?? 'right',
      toDir: to?.dir ?? 'left',
      degraded,
      routePoints: routed.points,
      path: routed.d,
      midpoint: pathMidpoint(routed.points),
      manualWaypoints,
    };
  };

  const allWires = Object.values(doc.wires);
  const touchesShieldNode = (w: (typeof allWires)[number]) =>
    w.source.kind === 'shieldNode' || w.target.kind === 'shieldNode';

  const noAnchorsYet = new Map<string, Anchor>();
  const memberScene = new Map<string, SceneWire>();
  for (const wire of allWires) {
    if (touchesShieldNode(wire)) continue;
    memberScene.set(wire.id, buildWire(wire, noAnchorsYet));
  }

  const shieldNodes = buildShieldNodes(doc, memberScene);
  const shieldAnchors = new Map<string, Anchor>(
    shieldNodes.map((n) => [n.groupId, { point: n.anchor, dir: 'right' as ExitDir }]),
  );

  const wires: SceneWire[] = allWires.map(
    (wire) => memberScene.get(wire.id) ?? buildWire(wire, shieldAnchors),
  );

  const notes: SceneNote[] = Object.values(doc.notes).map((note) => ({
    noteId: note.id,
    point: note.schematicPosition,
    text: note.text,
  }));

  const mates = buildMates(doc, nodes);

  return { nodes, wires, notes, shieldNodes, mates };
}

/**
 * Mate geometry (T02 §"What is missing" item 3): one segment per mate,
 * centre-to-centre between the two mated components.
 *
 * Mates whose components no longer exist — or are not placed on this canvas —
 * are skipped rather than drawn degraded. Net extraction and the mate rules
 * ignore such mates too ("a mate naming a component that no longer exists is
 * ignored, not thrown on"), so the drawing agrees with the derived model
 * instead of advertising a join that isn't happening. An unplaced component
 * has no box to join; its mate reappears the moment both ends are placed.
 */
function buildMates(doc: HarnessDocument, nodes: SceneNode[]): SceneMate[] {
  const nodeById = new Map(nodes.map((n) => [n.componentId, n]));
  const out: SceneMate[] = [];
  for (const mate of Object.values(doc.mates ?? {})) {
    const source = doc.components[mate.sourceId];
    const target = doc.components[mate.targetId];
    if (!source || !target) continue;
    const sourceNode = nodeById.get(mate.sourceId);
    const targetNode = nodeById.get(mate.targetId);
    if (!sourceNode || !targetNode) continue;
    const from = nodeCenter(sourceNode);
    const to = nodeCenter(targetNode);
    out.push({
      mateId: mate.id,
      sourceId: mate.sourceId,
      targetId: mate.targetId,
      sourceRefdes: source.refdes,
      targetRefdes: target.refdes,
      from,
      to,
      midpoint: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
      mapped: !!mate.cavityMap && mate.cavityMap.length > 0,
    });
  }
  return out;
}

function nodeCenter(node: SceneNode): Point {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

function buildShieldNodes(doc: HarnessDocument, memberScene: Map<string, SceneWire>): SceneShieldNode[] {
  const out: SceneShieldNode[] = [];
  for (const group of Object.values(doc.wireGroups)) {
    if (!group.shield?.terminationNode) continue;
    const members = collectGroupMembers(doc, group, new Set())
      .map((id) => memberScene.get(id))
      .filter((w): w is SceneWire => !!w && !w.degraded);
    if (members.length === 0) continue;
    const marks = shieldTerminationMarks(members, group.shield.position ?? DEFAULT_SHIELD_POSITION);
    if (marks.length === 0) continue;
    out.push({
      groupId: group.id,
      refdes: group.refdes ?? 'SHIELD',
      points: marks.map((m) => m.nodePoint),
      anchor: marks[0]!.nodePoint,
    });
  }
  return out;
}

/** A group's member wire ids, following `memberGroupIds` so a shield on a
 * jacketed cable that contains two twisted pairs encircles all four wires,
 * not just the (zero) wires the outer group lists directly. `seen` guards
 * against a malformed document with a cyclic group nesting. */
export function collectGroupMembers(doc: HarnessDocument, group: WireGroup, seen: Set<string>): string[] {
  if (seen.has(group.id)) return [];
  seen.add(group.id);
  const out = [...group.memberWireIds];
  for (const childId of group.memberGroupIds) {
    const child = doc.wireGroups[childId];
    if (child) out.push(...collectGroupMembers(doc, child, seen));
  }
  return out;
}

function buildNode(component: Component): SceneNode | null {
  const pos = component.schematicPosition;
  if (!pos) return null; // branch points, and anything not yet placed on this canvas

  switch (component.type) {
    case 'connector': {
      const flipped = component.flipped === true;
      const widthPercent = component.widthPercent ?? 100;
      const unrotatedWidth = Math.round((BOX_WIDTH * widthPercent) / 100);
      const rot = normalizeRotationDegrees(component.rotation ?? 0);
      const isTransposed = rot === 90 || rot === 270;

      const totalRowCount = component.cavities.length + (component.backshellTermination ? 1 : 0);
      const unrotatedHeight = HEADER_HEIGHT + Math.max(1, totalRowCount) * ROW_HEIGHT;

      const width = isTransposed ? unrotatedHeight : unrotatedWidth;
      const height = isTransposed ? unrotatedWidth : unrotatedHeight;

      // Known limitation: wire exit stubs point horizontally ('left' | 'right')
      // even when the connector is rotated 90° or 270° and ports sit on top/bottom
      // horizontal edges. This causes exit stubs to run along the box edge rather
      // than exiting perpendicularly through it. Fixing this requires extending
      // ExitDir from 'left' | 'right' to 4 directions ('left' | 'right' | 'up' | 'down')
      // and updating the router (routing.ts / manualRouting.ts); tracked as a follow-up.
      const calcRowPointAndDir = (baseY: number): { point: Point; dir: ExitDir } => {
        let pt: Point;
        let dir: ExitDir;
        if (rot === 0) {
          pt = { x: pos.x + (flipped ? 0 : unrotatedWidth), y: pos.y + baseY };
          dir = flipped ? 'left' : 'right';
        } else if (rot === 90) {
          pt = { x: pos.x + (unrotatedHeight - baseY), y: pos.y + (flipped ? 0 : unrotatedWidth) };
          dir = flipped ? 'left' : 'right';
        } else if (rot === 180) {
          pt = { x: pos.x + (flipped ? unrotatedWidth : 0), y: pos.y + (unrotatedHeight - baseY) };
          dir = flipped ? 'right' : 'left';
        } else { // 270
          pt = { x: pos.x + baseY, y: pos.y + (flipped ? unrotatedWidth : 0) };
          dir = flipped ? 'left' : 'right';
        }
        return { point: pt, dir };
      };

      const rows: SceneRow[] = component.cavities.map((cavity, i) => {
        const baseY = HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2;
        const { point, dir } = calcRowPointAndDir(baseY);
        return {
          rowId: cavity.id,
          label: cavity.designation,
          signal: cavity.signal,
          point,
          dir,
          signalCapable: true,
          direction: cavity.direction,
          impedanceMatched: cavity.impedanceMatched,
        };
      });
      // Backshell termination (Connor: "an optional connector 'backshell
      // termination' toggle that adds a BS contact"). Appended as an extra
      // row below the real cavities — wirable like any other port, but not a
      // cavity: `signalCapable: false`, so it gets no direction/impedance
      // controls (a shell ground has no signal direction), and it is never
      // written back into `component.cavities`. See BACKSHELL_CAVITY_ID.
      if (component.backshellTermination) {
        const baseY = HEADER_HEIGHT + component.cavities.length * ROW_HEIGHT + ROW_HEIGHT / 2;
        const { point, dir } = calcRowPointAndDir(baseY);
        rows.push({
          rowId: BACKSHELL_CAVITY_ID,
          label: 'BS',
          point,
          dir,
          signalCapable: false,
        });
      }
      return {
        componentId: component.id, type: component.type, refdes: component.refdes, label: component.label,
        x: pos.x, y: pos.y, width, height,
        rows,
      };
    }
    case 'cable': {
      const flipped = component.flipped === true;
      const dir: ExitDir = flipped ? 'left' : 'right';
      const exitX = flipped ? pos.x : pos.x + BOX_WIDTH;
      const all = [...component.cores, ...(component.shield ? [component.shield] : [])];
      const rows: SceneRow[] = all.map((core, i) => ({
        rowId: core.id,
        label: core.designation ?? String(i + 1),
        signal: core.signal,
        point: { x: exitX, y: pos.y + HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2 },
        dir,
        signalCapable: true,
        direction: core.direction,
        impedanceMatched: core.impedanceMatched,
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
          { rowId: `${component.id}:Left`, label: 'L', point: { x: pos.x, y: pos.y + height / 2 }, dir: 'left', signalCapable: false },
          { rowId: `${component.id}:Right`, label: 'R', point: { x: pos.x + width, y: pos.y + height / 2 }, dir: 'right', signalCapable: false },
        ],
      };
    }
    case 'terminal': {
      // Same flip and rotation affordance as Connector (Connor: "ensure all
      // relevant features added to the connector objects also appear in
      // the other components") — a terminal has exactly one directional
      // port, same shape of problem.
      const flipped = component.flipped === true;
      const unrotatedWidth = BOX_WIDTH * 0.6;
      const unrotatedHeight = HEADER_HEIGHT + ROW_HEIGHT;
      const rot = normalizeRotationDegrees(component.rotation ?? 0);
      const isTransposed = rot === 90 || rot === 270;

      const width = isTransposed ? unrotatedHeight : unrotatedWidth;
      const height = isTransposed ? unrotatedWidth : unrotatedHeight;

      const baseY = unrotatedHeight / 2;
      let point: Point;
      let dir: ExitDir;
      if (rot === 0) {
        point = { x: pos.x + (flipped ? 0 : unrotatedWidth), y: pos.y + baseY };
        dir = flipped ? 'left' : 'right';
      } else if (rot === 90) {
        point = { x: pos.x + (unrotatedHeight - baseY), y: pos.y + (flipped ? 0 : unrotatedWidth) };
        dir = flipped ? 'left' : 'right';
      } else if (rot === 180) {
        point = { x: pos.x + (flipped ? unrotatedWidth : 0), y: pos.y + (unrotatedHeight - baseY) };
        dir = flipped ? 'right' : 'left';
      } else { // 270
        point = { x: pos.x + baseY, y: pos.y + (flipped ? unrotatedWidth : 0) };
        dir = flipped ? 'left' : 'right';
      }

      return {
        componentId: component.id, type: component.type, refdes: component.refdes, label: component.label,
        x: pos.x, y: pos.y, width, height,
        rows: [{ rowId: component.id, label: component.terminalKind, point, dir, signalCapable: false }],
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
          { rowId: `${component.id}:Left`, label: 'L', point: { x: pos.x, y: pos.y + height / 2 }, dir: 'left', signalCapable: false },
          { rowId: `${component.id}:Right`, label: 'R', point: { x: pos.x + width, y: pos.y + height / 2 }, dir: 'right', signalCapable: false },
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

export interface Anchor {
  point: Point;
  dir: ExitDir;
}

/** rowId -> {point,dir}, per component, so wire endpoints can be resolved
 * without re-walking every node. */
function buildRowIndex(nodes: SceneNode[]): Map<string, Map<string, Anchor>> {
  const index = new Map<string, Map<string, Anchor>>();
  for (const node of nodes) {
    const rowMap = new Map<string, Anchor>();
    for (const row of node.rows) rowMap.set(row.rowId, { point: row.point, dir: row.dir });
    index.set(node.componentId, rowMap);
  }
  return index;
}

function resolveAnchor(
  endpoint: Endpoint,
  index: Map<string, Map<string, Anchor>>,
  shieldAnchors: Map<string, Anchor>,
): Anchor | null {
  switch (endpoint.kind) {
    case 'shieldNode':
      // Null until the shield-node pass has run — that's what makes the
      // first pass skip drain wires rather than routing them to (0,0).
      return shieldAnchors.get(endpoint.groupId) ?? null;
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
      return { point: endpoint.point, dir: 'right' };
  }
}
