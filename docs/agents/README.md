# Support agent briefs

Five roles. Each brief is written to be pasted as a system/task prompt with no
further context — the agent reads the repo and its brief, nothing else.

| Agent | Model tier | Runs |
|---|---|---|
| [Implementer](implementer.md) | mid (Sonnet-class) | per task packet |
| [Reviewer](reviewer.md) | mid | before every merge |
| [Verifier](verifier.md) | mid, needs a desktop | before every merge that changes the UI |
| [Domain auditor](domain-auditor.md) | high | once per quarter, and before any external release |
| [Maintainer](maintainer.md) | mid | monthly, and on any advisory |

Paste-ready kickoff prompts for all three of the per-change roles are in
[KICKOFF.md](KICKOFF.md). Those are what you actually hand to an agent; the
briefs below are what the agent reads once it arrives.

## How they fit together

```
packet ──> Implementer ──> Reviewer ──┬──> merge
                              ▲       │
              Verifier ───────┘       │   (UI packets only)
                                      │
Domain auditor ──> new packets ───────┘   (periodic, out of band)
Maintainer ──────> new packets            (periodic, out of band)
```

The Implementer never merges its own work. The Reviewer never fixes what it
finds — it reports, the Implementer fixes. That separation is the point: an
agent that both writes and approves its own code approves everything.

## Rules that apply to all five

- Read `docs/HANDOFF.md` first. It records decisions that are settled.
- Never widen a type to `any`, add a non-null `!` to silence a real error,
  skip or delete a failing test, or change an assertion to match the output
  you happened to get.
- Report blockers rather than working around them. An unfinished task with a
  clear account of why is worth more than a finished-looking one that is
  hollow.
