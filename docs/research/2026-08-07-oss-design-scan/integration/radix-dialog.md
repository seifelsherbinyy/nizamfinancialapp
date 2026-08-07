# Radix Dialog integration

- **Install:** `npm install @radix-ui/react-dialog@1.1.23`
- **Surface:** replace `src/components/Modal.tsx` only after focus tests pass.
- **Theme hook:** retain `.modal` and `.modal-backdrop` mapped to existing CSS tokens.
- **Escape hatch:** the current `Modal.tsx` is the fallback.
- **Removal cost:** low, about half a day.

```tsx
import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

export function Modal(props: { title: string; onClose(): void; children: ReactNode }) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop" />
        <Dialog.Content className="modal" aria-describedby={undefined}>
          <Dialog.Title>{props.title}</Dialog.Title>
          {props.children}
          <Dialog.Close className="btn btn-secondary">Close</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

**Test:** Tab wraps inside the dialog, Escape closes it, and focus returns to the trigger.
