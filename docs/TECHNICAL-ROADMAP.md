# Technical roadmap

CTO → CEO. Revision 2, August 2026.

Revision 1 asked you four questions. You answered them, and the answers change
the shape of the plan enough that this is a rewrite rather than an edit. What
changed is recorded under *Decisions taken* below; the rest of the document is
sequenced against them.

For the engineering breakdown see `docs/ROADMAP.md` (gap analysis) and
`docs/tasks/` (execution packets). This is the strategic view: where we are,
what we are betting on, what it costs, and what is still open.

---

## Decisions taken

**We are open-source infrastructure, and we want a community.** Not a product
with a public repo attached — infrastructure. That means the library is as much
the deliverable as the application, the file format is a published artefact we
owe stability to, and a contributor's first hour matters as much as a user's
first hour.

**MIT, confirmed and deliberate.** Anyone may fork and commercialise. We are
choosing adoption over capture.

**We have a resident harness engineer.** You. That converts our single largest
risk from "unvalidated and unvalidatable" into "a standing review process",
and it is worth more to this project than any three features on the list.

Everything below is re-sequenced around those three.

## Where we actually are

A working local-first harness CAD tool. Four functioning panes, a tested
derived model, a command-line interface, a documented file format, 196 tests.
It imports the incumbent's format, and a person can design a real harness in
it today.

Honest positioning: **a credible tool, not yet infrastructure.** Two distinct
gaps, and it is worth keeping them separate.

- *As a tool*, a harness designed here cannot yet be handed to someone who
  will build it. There is no manufacturing output. Until that exists,
  everything else is a demonstration.
- *As infrastructure*, nothing outside this repository can consume us. The
  packages are not published, the format has no versioned specification a
  third party could implement against, and a contributor arriving cold has a
  README and no map. Infrastructure that only its author can build on is a
  private tool with a public licence.

Revision 1 only counted the first gap. The second is now equally load-bearing.

## The bet

The tool we were specced against has roughly two years, a team, and shipped AI
integration, 1:1 formboard and multi-user collaboration in 2026 alone. On
present resources we do not catch them on features, and I would not try.

What they cannot do is structural, not a matter of effort. They are a hosted
subscription product. Their documentation states plainly that there is no
offline mode and no local-only operation. That means:

- A defence, aerospace or OEM supplier whose harness IP may not leave their
  network **cannot use them at all.**
- Nobody can put their own code in the loop — no scripting, no rules on save,
  no pipeline integration.
- Designs live in a proprietary store, not in the version control every
  engineering organisation already runs.
- Cost scales per seat, forever.

That was the wedge in revision 1 and it still is. What the open-source
decision changes is *what we do with it*. A closed product would sell the
wedge as a differentiator. Infrastructure gives it away, and wins on the
second-order effect: the harness format that engineering teams can read,
diff, script and keep forever becomes the one they standardise on. Formats win
by being implementable, not by being good.

So the strategic goal is no longer "reach feature parity in a niche". It is:

> **Make `.ohd` the format harness data is exchanged in, and
> `@openharness/core` the library people reach for when they need to compute
> something about a harness.**

The application is how most people meet the format. It is not the product.

Feature parity matters only where its absence makes us untrustworthy. That is
a much shorter list than full parity, and it is what M1 covers.

## Milestones

Estimates assume the current single-developer, AI-assisted pace. They are
sequencing, not commitments. M0 is new in this revision; M1–M5 are largely
carried over, with the contributor-facing work folded in rather than bolted on
at the end.

### M0 — Contributable · ~1–2 weeks · **new, and it goes first**

*Outcome: a competent stranger can land a patch without talking to us.*

`CONTRIBUTING.md` with the actual build invariants (the workspace build order
is not guessable and has already broken clone-and-run twice), a code of
conduct, issue and PR templates, and roughly ten issues marked
`good-first-issue` carved out of `docs/tasks/`. Publish `@openharness/core`
and `@openharness/io` to npm under a `0.x` line so the packages are consumable
outside this repo. Turn `docs/HARNESS-DESIGNER-SPEC.md` into a versioned
format specification with a stability statement.

This is small, dull, and first. Contribution capacity compounds; features do
not. Every week M0 is delayed is a week the project can only move at exactly
one person's speed. It is also the milestone most easily deferred forever,
which is why it is written down with a number on it.

*Gate: no public announcement before this lands. A repo that gets attention
before it can absorb contributors converts interest into nothing.*

### M1 — Trustworthy · ~3–4 weeks

*Outcome: a drawing an engineer would put their name on.*

Close the gaps that make output **wrong**, not merely inconvenient. Chiefly
connector mating — today a bulkhead's two halves come out as electrically
separate, which is silently incorrect on any harness with a pass-through.
Plus wire-gauge-versus-contact checking, and zoom, without which nothing
larger than a demo can be inspected.

Now also includes the two rules the resident engineer named as the highest
value missing checks: current capacity with bundle derating (T14) and minimum
bend radius (T15). Both are the kind of rule a user assumes we already run.

*Gate: no external demonstration before this lands.*

### M2 — Usable at scale · ~3–4 weeks

*Outcome: a 200-wire harness is tractable, not just a 20-wire one.*

Search, type-to-connect, bulk operations. The incumbent spent most of its 2026
development here, and its release notes read as a tool discovering that
dragging wires one at a time does not survive a real harness. We can learn
that lesson without paying for it.

### M3 — Manufacturable · ~4–5 weeks · **the adoption threshold**

*Outcome: outputs a shop floor accepts.*

PDF drawings with a proper title block; Excel wiring tables with per-connector
pinouts. This is the milestone that converts the project from a tool we use
into a tool someone else can use.

Revision 1 called this the *commercial* threshold. Under an open-source model
it is the **adoption** threshold, and that raises rather than lowers its
priority: we are not gating revenue behind it, we are gating whether anyone
outside this repository has a reason to stay. If we ship one milestone this
year, it is still this one.

### M4 — Differentiated · ~4–6 weeks

*Outcome: capability nobody else has.*

The local MCP server, the automation host, and semantic document diff. Diff is
worth calling out: it is only possible because the file format was designed to
be diffable, and it makes design review possible without a proprietary viewer.
No hosted competitor can offer it.

Under the infrastructure framing this milestone gains a second job. The
automation surface (T13) is the seam third parties build against, so its API is
a compatibility promise, not an internal convenience. It should be designed in
public, with the spec written before the implementation.

### M5 — Formboard · ~6–8 weeks

*Outcome: the high-value niche.*

1:1 physical-scale build documentation — print it, lay it on the bench, build
the harness on top. Expensive, self-contained, and the single feature harness
shops care most about. Deliberately after M4: it is a large geometry project
and it should not block the differentiators.

It is also the best-shaped contribution target in the whole roadmap — heavy,
well-isolated, geometry-flavoured, and touching almost nothing else. If the
community is going to take on one large piece, this is the one to offer.

**Total to a genuinely competitive position: roughly five to six months** at
current pace, with M3 as the point where external conversations become real.

## Risks, in the order they should worry you

**1. Nobody shows up.** This is now the top risk, and it is the direct cost of
the open-source decision. Most open-sourced projects acquire zero outside
contributors, and the ones that do usually earn it in the first ninety days
after they become visible. Wire-harness CAD is a narrow field, and the people
qualified to contribute are mostly employed doing exactly this work under
contracts that make contributing awkward. Mitigation is M0 plus deliberately
sizing some work for a stranger — but plan for a realistic outcome of a
handful of drive-by fixes and one or two serious contributors in the first
year, not a community. **We should be honest that the open-source decision is
primarily about credibility, permanence and adoption of the format, and only
secondarily about contributed labour.** If we are counting on labour, the plan
is wrong.

**2. Domain correctness — now managed, not solved.** Our design-rule checks
were reasoned out rather than derived from a standard. Four of the open
questions are now settled by the resident engineer and recorded in
`docs/DOMAIN-DECISIONS.md`; the rest are listed there as still open. The
remaining risk is narrower but real: rules that cite no standard, and a
`custom` escape hatch that lets a document carry engineering assertions we
never validate. A rule that passes a harness it should have failed is worse
than no rule, because the user believes we checked. The mitigation is now a
process — the domain-auditor brief (`docs/agents/domain-auditor.md`) prepares
questions and verifies citations, and you answer them.

This has moved from #1 to #2. That is the single largest improvement in the
project's risk profile since it started, and it cost a conversation.

**3. Bus factor of one.** Everything here was built in a small number of
AI-assisted sessions. It is well tested against its own assumptions, and
nobody has independently checked the assumptions. Open-sourcing does not fix
this by itself — it only makes it fixable. Until a second person can
confidently modify `packages/core`, the project is one distraction away from
stalling, and no licence changes that.

**4. We ship a dependency with a known vulnerability.** Electron 31 carries an
ASAR integrity bypass advisory and is two majors behind. Tolerable for
internal use; not tolerable in something we invite people to download. Under a
public model this moves earlier — it should close in M0 or M1, not M3.

**5. We cannot see rendering bugs automatically.** There is precedent: a bug
that typechecked cleanly and passed every test broke every button in the app.
Manual verification is the only control, which is why the Verifier role
exists. It does not scale, and it scales even worse across contributors we
cannot ask to check by hand. CI that renders and compares is a real cost we
have not yet paid.

**6. Liability, under a licence that disclaims it.** Harness drawings feed
manufacturing. MIT disclaims warranty, and that is legally load-bearing but
ethically thin: someone will eventually build from our output. We need a
stated position in the README before M3 — what the tool checks, what it does
not, and that it is not a substitute for engineering review.

**7. Governance debt.** Right now every decision is yours and mine, which is
correct at this size and becomes a bottleneck the moment it isn't. Not urgent.
Worth naming now so it is a choice later rather than a surprise.

## Still open

Revision 1's four questions are answered. These are the ones the answers
created.

**1. Do we want a CLA, or DCO, or neither?** Contributions under MIT with no
agreement are the lowest-friction option and are what most projects our size
do. It also means we can never relicense or dual-license, ever, without
tracking down every contributor. My recommendation is **DCO** — a sign-off
line in each commit, near-zero friction, establishes provenance, and keeps us
honest without asking anyone to sign anything. Decide before the first outside
patch, because it is retroactively painful.

**2. What does `0.1.0` mean, and what do we promise at `1.0`?** The moment we
publish to npm we are making a compatibility promise whether or not we mean
to. My recommendation: `0.x` for the library API with explicit breaking-change
notes, but treat the **file format** as stable from the first published spec —
people's data outlives our API, and a format that churns is a format nobody
adopts.

**3. How much of your engineering time do we spend, and on what?** You are
now the project's scarcest resource and its main technical differentiator. My
recommendation is a standing rhythm rather than a block: a batch of domain
questions per milestone, answered in writing into `docs/DOMAIN-DECISIONS.md`.
The `custom` field escape hatch and the unstandardised rule set are the two
places your time buys the most.

**4. Do we announce, and when?** M0 makes us contributable; M3 makes us
useful. Announcing between them spends attention on something people cannot
yet do their job with. My recommendation is to stay quiet, build in the open,
and announce at M3 — with M0 done well before, so that anyone who finds us
early is not turned away.

**5. Trademark.** MIT covers the code and nothing else. If "OpenHarness" is
worth anything later, the name is the only thing a fork cannot take, and only
if we hold it. Low cost, easy to forget, irreversible if someone else does it
first.

## How the work gets done

Execution is delegated to scoped agents (`docs/agents/`): an Implementer that
takes one task packet at a time, a Reviewer that never fixes what it finds, a
Verifier that drives the running app, plus periodic domain and maintenance
audits. The separation is deliberate — an agent that both writes and approves
its own code approves everything.

The task packets in `docs/tasks/` were written for delegation to a smaller
model. They turn out to be the same artefact a new human contributor needs:
context, scope, explicit non-goals, acceptance tests, and the traps to avoid.
That is a convenient accident and we should lean on it — one packet format for
agents and contributors, not two.

I hold architecture, sequencing, and anything that changes the data model.
Those are the decisions that are expensive to reverse. Under an open model,
data-model changes get more expensive still, because other people's files are
downstream of them.
