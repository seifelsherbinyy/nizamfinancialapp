/**
 * NIZAM - Forecast view tests: renders the deterministic cash-flow outlook by horizon.
 * Owning contract: PFOS contract 03 (Decision Engine) section 6 - forecast surface.
 * Build phase: PFOS Stage 3, phase 3.4 - forecast UI.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ForecastView } from './ForecastView.tsx';
import { bootStore, fixtureDb } from '../../../tests/helpers/fixtures.ts';

describe('ForecastView', () => {
  it('renders the cash-flow forecast heading and a by-horizon table', () => {
    const db = fixtureDb();
    db.accounts[0]!.clearedBalance = 2_000_000; // 2000 EGP cleared
    bootStore(db);
    render(<ForecastView />);

    expect(screen.getByRole('heading', { name: /cash-flow forecast/i })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /forecast by horizon/i })).toBeInTheDocument();
  });

  it('lists the fixed forecast horizons', () => {
    const db = fixtureDb();
    db.accounts[0]!.clearedBalance = 2_000_000;
    bootStore(db);
    render(<ForecastView />);

    // The forecast always spans the six fixed horizons.
    expect(screen.getByText('Next day')).toBeInTheDocument();
    expect(screen.getByText('Next week')).toBeInTheDocument();
    expect(screen.getByText('Next month')).toBeInTheDocument();
    expect(screen.getByText('Year')).toBeInTheDocument();
  });
});
