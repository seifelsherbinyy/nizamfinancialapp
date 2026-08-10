/**
 * NIZAM - Decide view tests: purchase request form renders the 11-line Decision Card.
 * Owning contract: PFOS contract 04 (Interface) section 4.4 - the Decision Card.
 * Build phase: PFOS Stage 2, phase 2.3 - Decide route + card render.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DecideView } from './DecideView.tsx';
import { bootStore, fixtureDb } from '../../../tests/helpers/fixtures.ts';
import { useNizamStore } from '@/state/store';

function seeded(cash: number) {
  const db = fixtureDb();
  db.accounts[0]!.clearedBalance = cash;
  return db;
}

function enterPrice(egp: string) {
  const price = screen.getByRole('textbox', { name: /purchase price/i });
  fireEvent.change(price, { target: { value: egp } });
  fireEvent.blur(price);
}

describe('DecideView', () => {
  it('prompts for a price before showing a recommendation', () => {
    bootStore(seeded(1_000_000));
    render(<DecideView />);
    expect(screen.getByText(/enter a price above/i)).toBeInTheDocument();
  });

  it('approves an easily affordable cash purchase', () => {
    bootStore(seeded(1_000_000)); // 1000 EGP on hand
    render(<DecideView />);
    enterPrice('50');
    const rec = screen.getByRole('status', { name: /recommendation/i });
    expect(rec.textContent).toMatch(/approve/i);
    // An easily affordable purchase gets an UNqualified approve (no cap/condition).
    expect(rec.textContent).not.toMatch(/cap|condition/i);
    expect(screen.getByText(/next step/i)).toBeInTheDocument();
    // The card renders the forward horizons.
    expect(screen.getByRole('table', { name: /time-horizon impact/i })).toBeInTheDocument();
  });

  it('qualifies a purchase far beyond cash on hand rather than approving outright', () => {
    bootStore(seeded(100_000)); // only 100 EGP
    render(<DecideView />);
    enterPrice('5000'); // 5000 EGP - far beyond safe-to-spend
    const rec = screen.getByRole('status', { name: /recommendation/i });
    // Not an unconditional green light: the engine caps, conditions, delays, or refuses.
    expect(rec.textContent).toMatch(/cap|condition|reject|blocked|delay|alternative/i);
  });

  it('records a decision into the append-only registry', () => {
    bootStore(seeded(1_000_000));
    render(<DecideView />);
    enterPrice('50');
    expect(useNizamStore.getState().db!.decisions).toHaveLength(0);
    const btn = screen.getByRole('button', { name: /record this decision/i });
    fireEvent.click(btn);
    const recs = useNizamStore.getState().db!.decisions;
    expect(recs).toHaveLength(1);
    expect(recs[0]!.userAction).toBe('pending');
    expect(recs[0]!.recommendation).toMatch(/approve/i);
    // Confirmation is shown and the button disables to prevent a double-write.
    expect(screen.getByText(/recorded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record this decision/i })).toBeDisabled();
  });
});
