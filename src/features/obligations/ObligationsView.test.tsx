/**
 * NIZAM - Obligations manager tests: add, validate, edit, delete.
 * Owning contract: PFOS contract 02 (Data Architecture) section 6 - obligation registry.
 * Build phase: PFOS Stage 1, phase 1.5 - obligation editor UI.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ObligationsView } from './ObligationsView';
import { bootStore, fixtureDb } from '../../../tests/helpers/fixtures';
import { useNizamStore } from '@/state/store';
import type { Obligation } from './obligation.types';

function mkOb(creditor: string, amount: number): Obligation {
  return {
    id: `ob_${creditor}`,
    creditor,
    accountId: null,
    amountDue: amount,
    minimumDue: amount,
    dueDate: '2027-02-01',
    graceDate: null,
    frequency: 'monthly',
    priority: 'P1',
    penalty: 0,
    interestBps: 0,
    autopay: false,
    verificationSource: 'manual',
    confidence: 0.85,
    protectedReserve: 0,
  };
}

function openAdd() {
  fireEvent.click(screen.getByRole('button', { name: /add obligation/i }));
}

describe('ObligationsView', () => {
  it('shows an empty state before any obligation exists', () => {
    bootStore(fixtureDb());
    render(<ObligationsView />);
    expect(screen.getByText(/no obligations yet/i)).toBeInTheDocument();
  });

  it('adds an obligation and persists it', () => {
    bootStore(fixtureDb());
    render(<ObligationsView />);
    openAdd();
    fireEvent.change(screen.getByRole('textbox', { name: /creditor/i }), {
      target: { value: 'Landlord' },
    });
    const amount = screen.getByRole('textbox', { name: /amount due/i });
    fireEvent.change(amount, { target: { value: '8000' } });
    fireEvent.blur(amount);
    fireEvent.change(screen.getByLabelText(/due date/i), { target: { value: '2027-03-01' } });
    fireEvent.click(screen.getByRole('button', { name: /save obligation/i }));

    const obs = useNizamStore.getState().db!.obligations;
    expect(obs.length).toBe(1);
    expect(obs[0]!.creditor).toBe('Landlord');
    expect(obs[0]!.amountDue).toBe(8_000_000);
    expect(obs[0]!.minimumDue).toBe(8_000_000); // blank minimum defaults to the full amount
    expect(screen.getByText('Landlord')).toBeInTheDocument();
  });

  it('refuses an obligation with no amount', () => {
    bootStore(fixtureDb());
    render(<ObligationsView />);
    openAdd();
    fireEvent.change(screen.getByRole('textbox', { name: /creditor/i }), {
      target: { value: 'X' },
    });
    fireEvent.change(screen.getByLabelText(/due date/i), { target: { value: '2027-03-01' } });
    fireEvent.click(screen.getByRole('button', { name: /save obligation/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/positive amount/i);
    expect(useNizamStore.getState().db!.obligations.length).toBe(0);
  });

  it('edits an existing obligation', () => {
    const db = fixtureDb();
    db.obligations.push(mkOb('Auto Finance', 6_000_000));
    bootStore(db);
    render(<ObligationsView />);
    fireEvent.click(screen.getByRole('button', { name: /edit auto finance/i }));
    const amount = screen.getByRole('textbox', { name: /amount due/i });
    fireEvent.change(amount, { target: { value: '7500' } });
    fireEvent.blur(amount);
    fireEvent.click(screen.getByRole('button', { name: /save obligation/i }));
    const obs = useNizamStore.getState().db!.obligations;
    expect(obs.length).toBe(1);
    expect(obs[0]!.amountDue).toBe(7_500_000);
  });

  it('deletes an obligation', () => {
    const db = fixtureDb();
    db.obligations.push(mkOb('Landlord', 8_000_000));
    bootStore(db);
    render(<ObligationsView />);
    expect(screen.getByText('Landlord')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /delete landlord/i }));
    expect(useNizamStore.getState().db!.obligations.length).toBe(0);
  });
});
