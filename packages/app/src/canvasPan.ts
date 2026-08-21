import { useCallback, useEffect, useRef } from 'react';

/**
 * Classify a wheel event for the canvases' input mapping (review B3, T04
 * contract): with a mouse the wheel zooms; with a trackpad the wheel pans
 * and pinch zooms.
 *
 * Every major browser delivers a trackpad pinch as a wheel event with
 * `ctrlKey` set, so that is the reliable zoom signal. `deltaZ` is the
 * designated trackpad-wheel marker here (carried over from the original
 * pinch detection). Caveat worth knowing: real two-finger trackpad scrolling
 * usually reports only deltaX/deltaY with no ctrlKey and no deltaZ, so on
 * such hardware it takes the zoom path — distinguishing it from a mouse
 * wheel would need delta-magnitude heuristics, which this deliberately does
 * not attempt (see the Phase-1 fix report).
 */
export function classifyWheelInput(e: { ctrlKey: boolean; deltaZ: number }): 'zoom' | 'pan' {
  if (e.ctrlKey) return 'zoom'; // pinch (all engines synthesise ctrl+wheel)
  if (Math.abs(e.deltaZ) > 0.01) return 'pan'; // trackpad wheel
  return 'zoom'; // plain vertical wheel: mouse
}

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
 * Also wires up mouse-wheel/trackpad scrolling manually (Connor, after
 * trying the click-drag pan above: "I still can[not] scroll around
 * individual panes to see large designs"). The container is plain
 * `overflow: auto`, which normally scrolls on wheel input for free — but in
 * practice that native path was unreliable here. Rather than chase the
 * exact cause, this attaches a real, non-passive `wheel` listener (a plain
 * `addEventListener`, NOT a React `onWheel` prop — React's synthetic wheel
 * handler is passive by default, so `preventDefault()` inside it is
 * silently ignored and can't actually override the native scroll path) and
 * drives `scrollLeft`/`scrollTop` from the event's own delta. That makes
 * this the ONE mechanism doing the scrolling, so it works the same way
 * every time regardless of whatever native quirk was swallowing it before.
 *
 * Since T04 this listener is also the single decision point for wheel input
 * (review B3): it classifies every event via `classifyWheelInput` and either
 * pans the container itself or delegates to the zoom handler passed in by
 * `useCanvasZoom`. Before that split, this hook panned on EVERY wheel event
 * while each canvas independently zoomed on ctrl/deltaZ events — so a
 * trackpad pinch zoomed and panned at once, and a mouse wheel panned when
 * the contract says it zooms. Zoom math lives in `useCanvasZoom` /
 * `zoomViewAboutCursor`, not here.
 */
export function useCanvasPan(scrollRef: React.RefObject<HTMLDivElement>, onWheelZoom: (e: WheelEvent) => void) {
  const panState = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (classifyWheelInput(e) === 'zoom') {
        onWheelZoom(e);
      } else {
        el.scrollLeft += e.deltaX;
        el.scrollTop += e.deltaY;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scrollRef, onWheelZoom]);

  const onBackgroundMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Left and middle button. Right is left alone so an accidental pan
      // can't eat a context menu.
      //
      // Left-drag reaching this handler at all is now conditional: the
      // Schematic canvas claims plain left-drag on its background for
      // marquee selection and calls `stopPropagation`, so what arrives here
      // from that pane is ALT+left-drag and middle-drag. Layout, which has
      // no marquee, still gets plain left-drag. This hook doesn't need to
      // know which pane it's in — it pans whatever reaches it.
      if (e.button !== 0 && e.button !== 1) return;
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
