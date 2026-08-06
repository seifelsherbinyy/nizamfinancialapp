/**
 * NIZAM - Decisions view tests: the append-only registry lists decisions and follow-through.
 * Owning contract: PFOS contract 03 (Decision Engine) section 12 - decision outcome registry.
 * Build phase: PFOS Stage 3, phase 3.4 - decision registry UI.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DecisionsView } from './DecisionsView';
import { decidePurchase } from './decision.logic';
import { recordDecision } from './decisionRegistry';
import { bootStore, fixtureDb } from '../../../tests/helpers/fixtures';
import { useNizamStore } from '@/state/store';

function seededWithDecision() {
  const db = fixtureDb();
  db.accounts[0]!.clearedBalance = 1_000_000; // 1000 EGP
  const card = decidePurchase(db, '2026-08-06', {
    price: 50_000,
    paymentMethod: 'cash',
    accountId: null,
    category: null,
    date: '2026-08-06',
    reversible: true,
    purpose: 'a test item',
    urgency: 'medium',
    alternativePrice: null,
  });
  db.decisions.push(
    recordDecision({
      id: 'dec_1',
      createdAt: '2026-08-06T09:00:00.000Z',
      question: 'Buy a test item',
      card,
      policyVersion: db.schemaVersion,
      dataSnapshotId: 'snap-0',
      userAction: 'pending',
    }),
  );
  return db;
}

describe('DecisionsView', () => {
  it('shows an empty state when nothing is recorded', () => {
    bootStore(fixtureDb());
    render(<DecisionsView />);
    expect(screen.getByText(/no decisions recorded yet/i)).toBeInTheDocument();
  });

  it('renders a recorded decision and updates its follow-through', () => {
    bootStore(seededWithDecision());
    render(<DecisionsView />);

    expect(screen.getByRole('table', { name: /decision registry/i })).toBeInTheDocument();
    expect(screen.getByText('Buy a test item')).toBeInTheDocument();
    expect(useNizamStore.getState().db!.decisions[0]!.userAction).toBe('pending');

    fireEvent.click(screen.getByRole('button', { name: /mark followed/i }));
    expect(useNizamStore.getState().db!.decisions[0]!.userAction).toBe('followed');
  });
});
