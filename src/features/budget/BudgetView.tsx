/**
 * NIZAM · YNAB budget grid — month nav, group rows, editable Assigned, RTA header,
 *          category targets (goal progress + suggested funding)
 * Implemented by: KIRO Contract 4 / Phase 4.3 (targets UI: post-release item R2, engine from Contract 3 / Phase 3.5)
 * Depends on: budget.logic.ts, state/store.ts, components/*
 */
import { useMemo, useState } from 'react';
import { useNizamStore } from '@/state/store';
import {
  computeBudget,
  setAssigned,
  applySeed,
  ensureCreditCardPaymentCategories,
  nextMonth,
  prevMonth,
  type ComputedCategoryMonth,
} from '@/features/budget/budget.logic';
import {
  ROLLOVER_BEHAVIOURS,
  TARGET_FAMILY,
  TARGET_TYPES,
  requiresObligation,
  requiresTargetMonth,
  type Category,
  type CategoryTarget,
  type MonthKey,
  type RolloverBehaviour,
  type TargetType,
} from '@/features/budget/budget.types';
import { targetFunding } from '@/features/budget/targets';
import type { Obligation } from '@/features/obligations/obligation.types';
import { MoneyCell } from '@/components/MoneyCell';
import { MoneyInput } from '@/components/MoneyInput';
import { Modal } from '@/components/Modal';
import { ragForRta } from '@/styles/theme';
import type { Money } from '@/lib/money/money';
import seedJson from '../../../data/seed/categories.seed.json';

function currentMonthKey(): MonthKey {
  return new Date().toISOString().slice(0, 7);
}

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthLabel(month: MonthKey): string {
  const m = Number(month.slice(5, 7));
  return `${MONTH_LABELS[m - 1] ?? month} ${month.slice(0, 4)}`;
}

/** Integer-percent text from a 0..1 ratio (no float formatting). */
function progressPercentText(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

// ---------------------------------------------------------------------------
// Target editor modal (post-release item R2)
// ---------------------------------------------------------------------------

/** Human labels for the eight target types (UI_CONTRACT_DELTA target editor). */
const TARGET_TYPE_LABELS: Record<TargetType, string> = {
  monthly_funding: 'Monthly funding',
  target_balance: 'Balance to reach (no date)',
  target_balance_by_date: 'Balance to reach by a month',
  sinking_fund: 'Sinking fund (by a month)',
  acquisition: 'Purchase goal (by a month)',
  emergency_reserve: 'Emergency reserve (no date)',
  obligation_reserve: 'Reserve for an obligation',
  debt_reduction: 'Pay an obligation down in full',
};

const ROLLOVER_LABELS: Record<RolloverBehaviour, string> = {
  set_aside: 'Set aside this amount again each month',
  refill: 'Refill up to this amount (leftover counts)',
};

function TargetModal(props: {
  category: Category;
  month: MonthKey;
  obligations: readonly Obligation[];
  onClose: () => void;
}) {
  const mutate = useNizamStore((s) => s.mutate);
  const existing = props.category.target;
  const [type, setType] = useState<TargetType | 'none'>(existing?.type ?? 'none');
  const [amount, setAmount] = useState<Money>(existing?.amount ?? 0);
  const [targetMonth, setTargetMonth] = useState<MonthKey>(
    existing?.targetMonth ?? nextMonth(props.month),
  );
  const [rollover, setRollover] = useState<RolloverBehaviour>(existing?.rollover ?? 'set_aside');
  const [obligationId, setObligationId] = useState<string | null>(existing?.obligationId ?? null);
  const [error, setError] = useState<string | null>(null);

  const linked = type !== 'none' && requiresObligation(type);
  const dated = type !== 'none' && requiresTargetMonth(type);
  // Only the per-month family consults rollover; every other family is cumulative and
  // behaves as refill, so the control is hidden rather than shown as an inert choice.
  const rolloverApplies = type !== 'none' && TARGET_FAMILY[type] === 'per_month';

  function save() {
    setError(null);
    if (type === 'none') {
      commit(null);
      return;
    }
    if (!linked && amount <= 0) {
      setError('Enter a positive target amount.');
      return;
    }
    if (dated && targetMonth < props.month) {
      setError('The target month cannot be in the past.');
      return;
    }
    if (linked && obligationId === null) {
      setError('Choose the obligation this target funds.');
      return;
    }
    commit({
      type,
      // The linked Obligation is the only source of truth for an obligation-backed
      // amount, so no figure is stored here that could go stale against it.
      amount: linked ? 0 : amount,
      targetMonth: dated ? targetMonth : null,
      rollover: rolloverApplies ? rollover : 'refill',
      obligationId: linked ? obligationId : null,
    });
  }

  function commit(target: CategoryTarget | null) {
    mutate((draft) => {
      const cat = draft.categories.find((c) => c.id === props.category.id);
      if (cat) cat.target = target;
    });
    props.onClose();
  }

  return (
    <Modal title={`Target — ${props.category.name}`} onClose={props.onClose}>
      <label className="field">
        <span>Target type</span>
        <select
          className="input"
          value={type}
          onChange={(e) => setType(e.target.value as TargetType | 'none')}
          aria-label="Target type"
        >
          <option value="none">No target</option>
          {TARGET_TYPES.map((t) => (
            <option key={t} value={t}>
              {TARGET_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      {type !== 'none' && !linked ? (
        <label className="field">
          <span>
            {TARGET_FAMILY[type] === 'per_month'
              ? 'Amount to assign each month (EGP)'
              : 'Amount to have available (EGP)'}
          </span>
          <MoneyInput value={amount} onCommit={setAmount} aria-label="Target amount" />
        </label>
      ) : null}
      {linked ? (
        <label className="field">
          <span>Linked obligation</span>
          <select
            className="input"
            value={obligationId ?? ''}
            onChange={(e) => setObligationId(e.target.value === '' ? null : e.target.value)}
            aria-label="Linked obligation"
          >
            <option value="">Choose an obligation…</option>
            {props.obligations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.creditor} — due {o.dueDate} ({o.priority})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {linked ? (
        <p className="muted">The amount comes from the obligation, not from this form.</p>
      ) : null}
      {rolloverApplies ? (
        <label className="field">
          <span>Rollover behaviour</span>
          <select
            className="input"
            value={rollover}
            onChange={(e) => setRollover(e.target.value as RolloverBehaviour)}
            aria-label="Rollover behaviour"
          >
            {ROLLOVER_BEHAVIOURS.map((r) => (
              <option key={r} value={r}>
                {ROLLOVER_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {dated ? (
        <label className="field">
          <span>By month</span>
          <input
            className="input"
            type="month"
            value={targetMonth}
            onChange={(e) => setTargetMonth(e.target.value)}
            aria-label="Target month"
          />
        </label>
      ) : null}
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={props.onClose}>
          Cancel
        </button>
        <button className="btn" onClick={save}>
          Save target
        </button>
      </div>
    </Modal>
  );
}

/** Compact goal readout under the category name. */
function GoalBadge(props: {
  category: Category;
  month: MonthKey;
  computed: ComputedCategoryMonth | undefined;
  obligations: readonly Obligation[];
}) {
  const target = props.category.target;
  if (!target) return null;
  const obligation =
    target.obligationId === null
      ? null
      : (props.obligations.find((o) => o.id === target.obligationId) ?? null);
  // A target pointing at a missing obligation is a data defect, not a zero. Saying so is
  // the only honest render: the engine cannot source an amount, so no figure is shown.
  if (requiresObligation(target.type) && obligation === null) {
    return (
      <span
        className="badge money-negative"
        role="status"
        aria-label={`Goal for ${props.category.name}`}
        title="This target references an obligation that no longer exists."
      >
        ⚠ obligation missing
      </span>
    );
  }
  const goal = targetFunding(target, props.month, props.computed, obligation);
  const pct = progressPercentText(goal.progress);
  const funded = goal.funded;
  // The per-month rate is only informative for targets with a deadline; for a monthly
  // target it would just restate the amount.
  const scheduled = goal.family === 'balance_by_date' || goal.family === 'obligation';
  const title =
    goal.family === 'per_month'
      ? `Monthly target (${ROLLOVER_LABELS[goal.rolloverApplied]}): ${pct} funded this month`
      : goal.family === 'balance'
        ? `Balance target: ${pct} available, no deadline`
        : `${pct} available; on this rate it completes ${goal.expectedCompletion ?? 'never'}`;
  return (
    <div
      className={`badge money-${funded ? 'positive' : 'warning'}`}
      role="status"
      aria-label={`Goal for ${props.category.name}`}
      title={title}
    >
      {funded ? '✓ funded' : `${pct}`}
      {!funded && goal.monthlyRate !== null && scheduled ? (
        <>
          {' · '}
          <MoneyCell amount={goal.monthlyRate} rag="zero" />
          /mo
        </>
      ) : null}
    </div>
  );
}

function CategoryRow(props: {
  category: Category;
  month: MonthKey;
  computed: ComputedCategoryMonth | undefined;
  obligations: readonly Obligation[];
  onEditTarget: (category: Category) => void;
}) {
  const mutate = useNizamStore((s) => s.mutate);
  const { category, month, computed } = props;
  return (
    <tr>
      <td>
        <button
          className="btn btn-sm btn-secondary"
          onClick={() => props.onEditTarget(category)}
          aria-label={`Edit target for ${category.name}`}
          title="Set or edit the target for this category"
        >
          {category.name}
        </button>{' '}
        <GoalBadge
          category={category}
          month={month}
          computed={computed}
          obligations={props.obligations}
        />
      </td>
      <td className="num" style={{ width: 140 }}>
        <MoneyInput
          value={computed?.assigned ?? 0}
          aria-label={`Assigned for ${category.name}`}
          onCommit={(value) =>
            mutate((draft) => {
              setAssigned(draft, month, category.id, value);
            })
          }
        />
      </td>
      <td className="num">
        <MoneyCell amount={computed?.activity ?? 0} />
      </td>
      <td className="num">
        <MoneyCell amount={computed?.available ?? 0} variant="pill" />
      </td>
    </tr>
  );
}

export function BudgetView() {
  const db = useNizamStore((s) => s.db);
  const mutate = useNizamStore((s) => s.mutate);
  const [month, setMonth] = useState<MonthKey>(currentMonthKey());
  const [editingTarget, setEditingTarget] = useState<Category | null>(null);

  const computation = useMemo(() => (db ? computeBudget(db, month) : null), [db, month]);
  if (!db) return <p className="muted">Loading…</p>;

  const computed = computation?.months.get(month);
  const rta = computed?.readyToAssign ?? 0;
  const groups = [...db.categoryGroups].filter((g) => !g.hidden).sort((a, b) => a.order - b.order);
  const incomeNames = new Set(['income', 'inflow: ready to assign', 'ready to assign', 'salary']);
  const categoriesOf = (groupId: string) =>
    db.categories
      .filter((c) => c.groupId === groupId && !c.hidden && !incomeNames.has(c.name.toLowerCase()))
      .sort((a, b) => a.order - b.order);

  const hasCategories = db.categories.length > 0;

  return (
    <section aria-label="Budget">
      <div className="month-nav">
        <button className="btn btn-secondary btn-sm" onClick={() => setMonth(prevMonth(month))} aria-label="Previous month">
          ◀
        </button>
        <h2>{monthLabel(month)}</h2>
        <button className="btn btn-secondary btn-sm" onClick={() => setMonth(nextMonth(month))} aria-label="Next month">
          ▶
        </button>
        <div className="spacer" />
        <div className={`rta-banner rta-${ragForRta(rta)}`} role="status" aria-label="Ready to assign">
          <span>Ready to Assign</span>
          <span className="rta-amount">
            <MoneyCell amount={rta} rag="zero" />
          </span>
        </div>
      </div>

      {!hasCategories ? (
        <div className="card">
          <p>No categories yet.</p>
          <button
            className="btn"
            onClick={() =>
              mutate((draft) => {
                applySeed(draft, seedJson as { groups: { name: string; categories: string[] }[] });
                ensureCreditCardPaymentCategories(draft);
              })
            }
          >
            Load starter categories
          </button>
        </div>
      ) : (
        <table className="table" aria-label="Budget grid">
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col" className="num">Assigned</th>
              <th scope="col" className="num">Activity</th>
              <th scope="col" className="num">Available</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const cats = categoriesOf(group.id);
              if (cats.length === 0) return null;
              return [
                <tr className="group-row" key={group.id}>
                  <td colSpan={4}>{group.name}</td>
                </tr>,
                ...cats.map((c) => (
                  <CategoryRow
                    key={c.id}
                    category={c}
                    month={month}
                    computed={computed?.categories[c.id]}
                    obligations={db.obligations}
                    onEditTarget={setEditingTarget}
                  />
                )),
              ];
            })}
          </tbody>
        </table>
      )}

      {editingTarget ? (
        <TargetModal
          category={editingTarget}
          month={month}
          obligations={db.obligations}
          onClose={() => setEditingTarget(null)}
        />
      ) : null}
    </section>
  );
}
