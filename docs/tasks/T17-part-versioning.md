# T17 — Part versioning and the revision log

**Size** M · **Package** `@openharness/parts` · **Needs** T16 · **Spec** `docs/DATA-LAYER-SPEC.md`

## Goal

Editing a part bumps its `version` and writes one `part_revision_log` row **per
changed field**, so any past revision has an explicit before/after diff.

This is what makes a released BOM trustworthy years later: not "somebody edited
this connector in March" but "the temperature rating went from 105 °C to 125 °C
in March, and the BOM you built from was version 3".

## Contract

An update goes through one function. There is no second path that writes a part
without logging — if there were, the log would be advisory, and an advisory
audit trail is worse than none because people trust it.

On update:

1. Read the current row.
2. Diff field by field against the incoming values.
3. If nothing changed, **do nothing**: no version bump, no log rows, no
   `last_modified_date` touch. A no-op save must not manufacture a revision.
4. Otherwise `version += 1`, set `last_modified_date`, and write one log row
   per changed field, all sharing the new `version`.

Log row: `part_number`, `part_type`, `version`, `field_name`, `old_value`,
`new_value`, `changed_date`, `changed_by` (nullable — single-user today,
multi-user later).

`old_value`/`new_value` are stringified. Stringification must round-trip:
reading the log and reversing it must reconstruct the earlier row exactly.
`undefined` and the string `"undefined"` must not become the same thing — a
field going from unset to a value is a real change and must read as one.

`part_type` is the closed set from the spec, `backshell` included.

Deleting a part is logged too, as a row per field with `new_value` null and a
`field_name` of `__deleted__`. A part that vanishes with no trace is the case
someone will be trying to explain later.

## Acceptance tests

- edit one field → version 1→2, exactly one log row, correct old and new
- edit three fields in one call → one version bump, three rows, same version
- save with no changes → version unchanged, zero rows, `last_modified_date`
  unchanged
- a field going from unset to a value logs `old_value` null, not `"undefined"`
- a field going from a value to unset logs `new_value` null
- replaying the log backwards from version N reconstructs version 1 exactly
- version numbers are per part, not global: two parts each edited once are both
  at version 2
- a numeric field changing only in representation (`1.50` → `1.5`) is **not** a
  change and logs nothing
- delete logs `__deleted__` rows and the part is gone
- `changed_by` null is accepted and round-trips

## Traps

- Float comparison. `1.50` and `1.5` are the same number; a naive string diff
  says otherwise and fills the log with noise. Compare typed values, not their
  renderings.
- The no-op case is the one that bites. A UI that saves the whole form on every
  blur will bump the version on every focus change unless step 3 is honoured.
- Do not log the `version` or `last_modified_date` columns themselves as
  changed fields. They change on every edit and would double every log.
- Bump and log must be one transaction. A version bump with no rows, or rows
  with no bump, is a corrupt history.
