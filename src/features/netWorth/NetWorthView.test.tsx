/**
 * NIZAM - Net worth view tests: the summary renders and the asset editor writes to the DB.
 * Owning contract: PFOS contract 03 (Decision Engine) section 8 - net-worth engine + assets.
 * Build phase: PFOS Stage 4, phase 4.4 - net-worth UI + asset/FX editor.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NetWorthView } from './NetWorthView';
import { bootStore, fixtureDb } from '../../../tests/helpers/fixtures';
import { useNizamStore } from '@/state/store';
import type { Asset } from './netWorth.types';

function egpAsset(): Asset {
  return {
    id: 'asset_1',
    name: 'Brokerage',
    kind: 'financial',
    currency: 'EGP',
    value: 500_000, // 500 EGP
    liquid: true,
    liquidationDiscountBps: 0,
    valuationSource: 'manual',
    valuationAsOf: '2026-08-06',
  };
}

describe('NetWorthView', () => {
  it('shows the net-worth summary and empty asset/rate prompts', () => {
    bootStore(fixtureDb());
    render(<NetWorthView />);
    expect(screen.getByRole('heading', { name: /^net worth$/i })).toBeInTheDocument();
    expect(screen.getByText(/no assets recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/no currency rates/i)).toBeInTheDocument();
  });

  it('reflects a recorded EGP asset in nominal net worth', () => {
    const db = fixtureDb();
    db.assets.push(egpAsset());
    bootStore(db);
    render(<NetWorthView />);
    expect(screen.getByText('Brokerage')).toBeInTheDocument();
    expect(screen.getByLabelText('Nominal net worth').textContent).toContain('500.00');
  });

  it('adds an asset through the modal', () => {
    bootStore(fixtureDb());
    render(<NetWorthView />);
    expect(useNizamStore.getState().db!.assets).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /^add asset$/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /asset name/i }), {
      target: { value: 'Apartment' },
    });
    const value = screen.getByRole('textbox', { name: /asset value/i });
    fireEvent.change(value, { target: { value: '200' } });
    fireEvent.blur(value);
    fireEvent.click(screen.getByRole('button', { name: /save asset/i }));

    const assets = useNizamStore.getState().db!.assets;
    expect(assets).toHaveLength(1);
    expect(assets[0]!.name).toBe('Apartment');
    expect(assets[0]!.value).toBe(200_000);
    expect(screen.getByText('Apartment')).toBeInTheDocument();
  });
});
