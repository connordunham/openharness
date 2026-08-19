# T14 — Current capacity with bundle derating

**Size** L · **Needs** T01 · **Package** `core` · **Basis** `DOMAIN-DECISIONS.md` D4

## Goal

Warn when a conductor is too small for the current it carries, accounting for
the fact that conductors bundled together cannot shed heat independently.

Named by the project's harness engineer as the missing check that would catch
the most real defects. It is also the largest DRC packet, because the document
has no load model yet — that is most of the work.

## Why this is bigger than it looks

Every existing rule reads data the document already holds. This one needs
something new: how much current a conductor actually carries. That is a
modelling decision, so **do not start by writing the rule.** Propose the model
in writing and get it reviewed first.

The obvious placement is a current rating per signal or per net rather than
per wire, since current is a property of the circuit, not of one conductor —
but a net can contain parallel paths, and that needs thought rather than an
assumption. Bring the question back before implementing.

## Contract, once the model exists

New rule `WIRE_CURRENT_CAPACITY`, severity `warning`.

For each conductor with a known load:

1. Establish base ampacity from gauge, insulation temperature rating and
   ambient — the figure before any derating.
2. Count the current-carrying conductors sharing its bundle. `bundleContents`
   in the derived model already gives bundle membership.
3. Apply the bundle derating factor for that count.
4. Compare derated ampacity against carried current.

Report base ampacity, the derating applied, and the resulting margin — not
just pass/fail. A 2% margin and a 200% margin are both "pass" and an engineer
needs to tell them apart.

## Sourcing the numbers — read this

Ampacity tables and derating factors are **standards data, not something to
derive from first principles.** Take them from a citable published source and
put the citation in the code beside the table.

Do not interpolate between tabulated sizes, do not invent a formula that
approximates the table, and do not carry a number you cannot attribute. If the
project's engineer supplies the table, record that as the source.

State the assumed ambient temperature explicitly and make it a document
setting — an ampacity figure without a stated ambient is not a figure.

## Acceptance tests

- a conductor comfortably within its derated ampacity: no finding
- the same conductor in a bundle of 20: finding, where alone it passed — the
  derating is the entire point of the rule
- a conductor with no load stated: no finding, no crash
- margin is reported, and 2% is distinguishable from 200%
- the ampacity table matches its cited source at three or more sizes,
  asserted directly against the published values

## Traps

- Ampacity depends on insulation temperature rating, which lives on the wire
  part. A missing rating is unknown, not a default — decide explicitly what
  the rule does; do not silently assume 80°C.
- Not every conductor in a bundle is current-carrying. Shields and drains
  generally are not. Counting them inflates the derating and produces false
  warnings on exactly the harnesses that were carefully designed.
