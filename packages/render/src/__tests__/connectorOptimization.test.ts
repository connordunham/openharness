/**
 * Phase 2b — connector-orientation optimizer (connectorOptimization.ts).
 *
 * The scoring fixture (crossingDoc) is built so rotation MATTERS: c1's bundle
 * runs to c2 on its right, and a vertical bundle passes 30 px to the right
 * of c1's center. With rotation 0 c1's stub faces the passing bundle and
 * attaches only 8 px from it — the crossing lands inside the 14 px endpoint
 * exclusion (component fan-out, not a conflict) and scores 0; every other
 * rotation swings the attach point away and the same bundles score 1 real
 * crossing. Geometry hand-verified in px space (PX_PER_MM = 4).
 */
import { describe, it, expect } from 'vitest';
import {
  createEmptyDocument,
  type Bundle, type Connector, type HarnessDocument,
} from '@openharness/core';
import {
  countWireCrossings, findOptimalRotation, normalizeRotationDegrees, ROTATION_STEPS,
} from '../connectorOptimization.js';
import { countPathCrossings } from '../bundleGeometry.js';

const PX_PER_MM = 4;
const EXCLUSION_PX = 14;   // LayoutCanvas's ENDPOINT_EXCLUSION_PX
const BRANCH_R_PX = 7;     // LayoutCanvas's BRANCH_R

function connectorAt(id: string, refdes: string, x: number, y: number, rotation?: number): Connector {
  return {
    id, type: 'connector', refdes,
    cavities: [{ id: 'a', designation: '1', custom: {} }],
    layoutPosition: { x, y },
    ...(rotation !== undefined ? { rotation } : {}),
    custom: {},
  } satisfies Connector;
}

function bundle(id: string, refdes: string, sourceId: string, targetId: string): Bundle {
  return { id, refdes, sourceId, targetId, custom: {} } satisfies Bundle;
}

/** c1 ──b1── c2 horizontally; bx runs vertically 30 px right of c1's center. */
function crossingDoc(c1Rotation?: number): HarnessDocument {
  const d = createEmptyDocument('Test');
  d.components['c1'] = connectorAt('c1', 'C1', 100, 100, c1Rotation);
  d.components['c2'] = connectorAt('c2', 'C2', 200, 100);
  d.components['c3'] = connectorAt('c3', 'C3', 107.5, 0);
  d.components['c4'] = connectorAt('c4', 'C4', 107.5, 200);
  d.bundles['b1'] = bundle('b1', 'BND1', 'c1', 'c2');
  d.bundles['bx'] = bundle('bx', 'BND2', 'c3', 'c4');
  return d;
}

/** Two diagonal bundles crossing in the middle — rotating c1 can't help. */
function tiedDoc(c1Rotation?: number): HarnessDocument {
  const d = createEmptyDocument('Test');
  d.components['c1'] = connectorAt('c1', 'C1', 0, 0, c1Rotation);
  d.components['c2'] = connectorAt('c2', 'C2', 100, 100);
  d.components['c3'] = connectorAt('c3', 'C3', 0, 100);
  d.components['c4'] = connectorAt('c4', 'C4', 100, 0);
  d.bundles['ba'] = bundle('ba', 'BND1', 'c1', 'c2');
  d.bundles['bb'] = bundle('bb', 'BND2', 'c3', 'c4');
  return d;
}

const c1 = (d: HarnessDocument): Connector => d.components['c1'] as Connector;

describe('countWireCrossings', () => {
  it('counts crossings for each rotation — the stub-facing bundle fan-out is excluded, swung-out attach points are not', () => {
    const d = crossingDoc();
    expect(countWireCrossings(c1(d), 0, d, PX_PER_MM, EXCLUSION_PX, BRANCH_R_PX)).toBe(0);
    expect(countWireCrossings(c1(d), 90, d, PX_PER_MM, EXCLUSION_PX, BRANCH_R_PX)).toBe(1);
    expect(countWireCrossings(c1(d), 180, d, PX_PER_MM, EXCLUSION_PX, BRANCH_R_PX)).toBe(1);
    expect(countWireCrossings(c1(d), 270, d, PX_PER_MM, EXCLUSION_PX, BRANCH_R_PX)).toBe(1);
  });

  it('no bundles — zero crossings for every rotation', () => {
    const d = createEmptyDocument('Test');
    d.components['c1'] = connectorAt('c1', 'C1', 0, 0);
    for (const r of ROTATION_STEPS) {
      expect(countWireCrossings(c1(d), r, d, PX_PER_MM, EXCLUSION_PX, BRANCH_R_PX)).toBe(0);
    }
  });

  it('a single bundle cannot cross anything — zero for every rotation', () => {
    const d = createEmptyDocument('Test');
    d.components['c1'] = connectorAt('c1', 'C1', 0, 0);
    d.components['c2'] = connectorAt('c2', 'C2', 100, 0);
    d.bundles['b1'] = bundle('b1', 'BND1', 'c1', 'c2');
    for (const r of ROTATION_STEPS) {
      expect(countWireCrossings(c1(d), r, d, PX_PER_MM, EXCLUSION_PX, BRANCH_R_PX)).toBe(0);
    }
  });

  it('multiple wires: a crossing far from the connector counts for every rotation of that connector', () => {
    // The X sits ~200 px away from c1; no rotation of c1 moves the crossing
    // into the exclusion radius, so all four candidates score identically.
    const d = tiedDoc();
    for (const r of ROTATION_STEPS) {
      expect(countWireCrossings(c1(d), r, d, PX_PER_MM, EXCLUSION_PX, BRANCH_R_PX)).toBe(1);
    }
  });

  it('other components keep their own stored rotations while one is scored', () => {
    // Rotating c3 (the top end of the vertical bundle bx) by 270° swings its
    // attach point east, tilting bx so it crosses b1 at ~19 px from b1's
    // attach — just outside the 14 px fan-out exclusion. If the scorer
    // silently zeroed c3's stored rotation, the tilt vanishes and the
    // crossing with it.
    const d = crossingDoc();
    const plain = countWireCrossings(c1(d), 0, d, PX_PER_MM, EXCLUSION_PX, BRANCH_R_PX);
    (d.components['c3'] as Connector).rotation = 270;
    const withC3Rotated = countWireCrossings(c1(d), 0, d, PX_PER_MM, EXCLUSION_PX, BRANCH_R_PX);
    expect(plain).toBe(0);
    expect(withC3Rotated).toBe(1);
  });
});

describe('countPathCrossings — the optimizer\'s scalar scorer', () => {
  // Direct coverage of the primitive countWireCrossings delegates to. The
  // countWireCrossings fixtures above never exercise the self-crossing
  // branch (a bundle cannot cross itself in those docs), so these tests hit
  // it head-on — mutation showed the branch was otherwise untested.

  it('counts a path that crosses itself once', () => {
    // A figure-8 style route: seg 0 (0,0)→(100,100) and the non-adjacent
    // seg 2 (100,0)→(0,100) meet at (50,50) — 70+ px from either path end,
    // so the exclusion radius does not swallow it.
    const count = countPathCrossings(
      [{ id: 'p', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }] }],
      EXCLUSION_PX,
    );
    expect(count).toBe(1);
  });

  it('counts a crossing between two paths exactly once — scalar, not per-path', () => {
    // detectPathCrossings reports the same hit under BOTH paths (right for
    // per-bundle conflict indicators); the optimizer's scalar must not
    // double it.
    const count = countPathCrossings(
      [
        { id: 'a', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
        { id: 'b', points: [{ x: 50, y: -50 }, { x: 50, y: 50 }] },
      ],
      EXCLUSION_PX,
    );
    expect(count).toBe(1);
  });

  it('applies the endpoint exclusion radius — fan-out geometry is not scored', () => {
    // The intersection at (5,0) sits 5 px from path a's start — component
    // fan-out, not a routing conflict, once the radius covers it.
    const nearEndA = [
      { id: 'a', points: [{ x: 0, y: 0 }, { x: 40, y: 0 }] },
      { id: 'b', points: [{ x: 5, y: -20 }, { x: 5, y: 20 }] },
    ];
    expect(countPathCrossings(nearEndA, 0)).toBe(1);          // no radius → real crossing
    expect(countPathCrossings(nearEndA, EXCLUSION_PX)).toBe(0); // 14 px radius → excluded
    // The exclusion applies to EITHER path's ends: same shape, but now the
    // intersection sits 5 px from path b's own endpoint instead.
    const nearEndB = [
      { id: 'a', points: [{ x: 0, y: 0 }, { x: 40, y: 0 }] },
      { id: 'b', points: [{ x: 20, y: -5 }, { x: 20, y: 50 }] },
    ];
    expect(countPathCrossings(nearEndB, EXCLUSION_PX)).toBe(0);
  });
});

describe('findOptimalRotation', () => {
  it('picks the rotation with the fewest crossings', () => {
    const d = crossingDoc(180); // starts sub-optimal: 1 crossing
    const best = findOptimalRotation(c1(d), d, PX_PER_MM, EXCLUSION_PX, BRANCH_R_PX);
    expect(best).toBe(0);
    expect(countWireCrossings(c1(d), best, d, PX_PER_MM, EXCLUSION_PX, BRANCH_R_PX)).toBe(0);
  });

  it('on a tie, keeps the connector\'s current rotation — no pointless churn', () => {
    const d = tiedDoc(90);
    expect(findOptimalRotation(c1(d), d, PX_PER_MM, EXCLUSION_PX, BRANCH_R_PX)).toBe(90);
  });

  it('on a tie with no stored rotation, returns the first candidate (0)', () => {
    const d = tiedDoc();
    expect(findOptimalRotation(c1(d), d, PX_PER_MM, EXCLUSION_PX, BRANCH_R_PX)).toBe(0);
  });

  it('edge case — connector with no bundles keeps its current rotation', () => {
    const d = createEmptyDocument('Test');
    d.components['c1'] = connectorAt('c1', 'C1', 0, 0, 270);
    expect(findOptimalRotation(c1(d), d, PX_PER_MM, EXCLUSION_PX, BRANCH_R_PX)).toBe(270);
  });

  it('is deterministic — repeated calls give the same answer', () => {
    const results = new Set<number>();
    for (let i = 0; i < 5; i++) {
      const d = crossingDoc(180);
      results.add(findOptimalRotation(c1(d), d, PX_PER_MM, EXCLUSION_PX, BRANCH_R_PX));
    }
    expect(results.size).toBe(1);
    expect(results.has(0)).toBe(true);
  });
});

describe('normalizeRotationDegrees', () => {
  it('maps any angle into [0, 360)', () => {
    expect(normalizeRotationDegrees(0)).toBe(0);
    expect(normalizeRotationDegrees(90)).toBe(90);
    expect(normalizeRotationDegrees(360)).toBe(0);
    expect(normalizeRotationDegrees(-90)).toBe(270);
    expect(normalizeRotationDegrees(450)).toBe(90);
    expect(normalizeRotationDegrees(-360)).toBe(0);
  });
});
