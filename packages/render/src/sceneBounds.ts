/**
 * Bounding-rect helpers over the schematic scene graph — the geometry that
 * fit-to-view and fit-to-selection (review B4) reduce to. The pipeline is:
 * collect canvas-space rects here, hand them to `fitView` in zoomGeometry,
 * apply the resulting zoom/pan/scroll in `useCanvasZoom`. Keeping the rect
 * collection pure (scene model in, rects out, no DOM) is what makes it
 * unit-testable — the app layer only decides *which* items are selected.
 */

import type { HarnessDocument, Point } from '@openharness/core';
import { collectGroupMembers, type SceneMate, type SceneNode, type SceneWire, type SchematicScene } from './schematicScene.js';
import { pointRect, type Rect } from './zoomGeometry.js';

/** A node box is already an axis-aligned rect in canvas units. */
export function sceneNodeRect(node: SceneNode): Rect {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

/**
 * Bounds of a wire's routed path (manual bends included — the route runs
 * through them). Null when the wire has no route points at all; the scene
 * builder always emits at least a two-point stub (even for degraded wires,
 * which draw a straight line to their fallback anchor), so this is a guard
 * rather than a path it currently produces.
 */
export function sceneWireRect(wire: SceneWire): Rect | null {
  if (wire.routePoints.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of wire.routePoints) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Bounds of a mate's segment — the axis-aligned box spanning its two
 * endpoints. A horizontal or vertical mate has zero height or width; that is
 * a correct bound, and `fitToBounds`'s padding keeps it visible. */
export function sceneMateRect(mate: SceneMate): Rect {
  const x = Math.min(mate.from.x, mate.to.x);
  const y = Math.min(mate.from.y, mate.to.y);
  return {
    x,
    y,
    width: Math.abs(mate.to.x - mate.from.x),
    height: Math.abs(mate.to.y - mate.from.y),
  };
}

/**
 * True when the segment a–b shares at least one point with rect `r` — the
 * lasso test for mates. A mate is one straight segment, so sampling a few
 * points (the way `wireTouchesRect` samples a routed path) would miss a
 * marquee that covers only the middle of a long mate; Liang–Barsky clipping
 * is exact and cheap: the parametric segment survives clipping against all
 * four edges iff some part of it lies inside.
 */
export function segmentIntersectsRect(a: Point, b: Point, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // One clip edge. p < 0 means the segment enters the slab at t = q/p,
  // p > 0 that it leaves at t = q/p, p === 0 that it runs parallel to the
  // edge pair and must already be inside the slab (q >= 0).
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, a.x - r.x)
    && clip(dx, r.x + r.width - a.x)
    && clip(-dy, a.y - r.y)
    && clip(dy, r.y + r.height - a.y)
  );
}

/**
 * Every drawn item in the scene as rects — the fit-to-view input. Notes and
 * shield nodes have no extent of their own in the scene model, so they
 * contribute point rects; `fitToBounds`'s padding covers the artwork drawn
 * around them (and around node boxes and wire traces). Mates contribute
 * nothing here: a mate always runs between two node boxes that are already
 * counted, so it can never extend the content bounds.
 */
export function schematicContentRects(scene: SchematicScene): Rect[] {
  const rects: Rect[] = [];
  for (const node of scene.nodes) rects.push(sceneNodeRect(node));
  for (const wire of scene.wires) {
    const r = sceneWireRect(wire);
    if (r) rects.push(r);
  }
  for (const note of scene.notes) rects.push(pointRect(note.point));
  for (const shieldNode of scene.shieldNodes) {
    for (const p of shieldNode.points) rects.push(pointRect(p));
  }
  return rects;
}

/** One selected item, as the canvas tracks it (single selection or a
 * multi-select key parsed by the app's `parseKey`). */
export interface SchematicSelectionItem {
  kind: 'component' | 'note' | 'wire' | 'group' | 'mate';
  id: string;
}

/**
 * Rects for a set of selected items — the fit-to-selection input. A group
 * fits to its member wires, following nested `memberGroupIds` exactly like
 * the halo/termination geometry does (`collectGroupMembers`). Items that no
 * longer resolve (deleted between selecting and fitting, a group whose
 * members are all unplaced) contribute nothing; if nothing resolves the
 * caller receives an empty list and `fitView` falls back to resetting the
 * view rather than fitting to stale coordinates.
 */
export function schematicSelectionRects(
  scene: SchematicScene,
  doc: HarnessDocument,
  items: ReadonlyArray<SchematicSelectionItem>,
): Rect[] {
  const wireById = new Map(scene.wires.map((w) => [w.wireId, w]));
  const rects: Rect[] = [];
  for (const item of items) {
    switch (item.kind) {
      case 'component': {
        const node = scene.nodes.find((n) => n.componentId === item.id);
        if (node) rects.push(sceneNodeRect(node));
        break;
      }
      case 'note': {
        const note = scene.notes.find((n) => n.noteId === item.id);
        if (note) rects.push(pointRect(note.point));
        break;
      }
      case 'wire': {
        const wire = wireById.get(item.id);
        const r = wire ? sceneWireRect(wire) : null;
        if (r) rects.push(r);
        break;
      }
      case 'group': {
        const group = doc.wireGroups[item.id];
        if (!group) break;
        for (const wireId of collectGroupMembers(doc, group, new Set())) {
          const wire = wireById.get(wireId);
          const r = wire ? sceneWireRect(wire) : null;
          if (r) rects.push(r);
        }
        break;
      }
      case 'mate': {
        const mate = scene.mates.find((m) => m.mateId === item.id);
        if (mate) rects.push(sceneMateRect(mate));
        break;
      }
    }
  }
  return rects;
}
