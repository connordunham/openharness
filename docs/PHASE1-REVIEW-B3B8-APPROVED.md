# Phase 1 Review — B3+B8 Approved, B4 Ready to Start

**Reviewer:** Kimi K3  
**Date:** 2026-08-21  
**Status:** 🟢 GREEN for B3+B8 — Proceed with B4

---

## B3+B8 Assessment: ✅ APPROVED

**Fixes:**
- Single wheel listener in `useCanvasPan` prevents double-handling
- `classifyWheelInput` routes: mouse wheel → zoom, deltaZ → pan, ctrl+wheel → zoom
- Anchor math: `canvas = (cursor + scroll − pan)/scale`
- Pan clamped to `[0, max(0, content·newScale − viewport)]`; clamped remainder absorbed by scroll
- Duplicated wheel handlers extracted to `useCanvasZoom.ts` hook (C6 fixed)
- Exponential zoom stepping (fixes 40-event pinch blowing through entire range)

**Test count:** 313 → 330 (+17 new tests)
- 12 new in `zoomGeometry.test.ts` (anchor math, scrolled-anchor, negative-pan regressions)
- 5 new in `canvasPan.test.ts` (classification table)

**Build gates:** ✅ tsc clean, ✅ 330 tests passing, ✅ eslint clean, ✅ vite build clean

**Verdict:** Input mapping correct, anchor math correct, entanglement genuinely resolved, tests fail against old behavior.

---

## Caveats (Acceptable, Documented)

### deltaZ is a weak trackpad marker
Real two-finger trackpad scrolls emit `deltaX/deltaY` with no `ctrlKey` and no `deltaZ`, so they take the zoom path. The "trackpad wheel pans" half of the contract is only delivered on hardware that emits `deltaZ`.

**Action:** Goes on the hardware verification checklist. If two-finger scroll zooms on the target machine, need heuristic or contract amendment.

### Running-app verification not performed
Cannot launch Electron from this environment. The agreed plan: one human pass after B3+B8+B4 land.

**Action:** Proceed with B4, then run verification checklist once.

---

## Remaining Open Issues

| Priority | Issue | Status | Action |
|----------|-------|--------|--------|
| 1 | **B4** | Open | Wire `fitToBounds` to fit-to-view/fit-to-selection |
| 2 | **B5** | Open | T02 mate rendering/creation (can run in parallel with B4) |
| 3 | **C9** | Found unfixed | DRAG_THRESHOLD semantics (fix with B4) |
| 4 | **C7** | Open | Correct completion docs |
| 5 | **C8** | Open | Revert ROADMAP.md deletions |

---

## C9: New Issue Found (Non-blocking, Fix with B4)

**Problem:** `DRAG_THRESHOLD` (3) is compared against **canvas-unit** distances at `SchematicCanvas.tsx:1068` and `:1136`. At 25% zoom, 3 canvas units = 0.75 screen px, so a plain click on a wire with 1 px of hand jitter inserts a spurious bend.

**Fix:** Compare against screen-pixel distances instead:
```ts
// Before (wrong at zoom ≠ 100%):
const distance = Math.hypot(dx, dy);
if (distance > DRAG_THRESHOLD) { /* bend */ }

// After (correct at any zoom):
const screenDistance = Math.hypot(dx * scale, dy * scale);
if (screenDistance > DRAG_THRESHOLD) { /* bend */ }
```

**Verification:** At 25% zoom, click a wire — no spurious bend should appear.

---

## Next Steps

1. **B4:** Wire `fitToBounds` to fit-to-view and fit-to-selection (implementer)
2. **C9:** Fix DRAG_THRESHOLD semantics (implementer, same session as B4)
3. **B5:** T02 mate rendering/creation (implementer, can run in parallel)
4. **Verification:** One human pass with checklist (after B4 lands):
   - Zoom-about-cursor at 25%, 100%, 400% **both scrolled and unscrolled**
   - Drag node, wire bend, bundle waypoint at each zoom level
   - Trackpad pinch (test deltaZ behavior on real hardware)
   - fit-to-view and fit-to-selection
   - C9 case: click a wire at 25% zoom — no spurious bend
5. **Documentation:** Correct C7/C8 (after verification passes)

---

## Verdict

**B3+B8 ready to merge.** Proceed with B4 and C9 in the same session, then B5 in parallel.

---

**Last updated:** 2026-08-21 (B3+B8 approved, B4 ready to start)
