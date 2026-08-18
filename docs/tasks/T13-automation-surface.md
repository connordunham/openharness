# T13 — Automation surface

**Size** L · **Do last** · **Packages** `mcp`, `automation`, `cli`

## Goal

The differentiator. `packages/mcp` and `packages/automation` are stubs, and
the CLI is missing `run`, `query`, `diff` and `doctor`.

## Why last

Every packet before this one changes the document model or the derive
outputs. An API published over a moving model has to be re-published. Let the
model settle first.

## What to build

**MCP server** (`packages/mcp`) — a local server over the same
`store.transact` path the GUI uses. No auth story is needed at all, which is
the advantage of being local: a hosted equivalent spends most of its
complexity budget on OAuth and tenancy.

Expose, at minimum: open a document, describe its connectivity, add
components and wires, assign parts, run validation, export. Every write goes
through a transaction so each tool call is one undo step.

**Automation host** (`packages/automation`) — spec §8.2. Run a user script
against a document with the core API in scope. The events and command
registry in spec §8.4/§8.8 are the surface it binds to.

**CLI commands** (spec §8.6):

| Command | Does |
|---|---|
| `run <script>` | run an automation against a document |
| `query <expr>` | print a slice of the derived model as JSON |
| `diff <a> <b>` | semantic diff of two documents |
| `doctor` | environment and document health check |

`diff` is the interesting one and has no equivalent in a hosted tool: it is
only possible because the file format was designed to be diffable. A semantic
diff — "C3 gained a cavity, W12 changed gauge" — is what makes design review
possible without a proprietary viewer.

## Contract

- The public API is `@openharness/core`'s exports. If a task needs something
  not exported, export it deliberately rather than reaching into a subpath.
- Every mutation is a transaction with a human-readable label. The label is
  what the user sees in undo.
- The document JSON schema should be published as a standalone reference
  document, generated from the types rather than written by hand so it cannot
  drift.

## Acceptance tests

- an MCP tool call that adds a connector produces the same document state as
  the equivalent GUI action
- a failed tool call leaves the document untouched — transactions are atomic
- `diff` of a document against itself is empty
- `diff` reports a changed gauge as one semantic change, not as a text hunk
- `query` output is stable across runs for the same input (the derive pipeline
  already sorts for this reason — do not undo it)

## Traps

- Do not build a second mutation path. The moment the MCP server writes to the
  document directly, undo and validation stop applying to it.
- `diff` should compare documents, not files. Two byte-different files with
  the same content are not a change.
