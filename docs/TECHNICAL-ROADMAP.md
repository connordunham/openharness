# Technical roadmap

CTO → CEO. August 2026.

For the engineering breakdown see `docs/ROADMAP.md` (gap analysis) and
`docs/tasks/` (execution packets). This document is the strategic view: where
we are, what we are betting on, what it costs, and what I need decided.

---

## Where we actually are

A working local-first harness CAD tool. Four functioning panes, a tested
derived model, a command-line interface, a documented file format, 196 tests.
It imports the incumbent's format, and a person can design a real harness in
it today.

Honest positioning: **credible internal tool, not yet a product.** The gap is
not polish. It is that a harness designed here cannot yet be handed to
someone who will build it — there is no manufacturing output. Until that
exists, everything else is a demonstration.

## The strategic question, and my answer

The tool we were specced against has roughly two years, a team, and shipped
AI integration, 1:1 formboard and multi-user collaboration in 2026 alone. On
present resources we do not catch them on features, and I would not try.

What they cannot do is structural, not a matter of effort. They are a hosted
subscription product. Their own documentation states plainly that there is no
offline mode and no local-only operation. That means:

- A defence, aerospace or OEM supplier whose harness IP may not leave their
  network **cannot use them at all.**
- Nobody can put their own code in the loop — no scripting, no rules on save,
  no pipeline integration.
- Designs live in a proprietary store, not in the version control every
  engineering organisation already runs.
- Cost scales per seat, forever.

**That is the wedge, and everything below is sequenced around it.** We are not
building a cheaper harness tool. We are building the one that runs where the
others are not allowed to, and that an engineering team can automate.

Feature parity matters only where its absence makes us untrustworthy. That is
a much shorter list than full parity, and it is what M1 covers.

## Milestones

Estimates assume the current single-developer, AI-assisted pace. They are
sequencing, not commitments.

### M1 — Trustworthy · ~3–4 weeks

*Outcome: a drawing an engineer would put their name on.*

Close the gaps that make output **wrong**, not merely inconvenient. Chiefly
connector mating — today a bulkhead's two halves come out as electrically
separate, which is silently incorrect on any harness with a pass-through.
Plus wire-gauge-versus-contact checking, and zoom, without which nothing
larger than a demo can be inspected.

*Gate: no external demonstration before this lands.*

### M2 — Usable at scale · ~3–4 weeks

*Outcome: a 200-wire harness is tractable, not just a 20-wire one.*

Search, type-to-connect, bulk operations. The incumbent spent most of its 2026
development here, and its release notes read as a tool discovering that
dragging wires one at a time does not survive a real harness. We can learn
that lesson without paying for it.

### M3 — Manufacturable · ~4–5 weeks · **the commercial threshold**

*Outcome: outputs a shop floor accepts.*

PDF drawings with a proper title block; Excel wiring tables with per-connector
pinouts. This is the milestone that converts the project from a tool we use
into a tool someone else can use. **Nothing before this can be sold or
seriously piloted.** If we ship one milestone this year, it is this one.

### M4 — Differentiated · ~4–6 weeks

*Outcome: capability nobody else has.*

The local MCP server, the automation host, and semantic document diff. Diff is
worth calling out: it is only possible because the file format was designed to
be diffable, and it makes design review possible without a proprietary viewer.
No hosted competitor can offer it.

This is where we stop being a cheaper alternative and start being a different
category.

### M5 — Formboard · ~6–8 weeks

*Outcome: the high-value niche.*

1:1 physical-scale build documentation — print it, lay it on the bench, build
the harness on top. Expensive, self-contained, and the single feature harness
shops care most about. Deliberately after M4: it is a large geometry project
and it should not block the differentiators.

**Total to a genuinely competitive position: roughly five to six months** at
current pace, with M3 as the point where external conversations become real.

## Risks, in the order they should worry you

**1. Domain correctness is unvalidated.** Our design-rule checks were reasoned
out, not verified against any standard, and no harness engineer has reviewed
them. Our own review notes flag this. A rule that passes a harness it should
have failed is worse than no rule, because the user believes we checked. This
is the one risk that could hurt somebody. I have written a standing audit
brief for it (`docs/agents/domain-auditor.md`) and I want it run before any
external use.

**2. Bus factor of one, and no independent review.** Everything here was built
in a small number of AI-assisted sessions. It is well tested against its own
assumptions. Nobody has independently checked the assumptions. Budget for a
harness engineer's time — days, not weeks — before M3 ships anywhere.

**3. We ship a dependency with a known vulnerability.** Electron 31 carries an
ASAR integrity bypass advisory and is two majors behind. Fine for internal
use; not fine for distribution. Must be closed before M3.

**4. We cannot see rendering bugs automatically.** There is precedent: a bug
that typechecked cleanly and passed every test broke every button in the app.
Manual verification is the only control, which is why the Verifier role
exists. It does not scale, and at some point we need real UI automation.

**5. Liability.** Harness drawings feed manufacturing. The incumbent ships an
explicit "documentation tool only, verify independently" disclaimer. We need a
stated position before anyone builds from our output.

## What I need from you

**1. What is this?** Product, internal tool, or open-source infrastructure?
Everything downstream turns on it — licensing, hosting, whether we build
multi-user at all, whether M3's output needs to satisfy a customer or just us.
I have sequenced for "product aimed at a security-constrained niche" because
that is where the defensible position is, but it is your call and I would
rather change course now than at M3.

**2. Do we fund a domain review?** A harness engineer for a few days, before
M3. Cheap relative to shipping a tool that quietly passes bad designs. My
recommendation is yes, and that it is the best money we spend this year.

**3. The repository is public under MIT.** Anyone may fork and commercialise
it. If that is deliberate — community, credibility, contributions — good. If
it was momentum, decide now, because it gets harder to reverse with every
external reader.

**4. Target segment.** Defence and aerospace suppliers is where the offline
constraint is worth real money. Motorsport and specialist automotive is where
the formboard is. Hobbyist is neither, and would pull the roadmap toward
polish over capability. I have assumed the first; tell me if that is wrong.

## How the work gets done

Execution is delegated to scoped agents (`docs/agents/`): an Implementer that
takes one task packet at a time, a Reviewer that never fixes what it finds, a
Verifier that drives the running app, plus periodic domain and maintenance
audits. The separation is deliberate — an agent that both writes and approves
its own code approves everything.

I hold architecture, sequencing, and anything that changes the data model.
Those are the decisions that are expensive to reverse.
