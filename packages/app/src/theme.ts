/**
 * Shared visual design tokens (spec: "keep the UI very clean and nice to
 * use" — Connor, follow-up request after base functionality landed). One
 * small palette + spacing scale imported by App.tsx and SchematicCanvas.tsx
 * so the toolbar, panels, and canvas read as one coherent app instead of
 * two components independently choosing colors.
 *
 * Dark mode (follow-up request): every color below is a CSS custom-property
 * reference rather than a literal hex value. The actual light/dark values
 * live in index.css as `:root` vs `[data-theme='dark']` rules, so toggling
 * `document.documentElement.dataset.theme` (see App.tsx) re-themes the whole
 * app instantly with zero changes needed in any component that consumes
 * `theme.color.*` — they're just var() strings, which every CSS/SVG color
 * property accepts natively.
 */

export const theme = {
  color: {
    // Neutrals
    surface: 'var(--oh-surface)',
    canvasBg: 'var(--oh-canvasBg)',
    border: 'var(--oh-border)',
    borderStrong: 'var(--oh-borderStrong)',

    textStrong: 'var(--oh-textStrong)',
    textMuted: 'var(--oh-textMuted)',
    textFaint: 'var(--oh-textFaint)',

    // Brand / accent
    accent: 'var(--oh-accent)',
    accentSoft: 'var(--oh-accentSoft)',
    accentHover: 'var(--oh-accentHover)',

    // Status
    danger: 'var(--oh-danger)',
    dangerSoft: 'var(--oh-dangerSoft)',
    dangerBorder: 'var(--oh-dangerBorder)',
    warning: 'var(--oh-warning)',
    warningSoft: 'var(--oh-warningSoft)',
    info: 'var(--oh-info)',
    infoSoft: 'var(--oh-infoSoft)',

    // Canvas
    nodeFill: 'var(--oh-nodeFill)',
    nodeBorder: 'var(--oh-nodeBorder)',
    headerFill: 'var(--oh-headerFill)',
    gridDot: 'var(--oh-gridDot)',
    noteFill: 'var(--oh-noteFill)',
    noteBorder: 'var(--oh-noteBorder)',
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
