# T05 — Schematic ergonomics

**Size** M · **Package** `app`, small `core`

## Goal

Four small independent affordances that are each individually cheap and
collectively the difference between a demo and a tool.

## 1. Rotate 90°

`R`, or right-click → Rotate. Schematic only. Connectors and terminals.
`ComponentBase.rotation` already exists and is never read — this is wiring up
a field, not adding one. Rotation transposes the node's width and height and
moves its ports accordingly, in `render/schematicScene.ts`.

## 2. Node width

Right-click → Width. `Connector.widthPercent` exists unused; `BOX_WIDTH` is a
fixed 160. Offer a small set of discrete widths rather than free resize —
discrete widths keep a drawing tidy and make the choice one click.

Long signal names currently overflow the box, which is the symptom to fix.

## 3. Cavity operations

Right-click a cavity → move up / move down / insert below / delete. Today
there is only a trailing `− N +` stepper, so a cavity cannot be inserted or
removed mid-list.

Guard deletion of a wired cavity the way the stepper already guards
(`cavityIsWired`). Reordering must carry signals, directions, contact and seal
references with the cavity — the whole `Cavity` object moves, not its label.

`Tab` / `Shift+Tab` move between cavity labels while editing.

## 4. Jumper wires

Drag cavity → cavity within one connector. Routing already has a `jumper`
status but only reaches it via cable cores. A same-connector wire is a
distinct case: it is a real conductor with zero length.

## Acceptance tests

- rotation transposes node dimensions and the ports follow (`render` test)
- cavity insert-below puts the new cavity at the right index and leaves
  existing designations intact
- cavity reorder moves the signal and the contact reference with it
- deleting a wired cavity is refused
- a same-connector wire routes as `jumper` with zero length and does not
  produce a `NO_ROUTE` diagnostic

## Traps

- Rotation and `flipped` are different things and compose. A rotated flipped
  connector must put its ports somewhere sensible; decide and test it.
- Cavity reordering changes indices, not ids. Anything keyed by index breaks;
  everything should be keyed by `Cavity.id` already, so treat a failure here
  as finding a latent bug rather than as a reason to key by index.
