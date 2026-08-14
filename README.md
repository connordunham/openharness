# OpenHarness

A local, automation-first wire harness CAD tool. Full design spec:
[`HARNESS-DESIGNER-SPEC.md`](../HARNESS-DESIGNER-SPEC.md) (in the project folder,
one level up from this repo). Review notes and open decisions:
[`SPEC-REVIEW-RECOMMENDATIONS.md`](../SPEC-REVIEW-RECOMMENDATIONS.md).

## Status

**Phase 1 in progress.** `@openharness/core` now has a real, tested
implementation of the whole derived model (spec §6):

- **Net extraction** (`derive/netExtraction.ts`) — union-find over cavities,
  splices (n-ary hyper-nodes), two-terminal sides (resistor/diode — kept
  separate, not unioned), cable cores/shield, and free ends; global-signal
  merging and signal-propagation/conflict detection.
- **Routing** (`derive/routing.ts`) — Dijkstra over the layout graph with
  deterministic tie-breaking, frozen-route validation, recursive splice-host
  resolution (with a visited-set to terminate chains), and the cable
  core/shield short-circuit (`jumper`/`shield` statuses, never `noRoute`).
- **Length** (`derive/length.ts`) — integer-micrometre summation, service
  loops, strip-length allowances, `lengthOverride`.
- **BOM** (`derive/bom.ts`) — grouped by part, with populated-cavity
  contact/seal rollup. Configuration-accessory rollup and length-based
  covering pricing are explicitly deferred — see the comment at the top of
  the file for why.
- **DRC** (`derive/rules.ts`) — 9 of the 16 built-in rules from spec §6.5
  (the rest need part-catalogue detail or formboard geometry no fixture
  exercises yet).

39 unit tests pass (`packages/core`), including a case (`routing.test.ts`,
"R12") that caught and fixed a real bug in splice-host resolution — the
first implementation didn't exclude the wire being routed from its own
splice's neighbour vote, which made otherwise-unambiguous splices look
falsely ambiguous.

`@openharness/io` now has a working vendor wire-format v0.8 JSON importer
(`importVendorJson.ts`, spec §11), tested against both real captured
exports — not synthetic data. It also has `.ohd` save/load with stable,
alphabetically-sorted keys for clean git diffs (spec §10), BOM CSV export
(spec §9), and diagnostics JSON/text formatting.

**The CLI is now real, not a placeholder.** `openharness import`,
`validate`, and `export --bom` (spec §8.6) work end to end — verified both
with unit tests (18 tests in `packages/cli`) and by actually running the
built CLI as a subprocess against the real reference export:

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
review's evidence-discipline (R2: these rules are "plausible engineering
concerns, not matching the original's actual guardrails" until checked
against the real app).

93 tests pass across `core` (40), `io` (28), and `cli` (18). Along the way,
fixing a Map-iteration-order false positive in the `.ohd` round-trip test
surfaced a real (if minor) issue: BOM/diagnostics/nets output order depended
on incidental object-insertion order, which would have made exported CSVs
and golden-file diffs non-reproducible for no functional reason —
`computeDerivedModel` now sorts all three deterministically before
returning, with a dedicated regression test.

Still placeholder: rendering, PDF/XLSX/WireViz export, the automation host,
the MCP server, and the CLI's `run`/`query`/`diff`/`doctor` commands. See
`HARNESS-DESIGNER-SPEC.md` §12 for the phase plan.

## Layout

```
packages/
  core/         @openharness/core        — document model, store, derive: IMPLEMENTED
  io/           @openharness/io          — the reference tool import, .ohd save/load, BOM CSV: IMPLEMENTED. PDF/XLSX/WireViz export, KiCad import: TODO (Phase 6)
  cli/          openharness              — import/validate/export --bom: IMPLEMENTED. run/query/diff/doctor: TODO (Phase 5+)
  render/       @openharness/render      — SVG scene builders (TODO, Phase 2)
  automation/   @openharness/automation  — plugin host (TODO, Phase 5)
  mcp/          @openharness/mcp         — local MCP server (TODO, Phase 5)
  app/          @openharness/app         — React editor (TODO, Phase 2)
automations/    — your own automations live here (spec §8.2)
fixtures/       — golden-file test documents (spec §13)
```

## Before you start Phase 1

Per the review document's closing summary, six decisions are still open and
should be made deliberately before real feature work starts:

1. Tauri/Electron-primary vs. browser-primary (review R15)
2. Variants/configurable harnesses — in or out of v1, as an explicit ADR (R3)
3. Directory file format's atomic-write story (R11)
4. Derived-model invalidation contract (R9)
5. Rough NFR numbers — target doc size, startup budget (R25)
6. PDF export spike, before Phase 2-3 UI assumes it works (R20)

## Getting started

```bash
npm install   # or pnpm install, if you have pnpm — pnpm-workspace.yaml is included
npm run typecheck
npm test
```

The `core` package has a real (if minimal) test suite exercising
`createEmptyDocument`, `HarnessStore.transact`, undo/redo, and dry-run. Start
there — `packages/core/src/store.ts` and `packages/core/src/types.ts` are the
foundation everything else builds on.
