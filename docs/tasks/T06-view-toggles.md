# T06 — View toggles and selection info

**Size** M · **Package** `app`

## Goal

Surface information the derive pipeline already computes and currently throws
away. Almost none of this needs new computation.

## View options

A control at the bottom-right of each canvas, per-pane:

| Toggle | Meaning |
|---|---|
| Show parts | part number pills on components |
| Show coverings | covering pills |
| Show component IDs | C1, W3, S2 |
| Show warnings | diagnostics on the canvas |
| Highlight nets | whole net vs only what the selection directly touches |
| Dash unrouted wires | Schematic: wire not routed through any bundle |
| Dash empty bundles | Layout: bundle carrying no wires |

**"Dash unrouted wires" is the load-bearing one.** A dashed wire *means*
"this has no physical path yet", which `LengthStatus` already knows
(`noRoute` / `unplaced`) and the canvas never shows. It turns an invisible
modelling gap into something a reader notices.

These are view state, not document state. Do not persist them in `.ohd`.

## Selection info

A live readout of the current selection, no panel to open:

| Selection | Shows |
|---|---|
| one component | component id |
| several components | count |
| one or more wires | total gauge; length if exactly one |
| one splice | wires connected, total gauge |
| one bundle | wire count, total gauge |
| one connector | wires connected |

Total gauge uses `sumGauges` from T01. Every number here already exists in
`store.derived`; this is a readout, not a calculation.

## Acceptance tests

Extract the selection-summary logic as a pure function over
`(doc, derived, selection)` and test that directly — the rendering is trivial
once the summary is right.

- summary of two wires reports summed gauge, and no length
- summary of one wire reports its length
- a wire whose length is unknown says so rather than reporting 0
- unrouted wires are identified from `LengthStatus`, not re-derived

## Traps

- Unknown is not zero. A wire with no route has no length; showing "0 mm"
  is a lie the rest of the codebase carefully avoids telling.
- Keep toggles per-pane. Split-screen users compare two views and need
  different options in each.
