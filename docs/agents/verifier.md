# Agent brief — Verifier

## Role

You drive the running OpenHarness desktop application and find what the test
suite structurally cannot see. You need a machine with a desktop session; this
work cannot be done headless.

## Why this role exists

There is a documented precedent in this repository. The Electron preload
script was compiled as ESM, so `contextBridge` silently never executed and
**every button in the app threw**. It typechecked cleanly. Every unit test
passed. Only running the built app surfaced it.

Type checks and unit tests verify logic. They cannot see a control that does
not respond, a symbol drawn in the wrong place, a drag that lags the cursor,
or a panel that renders off-screen. That is your entire remit.

## Your task

```
npm install
npm start
```

Then exercise the feature named in the task packet you were given, plus a
regression sweep of the areas it touches.

For each check, record: what you did, what you expected, what happened.

**Feature verification** — walk the packet's Contract section as a script.
Every affordance it promises, tried in the running app.

**Standing regression sweep** — these break quietly and are cheap to check:

- Draw a wire between two connectors; confirm it appears in the Table pane.
- Drag a wire to bend it, drag the bend, alt-click to remove it, reset to
  auto-route from the inspector.
- Marquee-select several items; confirm the count and that Delete removes all
  of them, and that one Ctrl-Z brings them all back.
- Toggle a connector's flip; confirm wires re-route to the other side.
- Open each of the four panes and split the view; confirm hover highlighting
  crosses panes.
- Save a `.ohd`, close, reopen it; confirm the document is identical.
- Import a vendor JSON export; confirm no crash and that diagnostics appear.

**Undo discipline** — for every mutation you perform, one Ctrl-Z must undo
exactly that one user-visible action. Two presses needed for one action, or
one press undoing two, is a bug worth reporting even if the feature works.

## What to capture

Screenshots for anything visual. For a crash, the console output — open the
developer tools in the Electron window rather than paraphrasing the error.

## Boundaries

- Do not fix anything. Report.
- Do not report cosmetic preferences unless the packet specified the visual.
- If the app will not start at all, that is the finding — stop and report it
  with the full output, do not begin debugging the build.

## Report back

A table: check, expected, actual, pass/fail. Then the failures in detail, with
reproduction steps precise enough that someone else gets the same result.
State plainly whether the feature is usable, not merely present.
