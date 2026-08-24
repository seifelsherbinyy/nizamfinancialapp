/**
 * NIZAM · Financial metric presentation
 * Implemented by: PFOS Contract 04 / Visual Upgrade Wave 1
 * Owning requirements: interface hierarchy only; values are supplied by deterministic engines.
 * Depends on: components/MoneyCell.
 *
 * This component performs no money arithmetic. It gives already-computed financial values a
 * consistent hierarchy, label, supporting context, and optional status treatment.
 */
import { MoneyCell } from '@/components/MoneyCell.tsx';
import type { Money } from '@/lib/money/money.ts';
import type { RagState } from '@/styles/theme.ts';

export interface FinancialMetricProps {
  readonly label: string;
  readonly value: Money;
  readonly supporting?: string;
  readonly rag?: RagState;
  readonly emphasis?: 'standard' | 'hero';
}

export function FinancialMetric({
  label,
  value,
  supporting,
  rag,
  emphasis = 'standard',
}: FinancialMetricProps) {
  return (
    <div className={`financial-metric financial-metric-${emphasis}`}>
      <span className="financial-metric-label">{label}</span>
      <span className="financial-metric-value">
        <MoneyCell amount={value} rag={rag} />
      </span>
      {supporting ? <span className="financial-metric-supporting">{supporting}</span> : null}
    </div>
  );
}
