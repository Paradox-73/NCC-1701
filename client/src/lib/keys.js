// Keyboard shortcuts (DESIGN.md, At the helm). The shell owns the global keys and a station owns its local ones;
// this file holds the one rule both follow, so a key press never sends a command twice.
import { useEffect, useRef } from 'react';

/** True where shortcuts stay out of the way: typing in a field, or focus inside a dialog that has keys of its own. */
export const inField = (el) => !!el?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]');

/**
 * A station's own shortcuts: { key: fn }, with 'Shift+X' for a shifted letter. A bound key is consumed
 * (preventDefault), and the listener sits on document, which a key event reaches before window: the shell's global
 * handler on window then sees the key as taken and leaves it alone. A held key repeats nothing.
 */
export function useKeys(map) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    const on = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || inField(e.target)) return;
      const fn = ref.current[(e.shiftKey && e.key.length === 1 ? 'Shift+' : '') + e.key] ?? ref.current[e.key];
      if (!fn) return;
      e.preventDefault();
      if (!e.repeat) fn(e);
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, []);
}
