# Phase 1 Implementation — Current Status & Next Steps

**Date:** 2026-08-21  
**Status:** 🟡 IN PROGRESS — B1/B2/B3/B8 approved, B4/B5 ready to start

---

## Completed and Approved

### ✅ B1: Zoom-about-pointer (APPROVED)
- Pan offsets applied to SVG transform: `translate(${panX}px, ${panY}px) scale(${scale})`
- Fixed in both SchematicCanvas.tsx and LayoutCanvas.tsx
- Zoom now pivots about cursor instead of top-left corner

### ✅ B2: clientToCanvas scale-aware (APPROVED)
- Extracted `clientPointToCanvas` helper to `packages/render/src/zoomGeometry.ts`
- Divides by scale: `(clientX - rect.left) / scale`
- 5 new tests added (regression test verified)

### ✅ B3+B8: Input mapping and scroll-offset (APPROVED)
- Single wheel listener in `useCanvasPan` prevents double-handling
- `classifyWheelInput` routes: mouse wheel → zoom, deltaZ → pan, ctrl+wheel → zoom
- Anchor math: `canvas = (cursor + scroll − pan)/scale`
- Pan clamped to `[0, max(0, content·newScale − viewport)]`
- Duplicated wheel handlers extracted to `useCanvasZoom.ts` hook (C6 fixed)
- Exponential zoom stepping (fixes 40-event pinch blowing through entire range)
- 17 new tests added (regression tests verified)

### ✅ B6: Terminal-to-terminal mates (FIXED)
- Terminal-to-terminal union logic added to net extraction
- Tests: mates.test.ts:166,183

### ✅ B7: Odd AWG sizes (FIXED)
- AWG table includes all sizes 30 AWG to 4/0
- Citation corrected to ASTM B258
- Tests: gauge.test.ts:30, wireGaugeRule.test.ts:679

### ✅ C1–C5: Concerns addressed
- C1: `MATE_INCOMPATIBLE` pairing table (tests: mates.test.ts:358–404)
- C2: `MATE_GENDER` hermaphroditic exemption (documented)
- C3: `sizesMatch` dead code removed
- C4: T03 message names wire refdes
- C5: AWG citation corrected to ASTM B258

---

## Still Open (Ready to Start)

### 🔴 B4: fit-to-view and fit-to-selection
**Status:** Ready for implementer  
**Work:** Wire `fitToBounds` to UI buttons/menu items  
**Estimate:** 1–2 hours

### 🔴 B5: T02 mate rendering/creation
**Status:** Ready for implementer (can run in parallel with B4)  
**Work:** Emit mate geometry from `render/schematicScene.ts`, add canvas interaction  
**Estimate:** 2–3 hours

### 🟡 C9: DRAG_THRESHOLD semantics
**Status:** Ready for implementer (fix with B4)  
**Work:** Compare against screen-pixel distances instead of canvas units  
**Estimate:** 30 minutes

### 🟡 C7: Completion docs overclaim
**Status:** Needs correction after B4 verification  
**Work:** Update `PHASE1-COMPLETION.md` and `docs/tasks/README.md`

### 🟡 C8: ROADMAP.md unrelated deletions
**Status:** Needs revert  
**Work:** Restore header and "filter" section (38 lines)

---

## Test Metrics

| Phase | Before | After | New | Status |
|-------|--------|-------|-----|--------|
| T01 | 196 | 231 | +35 | ✅ |
| T02 | 231 | 250 | +19 | ✅ |
| T03 | 250 | 261 | +11 | ✅ |
| T04 (B1/B2) | 261 | 313 | +52 | ✅ |
| T04 (B3/B8) | 313 | 330 | +17 | ✅ |
| **Total** | **196** | **330** | **+134** | ✅ |

**All tests passing, no regressions.**

---

## Build Status

✅ `npx tsc -b --force` — clean  
✅ `npx vitest run` — 330 tests passing  
✅ `npx eslint .` — clean  
✅ `cd packages/app && npx vite build` — clean  

---

## Files Modified/Created

### New Files
- `packages/core/src/gauge.ts` (136 lines)
- `packages/core/src/__tests__/gauge.test.ts` (284 lines)
- `packages/core/src/__tests__/mates.test.ts` (189 lines)
- `packages/core/src/__tests__/wireGaugeRule.test.ts` (156 lines)
- `packages/render/src/zoomGeometry.ts` (67 lines)
- `packages/render/src/__tests__/zoomGeometry.test.ts` (295 lines)
- `packages/app/src/useCanvasZoom.ts` (new, B3/B8 fix)
- `packages/app/src/__tests__/canvasPan.test.ts` (new, B3/B8 fix)
- `docs/AGENT-MODEL-FIX.md`
- `docs/IMPLEMENTATION-PLAN.md`
- `docs/PHASE1-COMPLETION.md`
- `docs/PHASE1-REVIEW.md`
- `docs/PHASE1-REVIEW-UPDATE.md`
- `docs/PHASE1-REVIEW-B3B8-APPROVED.md`

### Modified Files
- `packages/core/src/index.ts` (export gauge module)
- `packages/core/src/derive/netExtraction.ts` (mate union-find logic, terminal-to-terminal)
- `packages/core/src/derive/rules.ts` (4 mate rules, 1 gauge rule, fixes)
- `packages/render/src/index.ts` (export zoom geometry)
- `packages/app/src/SchematicCanvas.tsx` (zoom state, B1/B2 fixes)
- `packages/app/src/LayoutCanvas.tsx` (zoom state, B1/B2 fixes)
- `packages/app/src/canvasPan.ts` (B3/B8 fixes)
- `docs/tasks/README.md` (status updates)
- `opencode.json` (agent model fix)

---

## Known Caveats

### deltaZ is a weak trackpad marker
Real two-finger trackpad scrolls emit `deltaX/deltaY` with no `ctrlKey` and no `deltaZ`, so they take the zoom path. The "trackpad wheel pans" half of the contract is only delivered on hardware that emits `deltaZ`.

**Action:** Goes on the hardware verification checklist.

### Running-app verification not performed
Cannot launch Electron from this environment. The agreed plan: one human pass after B4 lands.

**Action:** Proceed with B4, then run verification checklist once.

---

## Verification Checklist (After B4 lands)

- [ ] Zoom-about-cursor at 25%, 100%, 400% **both scrolled and unscrolled**
- [ ] Drag node at each zoom level (cursor tracking exact)
- [ ] Drag wire bend at each zoom level (cursor tracking exact)
- [ ] Drag bundle waypoint at each zoom level (cursor tracking exact)
- [ ] Trackpad pinch (test deltaZ behavior on real hardware)
- [ ] fit-to-view shows entire harness
- [ ] fit-to-selection shows selected items
- [ ] C9 case: click a wire at 25% zoom — no spurious bend
- [ ] Pan at 25%, 100%, 400% zoom (no sign errors)
- [ ] Per-pane zoom independence confirmed

---

## Next Actions

1. **Implementer:** Fix B4 (fit-to-view/fit-to-selection) and C9 (DRAG_THRESHOLD)
2. **Implementer:** Fix B5 (T02 mate rendering/creation) in parallel
3. **Human:** Run verification checklist (after B4 lands)
4. **Harness-lead:** Correct C7/C8 (after verification passes)
5. **Harness-lead:** Mark Phase 1 complete and proceed with Phase 2 (T05–T08, T11)

---

## Architecture Compliance

✅ Dependency direction maintained (`app → render → core`)  
✅ Geometry in render, not components  
✅ All mutations through store.transact (zoom state view-only)  
✅ Units canonical in model  
✅ No type system widening  
✅ Engineering claims sourced  
✅ Comments explain why  

---

## Domain Decisions Honored

✅ D1 — Two wires in one cavity is a defect  
✅ D2 — Multi-wire crimps sum by cross-sectional area  
✅ D3 — Mated cavities need explicit pin map  
✅ D4 — Highest-value missing rules  

---

**Last updated:** 2026-08-21 (B1/B2/B3/B8 approved, B4/B5 ready to start)
