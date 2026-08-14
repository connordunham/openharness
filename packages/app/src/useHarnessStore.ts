/**
 * React binding for `HarnessStore` (spec §5.3). Deliberately thin: every
 * mutation the GUI performs — add a connector, draw a wire, rename a
 * refdes, drag a box — goes through the exact same `store.transact(...)`
 * call an automation would use (spec §8.3). There is no GUI-only mutation
 * path; the store doesn't know or care whether the caller is a button click
 * or a script. That symmetry is the whole point of the core/GUI split
 * (spec §5.1) and is worth preserving deliberately as the canvas grows.
 */

import { useCallback, useState, useSyncExternalStore } from 'react';
import { HarnessStore, type HarnessDocument } from '@openharness/core';

export function useHarnessStore(initialDocument: HarnessDocument | null) {
  const [store, setStore] = useState<HarnessStore | null>(
    () => (initialDocument ? new HarnessStore(initialDocument) : null),
  );

  const subscribe = useCallback(
    (onStoreChange: () => void) => (store ? store.on('transaction:committed', () => onStoreChange()) : () => {}),
    [store],
  );
  const getSnapshot = useCallback(() => store?.doc.meta.revision ?? -1, [store]);

  // Re-renders this component whenever the store commits, undoes, or redoes.
  useSyncExternalStore(subscribe, getSnapshot);

  const replaceDocument = useCallback((doc: HarnessDocument) => {
    setStore(new HarnessStore(doc));
  }, []);

  return { store, replaceDocument };
}
