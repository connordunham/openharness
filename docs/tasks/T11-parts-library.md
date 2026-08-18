# T11 — Local parts library

**Size** L · **Package** `io`, `app`

## Goal

A parts catalog that outlives one document, so a connector characterised once
does not have to be re-entered in the next harness.

## Shape

A file, not a service. `library.ohl` (or a directory of JSON) somewhere the
user chooses, with the same stable-sorted-key serialisation `.ohd` uses so it
diffs cleanly and can live in git.

That is the whole reason to build this locally rather than copy a cloud
catalog: a version-controllable catalog can be shared, reviewed and rolled
back by tools the user already has.

## Contract

Parts are keyed by **part number**.

- A duplicate part number **within one harness** is a diagnostic
  (`DUPLICATE_PART_NUMBER`, warning). It is how two entries silently diverge.
- A part is *in sync* only when **every** field matches — not just the number.
  Anything less and "synced" stops meaning anything.
- Per-part state, surfaced in the Parts pane: `synced` / `outOfSync` /
  `notInLibrary` / `notInHarness`.
- Directional actions, never a merge: push to library, pull from library, and
  bulk add-all in each direction. There is no automatic conflict resolution
  and there should not be — silently picking a winner loses data the user
  cannot get back.

## Acceptance tests

Put the comparison in `io` as a pure function over
`(harnessParts, libraryParts)` and test that; the UI is a readout of it.

- identical part number and fields → `synced`
- same number, one field differing → `outOfSync`, and the differing field is
  named in the result
- present only in the harness → `notInLibrary`; only in the library →
  `notInHarness`
- two harness parts sharing a number → `DUPLICATE_PART_NUMBER`
- a part with no number at all is excluded from comparison entirely rather
  than matching every other numberless part
- push then compare → `synced`
- library file round-trips with sorted keys, byte-identical on re-save

## Traps

- The numberless-part case is the one that bites: a naive keyed lookup makes
  every part with an empty number collide into one entry.
- Do not auto-sync on load. The user decides when a catalog change reaches
  their design.
