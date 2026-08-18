# T07 — Search and destinations

**Size** L · **Needs** T06 (shares the view-options surface) · **Package** `app`

## Goal

Two ways to work on a harness too large to navigate by dragging.

## Search

`Space` focuses it, `Escape` dismisses and clears. Per-pane in split screen —
it searches the pane the cursor is over.

- **Canvases**: matching components stay lit, non-matching dim. Results list
  below the box; clicking one selects it and centres it.
- **Tables**: filter rows live, matching against *every* field, so any
  property is searchable without choosing a column first.

## Destinations

Type-to-connect, which is how large harnesses actually get wired.

Toggle with `D`. Select a component: an input appears beside each cavity.
Type a component or cavity name, filter as you type, `Enter` or click creates
the wire immediately.

This is the single biggest throughput feature in the list. Dragging from pin
to pin does not scale past a demo, and the Table pane only edits connections
that already exist.

## Contract

Put the matcher in a pure module — `(doc, derived, query) → matches`, where a
match names the entity kind, its id, and the field that matched. The UI then
only decides how to present it. This keeps the ranking testable and stops
three panes from each inventing their own idea of what "matches" means.

Ranking: exact refdes first, then prefix, then substring, then any other
field. A user typing `C12` wants connector C12, not the wire whose note
mentions it.

## Acceptance tests

- refdes exact match outranks a substring hit elsewhere
- searching a signal name finds every cavity carrying it
- searching a part number finds the components it is assigned to
- empty query matches nothing (not everything)
- destination resolution turns `C2` + a cavity designation into a valid
  `Endpoint`, and rejects an ambiguous or unknown target rather than guessing
- creating a wire by destination produces exactly the same document state as
  drawing it by drag — assert on the resulting `Wire`, both paths

## Traps

- The last test above is the important one. Two creation paths that diverge
  is the bug this feature invites.
- Do not create on a partial match. If `C1` matches C1 and C10, require the
  user to disambiguate.
- Dimming must not change hit-testing — a dimmed component is still clickable.
