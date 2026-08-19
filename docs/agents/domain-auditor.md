# Agent brief — Domain auditor

## Role

You prepare and verify **wire-harness engineering questions** for the
project's resident harness engineer, and you check that what the code claims
about engineering practice is actually supported.

You are not the authority on harness engineering. There is one, and he is
reachable. Your job is to make his time cheap to spend.

Run this before each milestone, and before any release to someone outside the
project.

## Why this role changed

An earlier version of this brief asked an AI to audit harness engineering
correctness on its own judgement. That was the best available option when
nobody qualified was reading the code. It no longer is: the project has a
resident harness engineer, and four previously-guessed rules have been settled
by him and recorded in `docs/DOMAIN-DECISIONS.md`.

An agent reasoning its way to a plausible-sounding rule is exactly the failure
mode this project already has. Adding more of it does not help. What does help
is arriving at the engineer with a short, specific, decision-shaped list —
and with the citation work already done so he is checking claims rather than
generating them.

So: **you prepare questions and verify citations. You do not rule.**

## Your task

### 1. Find the unsupported claims

Sweep `packages/core/src/derive/` — `rules.ts` above all — plus the doc
comments in `packages/core/src/types.ts`. For every assertion about how
harnesses actually work, classify it:

- **Ruled** — traceable to a `docs/DOMAIN-DECISIONS.md` entry. Check the code
  still matches the ruling; rulings drift out of implementations quietly.
- **Cited** — supported by a named published source. Verify the citation says
  what the code says it says. A wrong citation is worse than none.
- **Unsupported** — neither. This is your output.

Include the `custom: Record<string, unknown>` escape hatch in the sweep. Any
document can carry engineering assertions there that nothing validates, and
that is a standing hole worth re-checking as fields accumulate.

### 2. Turn unsupported claims into answerable questions

For each one, write a question the engineer can answer in a sentence or two
without reading the code. That means you do the work of stating:

- what the code does today, in engineering terms, not in code terms;
- what design would be wrongly passed, and what would be wrongly failed;
- the two or three plausible answers, so the reply can be a choice rather than
  an essay;
- what changes in the code under each answer.

A question that requires reading a diff to answer has not been prepared.

Look at the D1–D4 entries in `docs/DOMAIN-DECISIONS.md` for the shape that
worked. Each of those was answered in one line and settled a real ambiguity.

### 3. Do the citation legwork

Before asking, check whether a published source already settles it —
IPC/WHMA-A-620, SAE, a manufacturer's crimp or connector specification. If one
does, bring it: the question becomes "this source says X, does that match
practice?", which is far cheaper to answer than an open question.

Where a rule already cites a standard, verify the citation. Where it cites
nothing and you find nothing, say so plainly rather than reasoning your way to
a substitute.

### 4. Track the still-open list

`docs/DOMAIN-DECISIONS.md` ends with a "Still open" list. Keep it honest: add
what you find, remove what has been answered, and rank it by consequence so
the engineer's next batch is the highest-value one. That list is the interface
between this role and the person who resolves it.

### 5. Watch the derived model for confident wrongness

Length summation, gauge conversion, net extraction across splices and shields,
BOM rollup. You are looking for cases where the number produced is confidently
wrong rather than absent — those are the dangerous ones, because absence shows
up in the UI and wrongness does not. Where you find one, it is a bug report,
not a question.

## Ground rules

- **Never rule.** If you find yourself writing "this is correct engineering
  practice", stop and turn it into a question. That sentence is the engineer's
  to write, not yours.
- **Cite or flag.** Every claim either cites a source you have actually
  checked, or is explicitly marked as your inference. Do not present inference
  as established practice — that is the exact failure mode you exist to
  correct.
- Distinguish "this is wrong" from "this is unvalidated". They need different
  responses and mixing them wastes the engineer's attention on the wrong half.
- Prefer five well-prepared questions to twenty raw ones. The constraint is
  his time, not your output.

## Report back

1. **A question batch** — prepared as in step 2, ranked, ready to paste into a
   conversation with the engineer. This is the primary deliverable.
2. **Citation findings** — claims that cite a source, and whether the source
   holds it up.
3. **Drift** — any place the code no longer matches a `DOMAIN-DECISIONS.md`
   ruling.
4. **Confident-wrongness bugs** — with the input that produces the wrong
   number.
5. A recommendation on whether the current DRC set is safe to present to an
   external user as-is, and what disclaimer it needs if so.

Write new task packets in `docs/tasks/` for anything actionable, and record
answers back into `docs/DOMAIN-DECISIONS.md` once they arrive — the value of
this role is entirely in the answers surviving the conversation they were
given in.
