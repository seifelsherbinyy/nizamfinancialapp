# TanStack Virtual integration

- **Install:** `npm install @tanstack/react-virtual@3.14.9`
- **Surface:** transaction register only after profiling proves a rendering threshold.
- **Theme hook:** use existing list CSS and logical inset properties.
- **Escape hatch:** a `virtualTransactions` flag renders the ordinary table when false.
- **Removal cost:** low when feature-gated.

```tsx
import { useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
export function VirtualRows({ count, renderRow }: { count: number; renderRow(i: number): ReactNode }) {
  const parent = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count, getScrollElement: () => parent.current, estimateSize: () => 38 });
  return <div ref={parent} className="register-scroll" role="rowgroup"><div style={{ height: v.getTotalSize(), position: 'relative' }}>{v.getVirtualItems().map(row => <div role="row" aria-rowindex={row.index + 1} key={row.key} style={{ position:'absolute', insetInline:0, transform:`translateY(${row.start}px)` }}>{renderRow(row.index)}</div>)}</div></div>;
}
```

**Test:** first, middle and last rows are keyboard reachable; assistive technology receives total row count.
