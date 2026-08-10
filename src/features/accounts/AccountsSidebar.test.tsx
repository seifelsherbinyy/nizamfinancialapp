/**
 * NIZAM · AccountsSidebar tests — grouping, balances, redaction
 * Implemented by: KIRO Contract 4 / Phase 4.2
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccountsSidebar } from './AccountsSidebar.tsx';
import { bootStore, fixtureDb, makeTxn } from '../../../tests/helpers/fixtures.ts';
import { redactIdentifier } from './accounts.types.ts';

beforeEach(() => {
  window.location.hash = '#/budget';
});

describe('AccountsSidebar', () => {
  it('groups on-budget and tracking accounts separately', () => {
    bootStore();
    render(<AccountsSidebar />);
    expect(screen.getByText(/On Budget/)).toBeInTheDocument();
    expect(screen.getByText(/Tracking/)).toBeInTheDocument();
    expect(screen.getByText('CIB Current')).toBeInTheDocument();
    expect(screen.getByText('Pension')).toBeInTheDocument();
  });

  it('shows balances derived from the store transactions', () => {
    const db = fixtureDb();
    db.transactions.push(
      makeTxn({ accountId: 'acc_cib', date: '2026-03-01', amount: 150_000 }),
      makeTxn({ accountId: 'acc_cib', date: '2026-03-02', amount: -50_000 }),
    );
    bootStore(db);
    render(<AccountsSidebar />);
    const row = screen.getByText('CIB Current').closest('a');
    // 100_000 milliunits = EGP 100.00
    expect(row?.textContent).toContain('100.00');
  });

  it('redacts account identifiers to the last four characters', () => {
    bootStore();
    render(<AccountsSidebar />);
    expect(screen.getAllByText(/••••9876/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/12349876/)).toBeNull();
    expect(redactIdentifier('12349876')).toBe('••••9876');
  });

  it('offers an add-account action', () => {
    bootStore();
    render(<AccountsSidebar />);
    expect(screen.getByRole('button', { name: /Add Account/i })).toBeInTheDocument();
  });
});
