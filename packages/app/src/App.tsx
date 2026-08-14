/**
 * Workspace shell root (spec §7.1). Holds the one `HarnessStore` for the
 * open document and everything downstream — the Schematic canvas, the
 * Overview/Diagnostics/BOM panels — reads from and writes through it. See
 * useHarnessStore.ts and SchematicCanvas.tsx for why that split matters:
 * every edit anywhere in this app takes the same `store.transact(...)` path
 * an automation would (spec §8.3).
 */

import { useCallback, useEffect, useState } from 'react';
import { createEmptyDocument, computeDerivedModel, type HarnessDocument, type DiagnosticSeverity } from '@openharness/core';
import { importVendorJson, serializeDocument, parseDocument, bomToCsv, type RawHarnessDocument } from '@openharness/io';
import { useHarnessStore } from './useHarnessStore.js';
import { SchematicCanvas } from './SchematicCanvas.js';

type Tab = 'schematic' | 'overview';

const SEVERITY_COLOR: Record<DiagnosticSeverity, string> = {
  error: '#d92d20',
  warning: '#b54708',
  info: '#175cd3',
};

export function App() {
  const { store, replaceDocument } = useHarnessStore(null);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('schematic');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const newDocument = useCallback(() => {
    setError(null);
    setImportWarnings([]);
    setSourcePath(null);
    replaceDocument(createEmptyDocument('Untitled Harness'));
  }, [replaceDocument]);

  const load = useCallback(
    async (kind: 'vendor-json' | 'ohd') => {
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

        replaceDocument(document);
        setSourcePath(picked.path);
        setImportWarnings(warnings);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [replaceDocument],
  );

  const saveOhd = useCallback(async () => {
    if (!store) return;
    setError(null);
    try {
      const saved = await window.openharness.saveFile({
        title: 'Save .ohd document',
        defaultPath: `${store.doc.meta.name}.ohd`,
        filters: [{ name: 'OpenHarness document', extensions: ['ohd'] }],
        contents: serializeDocument(store.doc),
      });
      if (saved) setSourcePath(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [store]);

  const exportBom = useCallback(async () => {
    if (!store) return;
    setError(null);
    try {
      await window.openharness.saveFile({
        title: 'Export BOM as CSV',
        defaultPath: `${store.doc.meta.name}-bom.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        contents: bomToCsv(computeDerivedModel(store.doc).bom),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [store]);

  // Hotkeys: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y (spec §2.8).
  useEffect(() => {
    if (!store) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
      else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); store.redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [store]);

  const derived = store ? computeDerivedModel(store.doc) : null;

  return (
    <div style={styles.shell}>
      <header style={styles.toolbar}>
        <strong style={{ marginRight: 16 }}>OpenHarness</strong>
        <button style={styles.button} disabled={busy} onClick={newDocument}>New</button>
        <button style={styles.button} disabled={busy} onClick={() => void load('vendor-json')}>Import vendor JSON…</button>
        <button style={styles.button} disabled={busy} onClick={() => void load('ohd')}>Open .ohd…</button>
        <button style={styles.button} disabled={!store} onClick={() => void saveOhd()}>Save as .ohd…</button>
        <button style={styles.button} disabled={!store} onClick={() => void exportBom()}>Export BOM CSV…</button>
        {store && (
          <>
            <span style={styles.divider} />
            <button style={styles.tabButton(tab === 'schematic')} onClick={() => setTab('schematic')}>Schematic</button>
            <button style={styles.tabButton(tab === 'overview')} onClick={() => setTab('overview')}>
              Overview{derived && derived.diagnostics.length > 0 ? ` (${derived.diagnostics.length})` : ''}
            </button>
          </>
        )}
        {sourcePath && <span style={styles.path}>{sourcePath}</span>}
      </header>

      {error && <div style={styles.errorBanner}>{error}</div>}

      {!store ? (
        <div style={styles.empty}>
          <p>No document open.</p>
          <p style={{ color: '#666', fontSize: 13 }}>
            Start a new harness, import a the reference tool export, or open a previously-saved .ohd
            file.
          </p>
        </div>
      ) : tab === 'schematic' ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          <SchematicCanvas store={store} />
        </div>
      ) : (
        <div style={styles.content}>
          <section style={styles.panel}>
            <h3 style={styles.panelTitle}>Document</h3>
            <table style={styles.kvTable}>
              <tbody>
                <tr><td>Name</td><td>{store.doc.meta.name}</td></tr>
                <tr><td>Components</td><td>{Object.keys(store.doc.components).length}</td></tr>
                <tr><td>Wires</td><td>{Object.keys(store.doc.wires).length}</td></tr>
                <tr><td>Bundles</td><td>{Object.keys(store.doc.bundles).length}</td></tr>
                <tr><td>Nets</td><td>{derived!.nets.length}</td></tr>
                <tr><td>Parts</td><td>{Object.keys(store.doc.parts).length}</td></tr>
              </tbody>
            </table>
            {importWarnings.length > 0 && (
              <>
                <h4 style={styles.panelSubtitle}>Import warnings</h4>
                <ul style={styles.list}>{importWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </>
            )}
          </section>

          <section style={styles.panel}>
            <h3 style={styles.panelTitle}>Diagnostics ({derived!.diagnostics.length})</h3>
            {derived!.diagnostics.length === 0 ? (
              <p style={{ color: '#666' }}>No diagnostics.</p>
            ) : (
              <table style={styles.table}>
                <thead><tr><th>Severity</th><th>Rule</th><th>Message</th></tr></thead>
                <tbody>
                  {derived!.diagnostics.map((d, i) => (
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
            <h3 style={styles.panelTitle}>BOM ({derived!.bom.length} lines)</h3>
            <table style={styles.table}>
              <thead><tr><th>Part Number</th><th>Manufacturer</th><th>Qty</th><th>Unit</th><th>Refdes</th></tr></thead>
              <tbody>
                {derived!.bom.map((line, i) => (
                  <tr key={i}>
                    <td>{line.partNumber}</td><td>{line.manufacturer}</td><td>{line.quantity}</td><td>{line.unit}</td>
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

const styles = {
  shell: { fontFamily: 'system-ui, sans-serif', height: '100vh', display: 'flex', flexDirection: 'column' },
  toolbar: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid #e0e0e0' },
  divider: { width: 1, height: 20, background: '#e0e0e0', margin: '0 4px' },
  button: { padding: '6px 12px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer' },
  tabButton: (active: boolean) => ({
    padding: '6px 12px', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer',
    background: active ? '#175cd3' : '#fff', color: active ? '#fff' : '#000',
  }),
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
} satisfies Record<string, React.CSSProperties | ((active: boolean) => React.CSSProperties)>;
