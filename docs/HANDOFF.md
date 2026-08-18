# Handoff guide

This repository is set up to be extended by another model working task by
task. This file is the operating manual; `docs/tasks/` holds the work.

Read this once, then read only the packet you are working on.

## The contract

Each packet in `docs/tasks/` is self-contained: goal, the files it touches,
the interface contract, the acceptance tests, and the traps that make the
task harder than it looks. Do one packet per branch. Do not start a second
packet before the first is green.

**A packet is done when all four hold:**

```
npx tsc -b --force     # clean
npx vitest run         # all green, and your new tests are in the count
npx eslint .           # clean
cd packages/app && npx vite build   # clean
```

Nothing merges on a red build. If a packet turns out to be wrong — the
design does not survive contact with the code — stop and say so in the PR
rather than reshaping the code to fit a bad spec.

## What is already decided

Do not relitigate these. They are load-bearing and the reasoning is in the
doc comments at each site.

| Decision | Where |
|---|---|
| One normalised `components` map with a `type` discriminant, not per-type arrays | `core/types.ts` header |
| Integer micrometres everywhere in the length pipeline | `core/derive/length.ts` |
| mm² is the canonical gauge unit; every comparison converts first | `core/types.ts` `GaugeUnit` |
| Typed part fields exist **only** where a derive stage or rule reads them; everything else goes in the open `parameters[]` list | `core/types.ts`, above `SplicePart` |
| Mates are their own entity, and cavity correspondence is positional | `core/types.ts` `Mate` |
| Port exit stubs are correctness, not styling — manual routing may not remove them | `render/routing.ts` `computeManualRoutePoints` |
| Legacy field shapes are normalised once at the load boundary, never read in two spellings | `core/migrate.ts` |
| Derived data is derived — never author a field a derive stage can compute | `core/derive/index.ts` |

## Conventions that are not negotiable

- **Every mutation goes through `store.transact(label, draft => …)`.** There is
  no GUI-only mutation path. An automation and a button press take the same
  route. One user-visible action is one transaction, so one Ctrl-Z undoes it.
- **Comments explain why, not what.** The existing code is dense with
  rationale for non-obvious choices, and that is deliberate — match it. A
  comment restating the line below it is worse than no comment.
- **New behaviour needs a test that would fail without it.** Tests that assert
  the implementation back to itself are not evidence.
- **Optional fields mean "not stated", not zero.** `undefined` gauge is
  unconstrained; `undefined` parasitic is uncharacterised. Never write a
  literal zero to mean "unknown", and collapse an all-blank object back to
  `undefined` so it does not appear in the serialised document.
- **Additive model changes do not bump `formatVersion`.** Add the field as
  optional and, if an old spelling exists, migrate it in `core/migrate.ts`.
  Bump the version only for a change that would lose or misread data.

## Where things live

```
packages/core     document model, store/undo, derive pipeline. No UI, no DOM.
packages/render   pure geometry: scene building, routing, overlays. No React.
packages/io       import/export and the load boundary (migrations run here).
packages/cli      the command-line entry point.
packages/app      Electron + React. The only package allowed to touch the DOM.
```

The dependency direction is one-way: `app → render → core`, `app → io → core`.
Nothing in `core` or `render` may import from `app`. If a task seems to need
that, the logic belongs lower down — that is the signal, not an obstacle.

**Put geometry in `render`, not in a component.** `SchematicCanvas.tsx` is the
largest file in the repo and the reason is that geometry kept landing there.
`render/overlays.ts` exists because that geometry is testable once it is out.

## Working on the canvases

`SchematicCanvas.tsx` is ~2,800 lines. Do not add a sixth responsibility to
it. If a packet needs substantial new canvas behaviour, extract the piece you
are touching into its own module first, in its own commit, with no behaviour
change — then build on it. `schematicSymbols.tsx` and `render/overlays.ts`
were extracted exactly this way.

Interaction rules already established, worth matching:

- Click and drag share a hit target and are told apart by pointer travel
  (`DRAG_THRESHOLD`), never by a modifier key.
- Alt-click deletes the thing under the cursor in path-editing contexts.
- Plain click selects; the full inspector opens only from right-click → Edit.
- Left-drag on empty Schematic canvas is the marquee, so panning there is
  alt-drag or middle-drag.

## Verifying UI work

Typecheck and unit tests cannot see a rendering bug. For any packet that
changes what is on screen, build and launch the app (`npm start`) and drive
the actual feature before calling it done. The preload/ESM bug recorded in
the README is the standing example: it typechecked cleanly and broke every
button in the running app.

## When you get stuck

Say so, with the specific thing that does not resolve. Do not:

- widen a type to `any` or add a non-null `!` to silence a real error
- skip or delete a failing test
- change an assertion to match the output you got
- implement half a packet and describe it as done

A packet returned unfinished with a clear account of the blocker is worth
more than one returned green and hollow.
