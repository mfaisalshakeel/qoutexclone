import { useEffect, useState } from 'react';

/**
 * Subscribes to a CSS media query.
 *
 * The terminal used to mount its ticket and positions panel twice — once for
 * each breakpoint — and hide one with Tailwind. That doubled the work, doubled
 * the DOM and made every selector ambiguous, so layout choices that change
 * *what* renders (rather than how it looks) are made here instead.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Tailwind's `md` breakpoint, where the terminal switches to the desktop layout. */
export const DESKTOP_QUERY = '(min-width: 768px)';
