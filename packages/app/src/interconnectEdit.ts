/**
 * Table -> Schematic half of the interconnect table's bidirectional sync
 * (Connor: "if the table exists, then the schematic should automatically be
 * generated"). The Schematic -> Table half needs no code at all — it's a
 * plain derived view, see core/derive/interconnect.ts's doc comment. This
 * direction is a real document edit, so it lives here at the app layer next
 * to every other editing helper, the same split the codebase already draws
 * between "derive" (core, read-only) and "edit" (app, mutates via
 * `store.transact`).
 *
 * Given a row describing a from/to connector+designation (plus optionally a
 * signal name, direction, and impedance-matched flag), `applyInterconnectRow`
 * finds or creates the connector(s) and cavity(ies) it names, sets whatever
 * fields the row actually specifies, and makes sure exactly one wire
 * connects the two cavities — auto-placing any newly-created components in
 * both Schematic and Layout along the way (schematicGrid.ts / layoutGrid.ts,
 * the same "automatic, not manual" placement every other "Add X" path in
 * this app already uses, and the same one Round 5's auto-routing already
 * extended into the Layout pane).
 *
 * Shared by the Interconnect Table pane's own "+ Add connection" form and by
 * CSV import (App.tsx) — both just build a row and call this function; only
 * the row's *origin* differs.
 */

import type { HarnessDocument, Connector, Cavity, Endpoint, SignalDirection } from '@openharness/core';
import { newInstanceId } from '@openharness/core';
import { nextGridPositionFromDraft } from './schematicGrid.js';
import { autoRouteInLayout } from './layoutGrid.js';

/** Same palette SchematicCanvas.tsx's own wire-drawing round-robins through
 * (kept as a small local copy rather than a shared export — it's a static
 * list of CSS color names, cheap enough to duplicate once rather than widen
 * SchematicCanvas.tsx's exports for it). */
const WIRE_COLORS = [
  'Black', 'Red', 'White', 'Green', 'Blue', 'Yellow', 'Orange', 'Brown', 'Violet', 'Gray', 'Tan', 'Pink',
] as const;

export interface InterconnectRowInput {
  fromComponentRefdes: string;
  fromDesignation?: string;
  fromSignal?: string;
  fromDirection?: SignalDirection;
  fromImpedanceMatched?: boolean;
  toComponentRefdes: string;
  toDesignation?: string;
  toSignal?: string;
  toDirection?: SignalDirection;
  toImpedanceMatched?: boolean;
  /** Explicit wire color, e.g. from a CSV column — falls back to the
   * round-robin palette (keyed by `wireColorIndex`) when absent. */
  color?: string;
}

function ensureConnectorByRefdes(draft: HarnessDocument, refdes: string): Connector {
  const existing = Object.values(draft.components).find(
    (c): c is Connector => c.type === 'connector' && c.refdes === refdes,
  );
  if (existing) return existing;
  const id = newInstanceId();
  const connector: Connector = {
    id, type: 'connector', refdes, cavities: [],
    schematicPosition: nextGridPositionFromDraft(draft),
    custom: {},
  };
  draft.components[id] = connector;
  return connector;
}

function ensureCavityByDesignation(connector: Connector, designation: string): Cavity {
  const existing = connector.cavities.find((c) => c.designation === designation);
  if (existing) return existing;
  const cavity: Cavity = { id: newInstanceId(), designation, custom: {} };
  connector.cavities.push(cavity);
  return cavity;
}

function applyCavityFields(cavity: Cavity, signal?: string, direction?: SignalDirection, impedanceMatched?: boolean): void {
  if (signal !== undefined) cavity.signal = signal || undefined;
  if (direction !== undefined) cavity.direction = direction;
  if (impedanceMatched !== undefined) cavity.impedanceMatched = impedanceMatched;
}

function endpointIsCavity(ep: Endpoint, componentId: string, cavityId: string): boolean {
  return ep.kind === 'cavity' && ep.componentId === componentId && ep.cavityId === cavityId;
}

/** Applies one interconnect-table row to `draft`, creating whatever
 * connectors/cavities/wire don't exist yet, and returns the resulting
 * wire's id. A row that only names a connector (no cavity designation)
 * resolves to designation "1" rather than silently failing, so "just a
 * connector refdes" is still a usable minimal row. `wireColorIndex` is the
 * caller's running count of wires created so far in this batch, so
 * importing a whole CSV still round-robins through the wire palette instead
 * of giving every new wire the same first color. */
export function applyInterconnectRow(draft: HarnessDocument, row: InterconnectRowInput, wireColorIndex: number): string {
  const fromConnector = ensureConnectorByRefdes(draft, row.fromComponentRefdes.trim());
  const toConnector = ensureConnectorByRefdes(draft, row.toComponentRefdes.trim());
  const fromCavity = ensureCavityByDesignation(fromConnector, (row.fromDesignation ?? '').trim() || '1');
  const toCavity = ensureCavityByDesignation(toConnector, (row.toDesignation ?? '').trim() || '1');
  applyCavityFields(fromCavity, row.fromSignal, row.fromDirection, row.fromImpedanceMatched);
  applyCavityFields(toCavity, row.toSignal, row.toDirection, row.toImpedanceMatched);

  const existingWire = Object.values(draft.wires).find(
    (w) =>
      (endpointIsCavity(w.source, fromConnector.id, fromCavity.id) && endpointIsCavity(w.target, toConnector.id, toCavity.id)) ||
      (endpointIsCavity(w.source, toConnector.id, toCavity.id) && endpointIsCavity(w.target, fromConnector.id, fromCavity.id)),
  );

  let wireId: string;
  if (existingWire) {
    wireId = existingWire.id;
  } else {
    wireId = newInstanceId();
    const n = Object.keys(draft.wires).length;
    const color = row.color?.trim() || WIRE_COLORS[wireColorIndex % WIRE_COLORS.length]!;
    draft.wires[wireId] = {
      id: wireId, refdes: `W${n + 1}`, color,
      source: { kind: 'cavity', componentId: fromConnector.id, cavityId: fromCavity.id },
      target: { kind: 'cavity', componentId: toConnector.id, cavityId: toCavity.id },
      custom: {},
    };
  }

  autoRouteInLayout(draft, fromConnector.id, toConnector.id);
  return wireId;
}

/** Turns a raw, all-string CSV row (io's `InterconnectCsvRow` — untrusted
 * external input, see interconnectCsv.ts) into a validated
 * `InterconnectRowInput`. Only 'input'/'output'/'bidirectional'
 * (case-insensitive) are accepted as a direction; anything else — an empty
 * cell, a typo, a stray note — is treated as "not specified" rather than
 * thrown out, same as the rest of this app's "unset means unspecified, not
 * an error" convention. */
export function parseInterconnectCsvRow(raw: {
  fromComponentRefdes: string; fromDesignation?: string; fromSignal?: string; fromDirection?: string; fromImpedanceMatched?: string;
  toComponentRefdes: string; toDesignation?: string; toSignal?: string; toDirection?: string; toImpedanceMatched?: string;
  color?: string;
}): InterconnectRowInput {
  const parseDirection = (v?: string): SignalDirection | undefined => {
    const lower = v?.trim().toLowerCase();
    return lower === 'input' || lower === 'output' || lower === 'bidirectional' ? lower : undefined;
  };
  const parseBool = (v?: string): boolean | undefined => {
    if (v === undefined) return undefined;
    const lower = v.trim().toLowerCase();
    if (lower === '') return undefined;
    return lower === 'yes' || lower === 'true' || lower === '1' || lower === 'y';
  };
  return {
    fromComponentRefdes: raw.fromComponentRefdes,
    fromDesignation: raw.fromDesignation,
    fromSignal: raw.fromSignal,
    fromDirection: parseDirection(raw.fromDirection),
    fromImpedanceMatched: parseBool(raw.fromImpedanceMatched),
    toComponentRefdes: raw.toComponentRefdes,
    toDesignation: raw.toDesignation,
    toSignal: raw.toSignal,
    toDirection: parseDirection(raw.toDirection),
    toImpedanceMatched: parseBool(raw.toImpedanceMatched),
    color: raw.color,
  };
}
