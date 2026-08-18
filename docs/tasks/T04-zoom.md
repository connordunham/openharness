# T04 — Zoom

**Size** M · **Package** `app` · **Do early**

## Goal

Zoom on both canvases. Scroll to zoom with a mouse, pinch on a trackpad,
fit-to-view, and fit-to-selection.

## Why early

Every later canvas packet is harder to build and to test without it, and
retrofitting zoom means revisiting each one. T12 (formboard) is unusable
without it.

## The actual work

This is not "add a transform". It is: every pixel-delta calculation in both
canvases currently assumes screen pixels equal canvas units, and each one has
to divide by the zoom factor.

The Schematic is partly ready. `clientToCanvas` there already goes through
`getBoundingClientRect`, which reflects any CSS or SVG transform, so it keeps
working unchanged. Everything that instead does `e.clientX - startX` does not.
Audit both files for that pattern; it is the whole task.

`canvasPan.ts` drives `scrollLeft`/`scrollTop` directly and will need to
account for scale.

## Contract

- Zoom range 10%–800%, clamped.
- Zoom is a **view** concern: it must not touch the document. Do not persist
  it in `.ohd`, and do not put it through `store.transact`.
- Zoom about the pointer, not the origin — zooming toward the cursor is the
  behaviour people expect and the difference is immediately obvious.
- Per-pane, not global: split panes zoom independently.
- Input mapping follows the existing mouse/trackpad convention — with a mouse,
  wheel zooms; with a trackpad, wheel pans and pinch zooms.

## Acceptance tests

Geometry helpers are unit-testable and should be extracted so they are:
screen↔canvas conversion at a given scale and offset, fit-to-bounds for a set
of rects, and clamping. Put them in `render` or a small `app` module and test
those directly.

The interaction itself needs the running app: zoom in, drag a node, confirm it
tracks the cursor exactly; do the same for a wire bend and a bundle waypoint.
That mismatch is the characteristic bug and no unit test will catch it.

## Traps

- Fit-to-selection with a single point-like item has no meaningful extent —
  pick a sensible default zoom rather than dividing by zero.
- Panning while zoomed is where sign errors surface. Test at 25% and 400%,
  not only at 100%.
