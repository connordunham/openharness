# T03 — Wire-gauge-vs-contact validation

**Size** M · **Needs** T01 · **Package** `core`

## Goal

Warn when a wire is outside the gauge range of the contact it is crimped
into — including the case of several wires sharing one cavity, where their
areas add.

## Contract

New rule in `core/derive/rules.ts`, id `WIRE_GAUGE_RANGE`, severity `warning`.

For every populated cavity:

1. Resolve the contact part. It comes from `Cavity.contactPartId` if set,
   otherwise from the connector's active `ConnectorConfiguration`. If neither
   resolves, emit nothing — an unassigned contact is `MISSING_PART`'s job,
   not this rule's.
2. Collect every wire landing in that cavity.
3. Sum their gauges in mm² via `sumGauges` from T01.
4. Compare the total against the contact's `GaugeRange`.
5. Report the total and the range in the document's own gauge unit.

## The summation rule — engineer-confirmed (`DOMAIN-DECISIONS.md` D2)

Two wires in one crimp occupy the sum of their areas. Confirmed by the
project's harness engineer, not assumed — it is the physical fact the rule
encodes, and it is why this cannot be done by comparing each
wire independently. Two 20 AWG wires do not fit a contact rated for a single
20 AWG. Convert each to mm², add, then convert the total back for display.

Never add AWG numbers. The result would be arithmetically meaningless and
directionally backwards.

## Acceptance tests

`core/src/__tests__/wireGaugeRule.test.ts`

- one wire inside the range: no finding
- one wire below `minGauge`: finding, message names both the wire and range
- one wire above `maxGauge`: finding
- **two wires that each fit but whose sum does not: finding** — the case the
  rule exists for
- two wires whose sum still fits: no finding
- contact with only `maxGauge` set: no finding for an arbitrarily thin wire
- no contact resolvable: no finding from this rule
- wire with no gauge at all: no finding, and no crash
- mixed units in one cavity (an AWG wire and an mm² wire) sum correctly

## Overlap with OVERFILLED_CAVITY

`OVERFILLED_CAVITY` (D1) already flags two wires in one cavity as an error,
full stop. This rule is not redundant with it — summed gauge is still needed
wherever a cavity legitimately carries more than one conductor, a backshell
being the obvious case, and D1 exempts those.

Expect both to fire on a double-crimped cavity. That is correct: they report
different defects.

## Traps

- A wire with no gauge is not a zero-area wire. Skip it, and if that leaves
  the cavity with nothing measurable, emit nothing.
- Resolve the contact through the configuration, not only the cavity override,
  or the rule silently never fires on the common case.
- Report in the document's unit. A user working in AWG should not be shown mm².
