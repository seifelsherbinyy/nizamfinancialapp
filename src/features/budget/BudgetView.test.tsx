/**
 * NIZAM · BudgetView tests — RTA header, editable assigned, groups, month nav
 * Implemented by: KIRO Contract 4 / Phase 4.3
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BudgetView } from './BudgetView';
import { bootStore, fixtureDb, makeTxn } from '../../../tests/helpers/fixtures';
import { useNizamStore } from '@/state/store';
import { setAssigned, computeMonth } from './budget.logic';

const THIS_MONTH = new Date().toISOString().slice(0, 7);

function seededDb() {
  const db = fixtureDb();
  db.transactions.push(
    makeTxn({
      accountId: 'acc_cib',
      date: `${THIS_MONTH}-01`,
      amount: 100_000,
      categoryId: 'cat_income',
    }),
    makeTxn({
      accountId: 'acc_cib',
      date: `${THIS_MONTH}-05`,
      amount: -25_000,
      categoryId: 'cat_groc',
    }),
  );
  setAssigned(db, THIS_MONTH, 'cat_groc', 60_000);
  return db;
}

describe('BudgetView', () => {
  it('shows Ready-To-Assign from the engine in the header', () => {
    bootStore(seededDb());
    render(<BudgetView />);
    const banner = screen.getByRole('status', { name: /ready to assign/i });
    expect(banner.textContent).toContain('40.00'); // 100000 − 60000 milliunits
  });

  it('renders category groups as grouped rows in a native table', () => {
    bootStore(seededDb());
    render(<BudgetView />);
    const table = screen.getByRole('table', { name: /budget grid/i });
    expect(table).toBeInTheDocument();
    expect(screen.getByText('Essentials')).toBeInTheDocument();
    expect(screen.getByText('Groceries')).toBeInTheDocument();
  });

  it('editing Assigned updates Available immediately and persists to the store', () => {
    bootStore(seededDb());
    render(<BudgetView />);
    const input = screen.getByRole('textbox', { name: /assigned for groceries/i });
    fireEvent.change(input, { target: { value: '80' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Persisted through the store:
    const db = useNizamStore.getState().db;
    expect(db?.months.find((m) => m.month === THIS_MONTH)?.categories['cat_groc']?.assigned).toBe(
      80_000,
    );
    // Engine agrees (available = 80000 − 25000):
    expect(computeMonth(db!, THIS_MONTH).categories['cat_groc']?.available).toBe(55_000);
    // Available cell re-rendered live:
    const row = screen.getByText('Groceries').closest('tr');
    expect(row?.textContent).toContain('55.00');
  });

  it('navigates months with accessible buttons', () => {
    bootStore(seededDb());
    render(<BudgetView />);
    const heading = screen.getByRole('heading', { level: 2 });
    const before = heading.textContent;
    fireEvent.click(screen.getByRole('button', { name: /previous month/i }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).not.toBe(before);
  });

  it('offers the starter-seed action when no categories exist', () => {
    const db = fixtureDb();
    db.categories = [];
    db.categoryGroups = [];
    bootStore(db);
    render(<BudgetView />);
    fireEvent.click(screen.getByRole('button', { name: /load starter categories/i }));
    expect(useNizamStore.getState().db?.categories.length).toBeGreaterThan(0);
  });
});
