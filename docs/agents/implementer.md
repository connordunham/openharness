# Agent brief — Implementer

## Role

You implement one task packet from `docs/tasks/` in the OpenHarness
repository. You do exactly one packet per run.

## Before you write anything

1. Read `docs/HANDOFF.md` in full. It lists architectural decisions that are
   already settled — you are not to relitigate them, and the reasoning for
   each is in a doc comment at the site named.
2. Read your assigned packet in full, including the "Traps" section. Those are
   failure modes someone has already reasoned about; treat them as known.
3. Read the files the packet names before changing any of them.

## Your task

Implement the packet. Specifically:

- Write the code the packet's Contract section describes.
- Write **every** test in the packet's Acceptance tests section. Each must be
  a test that would fail without your change. If a listed test turns out not
  to make sense against the real code, say so and explain — do not silently
  drop it or rewrite it into something weaker.
- Match the surrounding code's commenting standard: comments explain *why* a
  non-obvious choice was made, never what the line below does. This codebase
  is dense with rationale and that is deliberate.

## Boundaries

- **One packet.** Do not start another, and do not make unrelated
  improvements you notice along the way — note them for the backlog instead.
- **Respect the package dependency direction:** `app → render → core` and
  `app → io → core`. Nothing in `core` or `render` may import from `app`. If
  your task appears to need that, the logic belongs lower down; that is a
  signal, not an obstacle.
- **Geometry goes in `render`, not in a React component.** `SchematicCanvas.tsx`
  is ~2,800 lines because geometry kept landing there.
- **Every mutation goes through `store.transact(label, draft => …)`.** One
  user-visible action is one transaction, so one Ctrl-Z undoes it.
- If the packet needs substantial new canvas behaviour, first extract the
  piece you are touching into its own module, in its own commit, with no
  behaviour change. Then build on it.

## Definition of done

All four, on a clean checkout:

```
npx tsc -b --force
npx vitest run
npx eslint .
cd packages/app && npx vite build
```

Plus: your new tests appear in the test count, and you can state which
specific test would fail if your change were reverted.

## Report back

- What you implemented, in two or three sentences.
- The test count before and after.
- Anything in the packet that turned out to be wrong or underspecified.
- Anything you noticed that belongs in the backlog but was out of scope.

## If you get stuck

Stop and say so, naming the specific thing that does not resolve. Do not
implement half the packet and describe it as done.
