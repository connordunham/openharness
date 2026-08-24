# T19 — Part-number resolution between the two stores

**Size** M · **Package** `core` (comparison), `@openharness/parts` (lookup), `app` (pane)
**Needs** T16, T18 · **Spec** `docs/DATA-LAYER-SPEC.md` · **Carries forward** T11

## Goal

The boundary between a project and the parts library: resolve part numbers,
report every one that does not resolve, and let the user push and pull parts
between the two — deliberately, never automatically.

This packet carries forward the whole behavioural contract of `T11 — Local
parts library`. Only T11's storage choice was superseded; its sync semantics
were right and are restated here.

## Contract

### Resolution

Given a document and an open library, resolve each `partId`/part number used by
a component or wire.

- Resolved → the library row plus its `version` at read time.
- Missing → `UNRESOLVED_PART_NUMBER`, severity `warning`, targeting the
  component or wire. **Flagged, never silently skipped.** This is the main
  data-integrity checkpoint between the stores and the one place a quiet
  failure would be most expensive.
- Ambiguous sourcing (several suppliers, none preferred) → `AMBIGUOUS_SOURCING`,
  severity `info`. Not an error: it only matters at BOM release.

Resolution is a pure function of `(document, librarySnapshot)`. Put it in
`core` so it is testable without a database, and have `@openharness/parts`
supply the snapshot. `core` must not depend on the parts package — read the
snapshot in at the edge.

### Sync state (from T11, unchanged)

Per part, one of `synced` / `outOfSync` / `notInLibrary` / `notInHarness`.

- A part is `synced` only when **every** field matches. Anything less and the
  word stops meaning anything.
- `outOfSync` names the differing fields — not just the fact of difference.
- A part with **no part number at all** is excluded from comparison entirely.
  It does not match every other numberless part. This is the case that bites: a
  naive keyed lookup collides them all into one entry.
- Two harness parts sharing a number → `DUPLICATE_PART_NUMBER`, `warning`.

### Actions

Directional only: push to library, pull from library, and bulk add-all in each
direction.

**There is no merge and there must not be one.** No automatic conflict
resolution, no field-level "take newest". Silently picking a winner loses data
the user cannot recover.

**Nothing auto-syncs on load.** The user decides when a catalogue change
reaches their design. A document that opens differently tomorrow because a
colleague edited the library is not a document.

A pull that changes a part goes through `store.transact` like any other
mutation — one pull is one undo.

## Acceptance tests

Comparison is pure; test it directly.

- identical number and fields → `synced`
- same number, one field differing → `outOfSync`, differing field named
- present only in the harness → `notInLibrary`; only in the library →
  `notInHarness`
- two harness parts sharing a number → `DUPLICATE_PART_NUMBER`
- two numberless parts → both excluded, no match between them, no diagnostic
  claiming they duplicate each other
- push then compare → `synced`
- a part number used in the document but absent from the library →
  `UNRESOLVED_PART_NUMBER` naming the component
- a part with three sourcing rows and no preferred → `AMBIGUOUS_SOURCING`
- a part with three sourcing rows and one preferred → no diagnostic
- pull is one transaction: one Ctrl-Z restores the pre-pull document exactly
- opening a document does not modify it, whatever the library says

## Traps

- Comparing gauge by rendered string makes `0.5 mm²` and `20 AWG` look
  different when they may be the same conductor. Compare canonically (mm²), per
  `DOMAIN-DECISIONS.md` D2.
- Comparing a snapshot taken before an edit against a document read after it
  produces phantom `outOfSync`. Snapshot once per comparison.
- `version` is not a compared field. A part can be field-identical to library
  version 7 while the document was built against version 3; that is `synced`,
  not `outOfSync`. Versions matter at release (T21), not at comparison.
- Do not let the Parts pane call the database per row. Snapshot, then compare.
