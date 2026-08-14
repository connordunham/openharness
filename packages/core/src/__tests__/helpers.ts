import { createEmptyDocument } from '../document.js';
import type {
  HarnessDocument, Connector, Splice, Terminal, BranchPoint, TwoTerminal, Cable,
  Wire, Bundle, Cavity, Endpoint, Point,
} from '../types.js';

/** Small builder for constructing minimal documents in tests without the ceremony of the full type. */
export function doc(): HarnessDocument {
  return createEmptyDocument('Test');
}

export function cavity(id: string, overrides: Partial<Cavity> = {}): Cavity {
  return { id, designation: id, custom: {}, ...overrides };
}

export function connector(
  id: string,
  refdes: string,
  cavities: Cavity[],
  overrides: Partial<Connector> = {},
): Connector {
  return { id, type: 'connector', refdes, cavities, custom: {}, ...overrides };
}

export function splice(id: string, refdes: string, overrides: Partial<Splice> = {}): Splice {
  return { id, type: 'splice', refdes, custom: {}, ...overrides };
}

export function terminal(id: string, refdes: string, overrides: Partial<Terminal> = {}): Terminal {
  return { id, type: 'terminal', refdes, terminalKind: 'ring', custom: {}, ...overrides };
}

export function branchPoint(id: string, refdes: string, layoutPosition: Point): BranchPoint {
  return { id, type: 'branchPoint', refdes, layoutPosition, custom: {} };
}

export function twoTerminal(
  id: string,
  refdes: string,
  type: 'resistor' | 'diode',
  overrides: Partial<TwoTerminal> = {},
): TwoTerminal {
  return { id, type, refdes, custom: {}, ...overrides };
}

export function cable(id: string, refdes: string, overrides: Partial<Cable> = {}): Cable {
  return { id, type: 'cable', refdes, cores: [], custom: {}, ...overrides };
}

export function wire(
  id: string,
  refdes: string,
  source: Endpoint,
  target: Endpoint,
  overrides: Partial<Wire> = {},
): Wire {
  return { id, refdes, source, target, color: 'Red', custom: {}, ...overrides };
}

export function bundle(
  id: string,
  refdes: string,
  sourceId: string,
  targetId: string,
  overrides: Partial<Bundle> = {},
): Bundle {
  return { id, refdes, sourceId, targetId, custom: {}, ...overrides };
}

export function cavityEndpoint(componentId: string, cavityId: string): Endpoint {
  return { kind: 'cavity', componentId, cavityId };
}

export function spliceEndpoint(componentId: string): Endpoint {
  return { kind: 'splice', componentId };
}

export function cableCoreEndpoint(componentId: string, coreId: string): Endpoint {
  return { kind: 'cableCore', componentId, coreId };
}

export function twoTerminalEndpoint(componentId: string, side: 'Left' | 'Right'): Endpoint {
  return { kind: 'twoTerminalSide', componentId, side };
}

export function freeEndpoint(point: Point = { x: 0, y: 0 }): Endpoint {
  return { kind: 'free', point };
}

/** Add components/wires/bundles to a document in place, returning it for chaining. */
export function withEntities(
  d: HarnessDocument,
  entities: {
    components?: (Connector | Splice | Terminal | BranchPoint | TwoTerminal | Cable)[];
    wires?: Wire[];
    bundles?: Bundle[];
  },
): HarnessDocument {
  for (const c of entities.components ?? []) d.components[c.id] = c;
  for (const w of entities.wires ?? []) d.wires[w.id] = w;
  for (const b of entities.bundles ?? []) d.bundles[b.id] = b;
  return d;
}
