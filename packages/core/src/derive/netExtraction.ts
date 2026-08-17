/**
 * Net extraction (spec §6.1). A net is a connected component of the
 * electrical graph:
 *
 *   Vertices: every cavity, every splice (one hyper-node, not per-wire),
 *             every terminal-point, every two-terminal side (Left/Right —
 *             NOT unioned with each other; a resistor/diode separates nets),
 *             every cable core/shield, every free wire end.
 *   Edges:    every wire (source ↔ target).
 *   Global:   cavities with `global: true` and the same `signal` merge into
 *             one net across the whole document, with no drawn wire.
 *
 * Union-Find, O(α(n)) per operation.
 */

import type { HarnessDocument, Endpoint, Net, Component } from '../types.js';
import type { WireId } from '../ids.js';
import { UnionFind } from './unionFind.js';

export function endpointKey(endpoint: Endpoint, wireId: WireId, end: 'source' | 'target'): string {
  switch (endpoint.kind) {
    case 'cavity':
      return `cavity:${endpoint.componentId}:${endpoint.cavityId}`;
    case 'cableCore':
      return `cableCore:${endpoint.componentId}:${endpoint.coreId}`;
    case 'splice':
      return `splice:${endpoint.componentId}`;
    case 'terminalPoint':
      return `terminalPoint:${endpoint.componentId}`;
    case 'twoTerminalSide':
      return `twoTerminal:${endpoint.componentId}:${endpoint.side}`;
    case 'shieldNode':
      // One vertex per shielded group, not per wire — a shield is a single
      // conductor, so two drain wires landing on the same shield are on the
      // same net, exactly like two wires landing on the same splice.
      return `shieldNode:${endpoint.groupId}`;
    case 'free':
      return `free:${wireId}:${end}`;
  }
}

interface SignalSource {
  refdes: string;
  orderIndex: number;
  signal?: string;
  global?: boolean;
  noPropagate?: boolean;
}

export interface NetExtractionResult {
  nets: Net[];
  /** vertex key -> net id, for O(1) lookup from routing/rules/BOM. */
  netIdByVertex: Map<string, string>;
  /** net id -> distinct explicit signal names found on it, when there's more than one (spec: NET_SIGNAL_CONFLICT). */
  conflicts: Map<string, string[]>;
}

export function extractNets(doc: HarnessDocument): NetExtractionResult {
  const uf = new UnionFind<string>();
  const sourceRegistry = new Map<string, SignalSource>();

  // 1. Register every static vertex so unwired cavities/cores still get a
  //    (singleton) net rather than being invisible to the derived model.
  for (const component of Object.values(doc.components)) {
    registerComponentVertices(component, uf, sourceRegistry);
  }

  // 1b. Shield termination nodes (WireGroup.shield.terminationNode) are
  //     vertices too, and registered here for the same reason unwired
  //     cavities are: a shield with a node but no drain wire yet should
  //     still appear as its own (singleton) net rather than being invisible
  //     until someone happens to wire it.
  for (const group of Object.values(doc.wireGroups)) {
    if (group.shield?.terminationNode) uf.add(`shieldNode:${group.id}`);
  }

  // 2. Union across every wire.
  for (const [wireId, wire] of Object.entries(doc.wires)) {
    const a = endpointKey(wire.source, wireId, 'source');
    const b = endpointKey(wire.target, wireId, 'target');
    uf.add(a);
    uf.add(b);
    uf.union(a, b);
  }

  // 3. Global-signal merge: same signal name, global:true, anywhere in the document.
  const globalGroups = new Map<string, string[]>();
  for (const [vertexKey, src] of sourceRegistry) {
    if (src.global && src.signal) {
      if (!globalGroups.has(src.signal)) globalGroups.set(src.signal, []);
      globalGroups.get(src.signal)!.push(vertexKey);
    }
  }
  for (const vertices of globalGroups.values()) {
    for (let i = 1; i < vertices.length; i++) {
      uf.union(vertices[0]!, vertices[i]!);
    }
  }

  // 4. Materialise nets from the union-find groups.
  const nets: Net[] = [];
  const netIdByVertex = new Map<string, string>();
  const conflicts = new Map<string, string[]>();

  const groups = [...uf.groups().values()].sort((a, b) => minOf(a).localeCompare(minOf(b)));

  for (const members of groups) {
    const sortedMembers = [...members].sort();
    const netId = `net:${minOf(sortedMembers)}`;
    for (const m of sortedMembers) netIdByVertex.set(m, netId);

    const { signal, conflictingSignals } = resolveNetSignal(sortedMembers, sourceRegistry);
    if (conflictingSignals.length > 1) conflicts.set(netId, conflictingSignals);

    nets.push({ id: netId, memberIds: sortedMembers, signal });
  }

  return { nets, netIdByVertex, conflicts };
}

function minOf(xs: string[]): string {
  return xs.reduce((a, b) => (a < b ? a : b));
}

function registerComponentVertices(
  component: Component,
  uf: UnionFind<string>,
  registry: Map<string, SignalSource>,
): void {
  switch (component.type) {
    case 'connector':
      component.cavities.forEach((cavity, index) => {
        const key = `cavity:${component.id}:${cavity.id}`;
        uf.add(key);
        registry.set(key, {
          refdes: component.refdes,
          orderIndex: index,
          signal: cavity.signal,
          global: cavity.global,
          noPropagate: cavity.noPropagate,
        });
      });
      return;
    case 'splice':
      uf.add(`splice:${component.id}`);
      return;
    case 'terminal':
      uf.add(`terminalPoint:${component.id}`);
      return;
    case 'branchPoint':
      // Layout-only; not part of the electrical graph.
      return;
    case 'resistor':
    case 'diode':
      uf.add(`twoTerminal:${component.id}:Left`);
      uf.add(`twoTerminal:${component.id}:Right`);
      return;
    case 'cable': {
      const all = [...component.cores, ...(component.shield ? [component.shield] : [])];
      all.forEach((core, index) => {
        const key = `cableCore:${component.id}:${core.id}`;
        uf.add(key);
        registry.set(key, { refdes: component.refdes, orderIndex: index, signal: core.signal });
      });
      return;
    }
    case 'generic':
      return;
  }
}

function resolveNetSignal(
  memberKeys: string[],
  registry: Map<string, SignalSource>,
): { signal?: string; conflictingSignals: string[] } {
  const eligible = memberKeys
    .map((k) => registry.get(k))
    .filter((s): s is SignalSource => !!s && !s.noPropagate && !!s.signal);

  if (eligible.length === 0) return { signal: undefined, conflictingSignals: [] };

  const globals = eligible.filter((s) => s.global);
  const candidates = globals.length > 0 ? globals : eligible;

  candidates.sort((a, b) => a.refdes.localeCompare(b.refdes) || a.orderIndex - b.orderIndex);

  const distinct = [...new Set(candidates.map((c) => c.signal!))];
  return { signal: candidates[0]!.signal, conflictingSignals: distinct };
}
