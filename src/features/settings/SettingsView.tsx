/**
 * NIZAM - Settings: the financial policy (buffers, essential-living reserve, expected income)
 *   and the inflation macro that drive safe-to-spend and the real-value net-worth view.
 * Owning contract: PFOS contract 02 (Data Architecture) section 2.2 - policy is versioned data
 *   the owner edits (never a hard-coded constant); contract 03 section 8.3 - macro inputs.
 * Build phase: PFOS Stage 1, phase 1.6 - policy + macro editor (safe-to-spend configuration).
 * Depends on: safeToSpend/policy.types, netWorth.types, state/store (mutate), components.
 *
 * Pure client work on the Drive DB - no server. Reserves stay ZERO until the owner sets them
 * here, so safe-to-spend never invents a threshold. Setting an expected income unlocks the
 * "until next income" horizon and raises confidence.
 */
import { useState } from 'react';
import { useNizamStore } from '@/state/store';
import { DEFAULT_POLICY } from '@/features/safeToSpend/policy.types';
import { DEFAULT_MACRO } from '@/features/netWorth/netWorth.types';
import { MoneyInput } from '@/components/MoneyInput';
import type { Money } from '@/lib/money/money';

const CONFIDENCE_OPTIONS: { value: number; label: string }[] = [
  { value: 0.95, label: 'Reliable (arrives on time, in full)' },
  { value: 0.8, label: 'Likely' },
  { value: 0.6, label: 'Uncertain' },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SettingsView() {
  const db = useNizamStore((s) => s.db);
  const mutate = useNizamStore((s) => s.mutate);

  const policy0 = useNizamStore.getState().db?.policy ?? DEFAULT_POLICY;
  const macro0 = useNizamStore.getState().db?.macro ?? DEFAULT_MACRO;

  const [buffer, setBuffer] = useState<Money>(policy0.minimumLiquidityBuffer);
  const [essential, setEssential] = useState<Money>(policy0.essentialLivingMonthly);
  const [hasIncome, setHasIncome] = useState<boolean>(policy0.expectedInflow !== null);
  const [incomeAmount, setIncomeAmount] = useState<Money>(policy0.expectedInflow?.amount ?? 0);
  const [incomeDay, setIncomeDay] = useState<string>(String(policy0.expectedInflow?.dayOfMonth ?? 28));
  const [incomeConf, setIncomeConf] = useState<number>(policy0.expectedInflow?.confidence ?? 0.95);
  const [inflationPct, setInflationPct] = useState<string>(String((macro0.annualInflationBps ?? 0) / 100));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!db) return <p className="muted">Loading...</p>;

  function save() {
    setError(null);
    setSaved(false);
    const day = Number(incomeDay);
    if (hasIncome) {
      if (!Number.isInteger(day) || day < 1 || day > 31) return setError('Income day must be 1-31.');
      if (incomeAmount <= 0) return setError('Enter a positive expected income amount.');
    }
    const pct = Number(inflationPct);
    if (!Number.isFinite(pct) || pct < 0) return setError('Inflation must be zero or positive.');

    mutate((draft) => {
      draft.policy = {
        ...(draft.policy ?? DEFAULT_POLICY),
        minimumLiquidityBuffer: buffer,
        essentialLivingMonthly: essential,
        expectedInflow: hasIncome
          ? { amount: incomeAmount, dayOfMonth: day, confidence: incomeConf }
          : null,
      };
      draft.macro = {
        ...(draft.macro ?? DEFAULT_MACRO),
        annualInflationBps: Math.round(pct * 100),
        inflationSource: 'manual',
        inflationAsOf: today(),
      };
    });
    setSaved(true);
  }

  return (
    <section aria-label="Settings">
      <div className="month-nav">
        <h2>Settings</h2>
      </div>

      <div className="card" aria-label="Financial policy">
        <h3>Safe-to-spend policy</h3>
        <p className="muted">
          These reserves stay at zero until you set them, so safe-to-spend never invents a
          threshold - it protects exactly what you declare.
        </p>
        <label className="field">
          <span>Minimum cash buffer to never spend (EGP)</span>
          <MoneyInput value={buffer} onCommit={setBuffer} aria-label="Minimum liquidity buffer" />
        </label>
        <label className="field">
          <span>Essential living per month (food, transport, medicine) (EGP)</span>
          <MoneyInput value={essential} onCommit={setEssential} aria-label="Essential living monthly" />
        </label>

        <label className="field field-inline">
          <input
            type="checkbox"
            checked={hasIncome}
            onChange={(e) => setHasIncome(e.target.checked)}
            aria-label="Has regular income"
          />
          <span>I have a regular income</span>
        </label>
        {hasIncome ? (
          <>
            <label className="field">
              <span>Expected income amount (EGP)</span>
              <MoneyInput value={incomeAmount} onCommit={setIncomeAmount} aria-label="Expected income amount" />
            </label>
            <label className="field">
              <span>Day of month it lands (1-31)</span>
              <input
                className="input"
                type="number"
                min={1}
                max={31}
                value={incomeDay}
                onChange={(e) => setIncomeDay(e.target.value)}
                aria-label="Income day of month"
              />
            </label>
            <label className="field">
              <span>How reliable is it?</span>
              <select
                className="input"
                value={String(incomeConf)}
                onChange={(e) => setIncomeConf(Number(e.target.value))}
                aria-label="Income reliability"
              >
                {CONFIDENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={String(o.value)}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
      </div>

      <div className="card" aria-label="Macro">
        <h3>Economic context</h3>
        <label className="field">
          <span>Annual inflation (%) - used for the real-value net-worth view</span>
          <input
            className="input"
            type="number"
            min={0}
            step="0.1"
            value={inflationPct}
            onChange={(e) => setInflationPct(e.target.value)}
            aria-label="Annual inflation percent"
          />
        </label>
      </div>

      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      {saved && !error ? (
        <p className="badge money-positive" role="status">
          Settings saved.
        </p>
      ) : null}
      <div className="modal-actions">
        <button className="btn" onClick={save}>
          Save settings
        </button>
      </div>
    </section>
  );
}
