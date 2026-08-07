# Lucide integration

- **Install:** `npm install lucide-react@1.30.0`
- **Surface:** navigation and labelled actions, not decorative KPI tiles.
- **Theme hook:** use `currentColor`, 1.75 stroke and logical icon spacing.
- **Escape hatch:** icons are optional decoration; remove them without changing labels.
- **Removal cost:** very low.

```tsx
import { WalletCards } from 'lucide-react';
export function AccountsLabel() {
  return <span className="nav-label"><WalletCards aria-hidden="true" size={18} /><span>Accounts</span></span>;
}
```

**Test:** the icon is absent from the accessibility tree while the text name remains.
