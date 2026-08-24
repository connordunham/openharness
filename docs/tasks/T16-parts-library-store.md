# T16 — Parts library store

**Size** XL · **Package** new `@openharness/parts` · **Spec** `docs/DATA-LAYER-SPEC.md`

## Goal

A SQLite-backed master parts library that outlives any one project: connector
families, connectors, cavities, contacts, backshells, wire and tooling, with
version numbers and a field-level revision log.

This packet is the store and its schema only. Procurement (T18), cross-store
resolution (T19) and BOM release (T21) build on it and are separate.

## Shape

A new package, `@openharness/parts`, depending on `core` and nothing else. It
owns the schema, migrations and typed accessors. `app` and `cli` consume it;
`core` and `render` must not — the dependency direction rule is unchanged.

SQLite via `better-sqlite3`. Synchronous, no connection pool, no ORM. The
library is a file the user picks, the same way a document is.

**Do not put this in `io`.** `io` is document serialisation. Mixing a database
into it makes both harder to reason about.

## Contract

Tables exactly as `docs/DATA-LAYER-SPEC.md` § Adopted schema. Specifically:

- `connector_families`, `connectors`, `cavities`, `contacts`, `backshells`,
  `backshell_compatibility`, `wire_specs`, `tooling`, `tooling_compatibility`,
  `part_revision_log`. (`suppliers`, `part_sourcing`, `price_history` are T18.)
- Every master table carries `version INTEGER NOT NULL DEFAULT 1` and
  `last_modified_date`.
- `part_number TEXT UNIQUE` on every part-like table — internal canonical,
  user-defined, never derived from a manufacturer catalogue.
- `manufacturer_part_number TEXT` nullable on the same tables.
- Compatibility is expressed as join tables. A comma-separated column is not
  acceptable and will be sent back.

**Units are canonical, not as-typed.** Gauge is the existing `Gauge` type
(mm²); length is integer micrometres. `outer_diameter_um` on `wire_specs`.
Display units (`in`/`cm`/`ft`/`m`) are a rendering concern and are not stored
in place of the value. See spec Deviations 2–4.

Schema version lives in SQLite's `user_version`. A migration runner applies
ordered, forward-only migrations at open. Opening a library newer than the code
understands fails with a clear message rather than a partial read.

## Acceptance tests

Test the store as a library against a temp file; no UI.

- create → open → every table exists, `user_version` matches
- a part inserted and read back is field-identical, gauge included
- duplicate `part_number` in one table is rejected by the UNIQUE constraint
- `manufacturer_part_number` may be null, and two parts may share one
- a `Gauge` written as mm² and read back is unchanged; a part entered in AWG
  round-trips through mm² without drift at every AWG size the converter supports
- `outer_diameter_um` round-trips as an integer
- spool length entered as `500 ft` stores as µm and renders back as `500 ft`
- a backshell linked to three families produces three
  `backshell_compatibility` rows; querying by family returns it
- a tool qualified for two families likewise
- opening a library with a higher `user_version` than supported throws, and the
  message names both versions
- a migration applied twice is a no-op

## Traps

- **`better-sqlite3` is a native module.** It has to build on the user's
  machine and it has to be packaged into the Electron app. Check
  `electron-builder.cjs` — its `files` allowlist deliberately excludes
  `node_modules`, and `npmRebuild` is `false` because there were no native
  modules. Both assumptions die with this packet. Fix the packaging and
  *verify by launching a packaged build*, not just a dev run. A library that
  works under `npm start` and throws in the installer is the exact failure this
  project has already had once.
- Do not store display units in place of values. The spec's own convention
  section says the unit field records what was typed, not what is stored.
- `DATE` in SQLite is text. Pick ISO-8601 and enforce it in the accessor rather
  than hoping.
- Do not add a `harness_id` or any project reference to any table here. The
  whole point of the split is that this file knows nothing about projects.
