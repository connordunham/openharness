/**
 * Shared visual design tokens (spec: "keep the UI very clean and nice to
 * use" — Connor, follow-up request after base functionality landed). One
 * small palette + spacing scale imported by App.tsx and SchematicCanvas.tsx
 * so the toolbar, panels, and canvas read as one coherent app instead of
 * two components independently choosing colors.
 */

export const theme = {
  color: {
    // Neutrals
    surface: '#ffffff',
    canvasBg: '#fafafa',
    border: '#e2e4e8',
    borderStrong: '#c9cdd4',

    textStrong: '#1a1d23',
    textMuted: '#5b616e',
    textFaint: '#8a8f99',

    // Brand / accent
    accent: '#2f6fed',
    accentSoft: '#eaf1ff',
    accentHover: '#2860d0',

    // Status
    danger: '#c4362f',
    dangerSoft: '#fdf1f0',
    dangerBorder: '#f2c9c6',
    warning: '#a15c07',
    warningSoft: '#fdf3e2',
    info: '#1c5fc9',
    infoSoft: '#eaf2ff',

    // Canvas
    nodeFill: '#ffffff',
    nodeBorder: '#c9cdd4',
    headerFill: '#f3f4f6',
    gridDot: '#e5e7eb',
    noteFill: '#fffdf0',
    noteBorder: '#e8dfa8',
  },
  radius: {
    control: 6,
    panel: 10,
    node: 8,
  },
  shadow: {
    selected: 'drop-shadow(0 1px 4px rgba(47, 111, 237, 0.35))',
    panel: '0 1px 3px rgba(16, 24, 40, 0.06)',
  },
  space: (n: number): number => n * 4,
} as const;
