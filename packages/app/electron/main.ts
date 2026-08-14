/**
 * Electron main process (spec §7, GUI is mandatory per the reference app).
 *
 * Deliberately thin. Every document operation — parsing, import, the derive
 * model, serialization — is pure TypeScript that already lives in
 * `@openharness/core` / `@openharness/io` and is bundled straight into the
 * renderer via Vite (spec §5.1: "core has no DOM dependency" cuts both
 * ways — it also has no *Node* dependency, so it runs equally well in the
 * renderer). The main process's only job is the two things a renderer can't
 * safely do on its own: show native file dialogs, and touch the filesystem.
 * That keeps the IPC surface at two generic calls (`pickFile`, `saveFile`)
 * instead of growing a new IPC channel per feature.
 */

import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = process.env.OPENHARNESS_DEV === '1';

export interface PickFileOptions {
  title?: string;
  filters?: { name: string; extensions: string[] }[];
}

export interface PickFileResult {
  path: string;
  contents: string;
}

export interface SaveFileOptions {
  title?: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
  contents: string;
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'OpenHarness',
    webPreferences: {
      // .cjs, not .js: the preload script must be CommonJS. Sandboxed
      // preload scripts (sandbox: true, below) don't reliably run ESM —
      // the contextBridge call silently never executes if it's ESM, which
      // is exactly what happened here (caught by actually launching the
      // built app and clicking the button, not by typechecking or unit
      // tests — neither would ever catch this class of bug). Forcing
      // CommonJS via the `.cts` source extension (see preload.cts)
      // sidesteps the package's `"type": "module"` for this one file.
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    void win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    void win.loadFile(join(__dirname, '..', 'dist', 'index.html'));
  }
}

ipcMain.handle('pickFile', async (event, options?: PickFileOptions): Promise<PickFileResult | null> => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const result = await dialog.showOpenDialog(win as BrowserWindow, {
    title: options?.title,
    filters: options?.filters,
    properties: ['openFile'],
  });
  const path = result.canceled ? undefined : result.filePaths[0];
  if (!path) return null;
  const contents = await readFile(path, 'utf-8');
  return { path, contents };
});

ipcMain.handle('saveFile', async (event, options: SaveFileOptions): Promise<string | null> => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const result = await dialog.showSaveDialog(win as BrowserWindow, {
    title: options.title,
    defaultPath: options.defaultPath,
    filters: options.filters,
  });
  if (result.canceled || !result.filePath) return null;
  await writeFile(result.filePath, options.contents, 'utf-8');
  return result.filePath;
});

void app.whenReady().then(() => {
  // No custom menu is built (the toolbar covers every command this app
  // needs), but leaving Electron's *default* menu in place is worse than
  // no menu: its Edit role binds Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y to Chromium's
  // native webContents.undo()/redo() and swallows the keystroke before our
  // own keydown listener (App.tsx) ever sees it — the GUI's Ctrl+Z appeared
  // to silently do nothing. Caught only by actually pressing Ctrl+Z in the
  // running app and watching it not work; no unit test would catch this.
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
