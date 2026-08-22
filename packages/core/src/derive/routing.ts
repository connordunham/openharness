/**
 * Wire routing through the layout graph (spec §6.2). This is the mechanism
 * behind NO_ROUTE / JUMPER / SHIELD statuses.
 *
 *   Layout graph G = (V, E)
 *     V = components with a layoutPosition, plus branch points
 *     E = bundles
 *
 *   For each wire w:
 *     - a cable core/shield endpoint short-circuits routing entirely
 *       (status 'jumper' / 'shield') — the cable is the physical carrier.
 *     - otherwise resolve each end to a layout host; an unplaced splice
 *       resolves recursively through its neighbours (with a visited-set to
 *       terminate splice-to-splice chains); if that doesn't converge on one
 *       node, the splice — and therefore the wire — is unplaced.
 *     - same host on both ends → zero-length "exact" route (spec's
 *       pseudocode calls this 'internal'; reconciled here to 'exact' since
 *       LengthStatus has no separate internal state — see spec §4.4/§6.2).
 *     - otherwise: use a frozen `wire.route` if it's a valid walk, else
 *       Dijkstra shortest path, tie-broken by lexicographically smallest
 *       bundle-id sequence for reproducibility (spec: ROUTE_AMBIGUOUS).
 */

import type { HarnessDocument, Endpoint, RouteResult, Cable } from '../types.js';
import type { ComponentId, BundleId } from '../ids.js';
import { bundleAuthoredLength } from './bundleLength.js';

export function computeRoutes(doc: HarnessDocument): Map<string, RouteResult> {
  const graph = buildLayoutGraph(doc);
  const routes = new Map<string, RouteResult>();

  for (const [wireId, wire] of Object.entries(doc.wires)) {
    // A wire landing on a shield termination node is the shield's drain /
    // pigtail. It has no independent path through the bundle graph — it runs
    // alongside the very wires it shields — so it short-circuits exactly like
    // a cable's own shield core does, and for the same reason: the physical
    // carrier already accounts for the distance.
    if (wire.source.kind === 'shieldNode' || wire.target.kind === 'shieldNode') {
      routes.set(wireId, { status: 'shield', segments: [] });
      continue;
    }

    const cableStatus = cableCoreStatus(doc, wire.source) ?? cableCoreStatus(doc, wire.target);
    if (cableStatus) {
      routes.set(wireId, { status: cableStatus, segments: [] });
      continue;
    }

    const aHost = resolveEndpointHost(doc, wire.source, new Set(), wireId);
    const bHost = resolveEndpointHost(doc, wire.target, new Set(), wireId);

    if (aHost === undefined || bHost === undefined) {
      routes.set(wireId, { status: 'unplaced', segments: [] });
      continue;
    }

    if (aHost === bHost) {
      routes.set(wireId, { status: 'exact', segments: [] });
      continue;
    }

    const frozen = wire.route && isValidWalk(graph, wire.route, aHost, bHost) ? wire.route : undefined;
    if (frozen) {
      routes.set(wireId, { status: routeAuthoredStatus(graph, frozen), segments: frozen });
      continue;
    }

    const path = shortestPath(graph, aHost, bHost);
    if (!path) {
      routes.set(wireId, { status: 'noRoute', segments: [] });
      continue;
    }
    routes.set(wireId, { status: routeAuthoredStatus(graph, path), segments: path });
  }

  return routes;
}

// ---------------------------------------------------------------------------
// Cable core/shield short-circuit
// ---------------------------------------------------------------------------

function cableCoreStatus(doc: HarnessDocument, endpoint: Endpoint): 'jumper' | 'shield' | undefined {
  if (endpoint.kind !== 'cableCore') return undefined;
  const cable = doc.components[endpoint.componentId] as Cable | undefined;
  if (!cable || cable.type !== 'cable') return 'jumper';
  return cable.shield?.id === endpoint.coreId ? 'shield' : 'jumper';
}

// ---------------------------------------------------------------------------
// Layout host resolution
// ---------------------------------------------------------------------------

function resolveEndpointHost(
  doc: HarnessDocument,
  endpoint: Endpoint,
  visited: Set<ComponentId>,
  excludeWireId?: string,
): ComponentId | undefined {
  switch (endpoint.kind) {
    case 'cavity':
    case 'cableCore':
    case 'splice':
    case 'terminalPoint':
    case 'twoTerminalSide':
      return resolveComponentHost(doc, endpoint.componentId, visited, excludeWireId);
    case 'shieldNode':
      // Unreachable in practice: computeRoutes short-circuits shieldNode
      // wires to status 'shield' before host resolution is ever attempted.
      // Present so the switch stays exhaustive under the compiler rather
      // than relying on a default case that would silently swallow a future
      // endpoint kind.
      return undefined;
    case 'free':
      return undefined;
  }
}

/**
 * Exported for the SPLICE_UNPLACED / UNPLACED_COMPONENT rules (spec §6.5).
 *
 * `excludeWireId`, when given, is the wire currently being routed — per the
 * spec's pseudocode ("H = { layoutHost(other end of w) for w attached to S,
 * excluding the wire being routed }"), a splice's own host resolution must
 * not traverse back through the very wire whose route is being computed, or
 * an otherwise-unambiguous splice (all its *other* wires agree on one host)
 * looks falsely ambiguous because the wire being priced counts itself as a
 * second vote. Only excluded at the top level, not during the recursive
 * splice-to-splice hops beneath it — the `visited` set already prevents
 * infinite loops there.
 */
export function resolveComponentHost(
  doc: HarnessDocument,
  componentId: ComponentId,
  visited: Set<ComponentId>,
  excludeWireId?: string,
): ComponentId | undefined {
  const component = doc.components[componentId];
  if (!component) return undefined;
  if (component.layoutPosition) return componentId;
  if (component.type !== 'splice') return undefined; // no layoutPosition, not transparent -> unplaced

  if (visited.has(componentId)) return undefined; // terminate splice-to-splice chains
  visited.add(componentId);

  const neighborHosts = new Set<ComponentId>();
  for (const [wireId, wire] of Object.entries(doc.wires)) {
    if (wireId === excludeWireId) continue;
    for (const [end, endpoint] of [['source', wire.source], ['target', wire.target]] as const) {
      if (endpoint.kind === 'splice' && endpoint.componentId === componentId) {
        const other = end === 'source' ? wire.target : wire.source;
        // excludeWireId only applies at the top level; recursive hops consider all wires.
        const host = resolveEndpointHost(doc, other, visited);
        if (host !== undefined) neighborHosts.add(host);
      }
    }
  }

  return neighborHosts.size === 1 ? [...neighborHosts][0] : undefined;
}

// ---------------------------------------------------------------------------
// Layout graph + Dijkstra
// ---------------------------------------------------------------------------

interface LayoutEdge {
  bundleId: BundleId;
  to: ComponentId;
  weightUm: number;
  authored: boolean;
}

interface LayoutGraph {
  adjacency: Map<ComponentId, LayoutEdge[]>;
  bundlesById: Map<BundleId, { sourceId: ComponentId; targetId: ComponentId; authored: boolean }>;
}

function buildLayoutGraph(doc: HarnessDocument, excludeBundleId?: BundleId): LayoutGraph {
  const adjacency = new Map<ComponentId, LayoutEdge[]>();
  const bundlesById = new Map<BundleId, { sourceId: ComponentId; targetId: ComponentId; authored: boolean }>();

  const addEdge = (from: ComponentId, to: ComponentId, bundleId: BundleId, weightUm: number, authored: boolean) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from)!.push({ bundleId, to, weightUm, authored });
  };

  for (const [bundleId, bundle] of Object.entries(doc.bundles)) {
    // The extraction path (computeRouteAvoidingBundle) asks for a route with
    // one bundle removed; dropping the edge here is the whole of that.
    if (bundleId === excludeBundleId) continue;
    const a = doc.components[bundle.sourceId];
    const b = doc.components[bundle.targetId];
    if (!a || !b) continue;

    const { valueMm, authored } = bundleAuthoredLength(bundle);
    const weightUm = authored
      ? Math.round(valueMm * 1000) // authored in mm at this layer (spec §6.3)
      : geometricDistanceUm(a.layoutPosition, b.layoutPosition);

    bundlesById.set(bundleId, { sourceId: bundle.sourceId, targetId: bundle.targetId, authored });
    addEdge(bundle.sourceId, bundle.targetId, bundleId, weightUm, authored);
    addEdge(bundle.targetId, bundle.sourceId, bundleId, weightUm, authored);
  }

  return { adjacency, bundlesById };
}

function geometricDistanceUm(a?: { x: number; y: number }, b?: { x: number; y: number }): number {
  if (!a || !b) return 0;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.round(Math.sqrt(dx * dx + dy * dy) * 1000);
}

/** Every segment on the path has an authored bundle length. */
function routeAuthoredStatus(graph: LayoutGraph, path: BundleId[]): 'exact' | 'lowerBound' {
  return path.every((id) => graph.bundlesById.get(id)?.authored) ? 'exact' : 'lowerBound';
}

function isValidWalk(graph: LayoutGraph, route: BundleId[], from: ComponentId, to: ComponentId): boolean {
  let current = from;
  for (const bundleId of route) {
    const bundle = graph.bundlesById.get(bundleId);
    if (!bundle) return false;
    const next = bundle.sourceId === current ? bundle.targetId : bundle.targetId === current ? bundle.sourceId : undefined;
    if (next === undefined) return false;
    current = next;
  }
  return current === to;
}

/**
 * Dijkstra, O(V^2) — harness layout graphs are tiny (tens to low hundreds of
 * nodes), so a heap isn't worth the complexity here (spec §6.2). Ties are
 * broken by lexicographically smallest bundle-id sequence for reproducible
 * output (spec: ROUTE_AMBIGUOUS).
 */
function shortestPath(graph: LayoutGraph, from: ComponentId, to: ComponentId): BundleId[] | undefined {
  const dist = new Map<ComponentId, number>([[from, 0]]);
  const bestPath = new Map<ComponentId, BundleId[]>([[from, []]]);
  const visited = new Set<ComponentId>();

  while (true) {
    let current: ComponentId | undefined;
    let currentDist = Infinity;
    for (const [node, d] of dist) {
      if (!visited.has(node) && d < currentDist) {
        currentDist = d;
        current = node;
      }
    }
    if (current === undefined) break;
    if (current === to) return bestPath.get(to);
    visited.add(current);

    const edges = graph.adjacency.get(current) ?? [];
    for (const edge of edges) {
      if (visited.has(edge.to)) continue;
      const candidateDist = currentDist + edge.weightUm;
      const candidatePath = [...(bestPath.get(current) ?? []), edge.bundleId];
      const existingDist = dist.get(edge.to);

      if (existingDist === undefined || candidateDist < existingDist) {
        dist.set(edge.to, candidateDist);
        bestPath.set(edge.to, candidatePath);
      } else if (candidateDist === existingDist) {
        const existingPath = bestPath.get(edge.to)!;
        if (joinPath(candidatePath) < joinPath(existingPath)) {
          bestPath.set(edge.to, candidatePath);
        }
      }
    }
  }

  return bestPath.has(to) ? bestPath.get(to) : undefined;
}

/**
 * The tie-break key for a candidate route. The separator is NUL — spelled as
 * an escape, not a literal byte, because an invisible literal once got
 * silently edited into a space. NUL sorts below every printable character,
 * so the joined key orders route SEQUENCES unambiguously even when bundle ids
 * contain spaces (imported documents can): a space separator collapses
 * `['a b','c']` and `['a','b c']` into the same key, and the tie-break
 * degrades to "whichever path Dijkstra found first" — insertion-order
 * dependent, exactly what the tie-break exists to prevent.
 */
function joinPath(path: BundleId[]): string {
  return path.join('\0');
}

/**
 * The shortest route for one wire through the layout graph with a single
 * bundle removed — the core of "extract this wire from that bundle" (Phase 2,
 * docs/PHASE2-REFINED-DESIGN.md): extracting a wire means re-routing it around
 * the bundle, which is only possible when another path exists.
 *
 * Returns the alternate bundle sequence, or `undefined` when the wire has no
 * route that avoids the bundle (the bundle is its only way across, or the
 * wire is not routable through the graph at all — shield drain, cable core,
 * unplaced endpoint, same-host loop). Callers turn a found path into a frozen
 * `Wire.route` override; `computeRoutes` above then honours it (spec §6.2),
 * which is what keeps the wire out of the bundle afterwards.
 *
 * Deliberately does NOT check whether the wire currently uses `excludeBundleId`
 * — that is the caller's question, and this function stays a pure
 * "is there another way across" oracle.
 */
export function computeRouteAvoidingBundle(
  doc: HarnessDocument,
  wireId: string,
  excludeBundleId: BundleId,
): BundleId[] | undefined {
  const wire = doc.wires[wireId];
  if (!wire) return undefined;

  // Same short-circuits as computeRoutes: these wires have no bundle path by
  // construction, so there is nothing to re-route around anything.
  if (wire.source.kind === 'shieldNode' || wire.target.kind === 'shieldNode') return undefined;
  if (cableCoreStatus(doc, wire.source) || cableCoreStatus(doc, wire.target)) return undefined;

  const aHost = resolveEndpointHost(doc, wire.source, new Set(), wireId);
  const bHost = resolveEndpointHost(doc, wire.target, new Set(), wireId);
  if (aHost === undefined || bHost === undefined || aHost === bHost) return undefined;

  const graph = buildLayoutGraph(doc, excludeBundleId);
  return shortestPath(graph, aHost, bHost);
}
