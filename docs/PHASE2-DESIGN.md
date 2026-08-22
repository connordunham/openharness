# Phase 2: Cable Bundle Routing — Design & Implementation Plan

**Date:** 2026-08-21  
**Status:** Design phase  
**Priority:** High (UX-critical path)

---

## Vision Recap

Transform the layout canvas from a static routing tool into a **drag-and-drop-friendly cable management interface** where:

1. **Automatic bundling** — Wires are grouped into bundles by proximity/routing path
2. **Bundle-level routing** — Drag bundles as single units through the layout
3. **Branch separation** — Extract individual wires from bundles when needed
4. **Connector orientation** — Rotate connectors to optimize routing
5. **Intuitive interaction** — Everything feels like dragging objects on a canvas, not editing data

---

## Design Questions (Awaiting Your Input)

Before implementation, I need your feedback on these UX decisions:

### 1. Bundle Visualization
**How should bundles look on the canvas?**

Options:
- **A) Thicker lines** — Bundle rendered as a single thick line, individual wires hidden inside
- **B) Colored outline** — Individual wires visible, bundle outlined in a distinct color
- **C) Shaded region** — Wires visible, semi-transparent shaded area around them
- **D) Hybrid** — Show bundle outline when selected, individual wires otherwise

**Recommendation:** Option B or D (shows individual wires for debugging, but clear bundle grouping)

**Your preference?**

---

### 2. Drag Interaction
**What's the primary interaction for moving bundles?**

Options:
- **A) Drag bundle center** — Click anywhere on the bundle, drag to move whole bundle
- **B) Drag bundle edge** — Drag the bundle outline to move; drag individual wire to extract
- **C) Drag wire inside bundle** — Drag a wire inside bundle to extract; drag bundle outline to move
- **D) Context menu** — Right-click bundle → Move, Extract wire, etc.

**Recommendation:** Option A (simplest, most intuitive)

**Your preference?**

---

### 3. Connector Orientation
**How should users rotate connectors?**

Options:
- **A) Right-click menu** — Right-click connector → Rotate 90°, Rotate 180°, etc.
- **B) Drag handle** — Connector has a rotation handle (arrow), drag to rotate
- **C) Keyboard shortcut** — Select connector, press R to rotate
- **D) Auto-rotate button** — Button that auto-optimizes connector orientation

**Recommendation:** Option B (visual, immediate feedback) + Option D (auto-optimize)

**Your preference?**

---

### 4. Automatic Bundling
**When should bundling happen?**

Options:
- **A) On import** — Detect wires that should be bundled when loading a document
- **B) On-demand** — User selects wires, clicks "Group" button
- **C) Continuous** — Auto-group as user routes (wires within N pixels auto-bundle)
- **D) Hybrid** — On import + on-demand + continuous

**Recommendation:** Option D (all three, user has full control)

**Your preference?**

---

### 5. Broken Interactions (Current State)
**What specific UX problems are you seeing now?**

Examples:
- Waypoint editing is tedious (too many clicks)?
- No visual feedback on routing (hard to see what's connected)?
- Connector placement is hard (manual positioning)?
- Bundle diameter not visible (hard to plan space)?
- Something else?

**Please describe the top 3 pain points.**

---

## Proposed Implementation Phases

### Phase 2a: Bundle Visualization & Interaction (3–5 days)
**Goal:** Bundles are visible and draggable

**Deliverables:**
1. Bundle model extension (add to existing `Bundle` type)
2. Bundle rendering (scene builder emits bundle geometry)
3. Bundle drag interaction (move whole bundle)
4. Visual feedback (highlight on hover, selection state)
5. Tests (bundle rendering, drag interaction)

**Acceptance criteria:**
- Bundles render as visual groups on canvas
- Drag a bundle → all wires move together
- Hover shows bundle highlight
- Selection shows bundle outline
- No regressions in existing wire/component interactions

---

### Phase 2b: Connector Orientation (1–2 days)
**Goal:** Users can rotate connectors to optimize routing

**Deliverables:**
1. Rotation handle on connector (visual indicator)
2. Drag-to-rotate interaction
3. Auto-optimize button (minimize wire crossings)
4. Rotation persistence (saved in document)
5. Tests (rotation math, auto-optimization)

**Acceptance criteria:**
- Connector shows rotation handle
- Drag handle → connector rotates smoothly
- Auto-optimize button works
- Rotation persists across save/load
- No regressions in connector interactions

---

### Phase 2c: Automatic Bundling (2–3 days)
**Goal:** Wires are automatically grouped into bundles

**Deliverables:**
1. Proximity-based bundling algorithm (DBSCAN or k-means)
2. On-import bundling (detect wires that should be bundled)
3. On-demand bundling (user selects wires, clicks "Group")
4. Continuous bundling (auto-group as user routes)
5. Bundle naming and properties (color, label, shielding)
6. Unbundle interaction (extract wire or dissolve bundle)
7. Tests (bundling algorithm, edge cases)

**Acceptance criteria:**
- Wires within N pixels auto-bundle
- On-import bundling works
- User can manually group wires
- User can extract wires from bundles
- Bundle properties editable
- No regressions in wire/bundle interactions

---

### Phase 2d: Drag-and-Drop Polish (2–3 days)
**Goal:** Canvas feels smooth and responsive

**Deliverables:**
1. Smooth animations on drag (easing, transitions)
2. Snap-to-grid for connector placement
3. Multi-select and drag (select multiple bundles, drag together)
4. Undo/redo for all interactions
5. Keyboard shortcuts (G for group, U for ungroup, R for rotate)
6. Visual feedback (drag preview, drop zones)
7. Tests (animations, multi-select, keyboard shortcuts)

**Acceptance criteria:**
- Drag animations are smooth
- Snap-to-grid works
- Multi-select works
- Undo/redo works
- Keyboard shortcuts work
- No regressions in existing interactions

---

## Technical Approach

### Bundle Model (Core)
The `Bundle` type already exists in `HarnessDocument`. We're extending it to be the primary routing unit:

```ts
interface Bundle {
  id: BundleId;
  name: string;
  wireIds: WireId[];  // wires in this bundle
  color?: string;
  shielded?: boolean;
  // ... existing fields (length, waypoints, etc.)
}
```

**New fields to add:**
- `bundleId?: BundleId` on `Wire` (which bundle does this wire belong to?)
- `rotation?: number` on `Connector` (rotation angle in degrees)
- `bundleProperties?: { color, label, shielding }` on `Bundle`

### Rendering (Render Package)
- `bundleScene.ts` — Emit bundle geometry (grouped wire paths, bundle outline, labels)
- `bundleInteraction.ts` — Hit-testing for bundles, drag handles, rotation handles
- Visual layers: wires → bundles → connectors → labels

### Interaction (App Package)
- `LayoutCanvas.tsx` — Extend with bundle drag, connector rotation, multi-select
- `useBundleRouting.ts` — Hook for bundle grouping logic, drag state, undo/redo
- `BundleInspector.tsx` — Side panel for bundle properties (name, color, wires)

### Algorithms
- **Proximity grouping:** Cluster wires by distance (DBSCAN or k-means)
- **Connector optimization:** Minimize wire crossings (NP-hard, use heuristic)
- **Automatic routing:** A* or Dijkstra on a grid, respecting bundle width

---

## Immediate Next Steps

### This Session
1. **Gather your UX feedback** on the 5 design questions above
2. **Refine the design** based on your input
3. **Create detailed wireframes** (if needed)
4. **Finalize the implementation plan**

### Next Session
1. **Implement Phase 2a** (bundle visualization & interaction)
2. **Implement Phase 2b** (connector orientation)
3. **Implement Phase 2c** (automatic bundling)
4. **Implement Phase 2d** (polish)
5. **Run verification** (manual testing in running app)

---

## Timeline Estimate

- **Phase 2a (bundle viz & interaction):** 3–5 days
- **Phase 2b (connector orientation):** 1–2 days
- **Phase 2c (automatic bundling):** 2–3 days
- **Phase 2d (polish):** 2–3 days

**Total:** ~2–3 weeks to a fully functional cable bundle routing system.

---

## Success Metrics

**Phase 2 is complete when:**
1. ✅ Bundles are visible and draggable on the canvas
2. ✅ Connectors can be rotated to optimize routing
3. ✅ Wires are automatically grouped into bundles
4. ✅ Users can extract wires from bundles
5. ✅ Canvas feels smooth and responsive
6. ✅ All interactions are undo/redo-able
7. ✅ No regressions in existing functionality
8. ✅ Running-app verification passes

---

**Ready to answer the 5 design questions and proceed with Phase 2a?**

---

**Last updated:** 2026-08-21 (Phase 2 design document created)
