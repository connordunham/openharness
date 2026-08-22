# Cable Bundle Routing — New Focus Direction

**Date:** 2026-08-21  
**Status:** Planning phase  
**Priority:** High (UX-critical path)

---

## Vision

Transform the layout canvas from a static routing tool into a **drag-and-drop-friendly cable management interface** where:

1. **Automatic bundling** — Wires are grouped into bundles by proximity/routing path
2. **Bundle-level routing** — Drag bundles as single units through the layout
3. **Branch separation** — Extract individual wires from bundles when needed
4. **Connector orientation** — Rotate connectors to optimize routing
5. **Intuitive interaction** — Everything feels like dragging objects on a canvas, not editing data

---

## Why This Matters

Current state (T12 formboard, T09–T10 export) assumes the layout is already routed. But the **routing itself is the hard part** — users spend most of their time here, and the current UI makes it tedious:

- No visual feedback on bundle grouping
- Manual waypoint editing is click-heavy
- No way to treat related wires as a unit
- Connector orientation is a data field, not a visual interaction
- The canvas feels like editing a spreadsheet, not manipulating physical objects

Your focus addresses the **core workflow bottleneck** before we build export and formboard on top of it.

---

## Phased Approach

### Phase 1: Foundation (Immediate)
Complete the blockers to unblock Phase 2:
- **B4:** fit-to-view/fit-to-selection (1–2 hours)
- **B5:** T02 mate rendering (2–3 hours)
- **C9:** DRAG_THRESHOLD fix (30 minutes)
- **Running-app verification** (1–2 hours)

**Outcome:** T04 (Zoom) complete and verified. Canvas is zoomable and navigable.

### Phase 2: Cable Bundle Routing (New Focus)
Replace the current T05–T08, T11 sequence with a focused cable bundle routing feature:

**Phase 2a: Bundle Visualization & Interaction** (3–5 days)
- Detect wire groupings by routing proximity (algorithm: wires within N pixels of each other)
- Render bundles as visual groups (thicker lines, bundle outline, label)
- Drag a bundle → all wires in it move together
- Drag a single wire → extract it from bundle (or create new bundle)
- Visual feedback: highlight bundle on hover, show extraction preview

**Phase 2b: Connector Orientation** (1–2 days)
- Rotate connector on canvas (right-click → rotate, or drag handle)
- Automatic connector placement optimization (minimize crossing wires)
- Visual feedback: show connector rotation angle, preview optimized placement

**Phase 2c: Automatic Bundling** (2–3 days)
- On-demand bundling: "Group selected wires" button
- Automatic bundling on import: detect wires that should be bundled
- Bundle naming and properties (color, label, shielding)
- Unbundle: "Extract wire" or "Dissolve bundle"

**Phase 2d: Drag-and-Drop Polish** (2–3 days)
- Smooth animations on drag
- Snap-to-grid for connector placement
- Multi-select and drag (select multiple bundles, drag together)
- Undo/redo for all interactions
- Keyboard shortcuts (G for group, U for ungroup, R for rotate)

**Outcome:** Layout canvas is intuitive, fast, and feels like a physical design tool.

### Phase 3: Export & Formboard (After Cable Routing)
- **T09–T10:** PDF/XLSX export (now with bundle information)
- **T12:** Formboard (now with bundle visualization and 3D routing)
- **T14–T15:** Current capacity and bend radius rules (now bundle-aware)

---

## Technical Approach

### Bundle Model (Core)
Add to `HarnessDocument`:
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

**Note:** `Bundle` already exists in the model (types.ts). We're extending it to be the primary routing unit, not just a length container.

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

## Immediate Action Items

### This Session
1. ✅ Complete B4 (fit-to-view/fit-to-selection)
2. ✅ Complete B5 (T02 mate rendering)
3. ✅ Fix C9 (DRAG_THRESHOLD)
4. ✅ Run verification checklist
5. 📋 **Gather UX feedback** — You mentioned "drastic improvements needed." What specific interactions are broken?

### Next Session
1. Design the bundle model extension (how do bundles relate to wires, connectors, waypoints?)
2. Prototype bundle visualization (what does a bundle look like on screen?)
3. Prototype bundle drag interaction (what's the drag target? How do you extract a wire?)
4. Implement Phase 2a (bundle visualization & interaction)

---

## Questions for You

To refine the plan, I need your input on:

1. **Bundle visualization:** How should bundles look on the canvas?
   - Thicker lines? Colored outline? Shaded region? Label?
   - Should individual wires be visible inside a bundle, or just the bundle outline?

2. **Drag interaction:** What's the primary interaction?
   - Drag bundle center → move whole bundle?
   - Drag bundle edge → extract wire?
   - Drag wire inside bundle → extract?
   - Drag wire outside bundle → add to bundle?

3. **Connector orientation:** How should users rotate connectors?
   - Right-click menu?
   - Drag a rotation handle?
   - Keyboard shortcut?
   - Auto-rotate button?

4. **Automatic bundling:** When should bundling happen?
   - On import (detect wires that should be bundled)?
   - On-demand (user selects wires, clicks "Group")?
   - Continuous (auto-group as user routes)?

5. **Broken interactions:** What specific UX problems are you seeing now?
   - Waypoint editing is tedious?
   - No visual feedback on routing?
   - Connector placement is hard?
   - Something else?

---

## Timeline Estimate

- **Phase 1 (blockers):** 1 day (B4, B5, C9, verification)
- **Phase 2a (bundle viz & interaction):** 3–5 days
- **Phase 2b (connector orientation):** 1–2 days
- **Phase 2c (automatic bundling):** 2–3 days
- **Phase 2d (polish):** 2–3 days
- **Phase 3 (export & formboard):** 5–10 days

**Total:** ~3–4 weeks to a fully functional cable bundle routing system.

---

## Why This Sequencing Makes Sense

1. **Zoom (T04) is done** — Canvas is navigable at any scale
2. **Mates (T02) are done** — Connectors can be mated
3. **Bundle routing is next** — The core workflow users spend time on
4. **Export and formboard come after** — They consume the routed bundles

This is **user-centric sequencing**, not feature-checklist sequencing. You're right that the current roadmap misses the critical path.

---

**Ready to proceed with B4/B5 and then dive into cable bundle routing design?**

---

**Last updated:** 2026-08-21 (Cable bundle routing focus established)
