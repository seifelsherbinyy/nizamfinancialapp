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
  goalProgress,
  nextMonth,
  prevMonth,
  type ComputedCategoryMonth,
} from '@/features/budget/budget.logic';
import type { Category, CategoryTarget, MonthKey, TargetType } from '@/features/budget/budget.types';
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

function TargetModal(props: { category: Category; month: MonthKey; onClose: () => void }) {
  const mutate = useNizamStore((s) => s.mutate);
  const existing = props.category.target;
  const [type, setType] = useState<TargetType | 'none'>(existing?.type ?? 'none');
  const [amount, setAmount] = useState<Money>(existing?.amount ?? 0);
  const [targetMonth, setTargetMonth] = useState<MonthKey>(
    existing?.targetMonth ?? nextMonth(props.month),
  );
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    if (type !== 'none' && amount <= 0) {
      setError('Enter a positive target amount.');
      return;
    }
    if (type === 'target_by_date' && targetMonth < props.month) {
      setError('The target month cannot be in the past.');
      return;
    }
    const target: CategoryTarget | null =
      type === 'none'
        ? null
        : { type, amount, targetMonth: type === 'target_by_date' ? targetMonth : null };
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
          <option value="monthly">Monthly funding target</option>
          <option value="target_by_date">Amount available by a month</option>
        </select>
      </label>
      {type !== 'none' ? (
        <label className="field">
          <span>{type === 'monthly' ? 'Amount to assign each month (EGP)' : 'Amount to have available (EGP)'}</span>
          <MoneyInput value={amount} onCommit={setAmount} aria-label="Target amount" />
        </label>
      ) : null}
      {type === 'target_by_date' ? (
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
}) {
  const goal = goalProgress(props.category, props.month, props.computed);
  if (!goal) return null;
  const pct = progressPercentText(goal.progress);
  const funded = goal.remaining === 0;
  return (
    <div
      className={`badge money-${funded ? 'positive' : 'warning'}`}
      role="status"
      aria-label={`Goal for ${props.category.name}`}
      title={
        goal.target.type === 'monthly'
          ? `Monthly target: assign ${pct} funded this month`
          : `By ${goal.target.targetMonth}: ${pct} available`
      }
    >
      {funded ? '✓ funded' : `${pct}`}
      {!funded && goal.suggestedPerMonth !== null && goal.target.type === 'target_by_date' ? (
        <>
          {' · '}
          <MoneyCell amount={goal.suggestedPerMonth} rag="zero" />
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
        <GoalBadge category={category} month={month} computed={computed} />
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
                    onEditTarget={setEditingTarget}
                  />
                )),
              ];
            })}
          </tbody>
        </table>
      )}

      {editingTarget ? (
        <TargetModal category={editingTarget} month={month} onClose={() => setEditingTarget(null)} />
      ) : null}
    </section>
  );
}
