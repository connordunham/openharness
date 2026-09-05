/**
 * Vite's `?raw` suffix imports a file's contents as a string at build time.
 * Used for the bundled example harness (App.tsx's openExample) so shipping a
 * starter document needs no filesystem access and no new IPC channel.
 */
declare module '*?raw' {
  const contents: string;
  export default contents;
}
