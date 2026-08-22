/**
 * Layout-view node orientation and bundle-attach geometry (Phase 2b,
 * docs/PHASE2-REFINED-DESIGN.md §3 "Connector Orientation").
 *
 * Extracted behaviour-preserving from LayoutCanvas.tsx, which used to compute
 * all of it inline: the auto-orientation of each placed component glyph, the
 * bundle-attach point on a glyph's back stub, and the per-bundle polyline
 * assembly. Two consumers now share ONE spelling of this geometry — the
 * Layout canvas (rendering) and connectorOptimization.ts, which must answer
 * "where would every bundle run if this connector faced another way?"
 * without a canvas. Per AGENTS.md, geometry lives in this package, never in
 * a React component.
 *
 * Auto-orientation + stored rotation: a glyph's final facing angle is the
 * auto-orientation (average direction toward whatever the component is
 * bundled to — recomputed every render, never stored) PLUS the component's
 * stored `rotation` (Component.rotation, degrees clockwise, Phase 2b). The
 * stored field is a user-authored offset in 90° steps (R key in the Layout
 * pane); unset reads as 0, so documents written before Phase 2b render
 * exactly as they always did.
 */

import type { Bundle, Component, ComponentType, HarnessDocument, Point } from '@openharness/core';

/** Scale a document-space point (mm on the Layout canvas) into the caller's
 * px space. */
export function scalePoint(p: Point, scale: number): Point {
  return { x: p.x * scale, y: p.y * scale };
}

/** Shared length of a glyph's back stub (px) — the short line the bundle
 * cable visually leaves from. Exported so the canvas's glyph builders draw
 * with exactly the length the attach-point math below assumes. */
export const GLYPH_STUB_LEN = 10;

/** A glyph's body half-length along its facing axis (px, local space before
 * rotation). One table for every glyph builder AND the attach-point math, so
 * the drawn stub tip and the computed bundle-attach point can never drift
 * apart — they are the same physical spot on the glyph. */
export function glyphBodyHalfLen(type: ComponentType): number {
  switch (type) {
    case 'connector': return 12;
    case 'cable': return 11;
    case 'splice': return 8;
    case 'terminal': return 7;
    case 'resistor':
    case 'diode': return 10;
    case 'generic': return 7;
    // Branch points have no glyph body — bundles clip at the dot's edge
    // (branchOutlinePoint), never at a stub.
    case 'branchPoint': return 0;
  }
}

/** Distance from a glyph's center to its bundle-attach point (the stub tip),
 * px. Zero for branch points — see glyphBodyHalfLen. */
export function glyphStubRadius(type: ComponentType): number {
  return glyphBodyHalfLen(type) + (type === 'branchPoint' ? 0 : GLYPH_STUB_LEN);
}

/**
 * Auto-orientation (radians) for every placed non-branch component: the
 * average direction, in px space, from the component's own center to
 * whatever it's bundled to — aimed at the bundle's first/last routing
 * waypoint when one exists, so a bent bundle still leaves the glyph pointing
 * the right way. A component with no placed bundle partner gets 0.
 *
 * Two connectors bundled only to each other land exactly 180° apart (each
 * one's back/cable-stub points at the other), which is what makes them
 * automatically face opposite ways with no manual flip step.
 */
export function computeNodeAutoAngles(doc: HarnessDocument, pxPerMm: number): Map<string, number> {
  const placed = Object.values(doc.components).filter((c) => !!c.layoutPosition);
  const centersPx = new Map<string, Point>();
  for (const c of placed) if (c.layoutPosition) centersPx.set(c.id, scalePoint(c.layoutPosition, pxPerMm));
  const angles = new Map<string, number>();
  for (const c of placed) {
    if (c.type === 'branchPoint') continue;
    const center = centersPx.get(c.id);
    if (!center) continue;
    let sx = 0, sy = 0, n = 0;
    for (const b of Object.values(doc.bundles)) {
      const isSource = b.sourceId === c.id;
      const otherId = isSource ? b.targetId : b.targetId === c.id ? b.sourceId : null;
      if (!otherId) continue;
      const otherCenter = centersPx.get(otherId);
      if (!otherCenter) continue;
      const waypointsPx = (b.waypoints ?? []).map((p) => scalePoint(p, pxPerMm));
      const aimAt = (isSource ? waypointsPx[0] : waypointsPx[waypointsPx.length - 1]) ?? otherCenter;
      const dx = aimAt.x - center.x;
      const dy = aimAt.y - center.y;
      const len = Math.hypot(dx, dy);
      if (len > 0) { sx += dx / len; sy += dy / len; n++; }
    }
    angles.set(c.id, n > 0 ? Math.atan2(sy, sx) : 0);
  }
  return angles;
}

/** Final facing angle (radians) of a glyph: auto-orientation plus the
 * component's stored rotation (degrees). Screen space is y-down, so adding a
 * positive angle turns the glyph CLOCKWISE — the direction the Layout pane's
 * R key rotates. Unset reads as 0. */
export function nodeFacingAngle(autoAngle: number, rotationDeg: number | undefined): number {
  return autoAngle + ((rotationDeg ?? 0) * Math.PI) / 180;
}

/**
 * The point where a bundle cable attaches to a placed non-branch component's
 * glyph — the tip of the glyph's back stub, `glyphStubRadius` out from the
 * center along the facing angle. A flipped terminal faces the opposite way
 * (its single port is on the other side — the same flip affordance as
 * Connector.flipped), so its attach flips too; mirrors the terminal case of
 * the canvas's glyph builders exactly.
 */
export function glyphAttachPoint(center: Point, facingAngle: number, component: Component): Point {
  const angle = component.type === 'terminal' && component.flipped ? facingAngle + Math.PI : facingAngle;
  const r = glyphStubRadius(component.type);
  return { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r };
}

/** Point on a branch point's circle (radius `r`, px) where a bundle line
 * heading for `aimAt` visibly terminates — branch points are pure layout
 * topology with no orientation, so this is plain circle-edge math. */
export function branchOutlinePoint(center: Point, aimAt: Point, r: number): Point {
  const dx = aimAt.x - center.x;
  const dy = aimAt.y - center.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return center;
  return { x: center.x + (dx / len) * r, y: center.y + (dy / len) * r };
}

/**
 * The px polyline one bundle is drawn along: source attach → waypoints →
 * target attach. Attach points are glyph stub tips for ordinary components
 * (moved by stored rotation — the whole mechanism behind Phase 2b's
 * rotate-to-re-route) and circle-edge clips for branch points. Returns
 * undefined when either end isn't placed — the bundle can't be drawn.
 *
 * `facingAngles` maps componentId → final glyph facing angle (radians); a
 * component missing from the map faces 0° (the canvas's own fallback).
 */
export function bundlePolyline(
  doc: HarnessDocument,
  bundle: Bundle,
  facingAngles: Map<string, number>,
  pxPerMm: number,
  branchRadiusPx: number,
): Point[] | undefined {
  const a = doc.components[bundle.sourceId];
  const t = doc.components[bundle.targetId];
  if (!a?.layoutPosition || !t?.layoutPosition) return undefined;
  const pa = scalePoint(a.layoutPosition, pxPerMm);
  const pt = scalePoint(t.layoutPosition, pxPerMm);
  const waypointsPx = (bundle.waypoints ?? []).map((p) => scalePoint(p, pxPerMm));
  const aAimAt = waypointsPx[0] ?? pt;
  const tAimAt = waypointsPx[waypointsPx.length - 1] ?? pa;
  const from = a.type === 'branchPoint'
    ? branchOutlinePoint(pa, aAimAt, branchRadiusPx)
    : glyphAttachPoint(pa, facingAngles.get(a.id) ?? 0, a);
  const to = t.type === 'branchPoint'
    ? branchOutlinePoint(pt, tAimAt, branchRadiusPx)
    : glyphAttachPoint(pt, facingAngles.get(t.id) ?? 0, t);
  return [from, ...waypointsPx, to];
}
