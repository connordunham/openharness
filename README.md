# OpenHarness

A local, automation-first wire harness CAD tool. Electron desktop app plus a
TypeScript monorepo (`core` / `io` / `render` / `cli`) that all share one
document model.

- Full design spec: [`docs/HARNESS-DESIGNER-SPEC.md`](docs/HARNESS-DESIGNER-SPEC.md)
- Review notes and open decisions: [`docs/SPEC-REVIEW-RECOMMENDATIONS.md`](docs/SPEC-REVIEW-RECOMMENDATIONS.md)
- Running build log / session context: [`docs/00-SESSION-CONTEXT.md`](docs/00-SESSION-CONTEXT.md)

## Status

**There is a real, running GUI with working Schematic and Layout canvases.**
`@openharness/app` is an Electron desktop app (decision: Electron over Tauri —
same TypeScript/Node codebase as `@openharness/core`/`io`, no IPC boundary
between the app and automation scripts that need `fs`/`child_process`).

Panes that work today:

- **Schematic** — real symbols for every component type (connector housings by
  shape, splice, terminal, branch point, resistor, diode, cable), 45°-diagonal
  auto-routing with **drag-to-bend** manual override, marquee (lasso) and
  shift-click multi-select across wires, groups and components, wire groups
  (twist / cable) with an explicit twisted flag, shields with a user-positioned
  wrap, per-end terminations and a wirable termination node, optional connector
  backshell (BS) terminations, and cross-pane hover highlighting.
- **Layout** — connector/component glyphs with auto-orientation and auto-place,
  flowy bundle routing with per-segment lengths, bundle waypoints, signal-name
  hover tooltips, a closable bundle card, and pass-through resistors/diodes
  drawn inline on the merged bundle line.
- **Table** — an interconnect table that is bidirectional with the Schematic:
  edit either and the other follows. CSV import/export, per-signal direction
  (in / out / bidirectional) and an impedance-matched flag with a triangle
  indicator at each pin.
- **Parts / BOM** — shared part fields across every part kind (manufacturer PN,
  vendor PN, link, cost) plus a repeatable, user-extensible **parameter list**
  (`{name, min/max/nom/typ/abs, value, unit}`) replacing the old single
  max-rating slot; grouped BOM with populated-cavity contact and seal rollup,
  CSV export.
- **Diagnostics** — live DRC output from the derive pipeline.

Layout pans by click-drag; Schematic reserves left-drag on empty canvas for
the marquee, so it pans with alt-drag or the middle button. Both pan with the
mouse wheel. Zoom is a known gap and is deliberately deferred.

Verified by actually building and launching the app on Windows and driving it
with real mouse input — not just typechecked. That process caught a real bug
early on: the preload script (the bridge between the sandboxed renderer and the
main process) was compiled as ESM, but Electron's sandboxed preload context
doesn't reliably run ES modules, so the `contextBridge` call silently never
executed and every button threw `Cannot read properties of undefined (reading
'pickFile')`. Fixed by forcing the preload script to compile as CommonJS via
TypeScript's `.cts` source extension, independent of the package's
`"type": "module"`. No unit test or typecheck could have caught that — it only
shows up when the built app is actually run.

### Derived model

`@openharness/core` has a real, tested implementation of the whole derived
model (spec §6):

- **Net extraction** (`derive/netExtraction.ts`) — union-find over cavities,
  splices (n-ary hyper-nodes), two-terminal sides (resistor/diode — kept
  separate, not unioned), cable cores/shield, and free ends; global-signal
  merging and signal-propagation/conflict detection.
- **Routing** (`derive/routing.ts`) — Dijkstra over the layout graph with
  deterministic tie-breaking, frozen-route validation, recursive splice-host
  resolution (with a visited-set to terminate chains), and the cable
  core/shield short-circuit (`jumper`/`shield` statuses, never `noRoute`).
- **Length** (`derive/length.ts`, `derive/bundleLength.ts`) — integer-micrometre
  summation, service loops, strip-length allowances, `lengthOverride`, and
  per-segment authored bundle lengths.
- **BOM** (`derive/bom.ts`) — grouped by part, with populated-cavity
  contact/seal rollup. Configuration-accessory rollup and length-based
  covering pricing are explicitly deferred — see the comment at the top of
  the file for why.
- **Interconnect** (`derive/interconnect.ts`) — one row per wire, with each
  endpoint's declared direction folded into a single resolved direction and a
  `conflict` value surfaced rather than guessed.
- **Parasitics** (`derive/parasitics.ts`) — per-wire R and C from the wire
  part's per-unit-length figures times the derived length, carrying a
  `lengthKnown` flag so an unrouted wire reports "unknown" rather than a
  confident zero. Components carry their own optional R/C/L, hidden behind a
  project-level "show parasitics" setting.
- **DRC** (`derive/rules.ts`) — 9 of the 16 built-in rules from spec §6.5 (the
  rest need part-catalogue detail or formboard geometry no fixture exercises
  yet).

### I/O and CLI

`@openharness/io` has a working vendor wire-format v0.8 JSON importer
(`importVendorJson.ts`, spec §11), tested against both real captured
exports — not synthetic data. It also has `.ohd` save/load with stable,
alphabetically-sorted keys for clean git diffs (spec §10), BOM CSV export
(spec §9), interconnect CSV import/export, and diagnostics JSON/text
formatting.

**The CLI is real, not a placeholder.** `openharness import`, `validate`, and
`export --bom` (spec §8.6) work end to end — verified both with unit tests and
by running the built CLI as a subprocess against the real reference export:

```
$ openharness import reference-harness.json -o out.ohd --name "Smoke Test"
Wrote out.ohd
$ openharness validate out.ohd --fail-on error
[ERROR] OVERFILLED_CAVITY: C3 cavity _blVGl has 2 wires without a splice (cavity:ZWfYpO:_blVGl)
... (exit code 1)
$ openharness export out.ohd --bom bom.csv
Wrote bom.csv
```

That OVERFILLED_CAVITY error is itself a real finding: the actual reference
document has a connector used as an in-line jumper (two wires per cavity, no
splice) — possibly a legitimate pattern the rule is too strict about, flagged
in a comment in `rules.ts` rather than silently special-cased away, per the
review's evidence discipline (R2: these rules are "plausible engineering
concerns, not matching the original's actual guardrails" until checked against
the real app).

**196 tests pass** across `core` (82), `io` (30), `cli` (21), and `render`
(63). Along the way, fixing a Map-iteration-order false positive in the `.ohd`
round-trip test surfaced a real (if minor) issue: BOM/diagnostics/nets output
order depended on incidental object-insertion order, which would have made
exported CSVs and golden-file diffs non-reproducible for no functional reason —
`computeDerivedModel` now sorts all three deterministically, with a dedicated
regression test.

Still not built: PDF/XLSX/WireViz export, the automation host, the MCP server,
and the CLI's `run`/`query`/`diff`/`doctor` commands. See
[`docs/HARNESS-DESIGNER-SPEC.md`](docs/HARNESS-DESIGNER-SPEC.md) §12 for the
phase plan.

## Layout

```
packages/
  core/         @openharness/core        — document model, store, derive pipeline
  io/           @openharness/io          — the reference tool import, .ohd save/load, BOM + interconnect CSV
  cli/          openharness              — import / validate / export --bom
  app/          @openharness/app         — Electron desktop app: Schematic, Layout, Table, Parts, Diagnostics
  render/       @openharness/render      — SVG scene builders shared by the canvases
  automation/   @openharness/automation  — plugin host (TODO, Phase 5)
  mcp/          @openharness/mcp         — local MCP server (TODO, Phase 5)
automations/    — your own automations live here (spec §8.2)
docs/           — design spec, review notes, session context
fixtures/       — golden-file test documents (spec §13)
```

## Getting started

```bash
npm install        # or pnpm install — pnpm-workspace.yaml is included
npm run typecheck  # tsc -b across the project references
npm test           # vitest run, 196 tests
npm run lint
```

Running the app:

```bash
cd packages/app
npm run build      # vite build (renderer) + tsc (electron main/preload)
npm run start
```

Note: launch Electron pointed at `packages/app`, not the repo root.

`packages/core/src/store.ts` and `packages/core/src/types.ts` are the
foundation everything else builds on — start there.

## Roadmap

Full plan: [`docs/ROADMAP.md`](docs/ROADMAP.md) — a gap analysis against
[docs.the reference tool](the vendor documentation), the reference app this
project was specced against, captured in full on 17 August 2026.

Shipped since the last roadmap: a repeatable part parameter list replacing the
single max-rating slot; parasitics on components and per-unit-length R/C on
wire parts; marquee and shift-click multi-select; twisted decoupled from group
kind with an IEEE 315 / IEC 60617-3 setting; and the shield overhaul
(positioned wrap, per-end terminations, a wirable termination node, backshell
BS contacts, and a costing model that decides whether the shield gets a BOM
line). Drag-to-bend manual wire routing came back alongside them.

Next, in order — see `docs/ROADMAP.md` for the reasoning and the full table:

1. **Drawing correctness** — zoom; mates (connector↔connector and
   terminal↔cavity, with the cavity-count/gender/size validation that follows);
   wire-gauge-vs-contact checking with the mm² summation rule; rotate; cavity
   insert/delete; jumper wires; view toggles.
2. **Typed part properties** — contact, terminal, splice, diode and resistor
   fields, kept alongside the open `parameters[]` list rather than replacing
   it, because validation needs typed fields and datasheets need open ones.
3. **Bulk editing** — global search, type-to-connect destinations, select-wires-
   on-net, auto-layout, add-splice-from-selection, inline connectors, groups.
4. **Output** — PDF with a title block, XLSX wiring table with per-connector
   pinout sheets, and the reference tool export to match the existing importer.
5. **Formboard** — 1:1 scale layout, panel grid, bend radii, to-scale
   snapping, per-panel PDF.
6. **Local parts library** — a version-controllable catalog with real sync state.
7. **Automation surface** — the MCP server, the automation host, and the CLI's
   `run`/`query`/`diff`/`doctor`.

Also outstanding: **dependency upgrades** — Electron 31, Vite 5 and Vitest 2
all carry open advisories; all are dev/build-time except Electron, which ships.

Deliberately not pursued: teams, seats, billing, cloud sharing and embedding,
accounts, live multi-user sync, and mobile viewing — all consequences of the
reference tool being a hosted subscription product. See the roadmap's
Non-goals section.

## Open decisions

Five decisions remain open from the review document's closing summary and
should be made deliberately before the canvas work goes deeper:

1. Variants / configurable harnesses — in or out of v1, as an explicit ADR (R3)
2. Directory file format's atomic-write story (R11)
3. Derived-model invalidation contract (R9)
4. Rough NFR numbers — target doc size, startup budget (R25)
5. PDF export spike, before the UI assumes it works (R20)

## License

MIT — see [`LICENSE`](LICENSE).
