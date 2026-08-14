/**
 * Event catalogue. Transcribed from HARNESS-DESIGNER-SPEC.md §8.4.
 * This is the one bus GUI, CLI, MCP, and automations all listen on.
 */

import type { Patch } from 'immer';
import type { HarnessDocument, ComponentType, DerivedModel } from './types.js';
import type { ComponentId, WireId, BundleId } from './ids.js';

export interface SelectionRef {
  kind: 'component' | 'wire' | 'bundle' | 'note' | 'group';
  id: string;
}

export interface HarnessEvents {
  'document:opened': (e: { doc: HarnessDocument }) => void;
  'document:beforeSave': (e: { doc: HarnessDocument; cancel(reason: string): void }) => void;
  'document:saved': (e: { path: string }) => void;
  'transaction:committed': (e: { label: string; patches: Patch[]; revision: number }) => void;

  'component:created': (e: { componentId: ComponentId; type: ComponentType }) => void;
  'component:updated': (e: { componentId: ComponentId; changed: string[] }) => void;
  'component:deleted': (e: { componentId: ComponentId }) => void;

  'wire:created': (e: { wireId: WireId }) => void;
  'wire:updated': (e: { wireId: WireId }) => void;
  'wire:deleted': (e: { wireId: WireId }) => void;

  'bundle:created': (e: { bundleId: BundleId }) => void;
  'bundle:updated': (e: { bundleId: BundleId }) => void;
  'bundle:deleted': (e: { bundleId: BundleId }) => void;

  'derived:invalidated': (e: { slices: (keyof DerivedModel)[] }) => void;
  'selection:changed': (e: { selection: SelectionRef[] }) => void;
}

export type EventName = keyof HarnessEvents;
export type Unsubscribe = () => void;

/** Minimal typed pub/sub. Deliberately dependency-free — swap later if it needs to grow. */
export class EventBus {
  private handlers = new Map<EventName, Set<(...args: never[]) => void>>();

  on<E extends EventName>(event: E, handler: HarnessEvents[E]): Unsubscribe {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    const set = this.handlers.get(event)!;
    set.add(handler as never);
    return () => set.delete(handler as never);
  }

  emit<E extends EventName>(event: E, payload: Parameters<HarnessEvents[E]>[0]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) (handler as (p: typeof payload) => void)(payload);
  }
}
