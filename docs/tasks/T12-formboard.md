# T12 — Formboard

**Size** XL · **Needs** T04 (zoom) · **Package** `render`, `app`

## Goal

Turn the Layout view into a 1:1 physical-scale drawing — what you print, lay
on a bench, and build the harness on top of.

`DocumentSettings.formboard` already exists (`{ enabled, scale, sheet }`) and
nothing reads it. Treat that as a sketch to replace, not a contract to honour.

## Why it is XL and last-but-one

Everything else in this repo draws a diagram, where positions are suggestive.
Formboard mode makes positions *mean* something, so the geometry becomes
load-bearing and every interaction acquires a constraint. It is a different
mode, not a setting.

## Contract

**Panel and board**
- Panel size: A4 / A3 / A2 / A1 / Custom; orientation landscape or portrait
  (meaningless for Custom); width and height editable only when Custom.
- Panel grid: rows and columns, 1–64 each. Board = panel size × grid.
- Scale: physical length per canvas unit.
- Grid snapping is **off** in this mode — real measurements are not on a grid.

**Bundles**
- Bend radius: a document default, overridable per bundle; empty falls back.
- A bundle whose drawn length disagrees with its set length, or that has no
  set length, is drawn distinctly (out-of-scale).
- Per-bundle "match": move the far component so this bundle is drawn at
  exactly its set length. Plus a board-wide "set all to scale".
- Editing a length re-lays-out so the bundle is drawn at the new value.

**Manipulation**
- Dragging a branch point swings the whole connected branch as a rigid body:
  every downstream component keeps its position and angle relative to that
  branch point. This is the hard part of the packet.
- A marquee multi-selection translates only — it does not rotate.

**Export** — folds into T09's page model: one to-scale page per panel, so an
A3 panel on a 2×4 grid prints as 8 pages.

## Acceptance tests

The geometry is pure and belongs in `render`, tested directly:

- board dimensions from panel size × grid, for a preset and for Custom
- a bundle at its set length is in scale; changing the length puts it out
- "match" produces a position where the drawn distance equals the set length,
  to within a stated tolerance
- rigid-body branch rotation preserves every relative position and angle —
  assert on the whole subtree, not one node
- rotating a branch twice by θ equals rotating once by 2θ
- translation of a multi-selection changes no angle

## Traps

- Rigid-body rotation must find the connected subtree, and a cyclic layout
  graph will otherwise hang. Guard with a visited set, as the splice-host
  resolution in `derive/routing.ts` already does.
- Floating-point drift accumulates over repeated rotations. Store the
  authored positions and recompute, rather than mutating in place each drag.
- Do not let formboard mode write scale-derived positions back as authored
  layout positions unless the user asked — that would silently rewrite the
  diagram when someone merely looked at the formboard.
