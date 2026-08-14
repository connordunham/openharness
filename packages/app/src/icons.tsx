/**
 * Small physical glyphs per component type (spec §7.2: "Nodes are drawn as
 * small physical glyphs — connector body, splice dot, ring terminal, branch
 * ..."). Used in the "Add" toolbar and on schematic node headers, so a
 * connector, a splice, and a cable read as visually distinct shapes at a
 * glance instead of interchangeable boxes with only a text label telling
 * them apart.
 *
 * Deliberately plain geometric line-icons (16x16, currentColor stroke) —
 * no external icon library, kept dependency-free and consistent with the
 * rest of the schematic canvas rendering.
 */

import type { Component } from '@openharness/core';

type IconType = Component['type'] | 'note';

export function ComponentIcon({ type, size = 14 }: { type: IconType; size?: number }) {
  const common = {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  switch (type) {
    case 'connector':
      return (
        <svg {...common}>
          <rect x={2} y={3} width={9} height={10} rx={1.5} />
          <line x1={11} y1={5.5} x2={14} y2={5.5} />
          <line x1={11} y1={8} x2={14} y2={8} />
          <line x1={11} y1={10.5} x2={14} y2={10.5} />
        </svg>
      );
    case 'splice':
      return (
        <svg {...common}>
          <line x1={1.5} y1={8} x2={5.5} y2={8} />
          <line x1={10.5} y1={8} x2={14.5} y2={8} />
          <circle cx={8} cy={8} r={2.6} />
        </svg>
      );
    case 'terminal':
      return (
        <svg {...common}>
          <line x1={1.5} y1={8} x2={6} y2={8} />
          <circle cx={10} cy={8} r={3.6} />
        </svg>
      );
    case 'resistor':
      return (
        <svg {...common}>
          <line x1={1} y1={8} x2={3.5} y2={8} />
          <polyline points="3.5,8 5,4.5 7,11.5 9,4.5 11,11.5 12.5,8" />
          <line x1={12.5} y1={8} x2={15} y2={8} />
        </svg>
      );
    case 'diode':
      return (
        <svg {...common}>
          <line x1={1.5} y1={8} x2={5} y2={8} />
          <polygon points="5,4.5 5,11.5 10.5,8" />
          <line x1={10.5} y1={4.5} x2={10.5} y2={11.5} />
          <line x1={10.5} y1={8} x2={14.5} y2={8} />
        </svg>
      );
    case 'cable':
      return (
        <svg {...common}>
          <path d="M2 5 Q8 5 8 8 Q8 11 14 11" />
          <path d="M2 11 Q8 11 8 8 Q8 5 14 5" />
        </svg>
      );
    case 'branchPoint':
      return (
        <svg {...common}>
          <circle cx={8} cy={8} r={1.6} fill="currentColor" stroke="none" />
          <line x1={8} y1={8} x2={2} y2={4} />
          <line x1={8} y1={8} x2={2} y2={12} />
          <line x1={8} y1={8} x2={14} y2={8} />
        </svg>
      );
    case 'note':
      return (
        <svg {...common}>
          <rect x={2.5} y={2} width={11} height={12} rx={1.2} />
          <line x1={5} y1={5.5} x2={11} y2={5.5} />
          <line x1={5} y1={8} x2={11} y2={8} />
          <line x1={5} y1={10.5} x2={8.5} y2={10.5} />
        </svg>
      );
    case 'generic':
    default:
      return (
        <svg {...common}>
          <rect x={3} y={3} width={10} height={10} rx={1.5} />
        </svg>
      );
  }
}
