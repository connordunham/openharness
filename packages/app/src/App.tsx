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
import { theme } from './theme.js';

type Tab = 'schematic' | 'overview';

const SEVERITY_COLOR: Record<DiagnosticSeverity, string> = {
  error: theme.color.danger,
  warning: theme.color.warning,
  info: theme.color.info,
};

const SEVERITY_BG: Record<DiagnosticSeverity, string> = {
  error: theme.color.dangerSoft,
  warning: theme.color.warningSoft,
  info: theme.color.infoSoft,
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
  const errorCount = derived?.diagnostics.filter((d) => d.severity === 'error').length ?? 0;

  return (
    <div style={styles.shell}>
      <header style={styles.toolbar}>
        <div style={styles.brand}>
          <div style={styles.brandMark}>OH</div>
          <strong style={styles.brandName}>OpenHarness</strong>
        </div>

        <div style={styles.toolbarGroup}>
          <button style={styles.button} disabled={busy} onClick={newDocument}>New</button>
          <button style={styles.button} disabled={busy} onClick={() => void load('vendor-json')}>Import the reference tool…</button>
          <button style={styles.button} disabled={busy} onClick={() => void load('ohd')}>Open .ohd…</button>
          <button style={styles.buttonPrimary} disabled={!store} onClick={() => void saveOhd()}>Save as .ohd…</button>
          <button style={styles.button} disabled={!store} onClick={() => void exportBom()}>Export BOM CSV…</button>
        </div>

        {store && (
          <div style={styles.tabGroup}>
            <button style={styles.tabButton(tab === 'schematic')} onClick={() => setTab('schematic')}>
              Schematic
            </button>
            <button style={styles.tabButton(tab === 'overview')} onClick={() => setTab('overview')}>
              Overview
              {derived && derived.diagnostics.length > 0 && (
                <span style={styles.tabBadge(errorCount > 0)}>{derived.diagnostics.length}</span>
              )}
            </button>
          </div>
        )}

        <div style={styles.toolbarSpacer} />
        {sourcePath && <span style={styles.path} title={sourcePath}>{shortenPath(sourcePath)}</span>}
      </header>

      {error && (
        <div style={styles.errorBanner}>
          <span style={styles.errorBannerText}>{error}</span>
          <button style={styles.errorBannerDismiss} onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {!store ? (
        <div style={styles.empty}>
          <div style={styles.emptyMark}>OH</div>
          <h2 style={styles.emptyTitle}>No document open</h2>
          <p style={styles.emptyBody}>
            Start a new harness, import a the reference tool export, or open a previously-saved .ohd
            file to begin.
          </p>
          <div style={styles.emptyActions}>
            <button style={styles.buttonPrimary} onClick={newDocument}>New harness</button>
            <button style={styles.button} onClick={() => void load('vendor-json')}>Import the reference tool…</button>
          </div>
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
                <tr><td style={styles.kvKey}>Name</td><td style={styles.kvVal}>{store.doc.meta.name}</td></tr>
                <tr><td style={styles.kvKey}>Components</td><td style={styles.kvVal}>{Object.keys(store.doc.components).length}</td></tr>
                <tr><td style={styles.kvKey}>Wires</td><td style={styles.kvVal}>{Object.keys(store.doc.wires).length}</td></tr>
                <tr><td style={styles.kvKey}>Bundles</td><td style={styles.kvVal}>{Object.keys(store.doc.bundles).length}</td></tr>
                <tr><td style={styles.kvKey}>Nets</td><td style={styles.kvVal}>{derived!.nets.length}</td></tr>
                <tr><td style={styles.kvKey}>Parts</td><td style={styles.kvVal}>{Object.keys(store.doc.parts).length}</td></tr>
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
              <p style={styles.mutedNote}>No diagnostics — this document is clean.</p>
            ) : (
              <table style={styles.table}>
                <thead><tr><th style={styles.th}>Severity</th><th style={styles.th}>Rule</th><th style={styles.th}>Message</th></tr></thead>
                <tbody>
                  {derived!.diagnostics.map((d, i) => (
                    <tr key={i}>
                      <td style={styles.td}>
                        <span style={styles.severityChip(d.severity)}>{d.severity}</span>
                      </td>
                      <td style={{ ...styles.td, color: theme.color.textFaint, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{d.ruleId}</td>
                      <td style={styles.td}>{d.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section style={styles.panel}>
            <h3 style={styles.panelTitle}>BOM ({derived!.bom.length} lines)</h3>
            {derived!.bom.length === 0 ? (
              <p style={styles.mutedNote}>No BOM lines yet.</p>
            ) : (
              <table style={styles.table}>
                <thead><tr><th style={styles.th}>Part Number</th><th style={styles.th}>Manufacturer</th><th style={styles.th}>Qty</th><th style={styles.th}>Unit</th><th style={styles.th}>Refdes</th></tr></thead>
                <tbody>
                  {derived!.bom.map((line, i) => (
                    <tr key={i}>
                      <td style={styles.td}>{line.partNumber}</td>
                      <td style={styles.td}>{line.manufacturer}</td>
                      <td style={styles.td}>{line.quantity}</td>
                      <td style={styles.td}>{line.unit}</td>
                      <td style={{ ...styles.td, color: theme.color.textFaint }}>{line.refdes.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function shortenPath(path: string): string {
  if (path.length <= 56) return path;
  return `…${path.slice(-53)}`;
}

const styles = {
  shell: {
    fontFamily: '-apple-system, "Segoe UI", system-ui, sans-serif', height: '100vh',
    display: 'flex', flexDirection: 'column', color: theme.color.textStrong, background: theme.color.canvasBg,
    fontSize: 14,
  },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
    borderBottom: `1px solid ${theme.color.border}`, background: theme.color.surface, flexWrap: 'wrap',
  },
  brand: { display: 'flex', alignItems: 'center', gap: 8, marginRight: 6 },
  brandMark: {
    width: 24, height: 24, borderRadius: 6, background: theme.color.accent, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, letterSpacing: 0.2,
  },
  brandName: { fontSize: 14.5, fontWeight: 600, letterSpacing: -0.1 },
  toolbarGroup: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  toolbarSpacer: { flex: 1 },
  tabGroup: { display: 'flex', alignItems: 'center', gap: 2, background: theme.color.canvasBg, padding: 3, borderRadius: 8, border: `1px solid ${theme.color.border}` },
  button: {
    padding: '6px 12px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control,
    background: theme.color.surface, color: theme.color.textStrong, cursor: 'pointer', fontSize: 13, fontWeight: 500,
  },
  buttonPrimary: {
    padding: '6px 12px', border: `1px solid ${theme.color.accent}`, borderRadius: theme.radius.control,
    background: theme.color.accent, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500,
  },
  tabButton: (active: boolean) => ({
    padding: '6px 14px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500,
    background: active ? theme.color.surface : 'transparent',
    color: active ? theme.color.textStrong : theme.color.textMuted,
    boxShadow: active ? theme.shadow.panel : 'none',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  }),
  tabBadge: (danger: boolean) => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 16, height: 16,
    padding: '0 4px', borderRadius: 8, fontSize: 10.5, fontWeight: 700,
    background: danger ? theme.color.dangerSoft : theme.color.warningSoft,
    color: danger ? theme.color.danger : theme.color.warning,
  }),
  path: { color: theme.color.textFaint, fontSize: 12, fontFamily: 'ui-monospace, monospace' },
  errorBanner: {
    display: 'flex', alignItems: 'center', gap: 12, background: theme.color.dangerSoft, color: theme.color.danger,
    padding: '8px 16px', borderBottom: `1px solid ${theme.color.dangerBorder}`, fontSize: 13,
  },
  errorBannerText: { flex: 1 },
  errorBannerDismiss: {
    border: 'none', background: 'transparent', color: theme.color.danger, cursor: 'pointer',
    fontSize: 12, fontWeight: 600, textDecoration: 'underline', padding: 0,
  },
  empty: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    textAlign: 'center', padding: 32, gap: 4,
  },
  emptyMark: {
    width: 52, height: 52, borderRadius: 14, background: theme.color.accentSoft, color: theme.color.accent,
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, marginBottom: 12,
  },
  emptyTitle: { margin: 0, fontSize: 17, fontWeight: 600, color: theme.color.textStrong },
  emptyBody: { color: theme.color.textMuted, fontSize: 13.5, maxWidth: 360, margin: '4px 0 20px 0', lineHeight: 1.5 },
  emptyActions: { display: 'flex', gap: 8 },
  content: { flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box' },
  panel: {
    border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.panel, padding: 18,
    background: theme.color.surface, boxShadow: theme.shadow.panel,
  },
  panelTitle: { margin: '0 0 14px 0', fontSize: 13.5, fontWeight: 600, color: theme.color.textStrong },
  panelSubtitle: { margin: '14px 0 6px 0', fontSize: 12.5, color: theme.color.textMuted, fontWeight: 600 },
  kvTable: { borderCollapse: 'collapse', fontSize: 13, width: '100%' },
  kvKey: { color: theme.color.textFaint, padding: '4px 12px 4px 0', fontWeight: 500 },
  kvVal: { color: theme.color.textStrong, padding: '4px 0', fontWeight: 500 },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13 },
  th: {
    textAlign: 'left', padding: '6px 10px', fontSize: 11, fontWeight: 600, color: theme.color.textFaint,
    textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: `1px solid ${theme.color.border}`,
  },
  td: { padding: '8px 10px', borderBottom: `1px solid ${theme.color.border}`, color: theme.color.textStrong },
  severityChip: (severity: DiagnosticSeverity) => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
    color: SEVERITY_COLOR[severity], background: SEVERITY_BG[severity], textTransform: 'capitalize' as const,
  }),
  mutedNote: { color: theme.color.textMuted, fontSize: 13, margin: 0 },
  list: { margin: 0, paddingLeft: 20, fontSize: 12, color: theme.color.warning },
} satisfies Record<string, React.CSSProperties | ((...args: never[]) => React.CSSProperties)>;
