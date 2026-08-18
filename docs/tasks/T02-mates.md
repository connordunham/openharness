# T02 — Mates

**Size** L · **Needs** T01 · **Blocks** nothing · **Packages** `core`, `render`, `app`

## Goal

Make a bulkhead or pass-through connector expressible: two connectors plugged
into each other, terminals joined to terminals, terminals landed in cavities.

## State

The data model is **already landed** — `Mate` in `core/types.ts`,
`HarnessDocument.mates`, `MateId` in `ids.ts`. Read the `Mate` doc comment
before starting; it explains why this is its own entity and why cavity
correspondence is positional. Nothing consumes it yet.

## What is missing

**1. Net extraction** (`core/derive/netExtraction.ts`) — the whole point.
Mated connectors must union their nth cavities pairwise. A terminal mated
into a cavity unions the terminal's vertex with that cavity's. Do this after
component vertices are registered and before the global-signal merge, in its
own clearly-named pass.

**2. Validation** (`core/derive/rules.ts`) — new rules:

| Rule id | Fires when |
|---|---|
| `MATE_CAVITY_COUNT` | mated connectors have different cavity counts |
| `MATE_GENDER` | both ends have parts with a gender and they are equal |
| `MATE_INCOMPATIBLE` | the terminal-type pairing is not allowed (table below) |
| `MATE_SIZE` | both ends have a `size` and they differ |

Terminal compatibility, and the multiplicity limit, which is real:

| Type | May mate with | Limit |
|---|---|---|
| ferrule | connector cavity | one |
| ring | ring, spade, stud | — |
| spade | spade, ring, stud | — |
| male quick connect | female quick connect | one |
| female quick connect | male quick connect | one |

Gender mismatch is an **error**; a missing gender on either side is not a
finding at all — unknown is not wrong.

**3. Rendering** (`render/schematicScene.ts` + canvas) — a mate needs to be
visible and creatable. Emit mate geometry from the scene builder, not from
the component; the canvas draws what the scene gives it.

## Acceptance tests

`core/src/__tests__/mates.test.ts`

- two mated 4-cavity connectors put cavity *n* of each on one net, for every n
- a signal on one side propagates across the mate to the other
- a mate between connectors with 4 and 6 cavities raises `MATE_CAVITY_COUNT`
  and still unions the 4 pairs it can — a bad mate degrades, it does not crash
- male-to-male raises `MATE_GENDER`; male-to-female does not; part-less
  connectors raise nothing
- ferrule into a cavity is allowed; a second ferrule into the same cavity
  raises `MATE_INCOMPATIBLE`
- ring to ring with equal sizes passes, with differing sizes raises
  `MATE_SIZE`, with one size absent raises nothing
- a mate naming a component that no longer exists is ignored, not thrown on

## Traps

- **Positional pairing, not by designation.** Two housings routinely label the
  same physical position differently. Pairing by label mis-wires exactly the
  connectors most likely to be bulkheads.
- A mate is not a conductor. It must not appear in `wires`, must not get a
  length, and must not reach the BOM.
- `doc.mates` is optional. Treat absent as empty everywhere; do not write an
  empty object into documents that have no mates.
- Net extraction is union-find. Adding a pass is cheap; make sure it runs
  before signal resolution or propagation across a mate will not happen.
