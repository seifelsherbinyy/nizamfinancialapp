/**
 * NIZAM - Command Center tests: safe-to-spend headline, obligation statuses, net worth.
 * Owning contract: PFOS contract 04 (Interface) section 2 - the Command Center / Home.
 * Build phase: PFOS Stage 1, phase 1.4 - Command Center UI.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandCenter } from './CommandCenter';
import { bootStore, fixtureDb } from '../../../tests/helpers/fixtures';
import { createEmptyDb } from '@/lib/db/schema';
import { addDays } from '@/features/obligations/obligations.logic';
import type { Obligation } from '@/features/obligations/obligation.types';

const BASE_OB: Obligation = {
  id: 'ob_rent',
  creditor: 'Landlord',
  accountId: null,
  amountDue: 30_000,
  minimumDue: 30_000,
  dueDate: '2099-01-15',
  graceDate: null,
  frequency: 'monthly',
  priority: 'P0',
  penalty: 0,
  interestBps: 0,
  autopay: false,
  verificationSource: 'manual',
  confidence: 0.9,
  protectedReserve: 0,
};

describe('CommandCenter', () => {
  it('shows safe-to-spend, a funded obligation, and net worth', () => {
    const db = fixtureDb();
    db.accounts[0]!.clearedBalance = 500_000; // 500 EGP cash, no reserves due
    db.obligations.push({ ...BASE_OB });
    bootStore(db);
    render(<CommandCenter />);

    expect(screen.getByRole('heading', { name: /command center/i })).toBeInTheDocument();

    const banner = screen.getByRole('status', { name: /safe to spend/i });
    expect(banner.textContent).toContain('500.00');

    expect(screen.getByText('Landlord')).toBeInTheDocument();
    const oblTable = screen.getByRole('table', { name: /obligation protection/i });
    expect(oblTable.textContent).toContain('Funded');

    expect(screen.getByRole('heading', { name: /net worth/i })).toBeInTheDocument();
    const nwTable = screen.getByRole('table', { name: /net worth views/i });
    expect(nwTable.textContent).toContain('Nominal');
    expect(screen.getByText(/figures in EGP/i)).toBeInTheDocument();
  });

  it('surfaces a deficit when a near-term obligation exceeds cash', () => {
    const db = fixtureDb();
    db.accounts[0]!.clearedBalance = 10_000; // only 10 EGP
    const asOf = new Date().toISOString().slice(0, 10);
    db.obligations.push({
      ...BASE_OB,
      id: 'ob_urgent',
      amountDue: 100_000,
      minimumDue: 100_000,
      dueDate: addDays(asOf, 3),
    });
    bootStore(db);
    render(<CommandCenter />);

    expect(screen.getByRole('alert').textContent).toMatch(/over-committed/i);
  });

  it('offers sample data on an empty portfolio and populates the view on load', () => {
    bootStore(createEmptyDb(new Date().toISOString()));
    render(<CommandCenter />);
    const load = screen.getByRole('button', { name: /load sample data/i });
    fireEvent.click(load);
    // The empty state is gone and the worked portfolio now renders.
    expect(screen.getByRole('status', { name: /safe to spend/i })).toBeInTheDocument();
    expect(screen.getByText('Landlord')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /net worth views/i })).toBeInTheDocument();
  });

  it('invites the owner to add obligations when none exist', () => {
    const db = fixtureDb();
    db.accounts[0]!.clearedBalance = 200_000;
    bootStore(db);
    render(<CommandCenter />);
    expect(screen.getByText(/no obligations tracked yet/i)).toBeInTheDocument();
  });
});
