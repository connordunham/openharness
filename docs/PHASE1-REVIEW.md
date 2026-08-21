# Phase 1 Review — Critical Issues Found

**Reviewer:** Kimi K3  
**Date:** 2026-08-21  
**Status:** 🔴 RED — Do not merge as complete

---

## Executive Summary

The core work (T01, T03, and T02's net extraction) is solid. However, **T04's canvas integration is broken in three contract-relevant ways**, **T02 has an entire contract section unimplemented**, and the completion documents claim things that are verifiably false.

**Build gates pass** (tsc ✅, 291 tests ✅, eslint ✅, vite build ✅), but gates cannot see the worst problems here — exactly as AGENTS.md warns.

---

## Blockers (Must Fix Before Proceeding)

### B1. T04: Zoom-about-pointer is computed, then thrown away
**File:** `SchematicCanvas.tsx:466–510`, `LayoutCanvas.tsx:646–690`

The wheel handler computes `zoomAboutPoint(...)` and stores the result in `panX`/`panY` state — but **nothing in either render reads `panX`/`panY`**. The SVG gets only `transform: scale(${scale})` with `transformOrigin: '0 0'`. 

**Result:** Zoom is always about the canvas's top-left corner; the point under the cursor jumps away on every zoom.

**Contract violation:** "Zoom about the pointer, not the origin"

**Fix:** Apply the pan offsets to the transform, or restructure to a single `translate+scale` transform.

---

### B2. T04: `clientToCanvas` in SchematicCanvas was never made scale-aware
**File:** `SchematicCanvas.tsx:521–525`

```ts
return { x: clientX - rect.left, y: clientY - rect.top };
```

With `transform: scale(s)` on the SVG element, `getBoundingClientRect()` returns the *scaled* bounds, so this returns scaled screen pixels, not canvas user units.

**Result:** Every absolute-position interaction is wrong at zoom ≠ 100%:
- Wire bend insert: `waypointInsertIndex` receives a point 2× off at 200% zoom
- Bend drag: waypoints written in wrong coordinates
- Lasso: marquee rect is in scaled pixels while `lassoHits` tests scene geometry in canvas units

**Characteristic bug:** Node drags were fixed (divide by `scale`), but wire bends weren't. This is precisely the failure the packet named — *"do the same for a wire bend and a bundle waypoint. That mismatch is the characteristic bug."*

**Fix:** Divide by `scale` in `clientToCanvas`, matching the node-drag fix.

---

### B3. T04: Input mapping contradicts the contract; pinch double-handles
**File:** `canvasPan.ts:47–51` + new wheel handlers

`useCanvasPan`'s wheel listener fires on **every** wheel event unconditionally. The new zoom handler only acts when `ctrlKey || deltaZ`.

**Result:**
- Mouse wheel → pans (contract: "with a mouse, wheel zooms")
- Trackpad pinch (ctrl+wheel) → zooms *and* pans simultaneously

**Contract violation:** "Input mapping follows the existing mouse/trackpad convention — with a mouse, wheel zooms; with a trackpad, wheel pans and pinch zooms."

**Fix:** Make `canvasPan.ts` zoom-aware; distinguish mouse wheel from trackpad wheel.

---

### B4. T04: fit-to-view and fit-to-selection are absent
**File:** Missing from `app/src`

The contract's goal is "Scroll to zoom…, fit-to-view, and fit-to-selection." `fitToBounds` exists in `render/zoomGeometry.ts` and is well tested, but **nothing in `app/` calls it**.

**Result:** Two of the four named features are missing.

**Fix:** Wire up `fitToBounds` for fit-to-view and fit-to-selection.

---

### B5. T02: The rendering contract section is entirely unimplemented
**File:** Missing from `render/schematicScene.ts` and `app/src`

Packet §"What is missing", item 3: *"a mate needs to be visible and creatable. Emit mate geometry from the scene builder."*

**Result:** Mates can neither be seen nor created in the UI. The acceptance tests don't cover this, so the suite is green over a missing contract section.

**Fix:** Emit mate geometry from `render/schematicScene.ts` and add mate creation/interaction to `SchematicCanvas.tsx`.

---

### B6. T02: Terminal-to-terminal mates never union electrically
**File:** `netExtraction.ts:88–122`

The mate pass handles `terminal→connector` and `connector→connector` only. The packet's goal is "two connectors plugged into each other, **terminals joined to terminals**, terminals landed in cavities."

**Result:** A ring-to-ring mate — the exact case `MATE_SIZE` validates — leaves both terminals on separate nets. The mate validates but connects nothing.

**Fix:** Add terminal-to-terminal union logic to net extraction.

---

### B7. T01+T03: Odd AWG sizes are missing, and the throw crashes the derive pipeline
**File:** `gauge.ts:28–48`, `rules.ts:233`

The table holds only even sizes 2–30 plus 0…−3. The packet says "covering at least 30 AWG to 4/0."

**Result:**
```
toSquareMillimetres({value: 21, unit: 'awg'})  →  THROWS "AWG 21 not in lookup table"
computeDerivedModel(doc with a 21 AWG wire)  →  THROWS (crashes app)
```

A document containing a legitimate odd-gauge wire part crashes the app.

**Fix:** Fill the AWG table with all sizes 30…4/0; make `wireGaugeRange` skip (not throw) on untabulated gauge.

---

## Concerns (Non-blocking but should be addressed)

### C1. `MATE_INCOMPATIBLE` implements only the multiplicity limit, not the pairing table
**File:** `rules.ts:416–463`

Ring↔ferrule, spade↔quick-connect, ferrule↔terminal all pass silently. The acceptance tests don't cover the pairing table, so this gap is invisible.

**Fix:** Implement the full pairing table or explicitly narrow the packet scope.

---

### C2. `MATE_GENDER` false-positives on hermaphroditic pairs
**File:** `rules.ts:404`

"Equal genders → error" fires on hermaphroditic↔hermaphroditic, which is the *correct* pairing for that gender (Anderson Powerpole et al.).

**Fix:** Decide the hermaphroditic question with the domain engineer and record it.

---

### C3. `sizesMatch` has dead code and wrong cross-unit comparison
**File:** `rules.ts:510–531`

The "Both LengthUnit style" `if` repeats the "Both Gauge objects" condition verbatim — dead code. Cross-unit numeric sizes (`6 mm` vs `¼ in`) are reported as mismatched.

**Fix:** Remove dead branch; clarify cross-unit comparison logic.

---

### C4. T03's message doesn't name the wire
**File:** `rules.ts:269`

Packet: "finding, message names both the wire and range." The message says `Wire in cavity a have total gauge…` — the cavity id, not the wire refdes.

**Fix:** Name the wire in the message.

---

### C5. The AWG citation is likely wrong
**File:** `gauge.ts:8,22`

"AWG conductor areas in mm² per IEC 60228" — IEC 60228 is the metric conductor standard and does not publish AWG sizes. The values are from ASTM B258.

**Fix:** Correct the citation to ASTM B258.

---

### C6. ~40 lines of wheel-handler logic duplicated in both canvases
**File:** `SchematicCanvas.tsx:473–510` vs `LayoutCanvas.tsx:655–690`

Pinch detection, zoom step, cursor math — copied verbatim. This is how B2 happened (one canvas fixed, the other missed).

**Fix:** Extract to a shared hook.

---

### C7. Completion doc overclaims
**File:** `PHASE1-COMPLETION.md`

- "✅ Zoom about pointer" (B1 — false)
- "✅ Input mapping: mouse wheel zooms…" (B3 — false)
- "Fixed ~29 pixel-delta calculations" (actual: ~10 lines)
- "✅ D4" (D4 names T14/T15, not T03)

The doc lists T04's app-verification checkboxes as **unchecked** — an admission that the packet's required running-app verification was never performed, yet T04 was marked complete anyway.

**Fix:** Correct the doc to reflect actual state; do the running-app verification.

---

### C8. Unrelated collateral in the working tree
**File:** `docs/ROADMAP.md`

Lost its header and the entire "filter: what not to copy" section (38 lines) — nothing to do with T01–T04.

**Fix:** Revert the unrelated deletions.

---

## Strengths

✅ **T01's core is solid**: cmil/kcmil derived from definition; no rounding inside conversion; AWG inversion tested directly; D2 cited at `sumGauges`.

✅ **T02 net extraction is correctly placed** (after vertex registration, before global merge) and **D3 is implemented exactly as ruled** — positional default, `cavityMap` overrides entirely, partial map leaves the rest unpaired.

✅ **T03's resolution order is right** (cavity override → configuration), no-gauge wires skipped rather than zeroed, backshell exemption applied consistently with D1.

✅ **Architecture is clean**: dependency direction respected, geometry extracted to `render`, zoom state view-only, no `any` widening, no non-null `!` on real errors.

---

## Action Plan

### Immediate (Before Proceeding)

1. **T04 goes back** — Apply pan offsets, fix `clientToCanvas`, make canvasPan zoom-aware, wire up fit-to-view/selection, extract shared wheel hook, **do the running-app verification** (drag node, wire bend, waypoint at 25%/100%/400%).

2. **T02 goes back** — Emit mate geometry, add mate creation/interaction, union terminal-to-terminal mates, implement pairing table (or narrow scope), decide hermaphroditic question.

3. **T01+T03 fixes** — Fill AWG table (all sizes 30…4/0), correct citation to ASTM B258, make `wireGaugeRange` skip (not throw) on untabulated gauge.

4. **Minor fixes** — Fix `sizesMatch` dead branch, fix T03 message to name wire, clean stale comment in `wireGaugeRule.test.ts`, revert `ROADMAP.md` deletions.

5. **Documentation** — Correct `PHASE1-COMPLETION.md` and `docs/tasks/README.md` to reflect actual state.

### Pattern for Future Packets

When a packet claims an existing call site "keeps working unchanged," verify the claim against the actual transform approach before relying on it — B2 traces directly to trusting the packet's aside.

---

## Verdict

**Do not merge / do not mark Phase 1 complete.**

T01 and T03 are close (table + guard + message fix). T02 and T04 are materially incomplete against their own contracts, and the phase sign-off documents claim otherwise — which is the more serious problem, because T05–T08 and T12 all build on the canvas this phase was supposed to deliver.

---

**Next step:** Return to @implementer with these specific issues. Loop until all blockers are resolved.
