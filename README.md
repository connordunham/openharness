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
  auto-routing, wire groups (twist / cable) with shields and shield-termination
  glyphs, cross-pane hover highlighting. Wires are always auto-routed; the
  manual drag-to-bend affordance was deliberately removed.
- **Layout** — connector/component glyphs with auto-orientation and auto-place,
  flowy bundle routing with per-segment lengths, bundle waypoints, signal-name
  hover tooltips, a closable bundle card, and pass-through resistors/diodes
  drawn inline on the merged bundle line.
- **Table** — an interconnect table that is bidirectional with the Schematic:
  edit either and the other follows. CSV import/export, per-signal direction
  (in / out / bidirectional) and an impedance-matched flag with a triangle
  indicator at each pin.
- **Parts / BOM** — shared part fields across every part kind (manufacturer PN,
  vendor PN, link, cost, max rating), grouped BOM with populated-cavity contact
  and seal rollup, CSV export.
- **Diagnostics** — live DRC output from the derive pipeline.

Both canvases pan by click-drag and mouse wheel. Zoom is a known gap and is
deliberately deferred.

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

**110 tests pass** across `core` (43), `io` (28), `cli` (21), and `render`
(18). Along the way, fixing a Map-iteration-order false positive in the `.ohd`
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
npm test           # vitest run, 110 tests
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

Next up, in order:

1. **Generic parameter list for parts** — replace the single `maxRating` field
   with a repeatable list of `{ value, type: min/max/nom/typ, unit }`
   parameters, user-extensible.
2. **Parasitics on all components** — optional resistance / capacitance /
   inductance, defaulting to zero and hidden in Properties behind a "show
   parasitics" toggle.
3. **Wire parts** gain optional per-unit-length resistance and capacitance.
4. **Multi-select** — lasso-drag to select multiple wires; extend shift-click
   beyond wires/groups to every component type.
5. **Wire groups** — decouple the twisted visual from the group's `kind` (make
   it an explicit opt-in checkbox) and add a project-level setting choosing
   between IEEE Std 315-1975 and IEC 60617-3 twisted-pair symbol styles.
6. **Shields** — user-controlled position along the wire run, a termination
   connection node on the shield itself, an optional connector "backshell
   termination" toggle adding a BS contact, a shield model choice (standalone
   part / IPC-620 wire+termination / custom), and a configurable straight
   exit-stub length for wires leaving a connector so there's room to draw the
   shield-wrap symbol before the auto-router bends them.

Deferred, not forgotten: **zoom** for the Schematic and Layout canvases.

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
