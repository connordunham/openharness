# T18 — Suppliers, sourcing and price history

**Size** M · **Package** `@openharness/parts` · **Needs** T16 · **Spec** `docs/DATA-LAYER-SPEC.md`

## Goal

Where a part can be bought, for how much, in what currency, with what minimum
order and lead time — and how that price has moved.

## Contract

Three tables, as specified: `suppliers`, `part_sourcing`, `price_history`.

`part_sourcing` is one row per (part, supplier), keyed by `part_number` +
`part_type` — not by a foreign key into a specific part table, because one
sourcing shape has to serve connectors, contacts, wire, tooling and backshells
alike.

Fields as specified: `supplier_part_number` (the distributor's own SKU, which
may differ from both the internal and the manufacturer number), `unit_cost`,
`currency`, `moq`, `lead_time_days`, `stock_status`, `distributor_url`,
`preferred`, `last_checked_date`.

**Currency is `USD` or `CAD`.** No conversion, no rate table. A stored cost
carries its native currency and keeps it.

**`preferred` is at most one per part.** Setting it on a second supplier for
the same part clears the first, in the same transaction. Two preferred
suppliers means BOM resolution has to pick one arbitrarily, and an arbitrary
pick is a silently wrong price.

A part with no preferred supplier and exactly one sourcing row resolves to that
row. With several and none preferred, resolution reports ambiguity rather than
guessing — that is T19's problem, but the store must make the state
distinguishable.

`price_history` gets a row whenever a `part_sourcing.unit_cost` changes,
carrying the cost, currency and date. Same discipline as T17: no second write
path.

## Acceptance tests

- a supplier with three sourcing rows across three parts round-trips
- the same part sourced from two suppliers yields two rows
- setting `preferred` on supplier B clears it on supplier A, atomically
- a part with zero preferred and one row is distinguishable from one with zero
  preferred and three rows
- changing `unit_cost` writes a `price_history` row; changing `lead_time_days`
  does not
- rewriting the same `unit_cost` writes no history row
- a cost in CAD and a cost in USD for the same part both persist, unconverted,
  and are separately readable
- `currency` outside {USD, CAD} is rejected
- `moq` and `lead_time_days` may be null and round-trip as null, not 0
- deleting a supplier does not orphan sourcing rows silently — either cascade
  or refuse, and the test states which

## Traps

- **Null is not zero.** `lead_time_days` null means "not known"; 0 means "same
  day". Collapsing them produces a confidently wrong purchasing plan. This is
  `AGENTS.md`'s `undefined` rule in its most expensive form.
- `unit_cost` as a float invites rounding drift once quantities multiply.
  Consider integer minor units; if you use REAL, say why in a comment and make
  sure T21's totals are still exact to the cent.
- Do not add a conversion helper "for later". v1 has no rates, and a helper
  with a hardcoded or stale rate is worse than the absence of one.
- `part_type` must match T16's closed set exactly. A typo here silently
  un-resolves a part at BOM time.
