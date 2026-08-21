# Phase 1 Review — B1/B2 Assessment and Remaining Blockers

**Reviewer:** Kimi K3  
**Date:** 2026-08-21  
**Status:** 🟡 YELLOW — B1/B2 approved, but B8 discovered; B3+B8 must be fixed together

---

## B1 Assessment: ✅ APPROVED

**Fix:** Applied pan offsets to SVG transform: `translate(${panX}px, ${panY}px) scale(${scale})`

**Verdict:** Correct. Transform order is mathematically sound (CSS applies right-to-left; pan is in screen pixels). Comment explains *why* the order matters. Zoom state is per-pane, view-only, never touches `store.transact`.

**Caveat:** Running-app verification not performed (cannot launch Electron from environment). Needs human check: at 200% zoom, click a node, zoom in/out — point under cursor should stay under cursor.

---

## B2 Assessment: ✅ APPROVED

**Fix:** Extracted `clientPointToCanvas` helper to `packages/render/src/zoomGeometry.ts`, divides by scale.

**Verdict:** Correct. Extraction to `render` is the right choice (geometry in render, not app). Helper is robust — reads transformed SVG's own bounding rect, so pan cancels in subtraction and scroll is irrelevant. 5 new tests added; regression test verified (removing `/ scale` causes 4 of 5 tests to fail).

**Caveat:** Running-app verification not performed. Needs human check: at 200% zoom, drag a wire bend — should track cursor exactly.

---

## B8: NEW BLOCKER DISCOVERED (Scroll-offset bug)

**Severity:** Blocker (entangled with B3)

**Problem:** The wheel handler computes anchor point against scroll container's viewport rect but omits `scrollLeft`/`scrollTop`. True relation is:
```
screenX = canvasX·scale + panX − scrollLeft
```

**Result:** Anchor point is wrong by `scroll/scale`. Each zoom step misplaces the anchor by `scroll·(newScale/scale − 1)`.

**Concrete example:** Pan 800px right via drag, then ctrl-wheel 100%→110% — point under cursor jumps 80px per wheel step.

**Two related symptoms:**

1. **B3 manufactures the trigger:** `canvasPan.ts` adds `deltaY` to `scrollTop` on *every* wheel event, including ctrl+wheel pinch. So trackpad pinch simultaneously scrolls and zooms — the pinch gesture itself creates nonzero scroll that breaks the next pinch event's anchor math.

2. **Negative-pan stranding:** Zooming in about a point routinely produces negative pan (e.g., 100%→200% about canvas point (300,200) from pan=0 yields pan=(−300,−200)). Inner div is sized `maxX·scale` and scroll can't go negative, so everything above-left of roughly half viewport becomes *unreachable* — drag-pan can't get there, only zooming back out recovers it.

**Root cause:** Two pan mechanisms (scroll via `useCanvasPan`, translate via zoom state) never reconciled — which the packet explicitly warned about.

**Fix:** B3 and B8 must be fixed together:
1. Make `canvasPan` zoom-aware (mouse wheel zooms, trackpad wheel pans, pinch zooms without double-handling)
2. Add scroll terms to anchor math: `canvasX = (screenX − panX + scrollLeft) / scale`
3. Resolve negative-pan stranding (clamp pan or offset content origin)
4. Extract shared wheel hook (C6) to avoid duplication
5. Fix flat ±10-point zoom step (trackpad pinch emits dozens of small events; current code blows through entire 10–800% range in one gesture)

---

## Remaining Blockers (Prioritized)

| Priority | Blocker | Status | Notes |
|----------|---------|--------|-------|
| 1 | **B3 + B8** | Open | Same code, same session. Entangled. Must fix together. |
| 2 | **B4** | Open | fit-to-view/fit-to-selection wiring (fitToBounds exists, has zero callers) |
| 3 | **B5** | Open | T02 mate rendering/creation (entire contract section absent) |

---

## Concerns (Non-blocking)

| ID | Issue | Status |
|----|-------|--------|
| C1 | `MATE_INCOMPATIBLE` pairing table | ✅ FIXED (tests at mates.test.ts:358–404) |
| C2 | `MATE_GENDER` hermaphroditic | ✅ FIXED (exemption with unvalidated-inference comment) |
| C3 | `sizesMatch` dead code | ✅ FIXED |
| C4 | T03 message doesn't name wire | ✅ FIXED |
| C5 | AWG citation wrong | ✅ FIXED (corrected to ASTM B258) |
| C6 | Duplicated wheel-handler logic | Open (will fix with B3) |
| C7 | Completion doc overclaims | Open (needs correction) |
| C8 | ROADMAP.md unrelated deletions | Open (needs revert) |
| **C9** | DRAG_THRESHOLD semantics wrong | New (non-blocking, fix with B3) |

**Note:** B6 (terminal-to-terminal mates) and B7 (odd AWG sizes) are **already fixed** with real tests (mates.test.ts:166,183 for B6; gauge.test.ts:30 and wireGaugeRule.test.ts:679 for B7).

---

## Running-App Verification

**Do not merge as complete; proceed with a checklist — but run it once, after B3+B8+B4 land.**

The packet names the drag-tracking mismatch "the characteristic bug… no unit test will catch it." This phase already got burned (C7) for marking T04 done with verification boxes unchecked. Repeating that is not acceptable.

**Sequence:**
1. Fix B3+B8+B4
2. One human pass with written checklist:
   - Zoom-about-cursor at 25%, 100%, 400% **both scrolled and unscrolled**
   - Drag node, wire bend, bundle waypoint at each zoom level
   - Trackpad pinch
   - fit-to-view and fit-to-selection
   - C9 case: click a wire at 25% zoom — no bend should appear

---

## What's Actually Fixed (Verified)

✅ B1 — Zoom-about-pointer transform (approved)  
✅ B2 — clientToCanvas scale-aware (approved)  
✅ B6 — Terminal-to-terminal mates union (mates.test.ts:166,183)  
✅ B7 — Odd AWG sizes (gauge.test.ts:30, wireGaugeRule.test.ts:679)  
✅ C1–C5 — All concerns addressed with tests  

---

## What's Still Open

🔴 **B3 + B8** — Input mapping + scroll-offset bug (entangled, must fix together)  
🔴 **B4** — fit-to-view/fit-to-selection wiring  
🔴 **B5** — T02 mate rendering/creation  
🟡 **C6** — Duplicated wheel-handler logic (will fix with B3)  
🟡 **C7** — Completion doc overclaims (needs correction)  
🟡 **C8** — ROADMAP.md unrelated deletions (needs revert)  
🟡 **C9** — DRAG_THRESHOLD semantics (fix with B3)  

---

## Verdict

**Do not merge. Proceed with B3+B8+B4.**

B1 and B2 are individually correct and well-tested. But B8 (verified, with a second unreported symptom) means the "zoom about the pointer" contract is still not actually delivered. B3/B4/B5 remain open contract violations. The sign-off documents still claim otherwise.

**Next step:** Send to @implementer with B3+B8 combined prompt (they're entangled in the same code).

---

**Last updated:** 2026-08-21 (B1/B2 approved, B8 discovered, B3+B8 prioritized)
