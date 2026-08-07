# React DayPicker integration

- **Install:** `npm install @daypicker/react@10.0.1`
- **Surface:** obligations due-date picker and report date ranges.
- **Theme hook:** override DayPicker CSS variables with NIZAM tokens.
- **Escape hatch:** retain native `<input type="date">`.
- **Removal cost:** low.

```tsx
import { DayPicker } from '@daypicker/react';
import '@daypicker/react/style.css';
export function DueDatePicker({ date, onChange }: { date?: Date; onChange(date?: Date): void }) {
  return <DayPicker mode="single" selected={date} onSelect={onChange} aria-label="Choose obligation due date" />;
}
```

**Test:** keyboard-select a date, reopen with selection retained, and verify RTL in the localization spike.
