/**
 * NIZAM · Root component — financial command-system shell
 * Implemented by: KIRO Contract 4 / Phase 4.2; enhanced by PFOS Contract 04 / Visual Upgrade Wave 1
 * Depends on: app/router.tsx, features/* views, state/store.ts
 */
import { useEffect, useState, type ReactNode } from 'react';
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
import { NetWorthView } from '@/features/netWorth/NetWorthView';

interface NavItem {
  readonly path: RoutePath;
  readonly label: string;
}

interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

const NAV_GROUPS: readonly NavGroup[] = [
  { label: 'Overview', items: [{ path: '/home', label: 'Home' }] },
  {
    label: 'Plan',
    items: [
      { path: '/budget', label: 'Budget' },
      { path: '/forecast', label: 'Forecast' },
      { path: '/decide', label: 'Decide' },
    ],
  },
  {
    label: 'Money',
    items: [
      { path: '/obligations', label: 'Obligations' },
      { path: '/networth', label: 'Net worth' },
    ],
  },
  {
    label: 'Activity',
    items: [
      { path: '/decisions', label: 'Decisions' },
      { path: '/reports', label: 'Reports' },
    ],
  },
  {
    label: 'Tools',
    items: [
      { path: '/import', label: 'Import' },
      { path: '/reconcile', label: 'Reconcile' },
      { path: '/settings', label: 'Settings' },
    ],
  },
] as const;

function SyncBadge() {
  const sessionStatus = useNizamStore((s) => s.sessionStatus);
  const syncStatus = useNizamStore((s) => s.syncStatus);
  const connectDrive = useNizamStore((s) => s.connectDrive);
  const disconnect = useNizamStore((s) => s.disconnect);

  return (
    <div className="sidebar-footer">
      {sessionStatus === 'signedIn' ? (
        <>
          <span className="badge" role="status">
            <span className="status-dot" aria-hidden="true" />
            Drive {syncStatus}
          </span>{' '}
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
  '/networth': <NetWorthView />,
  '/obligations': <ObligationsView />,
  '/settings': <SettingsView />,
};

export default function App() {
  const db = useNizamStore((s) => s.db);
  const hydrateFromCache = useNizamStore((s) => s.hydrateFromCache);
  const route = useHashRoute();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      await hydrateFromCache();
      const state = useNizamStore.getState();
      if (!state.db) {
        useNizamStore.setState({ db: createEmptyDb(new Date().toISOString()) });
      }
    })();
  }, [hydrateFromCache]);

  useEffect(() => {
    setNavOpen(false);
  }, [route.path, route.param]);

  return (
    <div className="app-shell">
      <nav className={`sidebar ${navOpen ? 'open' : ''}`} aria-label="Main navigation">
        <div className="sidebar-top">
          <div>
            <div className="sidebar-brand">NIZAM</div>
            <span className="sidebar-subtitle">Financial command system</span>
          </div>
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={navOpen}
            aria-controls="primary-sidebar-body"
            onClick={() => setNavOpen((open) => !open)}
          >
            {navOpen ? 'Close' : 'Menu'}
          </button>
        </div>
        <div className="sidebar-body" id="primary-sidebar-body">
          <div className="sidebar-nav">
            {NAV_GROUPS.map((group) => (
              <div className="nav-group" key={group.label}>
                <div className="nav-group-label">{group.label}</div>
                {group.items.map((item) => (
                  <a
                    key={item.path}
                    href={`#${item.path}`}
                    className={route.path === item.path ? 'active' : ''}
                    aria-current={route.path === item.path ? 'page' : undefined}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            ))}
          </div>
          <AccountsSidebar />
          <SyncBadge />
        </div>
      </nav>
      <main className="app-main">
        <div className="app-content">
          {db ? <RouterOutlet views={views} /> : <p className="muted">Loading…</p>}
        </div>
      </main>
    </div>
  );
}
