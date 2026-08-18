# T09 — PDF export

**Size** L · **Blocks** T10 · **Package** `io`, small `app`

## Goal

A printable drawing: schematic page, layout page, or both, with a proper
engineering title block.

This is spec §9 and review item **R20**, which asks for a spike *before* the
UI assumes it works. Honour that: prove the rendering path end to end on one
non-trivial document before building the options UI.

## Why it is shaped this way

`render` already produces the scene as pure geometry with no DOM — that was
the point of the core/render split. The PDF exporter consumes the same scene
the canvas does. If you find yourself re-deriving positions in the exporter,
stop: the drawing would then be able to disagree with the screen, which is
the one thing this architecture exists to prevent.

## Contract

Per page: show parts, show coverings, show component IDs, wire thickness
(regular / thick / extra thick), and an optional filter to selected nets.

Net filtering has a subtlety worth getting right: components not on a shown
net are omitted entirely, but cavity labels inherited from a hidden net still
render, greyed. Otherwise a filtered page implies a pin is unused when it is
merely not shown.

**Title block**, bottom-right of every page: Company, Title, Drawing number,
Date, Drawn by. Empty fields fall back to the document title, today's date,
and the user's profile name. Only filled fields render. The block and the
export options both persist **in the document**, since they are properties of
this drawing rather than of whoever exported it — so they need a home in
`DocumentSettings`.

## Acceptance tests

Test the page model, not the pixels:

- a document with both views selected produces two pages
- net filtering excludes off-net components and retains inherited labels
- an empty title block falls back correctly on every field
- options round-trip through `.ohd` save and load
- a document with no components produces a valid single page, not a crash

Then verify visually: export a real harness, open the PDF, check the title
block, the wire weights and that nothing is clipped at the margin.

## Traps

- Pick the PDF library in the spike, not after. Font embedding and vector
  output quality vary sharply, and switching later means redoing the layout.
- Text measurement is the usual source of clipping. Measure, do not estimate.
- Keep the exporter in `io`. It must not import from `app`.
