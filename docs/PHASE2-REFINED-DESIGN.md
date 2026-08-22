# Phase 2: Cable Bundle Routing — Refined Design & Implementation

**Date:** 2026-08-21  
**Status:** Design finalized, ready for Phase 2a implementation  
**Your Decisions:**
- Bundle visualization: **B** (wires visible, bundle outlined in distinct color)
- Drag interaction: **B** (drag bundle edge to move, drag wire to extract)
- Connector orientation: **C** (keyboard shortcut — select connector, press R to rotate)
- Automatic bundling: **C** (continuous auto-group as user routes)
- Top pain points: waypoint editing tedious, no visual feedback on routing, bundle diameter not visible

---

## Refined Design

### 1. Bundle Visualization (Option B)

**What users see:**
- Individual wires remain visible (for debugging and precision)
- Bundle outlined in a distinct color (e.g., purple, orange, or user-selected)
- Bundle label showing wire count and total gauge
- Bundle diameter indicator (visual representation of physical size)
- On hover: bundle outline highlights, shows properties tooltip
- On select: bundle outline becomes bold, shows extraction handles on each wire

**Visual hierarchy:**
- Wires: thin lines (existing)
- Bundle outline: medium stroke, dashed or solid
- Bundle label: small text showing "Bundle: 4 wires, 2.5mm diameter"
- Extraction handles: small circles on each wire (appear on hover/select)

**Color scheme:**
- Default: purple or teal (configurable per bundle)
- Hover: brighter version of bundle color
- Selected: bold outline + extraction handles visible
- Conflict (crossing wires): red outline (warning)

---

### 2. Drag Interaction (Option B)

**Drag bundle edge to move:**
- Click on the bundle outline (not on a wire) → drag to move entire bundle
- All wires in bundle move together
- Waypoints adjust automatically (maintain routing shape)
- Visual feedback: bundle outline follows cursor, wires ghost-fade

**Drag wire to extract:**
- Click on a wire inside a bundle → drag to extract
- Wire separates from bundle and becomes independent
- Remaining wires stay bundled
- Visual feedback: wire highlights, bundle outline updates in real-time
- Drop zone: anywhere on canvas creates new single-wire bundle or adds to existing bundle

**Interaction details:**
- Hover over bundle outline → cursor changes to "move" (four arrows)
- Hover over wire inside bundle → cursor changes to "grab" (hand)
- Drag threshold: 3 screen pixels (from C9 fix)
- Snap-to-grid: optional, configurable

---

### 3. Connector Orientation (Option C)

**Keyboard shortcut: R to rotate**

**Interaction:**
1. Select a connector (click on it)
2. Press R to rotate 90° clockwise
3. Press R again to rotate another 90°
4. Repeat until desired orientation (4 rotations = full circle)
5. Rotation persists in document

**Visual feedback:**
- Connector shows rotation angle (e.g., "0°", "90°", "180°", "270°")
- Wires connected to connector update their routing automatically
- Auto-optimize suggestion: "Press Shift+R to auto-optimize" (minimize crossings)

**Auto-optimize (Shift+R):**
- Algorithm: try all 4 rotations, pick the one with fewest wire crossings
- Visual feedback: connector rotates smoothly, wires re-route
- Undo/redo: full support

---

### 4. Automatic Bundling (Option C)

**Continuous auto-group as user routes**

**Algorithm:**
- As user drags wires, proximity-based clustering detects wires that should be bundled
- Wires within N pixels (configurable, default 10px) of each other auto-bundle
- Bundling happens in real-time, no user action needed
- User can override: right-click bundle → "Unbundle" or "Extract wire"

**Bundling rules:**
- Wires must have same source and target (or pass through same waypoints)
- Wires must be routed in parallel (not crossing)
- Wires with different gauges can bundle (but label shows gauge range)
- Shielded wires bundle separately from unshielded (or with explicit user action)

**User control:**
- "Auto-bundle" toggle in settings (on by default)
- "Unbundle all" button to dissolve all bundles
- "Extract wire" context menu on individual wires
- "Merge bundles" to combine two bundles
- "Split bundle" to separate wires by gauge or shielding

---

### 5. Addressing Pain Points

**Pain point 1: Waypoint editing tedious**
- **Solution:** Bundle-level waypoint editing
  - Drag bundle outline → all waypoints move together
  - No need to edit each wire individually
  - Waypoint insertion: click on bundle outline to add waypoint
  - Waypoint deletion: right-click waypoint → delete

**Pain point 2: No visual feedback on routing**
- **Solution:** Bundle visualization + routing indicators
  - Bundle outline shows routing path clearly
  - Bundle label shows wire count and gauge
  - Hover shows connection details (source, target, length)
  - Conflict indicators: red outline if wires cross outside bundle
  - Length feedback: "Bundle length: 2.5m" displayed on hover

**Pain point 3: Bundle diameter not visible**
- **Solution:** Bundle diameter indicator
  - Visual representation: bundle outline width proportional to diameter
  - Label: "Ø 2.5mm" displayed on bundle
  - Hover tooltip: detailed bundle properties (wires, gauges, diameter, length)
  - 3D preview: optional, shows bundle in 3D space (for formboard)

---

## Phase 2a: Bundle Visualization & Interaction (3–5 days)

### Deliverables

**1. Bundle Model Extension**
- Add `bundleId?: BundleId` to `Wire` type (which bundle does this wire belong to?)
- Add `rotation?: number` to `Connector` type (rotation angle in degrees)
- Extend `Bundle` type with `color?: string`, `diameter?: number`, `label?: string`
- Migration: existing bundles get default color and auto-calculated diameter

**2. Bundle Rendering**
- `render/bundleScene.ts` — Emit bundle geometry
  - Bundle outline (path connecting wire paths)
  - Bundle label (wire count, gauge range, diameter)
  - Extraction handles (small circles on each wire)
  - Conflict indicators (red outline if wires cross)
- `render/bundleGeometry.ts` — Helper functions
  - Calculate bundle outline from wire paths
  - Calculate bundle diameter from wire gauges
  - Detect wire crossings
  - Hit-test for bundle selection

**3. Bundle Interaction**
- `app/useBundleRouting.ts` — Hook for bundle drag/extract
  - Track drag state (which bundle, which wire)
  - Calculate new positions on drag
  - Update document via `store.transact`
  - Undo/redo support
- `LayoutCanvas.tsx` — Extend with bundle drag/extract handlers
  - `onBundleMouseDown` — Start drag
  - `onBundleMouseMove` — Update drag preview
  - `onBundleMouseUp` — Complete drag or extract
  - Cursor changes (move vs. grab)

**4. Visual Feedback**
- Hover: bundle outline highlights, tooltip shows properties
- Drag: bundle outline follows cursor, wires ghost-fade
- Extract: wire highlights, bundle outline updates in real-time
- Selection: bundle outline becomes bold, extraction handles visible

**5. Tests**
- `render/__tests__/bundleScene.test.ts` — Bundle geometry emission
- `render/__tests__/bundleGeometry.test.ts` — Helper functions
- `app/__tests__/useBundleRouting.test.ts` — Drag/extract logic
- `app/__tests__/bundleInteraction.test.tsx` — Canvas interaction

### Acceptance Criteria

- ✅ Bundles render with outline, label, and diameter indicator
- ✅ Wires inside bundle are visible
- ✅ Drag bundle outline → all wires move together
- ✅ Drag wire inside bundle → extract wire
- ✅ Hover shows bundle properties
- ✅ Selection shows extraction handles
- ✅ Conflict indicators show wire crossings
- ✅ No regressions in existing wire/component interactions
- ✅ All tests pass
- ✅ Build clean (tsc, vitest, eslint, vite build)

---

## Phase 2b: Connector Orientation (1–2 days)

### Deliverables

**1. Rotation Model**
- Add `rotation?: number` to `Connector` type (0, 90, 180, 270 degrees)
- Persist rotation in document

**2. Rotation Interaction**
- Select connector → press R to rotate 90° clockwise
- Press R again to rotate another 90°
- Shift+R to auto-optimize (minimize wire crossings)
- Visual feedback: rotation angle displayed on connector

**3. Auto-Optimize Algorithm**
- Try all 4 rotations
- For each rotation, count wire crossings
- Pick rotation with fewest crossings
- Smooth animation on rotation

**4. Tests**
- Rotation math (0°, 90°, 180°, 270°)
- Auto-optimize algorithm
- Undo/redo support

### Acceptance Criteria

- ✅ Select connector, press R → rotates 90°
- ✅ Rotation angle displayed on connector
- ✅ Shift+R auto-optimizes
- ✅ Wires re-route automatically
- ✅ Rotation persists across save/load
- ✅ Undo/redo works
- ✅ No regressions

---

## Phase 2c: Automatic Bundling (2–3 days)

### Deliverables

**1. Bundling Algorithm**
- Proximity-based clustering (DBSCAN or k-means)
- Wires within N pixels (default 10px) auto-bundle
- Wires must have same source/target or pass through same waypoints
- Wires must be routed in parallel (not crossing)

**2. Continuous Bundling**
- As user drags wires, bundling updates in real-time
- New bundles created automatically
- Existing bundles updated automatically

**3. User Control**
- "Auto-bundle" toggle in settings
- "Unbundle all" button
- "Extract wire" context menu
- "Merge bundles" option
- "Split bundle" option

**4. Tests**
- Bundling algorithm (proximity, routing)
- Edge cases (single wire, crossing wires, different gauges)
- Undo/redo support

### Acceptance Criteria

- ✅ Wires auto-bundle as user routes
- ✅ Bundling algorithm is correct
- ✅ User can unbundle or extract wires
- ✅ User can merge or split bundles
- ✅ Auto-bundle toggle works
- ✅ No regressions

---

## Phase 2d: Drag-and-Drop Polish (2–3 days)

### Deliverables

**1. Smooth Animations**
- Drag animations with easing
- Smooth transitions on bundle outline updates
- Smooth rotation animation

**2. Snap-to-Grid**
- Optional snap-to-grid for connector placement
- Configurable grid size

**3. Multi-Select and Drag**
- Select multiple bundles (Shift+click)
- Drag all selected bundles together
- Visual feedback: all selected bundles highlight

**4. Keyboard Shortcuts**
- R: Rotate connector 90°
- Shift+R: Auto-optimize connector
- G: Group selected wires into bundle
- U: Unbundle selected bundle
- Delete: Delete selected bundle (wires remain, unbundled)

**5. Visual Feedback**
- Drag preview (ghost wires)
- Drop zones (highlight valid drop targets)
- Conflict warnings (red outline for crossing wires)

**6. Tests**
- Animations (smooth, no jank)
- Multi-select (correct selection state)
- Keyboard shortcuts (correct actions)
- Visual feedback (correct rendering)

### Acceptance Criteria

- ✅ Drag animations are smooth
- ✅ Snap-to-grid works
- ✅ Multi-select works
- ✅ Keyboard shortcuts work
- ✅ Visual feedback is clear
- ✅ No regressions

---

## Implementation Sequence

### Session 1: Phase 2a (Bundle Visualization & Interaction)
1. Implement bundle model extension
2. Implement bundle rendering (scene builder)
3. Implement bundle drag/extract interaction
4. Add visual feedback (hover, select, drag)
5. Write tests
6. Verify build clean

### Session 2: Phase 2b (Connector Orientation)
1. Implement rotation model
2. Implement R key handler
3. Implement auto-optimize algorithm
4. Add visual feedback
5. Write tests
6. Verify build clean

### Session 3: Phase 2c (Automatic Bundling)
1. Implement bundling algorithm
2. Implement continuous bundling
3. Add user controls (toggle, unbundle, extract, merge, split)
4. Write tests
5. Verify build clean

### Session 4: Phase 2d (Polish)
1. Add smooth animations
2. Add snap-to-grid
3. Add multi-select and drag
4. Add keyboard shortcuts
5. Add visual feedback
6. Write tests
7. Verify build clean

### Session 5: Verification & Refinement
1. Run manual verification in running app
2. Fix any issues found
3. Gather user feedback
4. Refine as needed

---

## Success Metrics

**Phase 2 is complete when:**
1. ✅ Bundles are visible with outline, label, and diameter indicator
2. ✅ Wires inside bundles are visible
3. ✅ Drag bundle outline → all wires move together
4. ✅ Drag wire → extract from bundle
5. ✅ Select connector, press R → rotate 90°
6. ✅ Shift+R → auto-optimize
7. ✅ Wires auto-bundle as user routes
8. ✅ User can unbundle, extract, merge, split bundles
9. ✅ Drag animations are smooth
10. ✅ Multi-select and keyboard shortcuts work
11. ✅ All interactions are undo/redo-able
12. ✅ No regressions in existing functionality
13. ✅ Running-app verification passes

---

**Ready to proceed with Phase 2a implementation?**

---

**Last updated:** 2026-08-21 (Design finalized based on your input)
