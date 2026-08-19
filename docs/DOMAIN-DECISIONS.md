# Domain decisions

Engineering rulings from the project's resident harness engineer (Connor
Dunham). These settle questions the code previously guessed at.

**Why this file exists.** The design rules were originally reasoned out rather
than verified, and the project's own review notes flagged them as "plausible
engineering concerns" of unknown accuracy. Each entry below converts one of
those guesses into a decision with an owner and a date. Code that implements
a decision cites its ID.

If you disagree with one of these, raise it — do not quietly implement
something else.

---

## D1 — Two wires in one cavity is a defect

**Date** 2026-08-19 · **Ruling** the rule is right, the pattern is wrong

`OVERFILLED_CAVITY` fires as an **error** on two wires landing in one cavity
with no splice, and that is correct regardless of whether their combined gauge
would fit the contact. The severity should not be softened to a warning, and
the rule should not be made conditional on the contact's rating.

Consequence: `_reference_harness_export.json` — a real captured document —
contains this defect on connector `ZWfYpO`, which uses a 2-cavity connector as
an in-line jumper. That document is wrong. The rule firing on it is the rule
working, and the speculative comment suggesting otherwise has been removed
from `derive/rules.ts`.

The backshell exemption is unaffected: a backshell is a shell-level ground
point, not a crimp cavity, and takes several drain wires by design.

---

## D2 — Multi-wire crimps sum by cross-sectional area

**Date** 2026-08-19 · **Ruling** summing mm² is the correct physical model

Where several wires enter one contact, convert each to mm², add, and compare
the total against the contact's gauge range. This is what `T03` and
`sumGauges` in `T01` implement, and it is confirmed rather than assumed.

Never add AWG numbers — the result is arithmetically meaningless and
directionally backwards, since a larger AWG number is a smaller conductor.

Note this ruling is about the *area model*, not about whether the multi-wire
crimp is permitted in the first place. D1 governs that, and says it is not.
The two coexist: D1 flags the topology, D2 governs the arithmetic wherever
summed gauge is needed.

---

## D3 — Mated cavities need an explicit pin map

**Date** 2026-08-19 · **Ruling** positional is a default, not an assertion

Cavity pairing across a mate must not be inferred from designations — two
mating housings routinely label the same physical position differently
(1..8 against A..H).

Positional pairing (nth to nth) is a reasonable **default**, but the tool must
not assert it as fact: keyed housings, rotated inserts and mixed-density mates
all break it. `Mate.cavityMap` therefore exists as an explicit, user-editable
pairing that overrides the default entirely when present.

A partially specified map leaves unnamed cavities **unpaired**. It does not
fall back to positional for the remainder — a half-specified map is a
statement about the pairs it names, not licence to guess the rest.

This ruling changed the `Mate` type after it was first landed. See
`core/types.ts`.

---

## D4 — Highest-value missing rules

**Date** 2026-08-19 · **Ruling** current capacity with bundle derating, and
bend radius

Ranked above the other candidates (covering fit, sealing consistency) as the
checks that would catch the most real defects in harnesses actually being
built.

- **Current capacity vs gauge, derated for bundling** — `T14`. Needs a load
  model the document does not yet have, which is why it is a larger packet
  than it first appears.
- **Bend radius** — `T15`. Minimum bend radius against bundle diameter.
  Meaningful in the Layout view, and fully meaningful once the formboard
  gives real geometry.

---

## Still open

Questions the code currently guesses at, awaiting a ruling:

- Covering fit: should min/max diameter be checked against derived bundle
  diameter, and with what allowance for compression?
- Sealing consistency: should a sealed housing with unsealed contacts, or
  unpopulated cavities without seals, be an error or a warning?
- Mixed-metal contact pairing: worth a rule at all, or too rare to warrant one?
- Service loop and strip-length allowances: the length pipeline supports both;
  no rule checks that they are sane.
