# AGENTS.md — rules for every agent working in this repository

OpenHarness is a local-first, automation-first wire harness CAD tool.
TypeScript monorepo, npm workspaces, Electron + React front end.

This file is loaded for **every** agent, in every session. It contains only the
things that cause real bugs when broken. The reasoning behind each is in a doc
comment at the site named — go read it before you decide a rule is wrong.

## Read before doing anything

1. `docs/HANDOFF.md` — decisions that are settled. Do not relitigate them.
2. `docs/DOMAIN-DECISIONS.md` — engineering rulings from the project's resident
   harness engineer. These are facts about how harnesses work, not preferences.
   Code implementing one cites its ID (D1, D2, …).
3. `docs/tasks/README.md` — the work, in dependency order, with current state.
4. Your own packet or brief, in full, including its "Traps" section.

## Architecture rules

**Dependency direction is one-way.** `app → render → core`, and
`app → io → core`. Nothing in `core` or `render` may import from `app`. If your
task appears to need that, the logic belongs lower down. That is a signal, not
an obstacle.

**Geometry lives in `packages/render`, never in a React component.**
`SchematicCanvas.tsx` is ~2,800 lines precisely because geometry kept landing
there. If you must add canvas behaviour, first extract the piece you are
touching into its own module, as its own commit, with no behaviour change.
Then build on it.

**Every document mutation goes through `store.transact(label, draft => …)`.**
One user-visible action is one transaction, so one Ctrl-Z undoes it. Automation
uses the same path as the GUI. There is no second door, deliberately.

## Data rules

**`undefined` means "not stated". It never means zero.** A wire with no
computed length reports unknown, not `0`. A confident wrong number is worse
than an absent one, because the user believes it.

**Units are canonical in the model.** Conductor size in mm², length in integer
micrometres, parasitics in base SI. Convert at the edges — display, import,
export — never in the middle.

**Never add AWG numbers together** (`DOMAIN-DECISIONS.md` D2). Convert to mm²,
sum, convert back only to display. Adding AWG numbers is arithmetically
meaningless and directionally backwards.

**Additive model changes do not bump `formatVersion`.** Migrations run once at
the load boundary in `core/migrate.ts`. Adding an optional field is not
breaking; changing the meaning of an existing one is.

## Honesty rules

**Do not silence the type system.** No widening to `any`, no non-null `!` to
quiet a real error, no skipped or deleted failing tests, and never change an
assertion to match the output you happened to get. If a test is wrong, say why.

**Engineering claims need a source.** If your change asserts something about
harness practice — a limit, a derating, a "this is always true" — it must
either cite a published standard, cite a `DOMAIN-DECISIONS.md` ID, or carry an
explicit comment saying it is unvalidated inference. The third option is
entirely acceptable. Presenting inference as established practice is not.

**Comments explain why, never what.** This codebase is dense with rationale and
that is deliberate. A comment restating the line below it is noise.

**Report blockers rather than working around them.** An unfinished task with a
clear account of why is worth more than a finished-looking one that is hollow.
If you are stuck, stop and name the specific thing that does not resolve.

## Definition of done

All four, from the repo root, on a clean checkout:

```
npx tsc -b --force
npx vitest run
npx eslint .
cd packages/app && npx vite build
```

Plus: new tests appear in the count, and you can name the specific test that
would fail if your change were reverted.

## Build notes that will otherwise waste your time

- `@openharness/core`, `io` and `render` are consumed through their **built
  output** (`main: ./dist/index.js`). `Failed to resolve entry for package
  "@openharness/core"` means unbuilt libraries, not a broken dependency. Run
  `npm run build`. Reinstalling `node_modules` will not fix it.
- `npm run doctor` diagnoses a broken environment and prints the fix.
- Use npm. Not pnpm, not yarn.
- Unit tests cannot see rendering bugs. A bug here once typechecked cleanly and
  passed every test while breaking every button in the app. If you changed the
  UI, someone has to launch it.
