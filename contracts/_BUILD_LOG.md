# NIZAM Build Log
> KIRO appends one line per completed phase: `YYYY-MM-DD | C<n>.<phase> | gate: PASS | note`.

- 2026-07-29 | C1.1 | gate: PASS | deps pinned (react 18.3.1, zustand 5.0.2, dexie 4.0.10, zod 3.24.1, vite 5.4.11, vitest 2.1.8, ts 5.5.4); npm install ok; dev server serves 200
- 2026-07-29 | C1.2 | gate: PASS | tsconfig strict+@/* alias, vite.config (react, alias, vitest jsdom + tests/setup.ts), .eslintrc.cjs + .prettierrc; typecheck 0 errors; lint clean
- 2026-07-29 | C1.3 | gate: PASS | main.tsx/App.tsx/providers.tsx/router.tsx (hash router, no extra dep — works on static hosts); build emits dist; shell renders
- 2026-07-29 | C1.4 | gate: PASS | lib/money: fromDecimal/toDecimal (digit-parse, no floats), add/sub/mul/mulRatio(BigInt), allocate (largest remainder, exact), format EGP en/ar-EG
- 2026-07-29 | C1.5 | gate: PASS | 24 money tests green (round-trip, no-drift, allocate-sums-exact sweep, negatives); domain types: accounts/transactions/budget/ledger(25-col)
- 2026-07-29 | C2.1 | gate: PASS | oauth.ts GIS token client, drive.file ONLY, scope asserted (assertDriveFileScopeOnly); token memory-only; live sign-in awaits user .env.local creds (checklist in tasks.md)
- 2026-07-29 | C2.2 | gate: PASS | driveClient (fetch v3, backoff), schema.ts (zod, integer-money guard), driveDb (ensure/load/atomic save + snapshot-first + version guard + prune 10); round-trip + conflict + snapshot unit tests green vs fake Drive
- 2026-07-29 | C2.3 | gate: PASS | Dexie localCache (mirror + kv sync point), migrations v0->v1 idempotent (tested), ledgerStore read model (by account/month/category, running balances)
- 2026-07-29 | C2.4 | gate: PASS | sync.ts merge3 (3-way, LWW + audit in meta.conflicts) + pushDb merge-retry; store.ts wired (mutate -> cache dirty -> debounced push, online/offline listeners); merge matrix + concurrent-edit tests green
- 2026-07-29 | C2.5 | gate: PASS | picker.ts (drive.file grant on pick); ledgerImport: RFC4180 CSV, 25-col contract, money-format autodetect, exact+fuzzy+flagged dedup, pure importLedger; 15 tests incl. idempotent re-import
- 2026-07-29 | C3.1 | gate: PASS | budget.types finalized (C1); applySeed (idempotent) + month utils; DATA_MODEL.md written
- 2026-07-29 | C3.2 | gate: PASS | month facts collector + ledgerStore selectors; activity == sum of categorized txns (split legs, transfers excluded) unit-tested
- 2026-07-29 | C3.3 | gate: PASS | computeBudget: available = carryIn+assigned+activity; RTA = cum income − cum assigned − cum cash overspend; parity tests green
- 2026-07-29 | C3.4 | gate: PASS | rollover max(0,prev); cash overspend resets + reduces next RTA; credit overspend -> card debt (RTA untouched); mixed matrix tested
- 2026-07-29 | C3.5 | gate: PASS | funded credit spend auto-moves to payment category (per-account attribution); payments draw down; ensureCreditCardPaymentCategories idempotent; goals monthly + target_by_date (ceil suggestion); 19 engine tests green
- 2026-07-29 | C4.1 | gate: PASS | design tokens (styles/theme.ts + globals.css), MoneyCell (RAG + EGP), Modal (focus trap + escape), MoneyInput (integer milliunits at the boundary); typecheck + lint + build green; 85 tests green
- 2026-07-29 | C4.2 | gate: PASS | app shell + real route wiring (Stub removed), AccountsSidebar (on/off-budget groups, store balances, last-4 redaction), state/actions.ts domain helpers; typecheck 0, 4/4 sidebar tests; ledger cert C4.2
- 2026-07-29 | C4.3 | gate: PASS | BudgetView grid (month nav, editable Assigned persists via store, RTA banner matches engine, group rows, native table, seed loader); 24/24 budget tests; ledger cert C4.3
- 2026-07-29 | C4.4 | gate: PASS | Register (ledger-parity rows, view-only sort/filter, cleared toggle persists, canonical running balance, reconciled rows locked); 10/10 transactions tests; ledger cert C4.4
- 2026-07-29 | C4.5 | gate: PASS | TransactionForm (decimal->milliunits boundary, payee autocomplete, exact-sum splits enforced, linked transfers, unbalanced split refused with visible alert); money-invariant PASS; ledger cert C4.5
- 2026-07-29 | C4.6 | gate: PASS | Reconcile (statement vs cleared difference, adjustment closes to zero, cleared->reconciled lock; locked rows refuse edits); 4/4 tests; ledger cert C4.6
- 2026-07-29 | C4.7 | gate: PASS | ImportWizard over pure engine (Picker/local pick, exact+fuzzy+flagged dedup preview, idempotent double-commit); 19/19 import tests; drive-scope PASS; live E2E awaits credentials (U1); ledger cert C4.7 — Contract 4 DONE
- 2026-07-29 | C5.1 | gate: PASS | reports: spending (nets refunds, group rollup), netWorth series, ageOfMoney FIFO; Reports.tsx inline-SVG charts (no chart lib); 9 calc tests; money-invariant PASS; ledger cert C5.1
- 2026-07-29 | C5.2 | gate: PASS | rescue analytics: card utilization / debt service ratio / liquidity runway / 30-60-90 panel, integer-bps ratios, formulas cite docs/research, not-advice disclaimer; 10 tests; ledger cert C5.2
- 2026-07-29 | C5.3 | gate: PASS | installable offline PWA (vite-plugin-pwa 0.21.1 generateSW, 10-entry local-only precache, hand-authored manifest + SVG icons); no-remote-refs + dist checks PASS; ledger cert C5.3
- 2026-07-29 | C5.4 | gate: PASS | honest docs: README real status + verified run steps, OVERVIEW component/data-flow/choices, .env.example = exactly the keys the app reads; generic-only PASS; ledger cert C5.4
- 2026-07-29 | C5.5 | gate: PASS | RELEASE_CHECKLIST + CHANGELOG 0.1.0; contracts 1-5 DONE; verify:all green; push-ready, NOT pushed (awaits remote + explicit go); ledger cert C5.5 — FULL BUILD COMPLETE
