import { useEffect, useRef, useState } from 'react';

// Windowed list: only the rows inside the scroll viewport (plus a few spare) exist in the DOM.
// Give the list a fixed height (className or style) so it scrolls. Items may carry an `id` used as the row key.
// minWidth: the list scrolls sideways inside its own box below that width; header (optional) then lives
// inside the scroll box, pinned to the top, so it moves sideways with the rows.
export default function VirtualList({ items, rowHeight, renderRow, empty, className = '', style, label, minWidth, header }) {
  const ref = useRef(null);
  const [top, setTop] = useState(0);
  const [h, setH] = useState(300);
  useEffect(() => {
    const el = ref.current;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  const first = Math.max(0, Math.floor(top / rowHeight) - 3);
  const last = Math.min(items.length, Math.ceil((top + h) / rowHeight) + 3);
  const rows = [];
  for (let i = first; i < last; i++) rows.push(<div key={items[i].id ?? i} role="listitem" style={{ position: 'absolute', top: i * rowHeight, height: rowHeight, left: 0, right: 0 }}>{renderRow(items[i], i)}</div>);
  return (
    <div ref={ref} className={className} style={{ overflowY: 'auto', position: 'relative', ...style }} onScroll={(e) => setTop(e.currentTarget.scrollTop)} role="list" aria-label={label} tabIndex={0}>
      {header && <div style={{ position: 'sticky', top: 0, zIndex: 2, minWidth }}>{header}</div>}
      {!items.length && empty}
      <div style={{ height: items.length * rowHeight, position: 'relative', minWidth }}>{rows}</div>
    </div>
  );
}
