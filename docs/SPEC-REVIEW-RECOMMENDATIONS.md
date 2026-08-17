# Review of HARNESS-DESIGNER-SPEC.md — Recommendations

Version 0.2 · 2026-08-14 · Author: Claude, reviewing its own spec

This is a self-review of `HARNESS-DESIGNER-SPEC.md`, kept as a **separate document** so the
spec itself stays a clean build target and this stays a punch list. Each item has an ID, a
severity, and a concrete next step. Severities: **BLOCKER** (spec is wrong or unsafe to
build from as written), **HIGH** (should be resolved before Phase 1 starts), **MEDIUM**
(resolve during the relevant phase), **LOW** (nice-to-have / polish).

This revision reflects the kitchen-sink fixture (`_kitchen_sink_export.json`) built and
exported since the previous pass, and the corrections it forced into the spec (§16 of the
spec's changelog). Where a recommendation below is now satisfied or partially satisfied by
that evidence, it says so explicitly rather than being silently dropped.

---

## Evidence quality

**R1 — Evidence base was thin; partially resolved.** [was BLOCKER → now MEDIUM]

The spec was originally built from a single real document exercising a narrow subset of
entity types (wires, connectors, twisted wires, a splice, a resistor). Since then, a
purpose-built "kitchen sink" document was created and exported, adding direct evidence for
**cables + shield, coverings, terminals, notes, and branch points** — five entity types
that were previously inferred, not observed. Two of those (coverings, cable/shield) turned
out to be modeled wrong in the first pass and are now corrected (spec §16).

Still not covered by any export: diodes, splices with real wiring (the kitchen sink has no
splice), resistors, multi-configuration connector parts in practice (only the field editor
was seen, not an exported instance with a non-default configuration selected), twisted
wires combined with the new entity types, and bundles with an authored length. Downgrading
to MEDIUM rather than closing outright — the highest-risk unknowns (coverings, shield) are
now resolved; what's left is lower-risk gap-filling. Recommend one more short fixture pass
before Phase 1 if time allows: add a diode, a splice with two wires, and a bundle with an
explicit `length`, and export again. Each is a five-minute addition to the existing
`gpVj` document.

**R2 — No negative-space testing.** [HIGH, unchanged]

Every observation so far is "what does a valid action produce." Nothing tests what the app
rejects: connecting two cavities that are already connected, deleting a connector that has
wires attached, assigning a part with fewer cavities than the instance has, exceeding a
covering's diameter range. The clone's validation rules (spec §6.5) are informed by
plausible engineering concerns, not by matching the original's actual guardrails. Low cost
to test a handful of these before Phase 1; cheap insurance against building a rule set that
disagrees with user expectations formed on the original tool.

**R3 — Variants/configurable harnesses is a real open question, not a settled non-goal.**
[HIGH, unchanged]

The spec lists this as a v1 non-goal but flags it explicitly as "large enough that shipping
v1 without it and retrofitting later is close to a rewrite." That's the right instinct, but
it's currently sitting in a non-goals list, which reads as decided when it isn't. Recommend
converting this into an actual ADR before Phase 1: either commit to "no variants in v1,
retrofit accepted as a cost" or spend a day sketching how a `variant` axis would thread
through `components`/`wires`/`bom` and confirm the core model doesn't foreclose it. Either
answer is fine; leaving it implicit is not.

---

## Missing or under-specified domain concepts

**R4 — Cable/shield model: now corrected, verify the DRC rules against it.** [was HIGH →
now LOW, follow-up only]

The original inferred shape (`{kind, drainWireId, terminations[]}`) is gone; the real shape
(`{id, color: "Shield"}`, structurally identical to a core) is now in the spec (§4.2, §4.4).
This actually simplifies two of the DRC rules (`SHIELD_MULTI_GROUND`, `SHIELD_UNGROUNDED`)
since they now just inspect wires on the shield handle instead of dedicated fields. Remaining
follow-up: confirm those two rules still make sense given that a shield with **zero** wires
attached is indistinguishable, in the current model, from "shield intentionally left
floating" vs. "shield not yet wired" — both produce the same `SHIELD_UNGROUNDED` warning.
Low severity because it's a UX nuance, not a data-model gap.

**R5 — Termination/crimp detail: now specified.** [was HIGH → now satisfied, verify only]

`WireEnd` (spec §4.3) covers strip length, terminal/seal part references, treatment, and
crimp height, and `GAUGE_TERMINAL_MISMATCH` (§6.5) uses it. This was speculative in v0.1;
it remains speculative now too — no termination detail was directly observed in either
export, since neither fixture's wires had strip-length or crimp data populated. Keep this
flagged as inferred (spec §14 doesn't currently list it — recommend adding it there) until a
future pass opens a wire's own detail panel, if the UI has one, to confirm the field set.

**R6 — Splice kinds still unconfirmed.** [MEDIUM, unchanged]

`Splice.spliceKind` (crimp/weld/solderSleeve) remains a guess; the kitchen-sink pass didn't
add a splice at all. This affects BOM (a solder sleeve is a purchasable part, a plain crimp
splice may not be) and a manufacturing DRC rule that doesn't exist yet. Low effort to check:
add one splice to the fixture document next time it's opened, right-click it, and see
whether a "type" or "kind" property surfaces anywhere (context menu, part assignment, or
a properties panel not yet found).

**R7 — Connector keying/coding not modeled beyond a single string field.** [MEDIUM,
unchanged]

`ConnectorPart.keying?: string` is a placeholder. Real keying (Molex A/B/C, Deutsch color
codes, TE positions) is usually a small closed enum per manufacturer family, and the
`MATE_CHECK` automation idea in the spec (§8.8 item 7) depends on it being structured enough
to compare. Recommend deferring real design here until the connector-mating automation is
actually being built (Phase 5+) rather than guessing now — but keep the field as a string
today so nothing is blocked.

**R8 — Bundle diameter/fill is a formula, not a verified behavior.** [LOW, unchanged]

The `1.15·√(Σd²)` circle-packing approximation in spec §6.5 is a reasonable industry
heuristic but was never checked against anything the original tool actually computes or
displays — no bundle-diameter number was observed anywhere in either export or in the UI.
It's fine as a v1 estimate as long as the rule message says so (spec already does this).
No action needed beyond what's already written.

---

## Architecture risks

**R9 — Derived-model recompute strategy will not scale past pilot size.** [HIGH, unchanged]

Spec §5.3 says the whole `derived` model recomputes on every transaction. Fine for tens of
wires; a 500-wire harness recomputing net extraction, routing, BOM and every DRC rule on
every keystroke-adjacent edit will visibly lag. The spec's Phase 7 "performance pass against
the 500-wire/16ms budget" is the right target but arrives too late to be cheap to fix.
Recommend: design the invalidation story (which `derived` slices a given patch can possibly
affect) during Phase 1, even if the naive full-recompute is what actually ships in Phase 1-3.
Getting the `reads: (keyof DerivedModel)[]` declaration on rules (already in the spec) is a
good start — extend the same declared-dependency idea to bundle/net/route recomputation
itself, not just to rules consuming it.

**R10 — Namespaced `custom` fields need a collision policy.** [MEDIUM, unchanged]

Every entity has `custom: Record<string, unknown>` for automations to write into. With
multiple automations installed, two of them writing `custom.status` will silently clobber
each other. Recommend namespacing by automation id at write time (`custom['awg-from-current'].status`)
enforced by the host, not left to convention — a one-line change to the store's patch
validator now avoids a real bug later.

**R11 — Directory file format solves git merges but changes autosave/atomicity.** [MEDIUM,
unchanged]

Spec §10 correctly identifies that a single-file `.ohd` merges badly and proposes a
directory format instead (one file per entity). That fixes merge conflicts but reopens the
atomic-write question the spec solved for the single-file case (temp+rename) — a crash
mid-save now can leave the directory in a torn state (some entity files updated, others
not). Recommend: write new/changed entity files to a temp subdirectory, then do a single
directory-level rename, or maintain a small manifest file with a hash of the directory
state that `openharness doctor` can use to detect torn saves. This should be designed
alongside the directory format itself in Phase 1, not bolted on later.

**R12 — Splice-host circularity: the spec's fallback needs a test, not just an algorithm.**
[MEDIUM, downgraded from HIGH — the spec now has a concrete termination rule]

Spec §6.2 defines `layoutHost` for an unplaced splice recursively via its neighbors, with an
explicit visited-set to terminate chains. That's the right shape, and closes what was a
genuine gap in v0.1 (which didn't specify termination at all). What's still missing is a
test case: two chained unplaced splices, each resolving through the other, feeding into a
placed component on one side only. Recommend this specific topology as one of the golden
fixtures in Phase 1's test suite (spec §13) rather than trusting the algorithm's correctness
on inspection alone — recursive host-resolution with a visited-set is exactly the kind of
logic that's right in the simple case and wrong in the two-hop case.

**R13 — Formboard precedence rule is stated but not tested against real geometry drift.**
[LOW, unchanged]

Spec §6.3 says authored length wins over formboard geometry, with a mismatch warning at some
tolerance. The tolerance value itself isn't specified anywhere. Recommend picking a concrete
default (e.g., 5% or 10mm, whichever is larger) and documenting it in §6.3 rather than
leaving "tolerance" as an unbound symbol — small thing, easy to fix now, easy to forget
later.

**R14 — Fixed-point length storage: implemented, needs a conversion-boundary test.** [was
MEDIUM → now LOW, verify only]

Spec §6.3 now specifies integer micrometres internally with conversion only at UI/export
boundaries, and explains why (floating-point drift breaks golden-file tests). This is
resolved as a design decision; recommend one specific unit test asserting that a
round-trip through every supported `lengthUnit` (mm/cm/m/in/ft) and back to micrometres is
lossless for a representative set of values, since inch/foot conversions are where rounding
bugs actually tend to hide.

**R15 — Browser-primary persistence (File System Access API) is Chromium-only; this
contradicts "runs fully offline" as a cross-platform goal.** [HIGH, unchanged]

Spec §5.2 lists File System Access API as the browser persistence path, with Electron/
Tauri/Node `fs` for desktop. FSA API has no Safari or Firefox support as of this review.
Given the project's actual usage pattern — one user, wants git-friendly local files, wants
automations with real filesystem/network access for things like part-number lookups — a
browser-primary architecture with a native fallback bolted on for missing features is
probably backwards. Recommend deciding Tauri-primary (or Electron-primary) now: it gets you
unrestricted filesystem access, a real background process for the MCP server and automation
worker host, and no browser-compatibility matrix to maintain, at the cost of a native
install instead of "open a URL." Given automations are the entire point of this project
(§1.1), the native-app trade-off is very likely correct. This is one of the three decisions
the spec's Phase 12 section already flags as "cheap to decide now, expensive to reverse
later" — treat it as such.

**R16 — Undo coalescing rule is now concrete; the 400ms/target-match logic needs a boundary
case documented.** [was MEDIUM → now LOW]

Spec §10 now specifies both a time window (400ms) and a same-primary-target requirement,
and explicitly excludes coalescing across a selection change. That's a well-specified rule.
One boundary case worth writing down before Phase 1 rather than discovering during
implementation: dragging a component while a rule's `fix` action fires in the background
(e.g., an autosave-triggered DRC re-run) — does that count as an intervening transaction
that breaks coalescing? Recommend explicitly excluding automation-originated and
system-originated transactions from breaking a human-originated coalescing streak.

---

## Sequencing and scope

**R17 — Automation core has moved to Phase 1; this is correct and should not slip back.**
[was BLOCKER → now resolved, tracking only]

The build plan (spec §12) now places the event bus, command registry, and rule registry in
Phase 1, and moves the full automation host + MCP server to Phase 5, ahead of exports
(Phase 6) and polish (Phase 7). This directly addresses the original BLOCKER-severity
concern that automation — the actual point of the project per §1.1 — was sequenced dead
last. No further change needed; flagging only so this doesn't quietly regress during
estimation pressure later, since "automation" is exactly the kind of phase that looks
cuttable to make a deadline and shouldn't be.

**R18 — Write-consent story for automations exists at the manifest level; runtime
confirmation UX is still unspecified.** [MEDIUM, downgraded from HIGH]

Spec §8.2 now has scoped permissions (`write:wires` vs `write:components` vs `write:parts`
vs `write:meta`) instead of one blanket `write:document`, plus an install-time warning for
`net` + any `write:*` combination, and §8.3's example shows a `dryRun` pattern with a
`ctx.ui.confirm(...)` gate before applying. That's a solid foundation. What's still open:
whether *every* automation-originated write requires a per-run confirmation, or only
first-run-after-install, or only writes above some size threshold. Recommend a simple
default — first run of a newly installed automation requires explicit confirmation of its
declared scopes; subsequent runs proceed silently unless the automation itself calls
`ctx.ui.confirm` (as the example does) — and revisit after Phase 5 usage shows whether that's
too permissive.

**R19 — Part editor auto-generation: the spec already recommends deferring it; agree and
narrow the scope further.** [LOW, was MEDIUM]

Spec §7.5 already suggests hand-writing the ~8 part forms in v1 rather than building a schema-
driven generator, noting only two part kinds (`ConnectorPart`, `CoveringPart`) are actually
confirmed against real editors. Agree with this and go one step further: build only the two
confirmed forms plus `WirePart` (needed immediately for the ampacity automation in §8.8) in
Phase 4, and stub the remaining five kinds as a single generic key-value form until each is
individually confirmed or needed by a specific automation. Building five speculative forms
now is wasted effort if even one of them turns out shaped wrong, same as the covering model
did.

**R20 — PDF export path (`svg-to-pdfkit`) is unproven at real-world scale; prototype early
as the spec now suggests.** [MEDIUM, unchanged]

Spec §5.2 and §12 (Phase 6) both flag this — the SVG-to-PDF path is chosen for good reasons
but has known rough edges (font embedding, non-Latin text) that could resurface as an
underestimated phase. The spec's own suggestion to "prototype `svg-to-pdfkit` early" in
Phase 6 is good but Phase 6 is 3-4 phases away. Recommend pulling a one-day spike — render
one saved schematic fixture to PDF via the actual proposed library — into Phase 1 or 2, not
because the phase order needs to change, but because a redesign of the export path is far
cheaper to absorb before Phases 2-3 build UI that assumes it works.

**R21 — Estimate (~20-27 weeks) is wide but now stated as such; no action needed beyond
tracking against Phase 1 velocity.** [LOW, was MEDIUM]

Spec §12 states the ±50% band explicitly rather than presenting a false-precision single
number, and calls out the three decisions (variants, file format, Tauri-vs-browser) that
should be locked before the estimate can tighten. Reasonable as written. Recommend
recording actual Phase 1 duration against the 3-4 week estimate once it's done, since Phase
1 is the best available calibration point for the other six phases.

---

## Interoperability

**R22 — WireViz export: still the best value-for-effort addition, now correctly placed as
an export rather than an automation.** [LOW, unchanged]

Spec §9 lists WireViz YAML as an export alongside the native formats, which is the right
home for it (a static format conversion, no document mutation, no reason to route it through
the automation host). Still worth doing early because WireViz has its own test corpus of
real harness files that would make good additional golden fixtures beyond the two captured
in this project — recommend importing a couple of WireViz examples as read-only round-trip
tests even before the exporter itself is built, purely as extra schema-validation signal.

**R23 — KBL/VEC formats: no change, still correctly deferred.** [LOW, unchanged]

Not mentioned in the spec at all, which is fine — these are heavier enterprise interchange
formats with no evidence anyone downstream of this project needs them. No action.

**R24 — Netlist import (KiCad/Altium) correctly moved into core.** [was HIGH → resolved,
tracking only]

Spec §8.6 and §12 (Phase 1) now place the KiCad/CSV netlist importer in
`@openharness/io` as a Phase 1 deliverable, with the opinionated matching/merging logic
explicitly left as a Phase 5+ automation on top of it. This matches the original
recommendation exactly (mechanical import as core plumbing, judgment calls as an
automation). No further action.

---

## Process / quality

**R25 — No non-functional requirements section.** [MEDIUM, unchanged]

The spec has a testing strategy (§13) and one concrete performance target (500 wires / 16ms,
Phase 7) but no consolidated NFR list: target document size ceiling, startup time budget,
memory ceiling for the derived-model cache, offline-storage size limits. Recommend adding a
short NFR table to spec §1 or §13 before Phase 1 — even rough numbers ("comfortable to
1,000 wires, degrades gracefully to 5,000") give the architecture decisions in R9 and R15 a
concrete target to design against instead of an implicit one.

**R26 — Fuzzer testing is now in the spec; good, keep it in Phase 1's definition of done.**
[was MEDIUM → resolved, tracking only]

Spec §13 now includes a seeded fuzzer generating random valid harnesses and asserting core
invariants (derive never throws, every wire has exactly one status, non-negative BOM
quantities, round-trip stability). This was a specific ask in the previous review and is now
concretely scoped at "~200 lines." Recommend treating it as part of Phase 1's exit criteria,
not an optional add-on, since it's cheapest to write while `core` is still small enough to
fuzz exhaustively.

**R27 — Provenance/evidence-quality note: now present, and this document extends it.**
[NEW, informational]

The spec's §0 ("How this spec was produced") and §14 ("Things I still could not verify")
are exactly the honesty mechanism the previous review asked for — every claim is tagged
`[observed]` or `[inferred]`, and the unresolved list is specific rather than a vague
disclaimer. This review document inherits the same discipline: every item above that changed
severity says what evidence changed it and what's still open. Recommend keeping both
documents' provenance sections current as future fixture passes close more of §14's list —
they're cheap to maintain and expensive to reconstruct from memory once they drift.

---

## Summary: what actually needs to happen before Phase 1 starts

In priority order, the items that are still open and matter before writing `core` code:

1. **R15** — decide Tauri/Electron-primary vs. browser-primary. Blocks the persistence
   layer design.
2. **R3** — decide variants in/out as an explicit ADR, not an implicit non-goal.
3. **R11** — design the directory-format atomic-write story alongside the format itself.
4. **R9** — design the derived-model invalidation contract even if Phase 1-3 ship the naive
   full recompute.
5. **R25** — write down rough NFR numbers so 1-4 have a concrete target.
6. **R20** — spike the PDF export path early enough to redesign around it if it's wrong.

Everything else in this document is either already resolved by the spec as written, or safe
to resolve during the phase where it becomes relevant.

---

*End of review.*
