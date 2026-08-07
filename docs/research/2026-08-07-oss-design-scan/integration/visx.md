# visx chart primitives integration

- **Install:** `npm install @visx/shape@4.0.0 @visx/scale@4.0.0`
- **Surface:** replace only the hand-rolled `LineChart` in `Reports.tsx` first.
- **Theme hook:** use CSS custom-property colors and keep an adjacent data table.
- **Escape hatch:** current inline SVG remains the fallback.
- **Removal cost:** medium because geometry is custom.

```tsx
import { LinePath } from '@visx/shape';
import { scaleLinear } from '@visx/scale';
export function NetWorthLine({ points }: { points: { month: string; net: number }[] }) {
  const x = scaleLinear({ domain:[0, Math.max(1, points.length - 1)], range:[24, 616] });
  const y = scaleLinear({ domain:[Math.min(0, ...points.map(p => p.net)), Math.max(1, ...points.map(p => p.net))], range:[156, 24] });
  return <svg role="img" aria-label="Net worth by month" viewBox="0 0 640 180"><title>Net worth by month</title><LinePath data={points} x={(_,i) => x(i)} y={p => y(p.net)} stroke="var(--accent)" strokeWidth={2} /></svg>;
}
```

**Test:** snapshot path bounds, zero/one-point behavior, and equivalent textual values.
