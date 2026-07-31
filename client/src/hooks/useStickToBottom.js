import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { isNearBottom } from '@/lib/chatScroll';

/**
 * Keeps a scroll viewport pinned to its newest content while the reader is
 * already at the bottom, and stops following the moment they scroll up to
 * re-read something. `pinned` is false exactly when the viewport has fallen
 * behind, which is when a "jump to latest" affordance is worth showing.
 *
 * The pinned flag is tracked from scroll events rather than measured after the
 * DOM grows: once a long reply has been appended, the viewport is no longer
 * near its bottom, so measuring at that point would drop the follow.
 *
 * @param {{ current: HTMLElement | null }} viewportRef
 * @param {string} growthKey  changes whenever the content has grown
 */
export function useStickToBottom(viewportRef, growthKey) {
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;

    const handleScroll = () => {
      const next = isNearBottom(viewport);
      pinnedRef.current = next;
      setPinned(next);
    };

    viewport.addEventListener('scroll', handleScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, [viewportRef]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !pinnedRef.current) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [viewportRef, growthKey]);

  // A scroll written while the panel is hidden (the lesson page keeps it mounted
  // behind the transcript tab) is discarded, so replies that arrived off-tab
  // would come back scrolled away. Coming back into view resizes the viewport
  // from 0×0, which is the signal to catch it up.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => {
      if (!pinnedRef.current) return;
      viewport.scrollTop = viewport.scrollHeight;
    });

    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewportRef]);

  const scrollToBottom = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    pinnedRef.current = true;
    setPinned(true);
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
  }, [viewportRef]);

  return { pinned, scrollToBottom };
}
