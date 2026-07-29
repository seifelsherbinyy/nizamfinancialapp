/**
 * NIZAM · YNAB budget grid — month nav, group rows, editable Assigned, RTA header
 * Implemented by: KIRO Contract 4 / Phase 4.3
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
import type { Category, MonthKey } from '@/features/budget/budget.types';
import { MoneyCell } from '@/components/MoneyCell';
import { MoneyInput } from '@/components/MoneyInput';
import { ragForRta } from '@/styles/theme';
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

function CategoryRow(props: {
  category: Category;
  month: MonthKey;
  computed: ComputedCategoryMonth | undefined;
}) {
  const mutate = useNizamStore((s) => s.mutate);
  const { category, month, computed } = props;
  return (
    <tr>
      <td>{category.name}</td>
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
                  />
                )),
              ];
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
