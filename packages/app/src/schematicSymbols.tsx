/**
 * Schematic node symbols (Connor: "improve the other components. add them as
 * symbols in the schematic instead of generic blocks").
 *
 * Split out of SchematicCanvas.tsx, which had grown past 2,800 lines with
 * these ~150 lines of pure shape geometry sitting in the middle of the
 * interaction code. Nothing here touches the store, selection, or any React
 * state — each function turns a node's box into path data — so keeping it
 * beside the event handlers made both harder to read than either is alone.
 *
 * Each shape is derived from the corresponding 16×16 `ComponentIcon` glyph
 * (icons.tsx) and rescaled to the node's actual (x, y, w, h), so the
 * full-size schematic symbol and the small toolbar icon read as the same
 * shape at two different sizes.
 */

import type { Component, HarnessDocument } from '@openharness/core';
import { normalizeRotationDegrees, type SceneNode } from '@openharness/render';

/**
 * Component types drawn as real schematic symbols instead of the generic
 * labeled box. `connector`/`cable`/`generic` keep the labeled-box treatment:
 * a connector's cavity list and a cable's core list both need real row space
 * a symbol can't provide, and `generic` has no more specific shape to draw.
 */
export const SYMBOL_NODE_TYPES = new Set<Component['type']>(['splice', 'terminal', 'resistor', 'diode']);

/** Splice symbol: a straight through-wire with a junction dot at the
 * midpoint — the standard schematic convention for "these wires are
 * electrically the same node," matching the two-port L/R shape
 * schematicScene.ts already gives a Splice component. */
export function spliceSymbol(x: number, y: number, w: number, h: number) {
  const cy = y + h / 2;
  return { lineD: `M ${x} ${cy} L ${x + w} ${cy}`, dotCx: x + w / 2, dotCy: cy, dotR: Math.min(h * 0.28, 5) };
}

/** Terminal symbol: a stub lead into a ring — the single-port lug shape
 * (spec §7.2's "ring terminal"), reused for every TerminalKind since the
 * kind itself is already surfaced as text via SceneRow.label. Ports sit on
 * the right unless flipped or rotated (see schematicScene.ts's Terminal handling). */
export function terminalSymbol(x: number, y: number, w: number, h: number, flipped: boolean, rotation = 0) {
  const rot = normalizeRotationDegrees(rotation);
  const isVertical = rot === 90 || rot === 270;
  if (isVertical) {
    const cx = x + w / 2;
    const ringR = Math.min(w * 0.34, 6.5);
    const portAtTop = (rot === 90 && flipped) || (rot === 270 && !flipped);
    const ringCy = portAtTop ? y + h * 0.28 : y + h * 0.72;
    const leadFrom = portAtTop ? y + h : y;
    const leadTo = portAtTop ? ringCy + ringR : ringCy - ringR;
    return { leadD: `M ${cx} ${leadFrom} L ${cx} ${leadTo}`, ringCx: cx, ringCy, ringR };
  } else {
    const cy = y + h / 2;
    const ringR = Math.min(h * 0.34, 6.5);
    const portAtLeft = (rot === 0 && flipped) || (rot === 180 && !flipped);
    const ringCx = portAtLeft ? x + w * 0.28 : x + w * 0.72;
    const leadFrom = portAtLeft ? x + w : x;
    const leadTo = portAtLeft ? ringCx + ringR : ringCx - ringR;
    return { leadD: `M ${leadFrom} ${cy} L ${leadTo} ${cy}`, ringCx, ringCy: cy, ringR };
  }
}

/** Resistor symbol: the classic zigzag between two stub leads. */
export function resistorSymbol(x: number, y: number, w: number, h: number) {
  const cy = y + h / 2;
  const amp = Math.min(h * 0.4375, 8);
  const zx0 = x + w * 0.219;
  const zx1 = x + w * 0.781;
  const fr = [0, 0.167, 0.389, 0.611, 0.833, 1];
  const pts = fr.map((f, i) => {
    const px = zx0 + (zx1 - zx0) * f;
    const py = i === 0 || i === fr.length - 1 ? cy : i % 2 === 1 ? cy - amp : cy + amp;
    return `${px},${py}`;
  });
  return {
    leftStubD: `M ${x} ${cy} L ${zx0} ${cy}`,
    zigzagPoints: pts.join(' '),
    rightStubD: `M ${zx1} ${cy} L ${x + w} ${cy}`,
  };
}

/** Diode symbol: triangle + cathode bar. `reverse` mirrors the whole shape
 * left-right so `TwoTerminal.polarity === 'reverse'` — already a field on
 * the data model — actually shows up as a flipped diode instead of only
 * being readable from the Edit tab's dropdown. */
export function diodeSymbol(x: number, y: number, w: number, h: number, reverse: boolean) {
  const cy = y + h / 2;
  const amp = Math.min(h * 0.4375, 8);
  const baseF = reverse ? 0.6875 : 0.3125;
  const apexF = reverse ? 0.344 : 0.656;
  const baseX = x + w * baseF;
  const apexX = x + w * apexF;
  return {
    leftStubD: `M ${x} ${cy} L ${Math.min(baseX, apexX)} ${cy}`,
    trianglePoints: `${baseX},${cy - amp} ${baseX},${cy + amp} ${apexX},${cy}`,
    barD: `M ${apexX} ${cy - amp} L ${apexX} ${cy + amp}`,
    rightStubD: `M ${Math.max(baseX, apexX)} ${cy} L ${x + w} ${cy}`,
  };
}

/** Renders the actual symbol for one SYMBOL_NODE_TYPES node — a plain
 * function (not a component) so it can be called directly inside the
 * scene.nodes.map JSX without an extra component-boundary/key wrapper. */
export function renderNodeSymbol(node: SceneNode, color: string, doc: HarnessDocument) {
  const { x, y, width: w, height: h } = node;
  const strokeProps = { stroke: color, strokeWidth: 1.6, style: { pointerEvents: 'none' as const } };
  switch (node.type) {
    case 'splice': {
      const sym = spliceSymbol(x, y, w, h);
      return (
        <g>
          <path d={sym.lineD} fill="none" {...strokeProps} />
          <circle cx={sym.dotCx} cy={sym.dotCy} r={sym.dotR} fill={color} style={{ pointerEvents: 'none' }} />
        </g>
      );
    }
    case 'terminal': {
      const component = doc.components[node.componentId];
      const flipped = component?.type === 'terminal' && component.flipped === true;
      const rotation = component?.rotation ?? 0;
      const sym = terminalSymbol(x, y, w, h, flipped, rotation);
      return (
        <g>
          <path d={sym.leadD} fill="none" {...strokeProps} />
          <circle cx={sym.ringCx} cy={sym.ringCy} r={sym.ringR} fill="none" {...strokeProps} />
        </g>
      );
    }
    case 'resistor': {
      const sym = resistorSymbol(x, y, w, h);
      return (
        <g>
          <path d={sym.leftStubD} fill="none" {...strokeProps} />
          <polyline points={sym.zigzagPoints} fill="none" strokeLinejoin="round" {...strokeProps} />
          <path d={sym.rightStubD} fill="none" {...strokeProps} />
        </g>
      );
    }
    case 'diode': {
      const component = doc.components[node.componentId];
      const reverse = component?.type === 'diode' && component.polarity === 'reverse';
      const sym = diodeSymbol(x, y, w, h, reverse);
      return (
        <g>
          <path d={sym.leftStubD} fill="none" {...strokeProps} />
          <polygon points={sym.trianglePoints} fill="none" strokeLinejoin="round" {...strokeProps} />
          <path d={sym.barD} fill="none" {...strokeProps} />
          <path d={sym.rightStubD} fill="none" {...strokeProps} />
        </g>
      );
    }
    default:
      return null;
  }
}
