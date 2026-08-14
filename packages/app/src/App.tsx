/**
 * Workspace shell root (spec §7.1). This is the first real GUI slice, not
 * the full multi-pane Schematic/Layout/Connections editor yet (that's a much
 * larger effort — canvas rendering, drag-to-wire, the works). What's here is
 * genuinely functional: open a real the reference tool export or a .ohd file,
 * run it through the actual `@openharness/core` derive pipeline (the same
 * code the CLI and 68 core/io tests exercise), and see real BOM and
 * diagnostics output. This corresponds to the Diagnostics + Parts views
 * from spec §7.1/§7.5, brought forward because they need no canvas work at
 * all to be useful — everything downstream of "load a document" already
 * exists and is tested.
 *
 * Next slice after this is the Schematic canvas (spec §7.2).
 */

import { useState, useCallback } from 'react';
import { computeDerivedModel, type HarnessDocument, type DerivedModel, type DiagnosticSeverity } from '@openharness/core';
import { importVendorJson, serializeDocument, parseDocument, bomToCsv, type RawHarnessDocument } from '@openharness/io';

interface LoadedState {
  document: HarnessDocument;
  derived: DerivedModel;
  sourcePath: string;
  warnings: string[];
}

const SEVERITY_COLOR: Record<DiagnosticSeverity, string> = {
  error: '#d92d20',
  warning: '#b54708',
  info: '#175cd3',
};

export function App() {
  const [state, setState] = useState<LoadedState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (kind: 'vendor-json' | 'ohd') => {
    setError(null);
    setBusy(true);
    try {
      const picked = await window.openharness.pickFile({
        title: kind === 'vendor-json' ? 'Open the reference tool export' : 'Open .ohd document',
        filters:
          kind === 'vendor-json'
            ? [{ name: 'the reference tool export', extensions: ['json'] }]
            : [{ name: 'OpenHarness document', extensions: ['ohd', 'json'] }],
      });
      if (!picked) return;

      let document: HarnessDocument;
      let warnings: string[] = [];
      if (kind === 'vendor-json') {
        const raw: RawHarnessDocument = JSON.parse(picked.contents);
        const result = importVendorJson(raw, picked.path);
        document = result.document;
        warnings = result.report.warnings;
      } else {
        document = parseDocument(picked.contents);
      }

      const derived = computeDerivedModel(document);
      setState({ document, derived, sourcePath: picked.path, warnings });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const saveOhd = useCallback(async () => {
    if (!state) return;
    setError(null);
    try {
      const saved = await window.openharness.saveFile({
        title: 'Save .ohd document',
        defaultPath: `${state.document.meta.name}.ohd`,
        filters: [{ name: 'OpenHarness document', extensions: ['ohd'] }],
        contents: serializeDocument(state.document),
      });
      if (saved) setState({ ...state, sourcePath: saved });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [state]);

  const exportBom = useCallback(async () => {
    if (!state) return;
    setError(null);
    try {
      await window.openharness.saveFile({
        title: 'Export BOM as CSV',
        defaultPath: `${state.document.meta.name}-bom.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        contents: bomToCsv(state.derived.bom),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [state]);

  return (
    <div style={styles.shell}>
      <header style={styles.toolbar}>
        <strong style={{ marginRight: 16 }}>OpenHarness</strong>
        <button style={styles.button} disabled={busy} onClick={() => void load('vendor-json')}>
          Import vendor JSON…
        </button>
        <button style={styles.button} disabled={busy} onClick={() => void load('ohd')}>
          Open .ohd…
        </button>
        <button style={styles.button} disabled={!state} onClick={() => void saveOhd()}>
          Save as .ohd…
        </button>
        <button style={styles.button} disabled={!state} onClick={() => void exportBom()}>
          Export BOM CSV…
        </button>
        {state && <span style={styles.path}>{state.sourcePath}</span>}
      </header>

      {error && <div style={styles.errorBanner}>{error}</div>}

      {!state ? (
        <div style={styles.empty}>
          <p>No document loaded.</p>
          <p style={{ color: '#666', fontSize: 13 }}>
            Import a the reference tool export, or open a previously-saved .ohd file, to see its
            components, BOM, and diagnostics — computed by the real derive pipeline (spec §6).
          </p>
        </div>
      ) : (
        <div style={styles.content}>
          <section style={styles.panel}>
            <h3 style={styles.panelTitle}>Document</h3>
            <table style={styles.kvTable}>
              <tbody>
                <tr><td>Name</td><td>{state.document.meta.name}</td></tr>
                <tr><td>Components</td><td>{Object.keys(state.document.components).length}</td></tr>
                <tr><td>Wires</td><td>{Object.keys(state.document.wires).length}</td></tr>
                <tr><td>Bundles</td><td>{Object.keys(state.document.bundles).length}</td></tr>
                <tr><td>Nets</td><td>{state.derived.nets.length}</td></tr>
                <tr><td>Parts</td><td>{Object.keys(state.document.parts).length}</td></tr>
              </tbody>
            </table>
            {state.warnings.length > 0 && (
              <>
                <h4 style={styles.panelSubtitle}>Import warnings</h4>
                <ul style={styles.list}>
                  {state.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </>
            )}
          </section>

          <section style={styles.panel}>
            <h3 style={styles.panelTitle}>Diagnostics ({state.derived.diagnostics.length})</h3>
            {state.derived.diagnostics.length === 0 ? (
              <p style={{ color: '#666' }}>No diagnostics.</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr><th>Severity</th><th>Rule</th><th>Message</th></tr>
                </thead>
                <tbody>
                  {state.derived.diagnostics.map((d, i) => (
                    <tr key={i}>
                      <td style={{ color: SEVERITY_COLOR[d.severity], fontWeight: 600 }}>{d.severity}</td>
                      <td>{d.ruleId}</td>
                      <td>{d.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section style={styles.panel}>
            <h3 style={styles.panelTitle}>BOM ({state.derived.bom.length} lines)</h3>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th>Part Number</th><th>Manufacturer</th><th>Qty</th><th>Unit</th><th>Refdes</th>
                </tr>
              </thead>
              <tbody>
                {state.derived.bom.map((line, i) => (
                  <tr key={i}>
                    <td>{line.partNumber}</td>
                    <td>{line.manufacturer}</td>
                    <td>{line.quantity}</td>
                    <td>{line.unit}</td>
                    <td>{line.refdes.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: { fontFamily: 'system-ui, sans-serif', height: '100vh', display: 'flex', flexDirection: 'column' },
  toolbar: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid #e0e0e0' },
  button: { padding: '6px 12px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer' },
  path: { marginLeft: 'auto', color: '#666', fontSize: 12 },
  errorBanner: { background: '#fef3f2', color: '#b42318', padding: '8px 16px', borderBottom: '1px solid #fecdca' },
  empty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 32 },
  content: { flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 20 },
  panel: { border: '1px solid #e0e0e0', borderRadius: 6, padding: 16 },
  panelTitle: { margin: '0 0 12px 0', fontSize: 14 },
  panelSubtitle: { margin: '12px 0 6px 0', fontSize: 13, color: '#666' },
  kvTable: { borderCollapse: 'collapse', fontSize: 13 },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13 },
  list: { margin: 0, paddingLeft: 20, fontSize: 12, color: '#b54708' },
};
