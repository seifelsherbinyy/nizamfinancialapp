# React Aria conditional integration

- **Install:** `npm install react-aria-components@1.20.0`
- **Condition:** only if Arabic/Hijri or a complex screen-reader-tested DateField becomes committed. Full-import estimate exceeds the surface gate; measure granular imports first.
- **Surface:** obligations calendar.
- **Theme hook:** render-prop classes mapped to NIZAM tokens.
- **Escape hatch:** DayPicker remains the Gregorian fallback.
- **Removal cost:** medium.

```tsx
import { I18nProvider, DateField, DateInput, DateSegment, Label } from 'react-aria-components';
export function ArabicDueDate() {
  return <I18nProvider locale="ar-AE"><DateField><Label>تاريخ الاستحقاق</Label><DateInput>{segment => <DateSegment segment={segment} />}</DateInput></DateField></I18nProvider>;
}
```

**Test:** Arabic segment order, mirrored arrow behavior, screen-reader labels, and granular production bundle delta.
