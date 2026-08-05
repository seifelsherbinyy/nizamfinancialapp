/**
 * NIZAM · Financial policy (buffers, reserves, expected inflow)
 * Owning contract: PFOS contract 02 (Data Architecture) section 2.2 — policy is versioned data.
 * Build phase: PFOS Stage 1, phase 1.1 — policy schema.
 * Depends on: lib/money/money.ts
 *
 * Source contract: contracts/pfos/02_..._Data_Architecture... section 2.2 lists
 * "safe-to-spend rules, buffer rules, risk limits" as VERSION-CONTROLLED policy
 * rather than free-floating constants. It therefore lives in the database as data
 * the owner can edit and the engine must read — never as a hard-coded number.
 */
import type { Money } from '@/lib/money/money';

/** A recurring expected inflow (salary). Drives the "until next inflow" horizon. */
export interface ExpectedInflow {
  /** Net amount that reliably lands. */
  amount: Money;
  /** Day of month it lands, 1..31 (clamped to the month's length). */
  dayOfMonth: number;
  /** 0..1 confidence the inflow arrives on time and in full. */
  confidence: number;
}

export interface FinancialPolicy {
  /**
   * Cash that must never be spent — contract 03 section 2.4 reserve hierarchy step 3.
   */
  minimumLiquidityBuffer: Money;
  /**
   * Expected variable essentials for a full month (food, transport, medicine) —
   * reserve hierarchy step 4. Pro-rated across the horizon by day count.
   */
  essentialLivingMonthly: Money;
  /**
   * Uncertainty reserve rate in basis points, applied to protected + essential
   * outflows — reserve hierarchy step 6, contract 03 section 2.5.
   */
  uncertaintyBps: number;
  /**
   * Extra uncertainty basis points added when the ledger is stale. Contract 02
   * section 10: "when data is stale, the system reduces confidence and does not
   * issue false precision."
   */
  stalenessBps: number;
  /** Days after which the ledger counts as stale. */
  staleAfterDays: number;
  expectedInflow: ExpectedInflow | null;
}

/**
 * Conservative defaults. Every value is deliberately visible and editable; the
 * engine never invents a threshold. Zero buffers would be the unsafe choice, so
 * the defaults reserve nothing the owner has not declared EXCEPT uncertainty,
 * which protects against the data itself being wrong.
 */
export const DEFAULT_POLICY: FinancialPolicy = {
  minimumLiquidityBuffer: 0,
  essentialLivingMonthly: 0,
  uncertaintyBps: 500,
  stalenessBps: 500,
  staleAfterDays: 3,
  expectedInflow: null,
};
