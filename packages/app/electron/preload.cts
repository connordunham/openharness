/**
 * Preload script — the only bridge between the sandboxed renderer and the
 * main process. Exposes exactly two operations (`pickFile`, `saveFile`), not
 * a general-purpose fs/ipc passthrough, so a compromised or buggy renderer
 * can't do anything beyond "show a native dialog, read/write the one file
 * the user picked." contextIsolation + sandbox are both on in main.ts, so
 * this contextBridge call is the only way anything crosses the boundary.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { PickFileOptions, PickFileResult, SaveFileOptions } from './main.js';

const api = {
  pickFile: (options?: PickFileOptions): Promise<PickFileResult | null> => ipcRenderer.invoke('pickFile', options),
  saveFile: (options: SaveFileOptions): Promise<string | null> => ipcRenderer.invoke('saveFile', options),
  platform: process.platform,
};

export type OpenHarnessApi = typeof api;

contextBridge.exposeInMainWorld('openharness', api);
