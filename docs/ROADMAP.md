
## How to read the status column

| | meaning |
|---|---|
| **done** | Implemented and tested in OpenHarness today. |
| **model** | The data model supports it; no UI or derive stage uses it yet. Usually a small job. |
| **partial** | Something real exists but is materially narrower than the reference. |
| **gap** | Not present in any form. |
| **skip** | Deliberately not pursued — see [Non-goals](#non-goals). |

---

## Phase 1 — Close the drawing-correctness gaps

These are things that make a drawing wrong or unusable, not merely less
convenient. Everything here is small-to-medium and mostly builds on model
fields that already exist.

| Feature | Reference behaviour | Status | Notes |
|---|---|---|---|
| **Zoom** | Scroll to zoom (mouse) / pinch (trackpad), fit-to-view, fit-to-selection | **gap** | Already the one deliberately deferred item. Every pixel-delta drag in both canvases must divide by the zoom factor. `clientToCanvas` in SchematicCanvas is already written against `getBoundingClientRect` and survives a transform; Layout's drag paths are not. |
| **Mates** | Connector↔connector, terminal↔terminal, terminal↔cavity. Cavities map 1:1 and join the same net | **gap** | The single largest electrical-model gap. `ConnectorPart.matingPartId` exists but there is no `Mate` entity, so a bulkhead or pass-through connector cannot be modelled at all — the two halves are separate nets. Needs a `mates` array, net-extraction participation, and the validation below. |
| **Mate validation** | *Cavities do not match*; *Genders do not match*; terminal compatibility matrix (Ferrule→cavity max-one; Ring↔Ring/Spade/Stud size-checked; Quick Connect male↔female size-checked max-one) | **gap** | Follows the `Mate` entity directly. |
| **Wire gauge vs contact** | Warns when wire gauge is outside the contact's min/max. Multiple wires in one cavity are **summed**: convert each to mm², add, convert back to the document gauge unit | **gap** | The mm² summation rule is the non-obvious half and the reason this can't be approximated. Requires typed min/max gauge on `ContactPart` (Phase 2). |
| **Rotate 90°** | `R`, or right-click → Rotate. Schematic only. Connectors and terminals | **model** | `ComponentBase.rotation` exists and is never read. |
| **Connector / note width** | Right-click → Width → percentage. Node widths 60/90/150/210/270/390 units | **partial** | `Connector.widthPercent` exists unused; `BOX_WIDTH` is a fixed 160. Long signal names currently overflow. |
| **Cavity operations** | Right-click a cavity → move up / move down / add below / delete. `Tab`/`Shift+Tab` between labels | **partial** | Only a `− N +` trailing stepper today, so a cavity can't be inserted or removed mid-list. |
| **Jumper wires** | Drag cavity→cavity within one connector; length zero | **gap** | Routing already has a `jumper` status, but it is reached only via cable cores. |
| **Orthogonal routing** | Right-click wire → Make orthogonal, or `O` | **gap** | Complements the 45° auto-router and the new manual bends. |
| **Layout-point alignment guides** | Guide lines appear when points align horizontally, vertically or at 45° | **gap** | Applies to the drag-to-bend handles just shipped. |
| **View toggles** | Show parts / coverings / component IDs / warnings; dash undefined routes; dash empty bundles; highlight nets | **partial** | Only cross-pane hover highlighting exists. "Dash undefined routes" is load-bearing: a dashed wire *means* "not yet routed through a bundle", which OpenHarness computes already (`LengthStatus`) but never shows. |

## Phase 2 — Typed part properties and the validation they unlock

OpenHarness deliberately replaced the old single `maxRating` with an open
`parameters[]` list, and that was right for capturing whatever a datasheet
says. But an open list can't be validated against, and every meaningful DRC
rule in the reference tool keys off a *typed* field.

The resolution is both, not either: keep `parameters[]` as the open-ended
record, and add typed fields where a rule depends on them.

| Part | Typed fields to add | Status |
|---|---|---|
| Contact | `type` (Crimp/Solder/Other), `gender` (Pin/Socket), `minGauge`, `maxGauge`, `cavitySealPartId` | **gap** |
| Terminal | `size` (value+unit, or free string for e.g. `#8` US screw gauge), `minGauge`, `maxGauge`, `gender` (Quick Connect only) | **gap** |
| Splice | `minGauge`, `maxGauge` | **gap** |
| Covering | `minDiameter`, `maxDiameter`, `isFixedLength`, `length` | **partial** — all present; no fit check against bundle diameter |
| Cable | per-core `color` / `stripeColor` / `gauge`; `shielded` | **partial** — `coreCount` only, no per-core record |
| Diode | `voltage` + unit (mV/V/kV), `current` + unit (mA/A/kA) | **gap** |
| Resistor | `resistance` + unit (mΩ/Ω/kΩ/MΩ), `power` + unit (mW/W/kW) | **gap** — `resistanceOhms` exists, unitless |
| Connector | — | **done** (cavities, designations, gender, shell, configurations) |

Also in this phase:

- **Gauge units `cmil` / `kcmil`** — currently `mm2` and `awg` only. **gap**
- **Covering fit validation** — min/max diameter vs computed bundle diameter, which `derive/bundleAnalysis.ts` already produces. **gap**
- **Unassigned / unrouted surfacing** — "No Part" and "NO ROUTE" badges in the
  Table pane, "Not Used" in the Parts pane. All three are already computed;
  none are shown. **model**

## Phase 3 — Bulk editing and the operations that make large harnesses tractable

This is where the reference tool spent most of its 2026 development, and the
release notes make the reason obvious: dragging wires one at a time does not
scale past a demo.

| Feature | Reference behaviour | Status |
|---|---|---|
| **Global search** | Icon or `Space`. Dims non-matching components, lists matches, click to select and centre. Filters table rows live across every property | **gap** |
| **Destinations** | `D`. Click a cavity, type a connector or cavity name, press Enter — wire created instantly | **gap** |
| **Tabular editing** | Type into the to/from cell of the connections table to create or re-point a connection | **partial** — the Table pane is bidirectional but edits existing rows rather than creating by name |
| **Select wires on net** | Right-click a wire → select every wire on the net, then bulk-assign one wire part | **gap** |
| **Auto-layout** | `Shift+A` all wires, `A` selected wires | **gap** |
| **Add splice from wires** | Select wires → right-click → Add splice; splice auto-placed on the shortest path | **gap** |
| **Make cable from wires** | Select wires → right-click → Make cable; one core per wire | **partial** — grouping exists; no core-per-wire conversion |
| **Inline connectors** | Select wires or a bundle → right-click → Add inline connectors; splits every selected wire at once | **gap** |
| **Selection info** | Live readout: component count, total gauge, wire length, wires per splice/bundle/connector | **gap** — every number is already derived |
| **Groups (Frames)** | Group components; assign a Generic Part; drag by heading. The mechanism behind the whole "devices" convention | **model** — `Group` type exists with no UI |
| **Undo/redo buttons** | Toolbar buttons alongside the shortcuts | **model** — store has undo/redo |

### The devices convention

Worth recording because it is a *modelling decision*, not a feature, and
OpenHarness has quietly adopted the same one: there is no device object. A
switch, relay, ECU or fuse box is represented by the connectors that mate with
it, grouped, with a Generic Part carrying the part number and price. The rule
is "the document describes the harness, and only the harness."

OpenHarness already has `GenericPart` and `Group`; wiring them together is the
whole of the work.

## Phase 4 — Output

Nothing here is novel, and all of it is what makes the tool usable by anyone
who isn't the person who drew the harness.

| Feature | Reference behaviour | Status |
|---|---|---|
| **PDF export** | Schematic page, Layout page, or both. Per-page: show parts / coverings / component IDs; wire thickness Regular/Thick/Extra Thick; limit to selected nets (off-net components omitted, inherited cavity labels drawn in grey) | **gap** — spec §9, flagged as review item R20 (spike before the UI assumes it works) |
| **Title block** | Bottom-right of each page: Company, Title, Drawing number, Date, Drawn by. Empty fields fall back to harness title / today / profile name. Saved with the document | **gap** |
| **Wiring table XLSX** | Full connection list plus one sheet per connector giving that connector's pinout | **gap** — interconnect CSV exists; the per-connector sheets are the valuable half |
| **BOM CSV** | Parts view as CSV | **done** |
| **JSON round-trip** | Save and reload the document locally | **done** — `.ohd`, with sorted keys |
| **Vendor v0.8 JSON import** | — | **done** — tested against two real captured exports |
| **Vendor v0.8 JSON *export*** | — | **gap** — the importer already knows the format; the reverse direction makes OpenHarness interoperable rather than a one-way destination |

## Phase 5 — Formboard

A 1:1 physical-scale mode for the Layout view: what you print, lay on a bench,
and build the harness on top of. `DocumentSettings.formboard` exists in the
model (`{ enabled, scale, sheet }`) and nothing reads it.

This is a large, self-contained project and is listed as its own phase for
that reason.

- Panel size: preset **A4 / A3 / A2 / A1 / Custom**; orientation Landscape /
  Portrait (hidden when Custom); width and height editable only when Custom.
- Panel grid: rows **1–64**, columns **1–64**; board size = panel × grid.
- Default bend radius, overridable per bundle (right-click → Radius; empty
  falls back to the default).
- Scale: physical length per canvas pixel.
- Grid snapping is **removed** in formboard mode; bundles bend with a real
  corner radius and can be set to true lengths.
- Out-of-scale bundles drawn as yellow lines with black dashes.
- Per-bundle **Match** button snaps that bundle's path to its set length;
  **Set all bundle lengths to scale** does the whole board.
- Dragging a component previews the to-scale position with a blue line that
  turns green on match.
- Dragging a branch point swings the entire connected branch as a rigid body,
  preserving relative positions and angles; a marquee multi-selection
  translates without rotating.
- Export: **Formboard Panels** PDF, one to-scale page per panel (A3 at 2×4 =
  8 pages); **Formboard Data** JSON with panel config, pixel-to-length scale,
  every component's position/rotation/dimensions, every routed path, nets,
  coverings, notes and the part catalog, all relative to the panel grid's
  top-left.

## Phase 6 — Local parts library

The reference tool's cloud catalog, rebuilt as a local, version-controllable
file. The mechanics are worth copying closely because they are well judged:

- Parts are keyed by **part number**; a duplicate part number inside one
  harness raises a warning.
- A part is "in sync" only when **every** property matches, not just the number.
- Explicit per-part state: *Synced* / *Out of sync* / *Not in library* /
  *Not in harness*.
- Directional actions: push to library, pull from library, and bulk
  *add all parts from harness* / *add all parts to harness*.

Status: **gap**. OpenHarness has a per-document parts list only, so a
connector characterised in one harness has to be re-entered in the next.

## Phase 7 — Automation surface

The parts of the reference tool that point at where OpenHarness's stated
differentiator actually lies.

| Feature | Reference behaviour | Status |
|---|---|---|
| **MCP server** | A hosted MCP endpoint, OAuth as the user. Find/open harnesses, explain wiring, add connectors and wires, assign parts, import from a spreadsheet, bulk-load manufacturer catalogs. Shipped July 2026, labelled experimental | **gap** — `packages/mcp` is a stub. A local MCP server needs no auth story at all, which makes this *easier* here than there |
| **Automation host** | — | **gap** — `packages/automation` is a stub; spec §8.2 |
| **CLI `run` / `query` / `diff` / `doctor`** | no equivalent | **gap** — spec §8.6. `diff` in particular has no counterpart in a tool without a diffable file format |
| **Published JSON schema** | Their v0.8 schema is published as markdown explicitly so people can hand it to an LLM | **partial** — OpenHarness's model is documented in `types.ts` doc comments but not published as a standalone reference |

## Open decisions carried forward

Unchanged from the review document, and still worth settling before the canvas
work goes deeper:

1. Variants / configurable harnesses — in or out of v1, as an explicit ADR (R3)
2. Directory file format's atomic-write story (R11)
3. Derived-model invalidation contract (R9)
4. Rough NFR numbers — target document size, startup budget (R25)
5. PDF export spike, before the UI assumes it works (R20)

## Non-goals

Recorded so they don't get re-proposed. Each is a consequence of
the surveyed tool being a hosted subscription product, not of harness
engineering.

- Teams, seats, per-seat billing, email invitations
- Cloud sharing links, public harnesses, `<iframe>` embedding, demo mode
- Accounts, subscriptions, plan tiers, connection limits
- Live multi-user presence and last-write-wins sync
- Mobile read-only viewing
- Server-side revision snapshots — superseded by git plus a document diff view

## Where OpenHarness is already ahead

Not everything in the reference tool is a superset. Worth keeping in view so
these don't get regressed while chasing parity:

- **Signal direction and impedance matching** per cavity and per cable core,
  resolved per wire with an explicit `conflict` outcome. No equivalent.
- **Parasitics** — per-component R/C/L, per-unit-length wire R/C, and derived
  per-wire totals that report "unknown" rather than a confident zero when the
  wire has no routed length.
- **Open part parameters** — a repeatable `{name, qualifier, value, unit}`
  list with user-extensible units, against their fixed typed fields.
- **Shield model** — position along the run, per-end terminations, a wirable
  termination node that makes the drain a real conductor in nets/table/BOM, and
  a costing model choice (standalone part / IPC-620 / custom) that decides
  whether the shield gets a BOM line at all.
- **Twisted-pair drawing standard** — IEEE Std 315-1975 vs IEC 60617-3 as a
  project setting.
- **Local-first and offline** — their FAQ states plainly that there is no
  offline mode and no local-only operation, and that JSON export is the only
  local backup path.
- **A CLI and a git-diffable file format.**

## Notes on the survey

- The survey is a snapshot. Where the source's own reference pages and its
  change log disagreed, the change log was taken as current — published
  reference docs lag shipped behaviour more often than the reverse.
- Feature gating changed during the period surveyed, so "which plan includes
  what" was ignored entirely. Only the capability matters here.
- The surveyed tool ships with a disclaimer that it is a documentation aid and
  that designs need independent verification before manufacture. The same
  applies to OpenHarness.
