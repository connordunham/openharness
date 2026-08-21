# OpenHarness Implementation Plan

**Status as of 2026-08-21** — T01 complete, 15 packets remaining.

This document describes the short, medium, and long-term strategy for completing the OpenHarness feature roadmap. It is the harness-lead's working plan and should be updated after each packet lands.

---

## Executive Summary

**Total work:** 15 packets, estimated 30–40 days of implementation.

**Critical path:** T01 → T02 → T03 → (parallel: T04–T08, T11) → T09 → T10 → T12 → T13 → (pull-forward: T14, T15)

**Key constraints:**
- T01 is genuinely first (three later packets need gauge comparison)
- T04 must come before T12 (formboard is unusable without zoom)
- T14 and T15 are high-value checks; pull forward if time permits
- T13 is last (API should stabilize before automation surface)

---

## SHORT TERM (Next 1–2 weeks)

### Immediate: T02 — Mates (L, 3–4 days)

**What:** Make bulkhead and pass-through connectors expressible. Two connectors plugged into each other, terminals joined to terminals, terminals landed in cavities.

**Why now:**
- Unblocks T03 (wire-gauge-vs-contact validation)
- Model already landed; implementation is well-scoped
- Low execution risk (algorithmic, deterministically testable)
- Small canvas surface (~100 lines for mate creation) limits retrofit cost when T04 lands

**Deliverables:**
1. Net extraction pass (`derive/mates.ts`) — union-find cavity pairing
2. Validation rules (4 new rules in `derive/rules.ts`)
3. Rendering (mate geometry in `render/schematicScene.ts`)
4. Canvas interaction (mate creation in `SchematicCanvas.tsx`)
5. Comprehensive test suite (`core/__tests__/mates.test.ts`)

**Success criteria:**
- All 9 acceptance tests pass
- Build clean (tsc, vitest, eslint, vite build)
- Mate geometry renders correctly
- Mate creation interaction works

**Traps:**
- D3 ruling: positional is default, explicit when stated; partial cavityMap leaves unnamed cavities unpaired (no fallback)
- Mate is not a conductor; must not appear in wires, length, or BOM
- Union-find correctness; must run before signal resolution

---

### Then: T03 — Wire-gauge-vs-contact validation (M, 2–3 days)

**What:** DRC rule that checks whether each wire's gauge falls within its contact's range. Uses `sumGauges` from T01 for multi-wire crimps.

**Why now:**
- Depends only on T01 (complete) and T02 (just finished)
- High-value check; catches real defects
- Straightforward rule implementation (no algorithmic complexity)

**Deliverables:**
1. New rule in `derive/rules.ts` (WIRE_GAUGE_OUT_OF_RANGE)
2. Test suite (`core/__tests__/wireGaugeValidation.test.ts`)

**Success criteria:**
- Rule fires correctly for under/over-gauge wires
- Handles multi-wire crimps via `sumGauges`
- All acceptance tests pass
- Build clean

---

### Parallel: T04 — Zoom (M, 3–5 days)

**What:** Zoom on both canvases (10%–800%, clamped). Scroll to zoom with mouse, pinch on trackpad, fit-to-view, fit-to-selection. Per-pane, not global.

**Why now (after T02):**
- Independent of T02/T03
- Marked "do early" — every later canvas packet is harder without it
- T02's small canvas surface means retrofit cost is minimal
- T12 (formboard) is unusable without zoom

**Deliverables:**
1. Geometry helpers (screen↔canvas conversion, fit-to-bounds, clamping) in `render/` or small `app/` module
2. Zoom state management (per-pane, not persisted)
3. Systematic audit of pixel-delta calculations in both canvases (~29 sites)
4. Unit tests for geometry helpers
5. App verification (manual testing at 25%, 100%, 400% zoom)

**Success criteria:**
- Zoom range 10%–800%, clamped
- Zoom about pointer (not origin)
- Per-pane zoom independent
- Drag a node while zoomed; confirm it tracks cursor exactly
- Panning while zoomed works at extreme zoom levels
- Build clean

**Traps:**
- ~29 pixel-delta sites across both canvases; easy to miss one
- Sign errors in zoom-about-pointer math (especially at 25% and 400%)
- Fit-to-selection on point-like item needs sensible default (not division by zero)
- Requires running app to verify; unit tests cannot catch rendering bugs

---

### Parallel: T05–T08, T11 (Independent, can start anytime)

These packets are independent of each other and of T02–T04:
- **T05** — Schematic ergonomics (M, 2–3 days)
- **T06** — View toggles and selection info (M, 2–3 days)
- **T07** — Search and destinations (L, 2–3 days; after T06)
- **T08** — Groups and device convention (M, 2–3 days)
- **T11** — Local parts library (L, 2–3 days)

**Recommendation:** Do T04 first (it unblocks T12), then T05–T08 in any order, then T11.

---

## MEDIUM TERM (Weeks 2–3)

### T09 — PDF export (L, 2–3 days)

**What:** Export harness to PDF. Establishes page model that T10 shares.

**Why now:**
- Depends on nothing; can start after T04 if desired
- Must come before T10 (shares page model)
- Moderate complexity; good checkpoint

**Deliverables:**
1. Page model (layout, margins, page breaks)
2. PDF rendering (via existing export infrastructure)
3. Test suite

---

### T10 — XLSX wiring table (M, 2–3 days)

**What:** Export wiring table to Excel. Uses page model from T09.

**Why now:**
- Depends on T09 (just finished)
- Straightforward export; low risk

---

### T12 — Formboard (XL, 5–7 days)

**What:** 3D formboard view. Wires laid out on a board, bundle geometry, bend radius visualization.

**Why now:**
- Depends on T04 (zoom, just finished)
- Largest packet; needs full attention
- Unblocks T15 (bend radius rule needs formboard geometry)

**Deliverables:**
1. 3D scene builder (`render/formboardScene.ts`)
2. Canvas component (`LayoutCanvas.tsx` extension or new)
3. Interaction (drag wires, adjust bundle geometry)
4. Bundle diameter derivation
5. Bend radius visualization
6. Test suite

**Traps:**
- Largest packet in the roadmap; needs careful scoping
- 3D geometry is complex; needs thorough testing
- Bundle diameter affects T14 (current capacity) and T15 (bend radius)

---

## LONG TERM (Week 4+)

### T13 — Automation surface (L, 2–3 days)

**What:** API for automation. Scripting interface, batch operations, headless mode.

**Why last:**
- Depends on everything else (API should stabilize first)
- Lowest priority; nice-to-have for power users

---

### T14 — Current capacity with bundle derating (L, 2–3 days)

**What:** DRC rule: current capacity vs gauge, derated for bundling. Needs load model.

**Why pull-forward candidate:**
- High-value check (D4 ruling)
- Depends on T01 (complete) and bundle diameter from T12
- Can start after T12 lands

**Deliverables:**
1. Load model (current, ambient temperature, derating factor)
2. New rule in `derive/rules.ts` (CURRENT_CAPACITY_EXCEEDED)
3. Test suite

---

### T15 — Bend radius (M, 2–3 days)

**What:** DRC rule: minimum bend radius against bundle diameter.

**Why pull-forward candidate:**
- High-value check (D4 ruling)
- Depends on nothing (no hard dependencies)
- Can start anytime; fully meaningful after T12 (formboard gives real geometry)

**Deliverables:**
1. New rule in `derive/rules.ts` (BEND_RADIUS_EXCEEDED)
2. Test suite

---

## Dependency Graph (Visual)

```
T01 (gauge) ✅
  ├─ T02 (mates) → T03 (wire-gauge validation)
  └─ T03 (wire-gauge validation)

T04 (zoom) → T12 (formboard) → T14 (current capacity), T15 (bend radius)

T05 (schematic ergonomics) — independent
T06 (view toggles) → T07 (search)
T08 (groups) — independent
T09 (PDF export) → T10 (XLSX wiring table)
T11 (parts library) — independent

T13 (automation surface) — last (depends on everything)
```

---

## Sequencing Strategy

### Phase 1: Foundation (T01–T03)
- **T01** ✅ Complete
- **T02** → Scout → Implement → Review → Verify (3–4 days)
- **T03** → Scout → Implement → Review (2–3 days)

**Outcome:** Gauge conversion and mate support complete. Wire-gauge validation in place.

### Phase 2: Canvas & UI (T04–T08, T11)
- **T04** (zoom) — critical path, unblocks T12
- **T05–T08** (ergonomics, toggles, search, groups) — parallel, any order
- **T11** (parts library) — independent

**Outcome:** Canvas is zoomable. UI is more ergonomic. Parts library available.

### Phase 3: Export & Formboard (T09–T12)
- **T09** (PDF export) → **T10** (XLSX wiring table)
- **T12** (formboard) — largest packet, needs full attention

**Outcome:** Export capabilities complete. 3D formboard view available.

### Phase 4: Rules & Automation (T13–T15)
- **T14** (current capacity) — after T12 (needs bundle diameter)
- **T15** (bend radius) — can start anytime; fully meaningful after T12
- **T13** (automation surface) — last

**Outcome:** High-value DRC rules in place. Automation API available.

---

## Risk & Mitigation

| Risk | Mitigation |
|---|---|
| T02 mate rendering breaks existing canvas | Small surface (~100 lines); review carefully; test in running app |
| T04 zoom has sign errors at extreme scales | Test at 25%, 100%, 400%; panning-while-zoomed is the characteristic bug |
| T12 formboard is too large to finish | Break into sub-tasks; extract geometry helpers first; test incrementally |
| T14 current capacity needs load model not yet designed | Coordinate with Connor; may need design ruling before implementation |
| T15 bend radius needs formboard geometry | Depends on T12; can start after T12 lands |

---

## Success Metrics

**Per packet:**
- All acceptance tests pass
- Build clean (tsc, vitest, eslint, vite build)
- Reviewer finds no blockers
- Verifier (for UI packets) confirms interaction works

**Overall:**
- 15 packets complete
- Test count increases from 231 to ~350+ (estimated)
- No regressions in existing functionality
- All DRC rules fire correctly
- Export and automation surfaces work

---

## Timeline Estimate

| Phase | Packets | Duration | Cumulative |
|---|---|---|---|
| Foundation | T01–T03 | 5–7 days | 5–7 days |
| Canvas & UI | T04–T08, T11 | 12–16 days | 17–23 days |
| Export & Formboard | T09–T12 | 10–13 days | 27–36 days |
| Rules & Automation | T13–T15 | 6–8 days | 33–44 days |

**Total: 33–44 days** (4–6 weeks of implementation)

---

## Next Steps

1. **Scout T02** — Map files, types, call sites
2. **Implement T02** — Net extraction, rules, rendering, tests
3. **Review T02** — Verify correctness, no regressions
4. **Verify T02** — Test mate creation in running app
5. **Update this plan** — Mark T02 complete, adjust timeline if needed
6. **Proceed to T03** — Repeat cycle

---

## Notes for Connor

- **T02 is the next critical path item.** It unblocks T03 and has low execution risk.
- **T04 (zoom) is marked "do early" for good reason.** Every later canvas packet is harder without it. Recommend doing it right after T02.
- **T12 (formboard) is the largest packet.** It may need to be broken into sub-tasks or extended timeline.
- **T14 and T15 are high-value checks** (D4 ruling). If time permits, pull them forward after T12.
- **T13 (automation surface) is last.** The API should stabilize before exposing it.

---

**Last updated:** 2026-08-21 (T01 complete, T02 ready to scout)
