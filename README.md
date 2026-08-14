# OpenHarness

A local, automation-first wire harness CAD tool. Full design spec:
[`HARNESS-DESIGNER-SPEC.md`](../HARNESS-DESIGNER-SPEC.md) (in the project folder,
one level up from this repo). Review notes and open decisions:
[`SPEC-REVIEW-RECOMMENDATIONS.md`](../SPEC-REVIEW-RECOMMENDATIONS.md).

## Status

**Scaffolding only.** This is the initial monorepo skeleton — package layout,
the document type model (spec §4), a working `HarnessStore` (transact / undo /
redo / dry-run / events) with an empty-but-correctly-typed derived model, and
placeholder entry points for every other package. No net extraction, routing,
rendering, exports, or automation host yet. See `HARNESS-DESIGNER-SPEC.md` §12
for the phase plan this scaffold is Phase 0 of.

## Layout

```
packages/
  core/         @openharness/core        — document model, transactions, derive (implemented: types + store; TODO: algorithms)
  render/       @openharness/render      — SVG scene builders (TODO, Phase 2)
  io/           @openharness/io          — load/save, exports, imports (TODO, Phase 1/6)
  automation/   @openharness/automation  — plugin host (TODO, Phase 5)
  cli/          openharness              — headless CLI (TODO, Phase 1)
  mcp/          @openharness/mcp         — local MCP server (TODO, Phase 5)
  app/          @openharness/app         — React editor (TODO, Phase 2)
automations/    — your own automations live here (spec §8.2)
fixtures/       — golden-file test documents (spec §13)
```

## Before you start Phase 1

Per the review document's closing summary, six decisions are still open and
should be made deliberately before real feature work starts:

1. Tauri/Electron-primary vs. browser-primary (review R15)
2. Variants/configurable harnesses — in or out of v1, as an explicit ADR (R3)
3. Directory file format's atomic-write story (R11)
4. Derived-model invalidation contract (R9)
5. Rough NFR numbers — target doc size, startup budget (R25)
6. PDF export spike, before Phase 2-3 UI assumes it works (R20)

## Getting started

```bash
npm install   # or pnpm install, if you have pnpm — pnpm-workspace.yaml is included
npm run typecheck
npm test
```

The `core` package has a real (if minimal) test suite exercising
`createEmptyDocument`, `HarnessStore.transact`, undo/redo, and dry-run. Start
there — `packages/core/src/store.ts` and `packages/core/src/types.ts` are the
foundation everything else builds on.
