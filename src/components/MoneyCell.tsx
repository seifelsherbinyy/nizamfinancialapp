/**
 * NIZAM · MoneyCell — formatted EGP with RAG state
 * Implemented by: KIRO Contract 4 / Phase 4.1
 * Depends on: lib/money/money.ts, styles/theme.ts
 */
import { format, type Money, type MoneyLocale } from '@/lib/money/money';
import { ragForAvailable, type RagState } from '@/styles/theme';

export interface MoneyCellProps {
  amount: Money;
  /** 'pill' renders the YNAB-style colored pill; 'plain' colors negatives only. */
  variant?: 'pill' | 'plain';
  /** Override the automatic RAG state (e.g. RTA semantics). */
  rag?: RagState;
  locale?: MoneyLocale;
  currency?: string;
  title?: string;
}

export function MoneyCell(props: MoneyCellProps) {
  const { amount, variant = 'plain', rag, locale, currency, title } = props;
  const state = rag ?? ragForAvailable(amount);
  const cls =
    variant === 'pill'
      ? `money money-pill money-${state}`
      : `money money-plain money-${state}`;
  return (
    <span className={cls} title={title}>
      {format(amount, { locale, currency })}
    </span>
  );
}
