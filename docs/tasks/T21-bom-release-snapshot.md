# T21 — Released BOM snapshot

**Size** L · **Package** `io`, `core` · **Needs** T18, T19, T20 · **Spec** `docs/DATA-LAYER-SPEC.md`

## Goal

Releasing a BOM writes an immutable record of what was bought, at what price,
against which part versions — so a BOM from eighteen months ago still explains
the harness that was actually built.

## Contract

### Two BOMs, and they are not the same object

The **derived** BOM (`derive/bom.ts`) always reflects the document as it is
now. It stays derived, is never stored, and this packet does not change it.

A **released** BOM is a separate, immutable artifact produced on demand. This
is the spec's `bom_line_items`, and it is an export artifact rather than a live
table precisely so there is never a stored BOM sitting next to a derived one
disagreeing with it.

### What a release captures

Per line, snapshotted at release time and never re-resolved afterwards:

`part_number`, `manufacturer_part_number`, `part_version`, `description`,
`quantity` (discrete parts), `total_length` and `buffered_length` (wire, from
T20), `spool_quantity_needed`, `unit_cost`, `currency`, `supplier`,
`total_cost`.

Plus, per release: a timestamp, the document revision, and the library file it
resolved against.

`part_version` is the load-bearing field. It is what makes a past BOM readable
against a part that has since been revised — and with T17's field-level log,
readable *specifically*: not "this part changed" but which field, from what, to
what.

### Currency

Per-currency subtotals. **No grand total across currencies.**

A BOM whose lines are partly USD and partly CAD has no meaningful single
number, and producing one anyway is the confidently-wrong-number failure this
project treats as worse than an absent one. Mixed release → both subtotals,
no grand total, and `MIXED_CURRENCY_BOM` at `info`.

Single-currency releases — the normal case — show one subtotal, which looks
exactly like a total because it is one.

### Resolution failures block a release

`UNRESOLVED_PART_NUMBER` (T19) at release time is an **error**, not a warning.
A BOM with a hole in it looks complete and is not; someone orders from it.

The release refuses and names every unresolved part. `AMBIGUOUS_SOURCING`
likewise: a release must not pick a supplier arbitrarily.

### Storage

A file next to the document — sorted keys, same serialisation discipline as
`.ohd`, so releases diff and live in git. Releases are append-only: a new
release is a new file, never an edit of an old one.

## Acceptance tests

- a release of a two-connector, three-wire document captures every line with
  version, cost, currency and supplier
- revising a part in the library afterwards leaves the released BOM byte-identical
- re-releasing after a part revision produces a new file with the new
  `part_version`, and both files coexist
- all-USD → one subtotal, no `MIXED_CURRENCY_BOM`
- mixed USD and CAD → both subtotals, **no** grand total field at all, and the
  diagnostic fires
- a part missing from the library → release refuses, error names the part, no
  file is written
- three suppliers, none preferred → release refuses
- three suppliers, one preferred → release succeeds using the preferred row
- wire lines carry buffered length and spool count from T20, not raw length
- a wire of unknown length → release refuses rather than releasing a hole
- released file round-trips byte-identically on re-save
- `total_cost` per line is exact to the cent for 10 000 units at $0.07

## Traps

- Snapshot means snapshot. Any field read live at display time defeats the
  entire packet. If a released BOM ever renders a current price, it is broken.
- Releasing must not mutate the document. It reads.
- Do not reuse the derived BOM's line type. They will diverge — the released
  one gains version, currency and supplier and must never gain live lookups —
  and a shared type invites exactly the coupling this design avoids.
- Float money. `0.07 × 10000` is not `700` in IEEE 754. Decide integer minor
  units or a rounding discipline, and let the acceptance test above enforce it.
- An empty BOM is a legitimate release of an empty document, not an error.
  Distinguish it from a refused release.
