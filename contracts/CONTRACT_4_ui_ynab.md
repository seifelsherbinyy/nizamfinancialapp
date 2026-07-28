<!-- NIZAM BUILD CONTRACT — machine+human readable. KIRO: execute phases in order, loop each phase to a GREEN gate before advancing (see contracts/_KIRO_LOOP_PROTOCOL.md). Honor .kiro/steering/*. -->
# Contract 4 — UI / UX (YNAB-style)
- **id:** C4 · **depends on:** C1, C2, C3 · **produces:** the full interactive YNAB-style UI
- **spec:** `.kiro/specs/04-ui-ynab/` · **steering:** product.md, structure.md

## Objective
Build the YNAB-style interface on top of the engine: budget grid, accounts sidebar, transaction register, transaction entry (splits/transfers), reconciliation, and the import wizard — with a clean design system and account-identifier redaction by default.

## Inputs
- C3 engine + C2 store; `src/styles/*`, `src/components/*`, `src/features/**/*.tsx`.

## Phases
### Phase 4.1 — Design system
- Tasks: `styles/theme.ts` + `globals.css`; MoneyCell (RAG: green RTA, red/amber overspend), Modal, DataTable, buttons/inputs; redaction util (last-4).
- **Gate:** Storybook-less visual check + typecheck; MoneyCell renders EGP + RAG.

### Phase 4.2 — App shell + navigation
- Tasks: real router wiring; `AccountsSidebar` with balances + on/off-budget grouping.
- **Gate:** navigate budget/accounts/reports/import; balances match store.

### Phase 4.3 — Budget view
- Tasks: `BudgetView.tsx` grid: month nav, group rows, editable Assigned, RTA header, RAG Available.
- **Gate:** editing Assigned updates available live + persists.

### Phase 4.4 — Register
- Tasks: `Register.tsx` per-account table: sort/filter, inline edit, cleared toggle, running balance.
- **Gate:** register matches ledgerStore; cleared toggles persist.

### Phase 4.5 — Transaction entry
- Tasks: `TransactionForm.tsx`: inflow/outflow, payee autocomplete, category, splits, transfers; integer-money input.
- **Gate:** add split + transfer create correct linked rows.

### Phase 4.6 — Reconciliation
- Tasks: `Reconcile.tsx`: enter statement balance, match cleared, create adjustment, lock.
- **Gate:** reconcile produces a balanced locked state.

### Phase 4.7 — Import wizard
- Tasks: `ImportWizard.tsx`: Picker -> map -> dedupe preview -> commit (uses C2 import).
- **Gate:** end-to-end import of a sample ledger via UI.

## Definition of Done
Full UI usable end-to-end against Drive DB; redaction on; typecheck+build green; a11y basics. Mark C4 DONE.
