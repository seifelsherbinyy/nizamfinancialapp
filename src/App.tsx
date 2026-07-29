/**
 * NIZAM · Root component — router outlet + app chrome
 * Implemented by: KIRO Contract 1 / Phase 1.3 (shell; YNAB-style chrome lands in Contract 4)
 * Depends on: app/router.tsx
 */
import type { ReactNode } from 'react';
import { RouterOutlet, type RoutePath } from '@/app/router';

function Stub(props: { title: string }) {
  return (
    <section>
      <h1>{props.title}</h1>
      <p>Coming in a later contract.</p>
    </section>
  );
}

const views: Record<RoutePath, ReactNode> = {
  '/budget': <Stub title="Budget" />,
  '/accounts': <Stub title="Accounts" />,
  '/reports': <Stub title="Reports" />,
  '/import': <Stub title="Import" />,
  '/reconcile': <Stub title="Reconcile" />,
};

export default function App() {
  return (
    <main>
      <RouterOutlet views={views} />
    </main>
  );
}
