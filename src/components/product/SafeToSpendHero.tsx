/**
 * NIZAM · Safe-to-spend hero presentation
 * Implemented by: PFOS Contract 04 / Visual Upgrade Wave 1
 * Owning requirements: Command Center headline presentation only; no financial calculation.
 * Depends on: components/MoneyCell.
 *
 * All values and confidence inputs are supplied by the deterministic PFOS engines. This component
 * only creates hierarchy, risk communication and an accessible status summary.
 */
import { MoneyCell } from '@/components/MoneyCell.tsx';
import type { Money } from '@/lib/money/money.ts';

export interface SafeToSpendHeroProps {
  readonly horizonLabel: string;
  readonly amount: Money;
  readonly dailyAllowance: Money;
  readonly confidenceLabel: string;
  readonly confidencePercent: string;
  readonly confidenceBps: number;
  readonly primaryRisk: string;
  readonly deficit: boolean;
}

export function SafeToSpendHero({
  horizonLabel,
  amount,
  dailyAllowance,
  confidenceLabel,
  confidencePercent,
  confidenceBps,
  primaryRisk,
  deficit,
}: SafeToSpendHeroProps) {
  return (
    <section
      className={`safe-hero ${deficit ? 'safe-hero-negative' : ''}`}
      aria-label="Safe to spend"
    >
      <div className="safe-hero-main">
        <span className="section-eyebrow">Available without breaking the plan</span>
        <div className="safe-hero-heading">
          <span className="safe-hero-amount">
            <MoneyCell amount={amount} rag={deficit ? 'negative' : 'positive'} />
          </span>
          <span className="safe-hero-window">{horizonLabel}</span>
        </div>
        <p className="safe-hero-daily">
          <MoneyCell amount={dailyAllowance} /> per day at the current plan
        </p>
      </div>
      <div className="safe-hero-context">
        <div className="confidence-block">
          <div className="confidence-row">
            <span>Confidence</span>
            <strong>{confidenceLabel} · {confidencePercent}</strong>
          </div>
          <div
            className="confidence-track"
            role="progressbar"
            aria-label="Safe-to-spend confidence"
            aria-valuemin={0}
            aria-valuemax={10000}
            aria-valuenow={confidenceBps}
          >
            <span style={{ width: `${Math.min(100, Math.max(0, confidenceBps / 100))}%` }} />
          </div>
        </div>
        <div className="risk-callout">
          <span className="risk-label">Main risk</span>
          <strong>{primaryRisk}</strong>
        </div>
      </div>
    </section>
  );
}
