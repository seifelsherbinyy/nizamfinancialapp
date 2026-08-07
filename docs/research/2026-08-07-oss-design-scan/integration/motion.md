# Motion integration

- **Install:** `npm install motion@13.0.0`
- **Surface:** decision-card state and sync confirmation only after the static UI ships.
- **Theme hook:** tokenized 120/180/260 ms durations.
- **Escape hatch:** components work without `motion.*`; animation is progressive enhancement.
- **Removal cost:** low if wrappers stay local.

```tsx
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
export function DecisionState({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return <motion.div initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : 0.18 }}>{children}</motion.div>;
}
```

**Test:** mocked reduced-motion yields zero duration and no initial transform.
