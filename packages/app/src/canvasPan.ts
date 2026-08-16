import { useCallback, useRef } from 'react';

/**
 * Click-and-drag panning for a large scrollable canvas (Connor: "users
 * should be able to scroll around large schematic and layout panes for
 * larger designs"). Both SchematicCanvas and LayoutCanvas already sit in a
 * plain `overflow: auto` container sized to fit their content, so trackpad/
 * scrollbar scrolling technically worked — but for a canvas-editing surface,
 * grabbing and dragging the background reads much more naturally than
 * hunting for a scrollbar once a design grows past the visible pane, which
 * is exactly the "larger designs" case being called out here.
 *
 * `onBackgroundMouseDown` is meant to be wired to the SAME element that has
 * `overflow: auto` (the thing being scrolled), NOT the inner SVG — dragging
 * adjusts that element's `scrollLeft`/`scrollTop` directly. It's safe to
 * attach at that outer level even though nodes/wires/waypoints inside also
 * have their own `onMouseDown` handlers, because every one of those already
 * calls `e.stopPropagation()` (pre-existing, for their own drag logic), so
 * this only ever fires when the mousedown actually lands on empty canvas
 * background — never on a component, wire, or handle.
 *
 * Deliberately pan-only, no zoom: zoom would require every existing
 * pixel-delta drag calculation in both canvases (node drag, waypoint drag,
 * wire drag, click-to-insert-routing-node) to divide by a zoom factor to
 * stay correct, which is a much larger, riskier change than what was asked
 * for here. Left for a later pass if actually needed.
 */
export function useCanvasPan(scrollRef: React.RefObject<HTMLDivElement>) {
  const panState = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);

  const onBackgroundMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Left button only — middle/right are left free for other tools
      // (context menus etc.), and we don't want an accidental pan to eat a
      // right-click.
      if (e.button !== 0) return;
      const el = scrollRef.current;
      if (!el) return;
      panState.current = { startX: e.clientX, startY: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
      let moved = false;
      const onMove = (ev: MouseEvent) => {
        const state = panState.current;
        const container = scrollRef.current;
        if (!state || !container) return;
        const dx = ev.clientX - state.startX;
        const dy = ev.clientY - state.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        if (!moved) return;
        container.scrollLeft = state.scrollLeft - dx;
        container.scrollTop = state.scrollTop - dy;
        container.style.cursor = 'grabbing';
      };
      const onUp = () => {
        panState.current = null;
        if (scrollRef.current) scrollRef.current.style.cursor = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [scrollRef],
  );

  return { onBackgroundMouseDown };
}
