/**
 * HarnessStore — the single mutation point for a document (spec §5.3).
 *
 * Every edit — from the GUI, the CLI, an MCP tool call, or an automation —
 * goes through `transact`. That is what makes automations safe: a script
 * mutates `wires` and the derived model (nets, lengths, BOM, diagnostics)
 * recomputes with no further work on the caller's part, and every mutation
 * is a single, labelled undo entry (spec §8.3).
 *
 * This is the scaffold-phase version: it wires up transact/undo/redo/on with
 * a real (if naive) implementation, and computes an empty-but-correctly-typed
 * DerivedModel. The actual net-extraction, routing, length, BOM and DRC
 * algorithms (spec §6) are Phase 1 work, not scaffolding — see
 * src/derive/ for where they land next, and fixtures/ for the golden files
 * they'll be tested against.
 */

import { produce, applyPatches, enablePatches, type Patch } from 'immer';
import type { HarnessDocument, DerivedModel } from './types.js';
import { EventBus, type EventName, type HarnessEvents, type Unsubscribe } from './events.js';
import { computeDerivedModel } from './derive/index.js';

enablePatches();

export interface TransactionResult<T> {
  value: T;
  patches: Patch[];
  inversePatches: Patch[];
  revision: number;
}

export interface TransactOptions {
  /** If true, compute and return patches without applying them (spec §8.3). */
  dryRun?: boolean;
}

interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  timestamp: number;
  /** Primary target of the edit, used by the coalescing rule (spec §10 / review R16). */
  primaryTargetId?: string;
}

const COALESCE_WINDOW_MS = 400;

export class HarnessStore {
  private _doc: HarnessDocument;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private bus = new EventBus();
  private _derived: DerivedModel;
  private dirty = true;

  constructor(initialDocument: HarnessDocument) {
    this._doc = initialDocument;
    this._derived = computeDerivedModel(this._doc);
  }

  get doc(): Readonly<HarnessDocument> {
    return this._doc;
  }

  get derived(): DerivedModel {
    if (this.dirty) {
      this._derived = computeDerivedModel(this._doc);
      this.dirty = false;
    }
    return this._derived;
  }

  transact<T>(
    label: string,
    fn: (draft: HarnessDocument) => T,
    options: TransactOptions = {},
  ): TransactionResult<T> {
    let returned!: T;
    const patches: Patch[] = [];
    const inversePatches: Patch[] = [];

    const nextDoc = produce(
      this._doc,
      (draft) => {
        returned = fn(draft);
        draft.meta.modifiedAt = new Date().toISOString();
      },
      (p, ip) => {
        patches.push(...p);
        inversePatches.push(...ip);
      },
    );

    if (options.dryRun) {
      return { value: returned, patches, inversePatches, revision: this._doc.meta.revision };
    }

    if (patches.length === 0) {
      // No-op transaction: nothing to commit, nothing to undo.
      return { value: returned, patches, inversePatches, revision: this._doc.meta.revision };
    }

    this.applyCommitted(nextDoc, label, patches, inversePatches);
    return { value: returned, patches, inversePatches, revision: this._doc.meta.revision };
  }

  /** Apply externally-produced patches (e.g. from an automation's dry-run) in one transaction. */
  applyPatches(patches: Patch[], options: { label: string }): void {
    let inversePatches: Patch[] = [];
    const nextDoc = produce(
      this._doc,
      (draft) => applyPatches(draft, patches),
      (_p, ip) => {
        inversePatches = ip;
      },
    );
    this.applyCommitted(nextDoc, options.label, patches, inversePatches);
  }

  private applyCommitted(
    nextDoc: HarnessDocument,
    label: string,
    patches: Patch[],
    inversePatches: Patch[],
  ): void {
    const now = Date.now();
    const last = this.undoStack[this.undoStack.length - 1];
    const primaryTargetId = primaryTargetOf(patches);

    const canCoalesce =
      !!last &&
      last.label === label &&
      now - last.timestamp <= COALESCE_WINDOW_MS &&
      last.primaryTargetId !== undefined &&
      last.primaryTargetId === primaryTargetId;

    this._doc = { ...nextDoc, meta: { ...nextDoc.meta, revision: nextDoc.meta.revision + 1 } };
    this.dirty = true;
    this.redoStack = [];

    if (canCoalesce) {
      last.patches.push(...patches);
      last.inversePatches.unshift(...inversePatches);
      last.timestamp = now;
    } else {
      this.undoStack.push({ label, patches, inversePatches, timestamp: now, primaryTargetId });
    }

    this.bus.emit('transaction:committed', { label, patches, revision: this._doc.meta.revision });
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this._doc = produce(this._doc, (draft) => applyPatches(draft, entry.inversePatches));
    this.dirty = true;
    this.redoStack.push(entry);
    // Undo/redo previously mutated state with no event at all — any
    // subscriber (the GUI's re-render, or an automation watching for
    // changes) had no way to know Ctrl+Z had happened. Emitting the same
    // event a normal transact() does keeps undo/redo indistinguishable
    // from any other document change to everything downstream.
    this.bus.emit('transaction:committed', {
      label: `Undo: ${entry.label}`,
      patches: entry.inversePatches,
      revision: this._doc.meta.revision,
    });
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this._doc = produce(this._doc, (draft) => applyPatches(draft, entry.patches));
    this.dirty = true;
    this.undoStack.push(entry);
    this.bus.emit('transaction:committed', {
      label: `Redo: ${entry.label}`,
      patches: entry.patches,
      revision: this._doc.meta.revision,
    });
  }

  on<E extends EventName>(event: E, handler: HarnessEvents[E]): Unsubscribe {
    return this.bus.on(event, handler);
  }
}

/** Best-effort "what did this transaction primarily touch" for undo coalescing. */
function primaryTargetOf(patches: Patch[]): string | undefined {
  const first = patches[0];
  if (!first) return undefined;
  const [collection, id] = first.path;
  return typeof collection === 'string' && typeof id === 'string' ? `${collection}/${id}` : undefined;
}
