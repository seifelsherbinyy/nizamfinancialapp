/**
 * NIZAM - Settings tests: financial policy + macro save and validation.
 * Owning contract: PFOS contract 02 (Data Architecture) section 2.2 - policy is versioned data.
 * Build phase: PFOS Stage 1, phase 1.6 - policy + macro editor.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsView } from './SettingsView';
import { bootStore, fixtureDb } from '../../../tests/helpers/fixtures';
import { useNizamStore } from '@/state/store';

function commitMoney(name: RegExp, value: string) {
  const input = screen.getByRole('textbox', { name });
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe('SettingsView', () => {
  it('saves the financial policy and inflation macro', () => {
    bootStore(fixtureDb());
    render(<SettingsView />);
    fireEvent.click(screen.getByRole('checkbox', { name: /has regular income/i }));
    commitMoney(/minimum liquidity buffer/i, '2000');
    commitMoney(/essential living monthly/i, '6000');
    commitMoney(/expected income amount/i, '25000');
    fireEvent.change(screen.getByRole('spinbutton', { name: /income day of month/i }), {
      target: { value: '28' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: /annual inflation percent/i }), {
      target: { value: '25' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    const p = useNizamStore.getState().db!.policy!;
    expect(p.minimumLiquidityBuffer).toBe(2_000_000);
    expect(p.essentialLivingMonthly).toBe(6_000_000);
    expect(p.expectedInflow).toEqual({ amount: 25_000_000, dayOfMonth: 28, confidence: 0.95 });
    expect(useNizamStore.getState().db!.macro!.annualInflationBps).toBe(2500);
    expect(screen.getByRole('status').textContent).toMatch(/saved/i);
  });

  it('rejects an out-of-range income day', () => {
    bootStore(fixtureDb());
    render(<SettingsView />);
    fireEvent.click(screen.getByRole('checkbox', { name: /has regular income/i }));
    commitMoney(/expected income amount/i, '25000');
    fireEvent.change(screen.getByRole('spinbutton', { name: /income day of month/i }), {
      target: { value: '40' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/1-31/);
    // Nothing persisted: expected income stays null.
    expect(useNizamStore.getState().db!.policy!.expectedInflow).toBeNull();
  });

  it('clears expected income when the regular-income box is unchecked', () => {
    const db = fixtureDb();
    db.policy = {
      ...db.policy!,
      expectedInflow: { amount: 10_000_000, dayOfMonth: 1, confidence: 0.8 },
    };
    bootStore(db);
    render(<SettingsView />);
    fireEvent.click(screen.getByRole('checkbox', { name: /has regular income/i })); // turn OFF
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    expect(useNizamStore.getState().db!.policy!.expectedInflow).toBeNull();
  });
});
