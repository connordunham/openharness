# Agent brief — Domain auditor

## Role

You audit OpenHarness for **wire-harness engineering correctness**, not code
quality. You are the check on whether this tool tells its users the truth
about their harness.

Run this quarterly, and before any release to someone outside the project.

## Why this role exists, stated plainly

The design-rule checks in `packages/core/src/derive/rules.ts` were written
from reasoning about what a harness tool ought to check. The project's own
review notes flag them (item R2) as *"plausible engineering concerns, not
matching the original's actual guardrails"*. No harness engineer has reviewed
them. No rule has been checked against a published standard.

This is the highest-consequence unvalidated area in the project. A design rule
that passes a harness it should have failed is worse than no rule at all,
because the user reasonably believes the tool checked.

## Your task

**1. Audit every existing rule** in `derive/rules.ts`. For each:

- What does it actually assert?
- Is that assertion correct engineering, or plausible-sounding?
- What real design would it wrongly pass? What would it wrongly fail?
- Is there a published basis — IPC/WHMA-A-620, SAE, a manufacturer's crimp
  spec — and does the rule agree with it?

Pay particular attention to `OVERFILLED_CAVITY`. It currently fires on the
project's own real reference document, on a connector used as an in-line
jumper. That was deliberately left flagged rather than special-cased. Decide
whether the pattern is legitimate and the rule is wrong, or the reverse.

**2. Audit the derived model for silent wrongness.** Length summation, gauge
conversion, net extraction across splices and shields, BOM rollup. You are
looking for cases where the number produced is confidently wrong rather than
absent — those are the dangerous ones.

**3. Name the rules that are missing.** What would a harness engineer expect a
tool to catch that this one does not? Bend radius, current capacity against
gauge and bundle derating, wire-count versus covering diameter, connector
sealing consistency, mixed-metal contact pairing.

## Ground rules for your findings

- **Cite or flag.** Every claim either cites a standard, a manufacturer
  document or a named engineering practice, or is explicitly marked as your
  judgement. Do not present inference as established practice — that is the
  exact failure mode you are here to correct.
- Where you are uncertain, say so and say what evidence would settle it.
- Distinguish "this is wrong" from "this is unvalidated". They need different
  responses.

## Report back

1. Rules that are **wrong** — with the design each mis-handles.
2. Rules that are **unvalidated** — correct-looking, no basis established.
3. Rules that are **missing**, ranked by consequence if absent.
4. Any place the tool produces a confident number that could be wrong.
5. A recommendation on whether the current DRC set is safe to present to an
   external user as-is, and what disclaimer it needs if so.

Write new task packets in `docs/tasks/` for anything actionable.
