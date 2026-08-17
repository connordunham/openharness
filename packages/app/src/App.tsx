/**
 * Workspace shell root (spec §7.1). Holds the one `HarnessStore` for the
 * open document and everything downstream — the Schematic canvas, the
 * Overview/Diagnostics/BOM panels — reads from and writes through it. See
 * useHarnessStore.ts and SchematicCanvas.tsx for why that split matters:
 * every edit anywhere in this app takes the same `store.transact(...)` path
 * an automation would (spec §8.3).
 *
 * Split-pane layout (Connor: "I want to be able to split up the window and
 * customize how the different panes appear (split in half or into
 * quarters), adaptable depending on user preference"): `splitLayout`
 * chooses a CSS-grid arrangement (single / two panes side by side / two
 * panes stacked / four panes) and `paneViews` tracks which of the four
 * views (Schematic/Layout/BOM/Overview) each grid cell shows, independent
 * of the others. In `single` mode this collapses back to exactly the old
 * one-tab-bar-at-a-time behavior — `paneViews[0]` just *is* what used to be
 * the `tab` state, so nothing about the single-pane experience changed.
 * Both are persisted to localStorage the same way dark mode already is, so
 * the chosen layout survives a restart. Every pane shares the same
 * `hoveredComponentId`/`onHoverComponent` pair already threaded through
 * Schematic/Layout/BOM (spec follow-up: cross-pane hover highlighting) —
 * with two or four panes visible at once that's no longer a "highlights on
 * a tab you can't currently see" curiosity, it's the actual point: hover a
 * wire in Schematic while Layout is visible in the next pane over and the
 * matching component lights up right there.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  createEmptyDocument, computeDerivedModel, DEFAULT_EXIT_STUB,
  type HarnessDocument, type DiagnosticSeverity, type TwistedPairStyle,
} from '@openharness/core';
import {
  importVendorJson, serializeDocument, parseDocument, bomToCsv,
  interconnectToCsv, interconnectFromCsv, type RawHarnessDocument,
} from '@openharness/io';
import { useHarnessStore } from './useHarnessStore.js';
import { SchematicCanvas } from './SchematicCanvas.js';
import { BomPane } from './BomPane.js';
import { LayoutCanvas } from './LayoutCanvas.js';
import { InterconnectTablePane } from './InterconnectTablePane.js';
import { applyInterconnectRow, parseInterconnectCsvRow } from './interconnectEdit.js';
import { theme } from './theme.js';

type PaneView = 'schematic' | 'layout' | 'table' | 'bom' | 'overview';
type SplitLayout = 'single' | 'split-h' | 'split-v' | 'quad';

const PANE_COUNT: Record<SplitLayout, number> = { single: 1, 'split-h': 2, 'split-v': 2, quad: 4 };
const DEFAULT_PANE_VIEWS: PaneView[] = ['schematic', 'layout', 'bom', 'overview'];

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
  const [splitLayout, setSplitLayout] = useState<SplitLayout>(() => {
    try {
      const saved = window.localStorage.getItem('openharness.splitLayout');
      if (saved === 'single' || saved === 'split-h' || saved === 'split-v' || saved === 'quad') return saved;
    } catch { /* ignore */ }
    return 'single';
  });
  const [paneViews, setPaneViews] = useState<PaneView[]>(() => {
    try {
      const saved = window.localStorage.getItem('openharness.paneViews');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length === 4) return parsed as PaneView[];
      }
    } catch { /* ignore */ }
    return DEFAULT_PANE_VIEWS;
  });
  useEffect(() => {
    try { window.localStorage.setItem('openharness.splitLayout', splitLayout); } catch { /* ignore */ }
  }, [splitLayout]);
  useEffect(() => {
    try { window.localStorage.setItem('openharness.paneViews', JSON.stringify(paneViews)); } catch { /* ignore */ }
  }, [paneViews]);
  const setPaneView = useCallback((index: number, view: PaneView) => {
    setPaneViews((prev) => { const next = [...prev]; next[index] = view; return next; });
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Cross-pane hover highlighting (spec follow-up: "when users hover over a
  // part, highlight part across all 3 panes"). Lifted here since Schematic,
  // Layout, and BOM are siblings — a component id hovered in any one of them
  // lights it up in the others too, even on tabs that aren't visible right
  // now (harmless: each pane just checks the id against its own content).
  const [hoveredComponentId, setHoveredComponentId] = useState<string | null>(null);
  // Wire/bundle cross-pane hover (Connor: "when I hover over wires or
  // connectors I want that highlighted in the schematic... if I highlight a
  // bundle, I want all wires that route through that point highlighted and
  // all relevant connectors highlighted"). Same lifted-state pattern as
  // hoveredComponentId: `hoveredWireId` originates from Schematic (the only
  // pane that draws individual wires) and `hoveredBundleId` originates from
  // Layout (the only pane that draws bundles); each pane also *reads* the
  // other's id to compute its own highlight set — see the derived-model
  // lookups (`bundleContents`/`wireRoutes`) in SchematicCanvas/LayoutCanvas.
  const [hoveredWireId, setHoveredWireId] = useState<string | null>(null);
  const [hoveredBundleId, setHoveredBundleId] = useState<string | null>(null);

  // Dark mode (follow-up request). The actual color values live in
  // index.css as `[data-theme='dark']` overrides of the --oh-* vars that
  // theme.ts's `theme.color.*` now resolve to, so toggling the attribute on
  // <html> re-themes every pane at once — nothing else needs to change.
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem('openharness.theme');
      if (saved) return saved === 'dark';
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
    try { window.localStorage.setItem('openharness.theme', darkMode ? 'dark' : 'light'); } catch { /* ignore */ }
  }, [darkMode]);

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

  // Interconnect table export/import (Connor: "add a new type of
  // window/export format... bidirectionally convertible" with the
  // Schematic). Export is a plain derived-view dump, same shape as BOM CSV
  // above. Import is the Table -> Schematic direction of that sync — every
  // parsed row is applied via the same `applyInterconnectRow` helper the
  // Table pane's own "+ Add connection" form uses, so an interconnect table
  // authored entirely outside this app (a spreadsheet) can grow a full
  // schematic with no manual re-entry (Connor: "if the table exists, then
  // the schematic should automatically be generated").
  const exportInterconnect = useCallback(async () => {
    if (!store) return;
    setError(null);
    try {
      await window.openharness.saveFile({
        title: 'Export interconnect table as CSV',
        defaultPath: `${store.doc.meta.name}-interconnect.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        contents: interconnectToCsv(store.derived.interconnect),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [store]);

  const importInterconnect = useCallback(async () => {
    if (!store) return;
    setError(null);
    setBusy(true);
    try {
      const picked = await window.openharness.pickFile({
        title: 'Import interconnect table CSV',
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (!picked) return;
      const rows = interconnectFromCsv(picked.contents);
      store.transact('Import interconnect table', (draft) => {
        let colorIndex = Object.keys(draft.wires).length;
        for (const row of rows) {
          applyInterconnectRow(draft, parseInterconnectCsvRow(row), colorIndex);
          colorIndex++;
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
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

  // One switch statement backs every pane, single or split — this is the
  // whole reason splitting the window was safe to add without touching
  // Schematic/Layout/BOM/Overview at all: each pane is just this function
  // called with a different `view`, sharing the one `hoveredComponentId`
  // pair so cross-pane highlighting works regardless of which views happen
  // to be on screen together.
  const renderPaneView = (view: PaneView) => {
    if (!store || !derived) return null;
    switch (view) {
      case 'schematic':
        return (
          <SchematicCanvas
            store={store}
            hoveredComponentId={hoveredComponentId} onHoverComponent={setHoveredComponentId}
            hoveredWireId={hoveredWireId} onHoverWire={setHoveredWireId}
            hoveredBundleId={hoveredBundleId}
          />
        );
      case 'layout':
        return (
          <LayoutCanvas
            store={store}
            hoveredComponentId={hoveredComponentId} onHoverComponent={setHoveredComponentId}
            hoveredWireId={hoveredWireId}
            hoveredBundleId={hoveredBundleId} onHoverBundle={setHoveredBundleId}
          />
        );
      case 'table':
        return <InterconnectTablePane store={store} hoveredComponentId={hoveredComponentId} onHoverComponent={setHoveredComponentId} />;
      case 'bom':
        return <BomPane store={store} hoveredComponentId={hoveredComponentId} onHoverComponent={setHoveredComponentId} />;
      case 'overview':
        return (
          <div style={styles.content}>
            <section style={styles.panel}>
              <h3 style={styles.panelTitle}>Document</h3>
              <table style={styles.kvTable}>
                <tbody>
                  <tr><td style={styles.kvKey}>Name</td><td style={styles.kvVal}>{store.doc.meta.name}</td></tr>
                  <tr><td style={styles.kvKey}>Components</td><td style={styles.kvVal}>{Object.keys(store.doc.components).length}</td></tr>
                  <tr><td style={styles.kvKey}>Wires</td><td style={styles.kvVal}>{Object.keys(store.doc.wires).length}</td></tr>
                  <tr><td style={styles.kvKey}>Bundles</td><td style={styles.kvVal}>{Object.keys(store.doc.bundles).length}</td></tr>
                  <tr><td style={styles.kvKey}>Nets</td><td style={styles.kvVal}>{derived.nets.length}</td></tr>
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

            {/* Project-level drawing and modelling settings. These live on
                the document (not in app-local state) because they change what
                the drawing MEANS to a reader — which twisted-pair standard is
                being used, how far a wire runs straight out of a connector
                before the router may bend it — so they have to travel with
                the file, not with whoever happens to open it. */}
            <section style={styles.panel}>
              <h3 style={styles.panelTitle}>Settings</h3>
              <table style={styles.kvTable}>
                <tbody>
                  <tr>
                    <td style={styles.kvKey}>Twisted-pair symbol</td>
                    <td style={styles.kvVal}>
                      <select
                        style={styles.settingControl}
                        value={store.doc.settings.twistedPairStyle ?? 'ieee315'}
                        onChange={(e) => {
                          const v = e.target.value as TwistedPairStyle;
                          store.transact('Set twisted-pair style', (draft) => { draft.settings.twistedPairStyle = v; });
                        }}
                      >
                        <option value="ieee315">IEEE Std 315-1975 (single crossover)</option>
                        <option value="iec60617">IEC 60617-3 (braid)</option>
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <td style={styles.kvKey}>Connector exit stub</td>
                    <td style={styles.kvVal}>
                      <input
                        style={styles.settingControl}
                        type="number" min={0} max={80} step={1}
                        value={store.doc.settings.schematicExitStub ?? DEFAULT_EXIT_STUB}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          store.transact('Set exit stub length', (draft) => {
                            draft.settings.schematicExitStub = Number.isFinite(v) ? Math.max(0, v) : DEFAULT_EXIT_STUB;
                          });
                        }}
                      />
                      <span style={styles.settingHint}>
                        px a wire runs straight out of a port before the router may bend it — raise it to leave
                        room for a shield-wrap symbol at the connector.
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td style={styles.kvKey}>Parasitics</td>
                    <td style={styles.kvVal}>
                      <label style={styles.settingCheckbox}>
                        <input
                          type="checkbox"
                          checked={store.doc.settings.showParasitics === true}
                          onChange={(e) => {
                            const v = e.target.checked;
                            store.transact('Toggle show parasitics', (draft) => { draft.settings.showParasitics = v; });
                          }}
                        />
                        Show R / C / L fields in Properties
                      </label>
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section style={styles.panel}>
              <h3 style={styles.panelTitle}>Diagnostics ({derived.diagnostics.length})</h3>
              {derived.diagnostics.length === 0 ? (
                <p style={styles.mutedNote}>No diagnostics — this document is clean.</p>
              ) : (
                <table style={styles.table}>
                  <thead><tr><th style={styles.th}>Severity</th><th style={styles.th}>Rule</th><th style={styles.th}>Message</th></tr></thead>
                  <tbody>
                    {derived.diagnostics.map((d, i) => (
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
              <h3 style={styles.panelTitle}>BOM</h3>
              <p style={styles.mutedNote}>
                {derived.bom.length} rolled-up {derived.bom.length === 1 ? 'line' : 'lines'} from {Object.keys(store.doc.parts).length} parts.
                Open the <strong>BOM</strong> pane to assign parts, browse the parts library, or export.
              </p>
            </section>
          </div>
        );
    }
  };

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
          <button style={styles.button} disabled={!store} onClick={() => void exportInterconnect()}>Export Interconnect CSV…</button>
          <button style={styles.button} disabled={!store || busy} onClick={() => void importInterconnect()}>Import Interconnect CSV…</button>
        </div>

        {store && splitLayout === 'single' && (
          <div style={styles.tabGroup}>
            <button style={styles.tabButton(paneViews[0] === 'schematic')} onClick={() => setPaneView(0, 'schematic')}>
              Schematic
            </button>
            <button style={styles.tabButton(paneViews[0] === 'layout')} onClick={() => setPaneView(0, 'layout')}>
              Layout
            </button>
            <button style={styles.tabButton(paneViews[0] === 'table')} onClick={() => setPaneView(0, 'table')}>
              Table
            </button>
            <button style={styles.tabButton(paneViews[0] === 'bom')} onClick={() => setPaneView(0, 'bom')}>
              BOM
              {store && Object.keys(store.doc.parts).length > 0 && (
                <span style={styles.tabBadge(false)}>{Object.keys(store.doc.parts).length}</span>
              )}
            </button>
            <button style={styles.tabButton(paneViews[0] === 'overview')} onClick={() => setPaneView(0, 'overview')}>
              Overview
              {derived && derived.diagnostics.length > 0 && (
                <span style={styles.tabBadge(errorCount > 0)}>{derived.diagnostics.length}</span>
              )}
            </button>
          </div>
        )}

        {store && (
          <div style={styles.splitGroup} title="Split the window into multiple panes">
            <SplitButton active={splitLayout === 'single'} onClick={() => setSplitLayout('single')} label="Single pane" kind="single" />
            <SplitButton active={splitLayout === 'split-h'} onClick={() => setSplitLayout('split-h')} label="Split side by side" kind="split-h" />
            <SplitButton active={splitLayout === 'split-v'} onClick={() => setSplitLayout('split-v')} label="Split top and bottom" kind="split-v" />
            <SplitButton active={splitLayout === 'quad'} onClick={() => setSplitLayout('quad')} label="Split into quarters" kind="quad" />
          </div>
        )}

        <div style={styles.toolbarSpacer} />
        {sourcePath && <span style={styles.path} title={sourcePath}>{shortenPath(sourcePath)}</span>}
        <button
          style={styles.iconToggle}
          onClick={() => setDarkMode((d) => !d)}
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? '☀︎' : '☾'}
        </button>
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
      ) : splitLayout === 'single' ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {renderPaneView(paneViews[0] ?? 'schematic')}
        </div>
      ) : (
        <div style={styles.paneGrid(splitLayout)}>
          {Array.from({ length: PANE_COUNT[splitLayout] }, (_, i) => {
            const view = paneViews[i] ?? DEFAULT_PANE_VIEWS[i] ?? 'schematic';
            return (
              <div key={i} style={styles.paneCell}>
                <div style={styles.paneHeader}>
                  <select
                    style={styles.paneSelect}
                    value={view}
                    onChange={(e) => setPaneView(i, e.target.value as PaneView)}
                  >
                    <option value="schematic">Schematic</option>
                    <option value="layout">Layout</option>
                    <option value="table">Table</option>
                    <option value="bom">BOM{store && Object.keys(store.doc.parts).length > 0 ? ` (${Object.keys(store.doc.parts).length})` : ''}</option>
                    <option value="overview">Overview{derived && derived.diagnostics.length > 0 ? ` (${derived.diagnostics.length})` : ''}</option>
                  </select>
                </div>
                <div style={styles.paneBody}>
                  {renderPaneView(view)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One button in the split-layout picker — four tiny geometric glyphs
 * (a single square, two side by side, two stacked, four quarters) so the
 * current arrangement reads at a glance without a text label taking up
 * toolbar space. */
function SplitButton({
  active, onClick, label, kind,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  kind: SplitLayout;
}) {
  return (
    <button style={styles.splitBtn(active)} onClick={onClick} title={label}>
      <svg width={14} height={14} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.4}>
        <rect x={1} y={1} width={12} height={12} rx={1.5} />
        {kind === 'split-h' && <line x1={7} y1={1} x2={7} y2={13} />}
        {kind === 'split-v' && <line x1={1} y1={7} x2={13} y2={7} />}
        {kind === 'quad' && <><line x1={7} y1={1} x2={7} y2={13} /><line x1={1} y1={7} x2={13} y2={7} /></>}
      </svg>
    </button>
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
  splitGroup: {
    display: 'flex', alignItems: 'center', gap: 2, background: theme.color.canvasBg, padding: 3,
    borderRadius: 8, border: `1px solid ${theme.color.border}`,
  },
  splitBtn: (active: boolean) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 24,
    border: 'none', borderRadius: 5, cursor: 'pointer',
    background: active ? theme.color.surface : 'transparent',
    color: active ? theme.color.accent : theme.color.textMuted,
    boxShadow: active ? theme.shadow.panel : 'none',
  }),
  paneGrid: (layout: SplitLayout) => ({
    flex: 1, minHeight: 0, display: 'grid', gap: 1, background: theme.color.border,
    gridTemplateColumns: layout === 'split-h' || layout === 'quad' ? '1fr 1fr' : '1fr',
    gridTemplateRows: layout === 'split-v' || layout === 'quad' ? '1fr 1fr' : '1fr',
  }),
  paneCell: { display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, background: theme.color.canvasBg },
  paneHeader: {
    display: 'flex', alignItems: 'center', padding: '4px 6px', background: theme.color.surface,
    borderBottom: `1px solid ${theme.color.border}`, flexShrink: 0,
  },
  paneSelect: {
    border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control, padding: '3px 6px',
    fontSize: 11.5, fontWeight: 600, background: theme.color.canvasBg, color: theme.color.textStrong,
  },
  paneBody: { flex: 1, minHeight: 0, minWidth: 0, display: 'flex', overflow: 'hidden' },
  tabBadge: (danger: boolean) => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 16, height: 16,
    padding: '0 4px', borderRadius: 8, fontSize: 10.5, fontWeight: 700,
    background: danger ? theme.color.dangerSoft : theme.color.warningSoft,
    color: danger ? theme.color.danger : theme.color.warning,
  }),
  path: { color: theme.color.textFaint, fontSize: 12, fontFamily: 'ui-monospace, monospace' },
  iconToggle: {
    width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control,
    background: theme.color.surface, color: theme.color.textMuted, cursor: 'pointer', fontSize: 14, padding: 0,
  },
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
  settingControl: {
    padding: '4px 8px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control,
    fontSize: 12.5, background: theme.color.surface, color: theme.color.textStrong, maxWidth: 280,
  },
  settingHint: { display: 'block', marginTop: 4, fontSize: 11, color: theme.color.textFaint, lineHeight: 1.4 },
  settingCheckbox: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: theme.color.textStrong },
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
