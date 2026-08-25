# Task packets

Ordered work, one packet per file. Each is self-contained — read
`docs/HANDOFF.md` once, then only the packet you are doing.

## Current priority -- updated 2026-08-25 (revised same day, per Connor)

**Reprioritized: the previously-postponed independent track (`T05` onward) is
next, starting with `T05`. The data-layer packets `T19`/`T20`/`T21`/`T22` are
paused, not dropped -- resume them after this track or when Connor says so.**
This is a project-owner decision, not a derivation from the dependency graph.
Do not re-derive an order from the graph below and start something else.

```
  finish first --> Phase 2a / Phase 2b running-app check
                   (both are implemented, reviewed, and gated green; the one
                   thing not yet done is actually opening the app and looking
                   at bundle rendering and connector rotation on the Layout
                   canvas -- land that before opening new work, whichever
                   track that new work is)

  then, in order -> T05  schematic ergonomics   M    <- start here
                    T06  view toggles           M    (independent)
                    T08  groups                 M    (independent)
                    T07  search + destinations  L    (needs T06)
                    T09  PDF export             L
                    T10  XLSX wiring table      M    (needs T09)
                    T12  formboard              XL   (needs T04, done)
                    T13  automation surface     L    (last on purpose --
                                                       API should stop
                                                       moving first)

  pull-forward
  candidates -----> T14  current capacity       L  the two rules the resident
                    T15  bend radius            M  engineer named as highest
                                                    value; T15 needs nothing,
                                                    T14 needs only T01 (done);
                                                    either can be slotted in
                                                    anywhere above

  paused,
  not dropped ----> T19  resolution             M    (needs T16 + T18, both done)
                    T20  buffer / spools        M    (needs T16, done)
                    T21  BOM release            L    (needs T18, T19, T20)
                    T22  tooling checklist      M    (needs T16, T19)
```

`T02` and `T04` are fully closed, running-app checks included. `Phase 2a` and
`Phase 2b` are not -- land that check first regardless of which track opens
next; it is the same category of loose end `T02`/`T04` used to represent.

Data-layer status for reference, unchanged by this reprioritization: `T16`-
`T18` shipped and are independently verified (a packaged build opens a
library; native-module rebuild is checked against Electron's ABI on every
package run via `scripts/rebuild-native.mjs`). `T19`-`T22` are fully specified
and ready to resume the moment this track is done or Connor calls an audible.

`T05`-`T13`'s previous direction -- parked until the data layer clears -- is
superseded by this update. `T14` and `T15` remain deferred-but-pullable, as
before.

## Order and dependencies

*Reference only. The priority above overrides the reading order here.*

```
T01 gauge conversion ──┬── T02 mates ── T03 wire-gauge-vs-contact DRC
                       └── T03
T04 zoom  (independent, do early — every later canvas task is easier after it)
T05 schematic ergonomics   (independent)
T06 view toggles + selection info   (independent)
T07 search + destinations   (after T06: shares the view-options surface)
T08 groups / frames   (independent)
T09 PDF export ── T10 XLSX wiring table   (T09 first: shares the page model)
T11 parts library   SUPERSEDED — see the data layer below
T12 formboard   (after T04: needs zoom to be usable at 1:1)
T13 automation surface   (last: the API should stop moving first)

Data layer (docs/DATA-LAYER-SPEC.md) — a second, largely independent track:

T16 parts store ──┬── T17 versioning
                  ├── T18 sourcing ──┐
                  ├── T19 resolution ─┼── T21 BOM release
                  ├── T20 buffer/spools ┘
                  └── T22 tooling checklist   (also needs T19)
```

`T14` and `T15` are the design-rule checks the project's harness engineer named
as highest-value (`docs/DOMAIN-DECISIONS.md` D4). They sit outside the graph
above because they are independent of it — T14 needs T01, T15 needs nothing.
They are the checks most likely to catch a defect in a harness someone actually
builds.

They are **deliberately deferred behind the data layer**, not forgotten. That
was a considered call by the project owner with the trade-off stated. `T15`
needs no prerequisites and is an M, so it can be pulled forward at any point
without disturbing the data-layer track.

**The data layer (`T16`–`T22`) is a new requirement** — see
`docs/DATA-LAYER-SPEC.md` for the adopted specification, the six deviations from
the submitted version, and why each was made. `T16` is its `T01`: everything
else in that track needs the store and its canonical units first. The track is
independent of `T02`–`T15` and can run in parallel with them, with one
exception — `T16` adds the project's first native module, which changes how the
app is packaged. Read its Traps before starting.

`T11` is superseded by that track. Its storage choice lost; its sync semantics
were right and are carried forward verbatim into `T19`.

`T01` is genuinely first. Three later packets need gauge comparison and each
would otherwise invent its own, differently wrong, version.

## Status

| Packet | Title | Size | State |
|---|---|---|---|
| T01 | Gauge conversion | S | ✅ complete |
| T02 | Mates | L | ✅ complete — B5 (mate rendering/creation), B6 (terminal-to-terminal union), B7 (odd AWG sizes) fixed; re-review approved |
| T03 | Wire-gauge-vs-contact validation | M | ✅ complete |
| T04 | Zoom | M | ✅ complete — B1 (pan in transform), B2 (`clientToCanvas` scale-aware), B3 (input mapping), B8 (scroll-offset anchor), B4 (fit-to-view/selection), C9 (DRAG_THRESHOLD in screen px), C10 (zoom overlay positioning via `canvasToScreen`) fixed; running-app verification complete |
| T05 | Schematic ergonomics | M | not started |
| T06 | View toggles and selection info | M | not started |
| T07 | Search and destinations | L | not started |
| T08 | Groups and the device convention | M | not started |
| T09 | PDF export | L | not started |
| T10 | XLSX wiring table | M | not started |
| T11 | Local parts library | L | ⛔ superseded by T16–T22 — sync contract carried into T19 |
| T12 | Formboard | XL | not started |
| T13 | Automation surface | L | not started |
| T14 | Current capacity with bundle derating | L | not started |
| T15 | Bend radius | M | not started |
| T16 | Parts library store (SQLite) | XL | implemented — SQLite master parts library (@openharness/parts) with forward migration runner, canonical units, join-table compatibility, ISO-8601 timestamps, native module packaging rebuild verified via packaged Electron build; 14 tests (536 total), all four gates green |
| T17 | Part versioning and revision log | M | implemented — field-level part versioning and revision logging in @openharness/parts; single transaction per update/delete with atomic version bumps, float/type-aware diffing, no-op save suppression, round-tripping stringification, revision replay helper with part/type filtering & gap validation, and __deleted__ logging on deletion; 21 new tests (557 total), all four gates green |
| T18 | Suppliers, sourcing and price history | M | implemented — suppliers, part_sourcing, and price_history tables with schema v2 migration in @openharness/parts; atomic preferred supplier clearing, closed-set currency (USD/CAD) and part_type validation, unrounded REAL unit_cost storage for fractional pricing, audit trail recording in price_history on price/currency change, nullable MOQ and lead times, and cascading deletion on supplier removal; 14 new tests (571 total), all four gates green |
| T19 | Part-number resolution between stores | M | not started |
| T20 | Scrap buffer and spool quantity | M | not started |
| T21 | Released BOM snapshot | L | not started |
| T22 | Tooling registry and shop checklist | M | not started |
| T23 | CSV formula injection hardening | S | implemented — hardened csvEscape in bomCsv.ts and interconnectCsv.ts against formula injection (CWE-1236) via force-quoting and tab-prefixing cells starting with =, +, -, or @; round-trips cleanly via interconnectFromCsv; 16 new tests (589 total), all four gates green |
| Phase 2a | Cable bundle routing: bundle visualisation & interaction | L | implemented — bundle outline/label/diameter/conflict rendering, drag-to-move and wire extraction on the Layout canvas (`docs/PHASE2-REFINED-DESIGN.md`); reviewer fixes applied (NUL tie-break separator restored in `joinPath` with a regression test, polyline-vs-spline approximation documented); 68 new tests (464 total), all four gates green; running-app check outstanding |
| Phase 2b | Cable bundle routing: connector orientation | M | implemented — R rotates a selected connector 90° (Shift+R auto-optimizes: fewest bundle crossings) on the Layout canvas; stored `rotation` is an offset on top of glyph auto-orientation, labelled on the canvas, undoable and persisted; orientation/attach/polyline geometry extracted to `render/layoutOrientation.ts`, optimizer in `render/connectorOptimization.ts`; schematic-scene changes in the brief don't apply (schematic boxes route horizontally — see packet report); reviewer fixes applied (inline pass-through scoring approximation documented honestly at all three claim sites, direct `countPathCrossings` self/pair-crossing/exclusion tests, rotation label gated to connectors); 50 new tests (514 total), all four gates green; running-app check outstanding |

S ≈ half a day, M ≈ a day, L ≈ two to three, XL ≈ a week.

Keep this table current — it is the only place the overall state is written
down.
