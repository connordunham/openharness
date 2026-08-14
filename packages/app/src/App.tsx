/**
 * Workspace shell root (spec §7.1). Currently a placeholder — the recursive
 * pane-split tree, view-type panes (Schematic/Layout/Parts/Connections/
 * Diagnostics), and status bar are Phase 2+ work per the build plan (spec
 * §12). This exists so `pnpm --filter @openharness/app dev` boots to
 * *something* once dependencies are installed.
 */
export function App() {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>OpenHarness</h1>
      <p>
        Scaffolding only — see <code>HARNESS-DESIGNER-SPEC.md</code> §7 for the
        workspace shell this will become.
      </p>
    </div>
  );
}
