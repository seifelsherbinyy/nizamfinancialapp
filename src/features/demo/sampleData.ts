/**
 * NIZAM - Living sample portfolio: demonstration data covering every server-free state.
 * Owning contract: PFOS contract 04 (Interface) - the onboarding "load sample" affordance;
 *   it composes the data shapes of contracts 01 (accounts / net worth), 02 (obligations /
 *   policy) and 03 (decision inputs). Clearly-labelled SAMPLE data: never real, and the UI
 *   only offers it when the portfolio is empty, so it can never overwrite a real ledger.
 * Build phase: PFOS Stage 4, phase 4.5 - living sample dataset (exercises Stages 1-4 end to end).
 * Depends on: lib/db/schema (createEmptyDb), feature types, obligations addDays (relative dates).
 *
 * Dates are relative to `nowIso` so the demo always looks current (evergreen). The builder is
 * deterministic given nowIso, so the coverage test can assert against a fixed anchor. No money
 * math lives here - amounts are literal milliunits via the EGP()/units() whole-number helpers.
 */
import { createEmptyDb, type NizamDb } from '@/lib/db/schema';
import type { Money } from '@/lib/money/money';
import type { Account } from '@/features/accounts/accounts.types';
import type { Transaction } from '@/features/transactions/transaction.types';
import type { Obligation } from '@/features/obligations/obligation.types';
import type { Asset, FxRate, MacroContext } from '@/features/netWorth/netWorth.types';
import type { FinancialPolicy } from '@/features/safeToSpend/policy.types';
import { addDays } from '@/features/obligations/obligations.logic';

/** Whole currency units -> milliunits (money core is 1000 milliunits per unit). */
const units = (whole: number): Money => whole * 1000;
const EGP = units;

function account(partial: Partial<Account> & Pick<Account, 'id' | 'name' | 'type'>): Account {
  return {
    onBudget: true,
    balance: 0,
    clearedBalance: 0,
    accountIdentifier: null,
    creditLimit: null,
    closed: false,
    order: 0,
    paymentCategoryId: null,
    ...partial,
  };
}

function txn(
  partial: Partial<Transaction> & Pick<Transaction, 'id' | 'accountId' | 'date' | 'amount'>,
): Transaction {
  return {
    payee: 'Sample',
    categoryId: null,
    memo: '',
    cleared: 'cleared',
    approved: true,
    transferAccountId: null,
    transferTransactionId: null,
    splits: null,
    importInfo: null,
    ...partial,
  };
}

function obligation(
  partial: Partial<Obligation> &
    Pick<Obligation, 'id' | 'creditor' | 'amountDue' | 'minimumDue' | 'dueDate' | 'priority'>,
): Obligation {
  return {
    accountId: null,
    graceDate: null,
    frequency: 'monthly',
    penalty: 0,
    interestBps: 0,
    autopay: false,
    verificationSource: 'manual',
    confidence: 0.9,
    protectedReserve: 0,
    ...partial,
  };
}

/** Build the full sample NizamDb, deterministic for a given `nowIso`. */
export function buildSampleDb(nowIso: string): NizamDb {
  const db = createEmptyDb(nowIso);
  const asOf = nowIso.slice(0, 10);

  // --- Accounts: liquid cash, a credit card, an off-budget tracking asset account. ---
  db.accounts = [
    account({
      id: 'acc_main',
      name: 'Main Current Account',
      type: 'CIB_DEBIT',
      clearedBalance: EGP(12_000),
      balance: EGP(12_000),
      accountIdentifier: '10002345',
      order: 0,
    }),
    account({
      id: 'acc_card',
      name: 'Rewards Credit Card',
      type: 'HSBC_CC',
      clearedBalance: EGP(-3_500),
      balance: EGP(-3_500),
      creditLimit: EGP(30_000),
      accountIdentifier: '40008899',
      order: 1,
      paymentCategoryId: 'cat_card_pay',
    }),
    account({
      id: 'acc_pension',
      name: 'Pension (tracked)',
      type: 'TRACKING',
      onBudget: false,
      clearedBalance: EGP(150_000),
      balance: EGP(150_000),
      order: 2,
    }),
  ];

  // --- Categories (so the budget grid is populated too). ---
  db.categoryGroups = [
    { id: 'grp_ess', name: 'Essentials', order: 0, hidden: false },
    { id: 'grp_cc', name: 'Credit Card Payments', order: 1, hidden: false },
    { id: 'grp_inc', name: 'Inflow', order: 2, hidden: false },
  ];
  db.categories = [
    { id: 'cat_groc', groupId: 'grp_ess', name: 'Groceries', order: 0, hidden: false, target: null, isCreditCardPayment: false, linkedAccountId: null },
    { id: 'cat_rent', groupId: 'grp_ess', name: 'Rent', order: 1, hidden: false, target: null, isCreditCardPayment: false, linkedAccountId: null },
    { id: 'cat_trans', groupId: 'grp_ess', name: 'Transport', order: 2, hidden: false, target: null, isCreditCardPayment: false, linkedAccountId: null },
    { id: 'cat_card_pay', groupId: 'grp_cc', name: 'Rewards Card Payment', order: 3, hidden: false, target: null, isCreditCardPayment: true, linkedAccountId: 'acc_card' },
    { id: 'cat_income', groupId: 'grp_inc', name: 'Income', order: 4, hidden: false, target: null, isCreditCardPayment: false, linkedAccountId: null },
  ];

  // --- Recent transactions: keep the ledger FRESH (higher confidence) + one pending outflow. ---
  db.transactions = [
    txn({ id: 'txn_sal', accountId: 'acc_main', date: addDays(asOf, -2), amount: EGP(25_000), payee: 'Employer', categoryId: 'cat_income' }),
    txn({ id: 'txn_groc', accountId: 'acc_main', date: addDays(asOf, -1), amount: EGP(-1_200), payee: 'Supermarket', categoryId: 'cat_groc' }),
    txn({ id: 'txn_trans', accountId: 'acc_main', date: addDays(asOf, -1), amount: EGP(-300), payee: 'Ride', categoryId: 'cat_trans' }),
    txn({ id: 'txn_pend', accountId: 'acc_main', date: asOf, amount: EGP(-800), payee: 'Pharmacy (pending)', categoryId: 'cat_groc', cleared: 'uncleared', approved: false }),
  ];
  db.payees = [];

  // --- Obligations across all four priority tiers; one credit-linked (statement horizon). ---
  db.obligations = [
    obligation({ id: 'ob_rent', creditor: 'Landlord', amountDue: EGP(8_000), minimumDue: EGP(8_000), dueDate: addDays(asOf, 18), priority: 'P0', penalty: EGP(500), verificationSource: 'statement', confidence: 0.97 }),
    obligation({ id: 'ob_card', creditor: 'Rewards Card', accountId: 'acc_card', amountDue: EGP(3_500), minimumDue: EGP(1_000), dueDate: addDays(asOf, 6), priority: 'P1', penalty: EGP(300), verificationSource: 'provider', confidence: 0.92 }),
    obligation({ id: 'ob_carloan', creditor: 'Auto Finance', amountDue: EGP(6_000), minimumDue: EGP(6_000), dueDate: addDays(asOf, 12), priority: 'P2', penalty: EGP(400), interestBps: 1800, confidence: 0.9 }),
    obligation({ id: 'ob_subs', creditor: 'Subscriptions & Gym', amountDue: EGP(900), minimumDue: EGP(900), dueDate: addDays(asOf, 25), priority: 'P3', frequency: 'monthly', confidence: 0.85 }),
  ];

  // --- Policy: real buffers + a reliable expected salary (unlocks the "until income" horizon). ---
  const policy: FinancialPolicy = {
    minimumLiquidityBuffer: EGP(2_000),
    essentialLivingMonthly: EGP(6_000),
    uncertaintyBps: 500,
    stalenessBps: 500,
    staleAfterDays: 3,
    expectedInflow: { amount: EGP(25_000), dayOfMonth: 28, confidence: 0.95 },
  };
  db.policy = policy;
  db.decisions = [];

  // --- Assets: multi-currency, financial + real, incl. a DELIBERATELY unrated currency (SAR). ---
  const assets: Asset[] = [
    { id: 'as_savings', name: 'Emergency Savings', kind: 'financial', currency: 'EGP', value: EGP(40_000), liquid: true, liquidationDiscountBps: 0, valuationSource: 'statement', valuationAsOf: asOf },
    { id: 'as_broker', name: 'US Brokerage', kind: 'financial', currency: 'USD', value: units(2_000), liquid: true, liquidationDiscountBps: 200, valuationSource: 'broker', valuationAsOf: asOf },
    { id: 'as_gold', name: 'Gold (bullion)', kind: 'real', currency: 'EGP', value: EGP(60_000), liquid: false, liquidationDiscountBps: 800, valuationSource: 'manual', valuationAsOf: asOf },
    { id: 'as_apt', name: 'Apartment share', kind: 'real', currency: 'EGP', value: EGP(500_000), liquid: false, liquidationDiscountBps: 1500, valuationSource: 'manual', valuationAsOf: asOf },
    { id: 'as_gulf', name: 'Gulf account', kind: 'financial', currency: 'SAR', value: units(5_000), liquid: true, liquidationDiscountBps: 0, valuationSource: 'manual', valuationAsOf: asOf },
  ];
  db.assets = assets;

  // --- FX: USD priced to EGP; SAR intentionally OMITTED to demonstrate the unrated flag. ---
  const fxRates: FxRate[] = [
    { currency: 'USD', perUnitNum: 49, perUnitDen: 1, source: 'manual', asOf },
  ];
  db.fxRates = fxRates;

  // --- Macro: inflation for the real-value net-worth view. ---
  const macro: MacroContext = {
    referenceCurrency: 'EGP',
    annualInflationBps: 2500,
    inflationSource: 'manual',
    inflationAsOf: asOf,
  };
  db.macro = macro;

  return db;
}

/** Populate a draft db in place with the sample (used by the "Load sample data" action). */
export function applySampleData(draft: NizamDb, nowIso: string): void {
  const s = buildSampleDb(nowIso);
  draft.accounts = s.accounts;
  draft.categoryGroups = s.categoryGroups;
  draft.categories = s.categories;
  draft.months = s.months;
  draft.payees = s.payees;
  draft.transactions = s.transactions;
  draft.obligations = s.obligations;
  draft.policy = s.policy;
  draft.decisions = s.decisions;
  draft.assets = s.assets;
  draft.fxRates = s.fxRates;
  draft.macro = s.macro;
}
