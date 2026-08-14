/** Renderer-side type for the API the preload script exposes via contextBridge. */

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

export interface OpenHarnessApi {
  pickFile(options?: PickFileOptions): Promise<PickFileResult | null>;
  saveFile(options: SaveFileOptions): Promise<string | null>;
  platform: string;
}

declare global {
  interface Window {
    openharness: OpenHarnessApi;
  }
}
