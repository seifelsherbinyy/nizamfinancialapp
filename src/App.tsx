/**
 * NIZAM · Root component — YNAB-style shell: sidebar + router outlet
 * Implemented by: KIRO Contract 4 / Phase 4.2
 * Depends on: app/router.tsx, features/* views, state/store.ts
 */
import { useEffect, type ReactNode } from 'react';
import { RouterOutlet, useHashRoute, type RoutePath } from '@/app/router';
import { useNizamStore } from '@/state/store';
import { createEmptyDb } from '@/lib/db/schema';
import { AccountsSidebar } from '@/features/accounts/AccountsSidebar';
import { BudgetView } from '@/features/budget/BudgetView';
import { Register } from '@/features/transactions/Register';
import { Reports } from '@/features/reports/Reports';
import { ImportWizard } from '@/features/import/ImportWizard';
import { Reconcile } from '@/features/reconciliation/Reconcile';
import { CommandCenter } from '@/features/safeToSpend/CommandCenter';
import { DecideView } from '@/features/decisions/DecideView';
import { ObligationsView } from '@/features/obligations/ObligationsView';
import { SettingsView } from '@/features/settings/SettingsView';
import { ForecastView } from '@/features/forecast/ForecastView';
import { DecisionsView } from '@/features/decisions/DecisionsView';

const NAV: { path: RoutePath; label: string }[] = [
  { path: '/home', label: 'Home' },
  { path: '/budget', label: 'Budget' },
  { path: '/decide', label: 'Decide' },
  { path: '/forecast', label: 'Forecast' },
  { path: '/decisions', label: 'Decisions' },
  { path: '/obligations', label: 'Obligations' },
  { path: '/settings', label: 'Settings' },
  { path: '/reports', label: 'Reports' },
  { path: '/import', label: 'Import' },
  { path: '/reconcile', label: 'Reconcile' },
];

function SyncBadge() {
  const sessionStatus = useNizamStore((s) => s.sessionStatus);
  const syncStatus = useNizamStore((s) => s.syncStatus);
  const connectDrive = useNizamStore((s) => s.connectDrive);
  const disconnect = useNizamStore((s) => s.disconnect);

  return (
    <div className="sidebar-footer">
      {sessionStatus === 'signedIn' ? (
        <>
          <span className="badge">Drive: {syncStatus}</span>{' '}
          <button className="btn btn-sm btn-secondary" onClick={() => void disconnect()}>
            Sign out
          </button>
        </>
      ) : (
        <button
          className="btn btn-sm"
          disabled={sessionStatus === 'signingIn'}
          onClick={() => void connectDrive()}
        >
          {sessionStatus === 'signingIn' ? 'Connecting…' : 'Connect Google Drive'}
        </button>
      )}
    </div>
  );
}

const views: Record<RoutePath, ReactNode> = {
  '/home': <CommandCenter />,
  '/budget': <BudgetView />,
  '/accounts': <Register />,
  '/reports': <Reports />,
  '/import': <ImportWizard />,
  '/reconcile': <Reconcile />,
  '/decide': <DecideView />,
  '/forecast': <ForecastView />,
  '/decisions': <DecisionsView />,
  '/obligations': <ObligationsView />,
  '/settings': <SettingsView />,
};

export default function App() {
  const db = useNizamStore((s) => s.db);
  const hydrateFromCache = useNizamStore((s) => s.hydrateFromCache);
  const route = useHashRoute();

  // Local-first boot: hydrate from the offline cache; start a fresh local db
  // when nothing exists yet (Drive connect merges later).
  useEffect(() => {
    void (async () => {
      await hydrateFromCache();
      const state = useNizamStore.getState();
      if (!state.db) {
        useNizamStore.setState({ db: createEmptyDb(new Date().toISOString()) });
      }
    })();
  }, [hydrateFromCache]);

  return (
    <div className="app-shell">
      <nav className="sidebar" aria-label="Main navigation">
        <div className="sidebar-brand">NIZAM</div>
        <div className="sidebar-nav">
          {NAV.map((n) => (
            <a key={n.path} href={`#${n.path}`} className={route.path === n.path ? 'active' : ''}>
              {n.label}
            </a>
          ))}
        </div>
        <AccountsSidebar />
        <SyncBadge />
      </nav>
      <main className="app-main">
        {db ? <RouterOutlet views={views} /> : <p className="muted">Loading…</p>}
      </main>
    </div>
  );
}
