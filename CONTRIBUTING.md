# Contributing to OpenHarness

Thanks for looking. OpenHarness is a local-first, automation-first wire
harness CAD tool, MIT licensed, and it is meant to be built on — the library
matters as much as the app.

This document is the short version of how to work here. Two other files carry
the detail: [`docs/HANDOFF.md`](docs/HANDOFF.md) records the decisions that
are already settled and should not be relitigated by accident, and
[`docs/tasks/`](docs/tasks/) holds self-contained work packets with acceptance
criteria. If you want something to do, start at
[`docs/tasks/README.md`](docs/tasks/README.md).

## Getting it running

You only need a toolchain if you are changing the code. If you just want to
*run* OpenHarness, take an installer from the [Releases
page](https://github.com/connordunham/openharness/releases) — no Node, no
build.

To build from source you need **Node.js 22 LTS** from
[nodejs.org](https://nodejs.org) — take the LTS installer and accept the
defaults. Node 20.19+ works; 22 is what CI uses and what `.nvmrc` pins.
Nothing else.

```bash
git clone https://github.com/connordunham/openharness.git
cd openharness
npm install     # this also compiles the workspace libraries — see below
npm start       # builds the app and launches it
npm test        # 196 tests
```

Use **npm**, not pnpm or yarn. `pnpm-workspace.yaml` is checked in but there
is no pnpm lockfile, so pnpm resolves a different dependency tree than CI
builds against.

### The one non-obvious build invariant

`@openharness/core`, `io` and `render` are consumed through their **built
output** — their `package.json` says `main: ./dist/index.js`. On a fresh clone
`dist/` does not exist, so anything importing them fails until they have been
compiled once:

```
[commonjs--resolver] Failed to resolve entry for package "@openharness/core".
```

**When anything at all goes wrong, run `npm run doctor` first.** It checks the
failures that have actually happened on real machines — wrong Node version, a
half-downloaded Electron binary, unbuilt libraries, a stray pnpm lockfile,
PowerShell's execution policy, a clone inside OneDrive — and prints the exact
fix for each. It is faster than reading the stack trace.

That error above means unbuilt libraries, not a broken dependency, and
reinstalling `node_modules` alone will not fix it. `npm install` runs `tsc -b` for you via
npm's `prepare` hook, and `npm test` / `npm run build` / `npm start` each build
what they need first. If you ever hit it anyway, `npm run build`.

This has broken clone-and-run twice. If you change the build graph, please
verify with an actual fresh `git clone` into a new directory, not just a clean
build in your existing one.

### Everyday commands

| Command | What it does |
|---|---|
| `npm start` | Build and launch the desktop app |
| `npm run dev` | Vite dev server + Electron with watch-mode rebuilds |
| `npm test` | Full test run (`vitest run`) |
| `npm run typecheck` | `tsc -b` across the project references |
| `npm run lint` | ESLint |
| `npm run doctor` | Diagnose a broken environment |
| `npm run clean` | Delete all build output, for when a stale build misleads you |
| `npm run package` | Build installers for your current OS into `release/` |

Odd behaviour after switching branches is almost always a stale
`tsconfig.tsbuildinfo` — `npm run clean && npm install`.

On Windows, `cannot be loaded because running scripts is disabled` is
PowerShell's execution policy blocking `npm.ps1`. Run from `cmd.exe`, use
`npm.cmd`, or `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## How the code is arranged

```
packages/core     document model, store/undo, derive pipeline   (no UI, no I/O)
packages/io       .ohd read/write, CSV, vendor JSON import      (depends on core)
packages/render   pure scene construction for the canvases      (depends on core)
packages/app      Electron + React                              (depends on all)
packages/cli      command line                                  (depends on core, io)
```

Dependencies point one way only: `app → render → core` and `app → io → core`.
Nothing in `core` or `render` may import from `app`. If you find yourself
wanting to, the thing you need probably belongs in `core`.

Start reading at `packages/core/src/types.ts` (the document model) and
`packages/core/src/store.ts` (the transaction/undo layer). Everything is built
on those two.

## The conventions that actually matter

These are not style preferences. Breaking them causes real bugs, and a review
will ask you to change them.

**One mutation path.** All document changes go through
`store.transact(label, draft => …)`. One user action is one transaction is one
Ctrl-Z. Automation uses the same path as the GUI — there is no second door,
deliberately.

**`undefined` means "not stated". It never means zero.** A wire with no
computed length reports unknown, not `0`. A confident wrong number is worse
than an absent one, because the user believes it.

**Units are canonical in the model.** Conductor size in mm², length in integer
micrometres, parasitics in base SI. Convert at the edges — display, import,
export — never in the middle.

**Never add AWG numbers together.** See `docs/DOMAIN-DECISIONS.md` D2. Convert
to mm², sum, convert back if you must display it.

**Additive model changes do not bump `formatVersion`.** Migrations run once at
the load boundary in `core/migrate.ts`. Adding an optional field is not a
breaking change; changing the meaning of an existing one is.

**Don't silence the type system.** No widening to `any`, no non-null `!` to
quiet a real error, no skipped or deleted failing tests, and never change an
assertion to match the output you happened to get. If a test is wrong, say why
in the PR.

## Engineering claims need a source

This is a CAD tool for things people build and then put current through. The
design rules in `packages/core/src/derive/rules.ts` decide whether a harness
gets flagged, so a rule that quietly passes a bad design is worse than no rule
at all.

If your change asserts something about harness engineering practice — a limit,
a derating, a "this is always true" — it needs one of:

- a citation to a published standard or a manufacturer specification, or
- an entry in [`docs/DOMAIN-DECISIONS.md`](docs/DOMAIN-DECISIONS.md), or
- an explicit comment saying it is unvalidated inference.

The third option is entirely acceptable. Presenting inference as established
practice is not. If you are not sure, open a **Domain question** issue — the
project has a resident harness engineer and settling it properly usually takes
him one line.

## Sending a patch

1. One logical change per PR. A refactor bundled with a behaviour change is
   very hard to review and tends to sit.
2. `npm run typecheck && npm test && npm run lint` all clean.
3. Add tests for behaviour you add. Tests live next to the code in
   `__tests__/`.
4. **If you changed the UI, run the app and check it.** There is precedent: a
   bug that typechecked cleanly and passed every test broke every button. Say
   in the PR that you did, and what you clicked.
5. Sign off your commits with `git commit -s`. That is a
   [DCO](https://developercertificate.org/) sign-off — it means you have the
   right to submit the work under MIT. There is no CLA and you keep your
   copyright.
6. Write the commit message for someone reading it in a year with no context.
   Why, not what — the diff already says what.

## Reporting things

- **Bugs** — an issue, with the steps and what you expected instead.
- **Harness engineering questions** — a Domain question issue. These are
  welcome and genuinely useful.
- **Security** — see [`SECURITY.md`](SECURITY.md). Not a public issue.

## A note on scope

Some things are deliberately out of scope: accounts, seats, billing, cloud
sharing, live multi-user sync, hosted anything. OpenHarness runs on your
machine on your files, and that constraint is the point rather than a stage
we are passing through. The roadmap's Non-goals section has the reasoning.

Everything else is fair game.
