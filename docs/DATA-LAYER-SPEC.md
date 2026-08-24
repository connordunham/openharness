# Data layer — parts library and procurement

**Status:** adopted, not yet implemented. Packets `T16`–`T22`.
**Supersedes:** `docs/tasks/T11-parts-library.md` (folded in; see below).

A reusable master parts library — connectors, contacts, wire, backshells,
tooling — with supplier pricing, lead times and version history, joined to
harness projects by part number.

This document is the reconciled version of a submitted specification. The
submitted spec is sound in almost all of its substance and it is adopted here
nearly whole. Six things changed, and each is recorded under **Deviations**
below with the reason. Read that section before implementing: two of the
changes are load-bearing and reversing them would break things that already
ship.

---

## The split, and what it actually means here

The submitted spec calls for two independent stores:

- **`parts.db`** — shared, slow-changing, procurement-sensitive. Built once,
  grows over time, independent of any project.
- **`harness.db`** — per-project wire lists, BOMs, revisions, referencing parts
  by part-number string rather than by foreign key.

**The reasoning is right and is adopted in full.** A harness project should be
handoff-able and archivable without dragging a parts catalogue with it, and the
catalogue should absorb new supplier pricing without touching a single project
file. String-keyed, application-layer joins rather than live foreign keys is
the correct call.

**`parts.db` is built as specified: a SQLite file.**

**`harness.db` is not built.** The project store already exists — it is `.ohd`,
and it already holds everything `harness.db` describes. See Deviation 1. The
data model the spec defines for the project side is adopted; the second
database file is not.

So the split in practice is:

```
  parts.ohdb  (SQLite)            project.ohd  (JSON, git-friendly)
  ─────────────────────           ────────────────────────────────
  connector_families              components, wires, bundles, mates
  connectors, cavities            settings (incl. scrap buffer)
  contacts, backshells            per-wire buffer overrides
  wire_specs, tooling             derived BOM (computed, never stored)
  suppliers, part_sourcing
  price_history
  part_revision_log
                    ▲
                    └── joined by part_number (TEXT), at the application
                        layer, at BOM-export time only
```

Both halves of the rationale survive: the catalogue is shared and slow-moving,
the project file is fast-moving and disposable, and neither can corrupt the
other.

---

## Deviations from the submitted spec

### 1. `harness.db` is not a second database — the project store is `.ohd`

**This is the change that matters most.** The submitted `harness.db` tables map
onto structures that already exist and are already tested:

| Submitted | Existing |
|---|---|
| `harnesses` | `HarnessDocument` + `DocumentSettings` |
| `harness_connections` | `Wire` with `source`/`target` `Endpoint`s |
| `bom_line_items` | the derived BOM (`derive/bom.ts`) plus a new export artifact |
| `revisions` | document revision metadata, and git |

Two reasons not to build the second store.

**A SQLite project file is not diffable.** "The file format was designed to be
diffable" is not incidental — it is the basis of semantic document diff (M4),
it is why `.ohd` serialises with stable sorted keys, and it is a capability no
hosted competitor can offer. A binary project file gives that up.

**`harness_connections` is strictly less expressive than `Wire`.** A
`from_part_number`/`from_cavity` → `to_part_number`/`to_cavity` pair cannot
represent a splice, a shield termination node, a cable core, a backshell
ground, or a deliberately free end. All five already exist in the model and
all five are exercised by tests. Adopting the flat pair would be a regression,
not a refactor.

What is adopted from that half of the spec: the project-level **fields** it
introduces (scrap/waste buffer, per-wire override) and the **BOM snapshot
concept**, which is genuinely new and genuinely good — see Deviation 5.

### 2. Canonical units are unchanged; `cm` is an entry unit

The spec stores lengths in cm and gauge as an AWG string. This project stores
**length in integer micrometres** and **conductor size in mm²** (`AGENTS.md`,
and `DOMAIN-DECISIONS.md` D2 — AWG numbers must never be summed, because a
larger AWG number is a smaller conductor).

The spec's own convention section already says the right thing — that the
`in`/`cm` fields record *the unit the value was entered or is displayed in*,
with conversion at the application layer. That principle is kept exactly; only
the canonical unit changes, from cm to µm, to match what T01 already shipped
and what `derive/length.ts` already computes in.

Concretely: `wire_length_value`/`wire_length_unit` become an existing `Wire`
length in µm plus a display-unit preference. `gauge_awg TEXT` becomes the
existing `Gauge` type (mm² canonical, AWG renderable). `spool_length_value` is
stored in µm.

Without this, library parts cannot feed the gauge-vs-contact rule that already
ships (T03), and every consumer would need its own conversion.

### 3. Wire spool units include `ft` and `m`

The spec allows `in` / `cm` for `spool_length_unit`. Wire is not sold that way
— it is sold in feet or metres, and a 500 ft spool entered as `500 in` is a
data-entry trap with no error message. `ft` and `m` are added to the display-
unit set. Canonical storage is still µm.

### 4. `wire_specs` gains outer diameter

The submitted `wire_specs` has ampacity but no physical size. Three things
already scheduled need the finished outside diameter and cannot be built
without it:

- **T14** — current capacity with bundle derating needs bundle diameter.
- **T15** — bend radius is a multiple of bundle diameter.
- covering fit (`DOMAIN-DECISIONS.md`, Still open) compares bundle diameter to
  a covering's min/max.

Added: `outer_diameter_um` (finished OD over insulation). Whether that is
nominal or maximum is an open question for the engineer — see below.

### 5. The BOM snapshot is an export artifact, not a live table

The spec's `bom_line_items` — with `part_version`, `unit_cost` and `currency`
snapshotted at export time so a historical BOM stays accurate — is a good idea
and is adopted.

It is adopted as an **export artifact**, not as a table that lives alongside
the working document. The BOM in this tool is *derived*: `derive/bom.ts`
computes it from the document on every change, and it is never stored. A stored
BOM table sitting next to a live derived one is two sources of truth, and they
will disagree.

So: the derived BOM stays derived and always reflects the document as it is
now. **Releasing** a BOM writes an immutable snapshot — part versions, prices,
suppliers, currency, buffered lengths, spool counts — as a separate artifact
with its own timestamp. That is the thing that stays accurate forever, and the
thing you hand to purchasing.

### 6. Cross-currency totals are refused, not summed

The spec scopes currency to USD and CAD with no conversion, which is a
reasonable v1 boundary. But `bom_line_items.total_cost` is a single number, and
a BOM whose lines are partly USD and partly CAD has no meaningful single total.
Summing them produces a confidently wrong number, which is the specific failure
mode this project treats as worse than no number at all.

A released BOM therefore carries **per-currency subtotals**. A mixed-currency
BOM shows both and no grand total, plus a `MIXED_CURRENCY_BOM` diagnostic at
`info` severity. When every line shares a currency — the common case — it looks
exactly like a single total, because it is one.

---

## Adopted schema

Everything below is the submitted spec unless a deviation above applies. Table
and column names are kept as submitted so the two documents read against each
other.

### Versioning and history

Every master table (`connector_families`, `connectors`, `contacts`,
`wire_specs`, `backshells`, `tooling`) carries `version INTEGER` starting at 1
and `last_modified_date DATE`.

`part_revision_log` records **one row per changed field** — `part_number`,
`part_type`, `version`, `field_name`, `old_value`, `new_value`, `changed_date`,
`changed_by`. One edit touching three fields produces three rows sharing a
`part_number` + `version`.

Field-level rather than freeform is the right call and is adopted without
change. It is the difference between "somebody edited this part in March" and
"the temperature rating went from 105 °C to 125 °C in March", and only the
second is usable when a past build is being investigated.

`part_type` is a closed set: `connector`, `contact`, `wire`, `tooling`,
`backshell`, `connector_family`. (The submitted spec omits `backshell` from
the `part_revision_log` list while including it in `part_sourcing`; that is
taken as an oversight and it is included in both.)

### Tables

Carried over as submitted, with the deviations applied:

- **`connector_families`** — manufacturer, series_name, description, sealed,
  shape, datasheet_url.
- **`connectors`** — family_id, `part_number` (UNIQUE, internal canonical),
  `manufacturer_part_number` (optional), cavity_count, gender, ratings, gauge
  range *(as `Gauge`, per Deviation 2)*, keying, mounting, temp range,
  image_ref.
- **`cavities`** — connector_id, cavity_number, position_label,
  `max_wire_gauge`, contact_part_number. `max_wire_gauge` is an **optional
  override** of the connector-level range, not a parallel truth: absent means
  "use the connector's range". A cavity range wider than its connector's is a
  data error worth flagging.
- **`backshells`** + **`backshell_compatibility`** — as submitted. These
  complement the existing `Connector.backshellTermination` and
  `BACKSHELL_CAVITY_ID`, which model the *electrical* backshell ground; this
  adds the physical part behind it.
- **`contacts`** — as submitted, gauge range as `Gauge`.
- **`wire_specs`** — as submitted, plus `outer_diameter_um` (Deviation 4),
  gauge as `Gauge`, spool length in µm with `ft`/`m`/`in`/`cm` display units
  (Deviation 3).
- **`tooling`** + **`tooling_compatibility`** — as submitted. Static registry,
  no checkout tracking. The join table is required; a comma-separated column is
  not acceptable.
- **`suppliers`**, **`part_sourcing`**, **`price_history`** — as submitted.
  `part_sourcing` is where all procurement data lives, one row per
  (part, supplier), with `preferred` flagging the default.

### Project-side fields

Added to the existing document model rather than a new store:

- `DocumentSettings.scrapWasteBufferPct` — project-wide default, `0` unless set.
- A per-wire override — **absent** means "use the project default", explicit
  `0` means "no buffer on this wire". The spec's NULL-vs-0 distinction is
  exactly the project's `undefined` convention and is adopted verbatim.

---

## Join strategy

Unchanged from the submitted spec, which gets this right:

- The project never stores a live foreign key into the parts library. It stores
  `part_number` as plain text.
- Resolution happens **once, at BOM generation**: look up cost, supplier and
  lead time from `part_sourcing` where `preferred = true`, and snapshot the
  result — including the part's `version` at that moment.
- A `part_number` present in a project but missing from the library is
  **flagged, never silently skipped** — `UNRESOLVED_PART_NUMBER`, and it is the
  main data-integrity checkpoint between the two stores.
- Tooling is not in the per-harness BOM. Tools are not consumed per build. A
  shop-setup checklist querying `tooling_compatibility` against a harness's
  connector families is a separate report (T22).

## Wire quantity derivation

Also unchanged, and worth restating because it is the one genuinely derived
number in the whole spec:

1. For each connection, take the per-wire buffer override if set, else the
   project default, else 0.
2. Apply it to that connection's length, **then** sum across all connections
   using the same wire part number.
3. Convert to the spool's unit and compute `spool_quantity_needed`.

Buffer-then-sum, not sum-then-buffer. They differ the moment any wire carries
an override, and only the first is right.

`spool_quantity_needed` is derived at export time and is never hand-entered.

---

## Open questions for the resident engineer

These are recorded in `docs/DOMAIN-DECISIONS.md` under "Still open" and block
nothing until the packet that needs them:

1. **Spool rounding.** The submitted spec raises this itself: is ceiling right,
   or should partial-spool purchasing be allowed where a supplier permits it?
   Ceiling is implemented as the default until ruled otherwise.
2. **What the scrap buffer applies to.** Cut length only, or also service loops
   and strip-length allowance? The length pipeline supports all three.
3. **Wire outer diameter: nominal or maximum?** Bundle diameter feeds derating
   and bend radius, so this choice propagates into two safety-relevant rules.
4. **Crimp tool calibration.** `tooling` carries calibration interval and last
   calibration date. Should an out-of-calibration crimper on a required tool
   raise a diagnostic, or is that a quality-system concern that lives outside
   this tool?
5. **Cavity gauge override.** Is a per-cavity gauge range narrower than the
   connector's a real thing worth modelling, or does it only ever indicate a
   data-entry error?

## What happened to T11

`T11 — Local parts library` proposed a JSON/`.ohl` catalogue with sync-state
comparison. Its **storage choice is superseded** by SQLite, which handles
supplier rows, price history and field-level revision log far better than a
sorted-key JSON file would.

Its **behavioural contract is not superseded and is carried forward into T19**
unchanged, because it is still exactly right: per-part `synced` / `outOfSync` /
`notInLibrary` / `notInHarness` state; directional push and pull with no
automatic merge; a part is in sync only when every field matches; duplicate
part numbers within one harness are a diagnostic; numberless parts are excluded
from comparison rather than colliding into one entry; and nothing auto-syncs on
load. That last one especially — the user decides when a catalogue change
reaches their design.
