# T22 — Tooling registry and shop-setup checklist

**Size** M · **Package** `@openharness/parts`, `app` · **Needs** T16, T19 · **Spec** `docs/DATA-LAYER-SPEC.md`

## Goal

Know which crimpers, dies, strippers and guns a given harness requires, and
whether the shop has them, before a build starts rather than halfway through.

## Contract

### Registry

`tooling` and `tooling_compatibility` land in T16. This packet is what is done
with them.

Static registry: no checkout, no booking, no usage tracking. Tools are
long-lived equipment, not consumables, and **tooling is not part of the
per-harness BOM** — a build does not consume a crimper.

### Checklist report

Given a document and a library:

1. Collect the connector families used, via each component's resolved part.
2. Query `tooling_compatibility` for tools qualified for those families.
3. Report, grouped by family: the tools required, and for each whether the
   library holds one.

A family with **no** qualified tool in the library is the finding that matters
— it means nobody can terminate that connector. Report it prominently rather
than as an absence in a list.

### Calibration

`tooling` carries `calibration_required`, `calibration_interval_days` and
`last_calibration_date`.

The checklist **reports** calibration state: due date, and overdue where the
interval has elapsed. Missing `last_calibration_date` on a tool that requires
calibration reads as **unknown**, not as due and not as fine.

Whether an overdue crimper should raise a document diagnostic — as opposed to
appearing on this report — is an **open question for the resident engineer**
(`DOMAIN-DECISIONS.md`, Still open). Do not decide it in this packet. Report it
here; do not add a DRC rule.

`replacement_interval_notes` is free text and is displayed verbatim. It is a
note to a human, not a schedule to compute against.

## Acceptance tests

Report generation is pure over `(document, librarySnapshot)`.

- a document using two families returns the tools qualified for both
- a family with no qualified tool is reported as a distinct "no tool" finding,
  not an empty row
- a tool qualified for three families appears once per family it is used for,
  not three times for one
- `calibration_required` false → no calibration state shown at all
- `calibration_required` true, last calibration 30 days ago, interval 90 →
  due in 60 days
- interval elapsed → overdue, with the number of days
- `calibration_required` true, `last_calibration_date` null → **unknown**,
  distinguishable in the result from both due and overdue
- a document using no connectors returns an empty report, not an error
- tooling never appears in the derived BOM or in a released BOM

## Traps

- Unknown is not fine. A crimper with no calibration record is the one most
  likely to be out of calibration; rendering it as compliant is the failure
  mode this whole report exists to prevent.
- Date arithmetic in local time will drift by a day near midnight and across
  DST. Compute in UTC from ISO-8601 and test a DST boundary.
- Do not let this become a DRC rule. It is a report. The rule question is open
  and belongs to the engineer.
- `die_or_tip_part_number` is a string on the tool, not a join. Do not invent a
  dies table in this packet; if it turns out to need one, say so and stop.
