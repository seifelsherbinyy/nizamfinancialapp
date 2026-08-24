# Financial NIZAM — Visual Upgrade Wave 2

**Date:** 2026-08-24  
**Branch:** `work/visual-system-wave1-20260824`  
**Classification:** review_before_commit / public-repository safe  
**Scope:** frontend presentation only; no finance-engine, persistence, routing or server behavior change

## Authority

- PFOS Contract 04 interface boundary
- attached Web Application Design Enhancement & Upgrade Execution Engine
- approved continuation after Visual Wave 1
- existing Budget, Forecast, Obligations and Net Worth source contracts

## Research findings before edit

### FACT

- Budget is a semantic editable table driven by `computeBudget`, with Ready-to-Assign and target progress already computed outside presentation.
- Forecast is a semantic comparison table driven by `forecastAll`; baseline/downside/upside scenario objects, shortfall probability and buffer days already exist.
- Obligations is a registry/editor whose ordered rows already come from `fundingSequence`.
- Net Worth already exposes nominal, liquid and liquidation views, asset components, and explicit unrated-currency evidence gaps.
- None of these screens requires a chart library to materially improve hierarchy in the first analytics wave.

### INFERENCE

The highest-leverage visual defect is not missing analytics data. It is that strong deterministic outputs are flattened into similarly weighted tables. The safest improvement is to add decision hierarchy while retaining the tables as exact comparison surfaces.

## Implementation

### 1. Dedicated analytics presentation layer

Added `src/styles/analytics.css` and imported it from `src/main.tsx`.

This keeps Wave-2 analytical styling separate from the core design-system foundation while reusing semantic tokens from Wave 1.

### 2. Budget responsiveness

Without changing Budget logic or JSX behavior:

- month controls / Ready-to-Assign surface receive stronger planning hierarchy;
- the budget grid gets a deliberate minimum analytical width;
- category/group hierarchy is strengthened;
- narrow-screen behavior preserves data through horizontal scrolling instead of deleting columns or transforming money semantics.

### 3. Forecast decision surface

Updated `src/features/forecast/ForecastView.tsx`.

Each horizon now has a product-level scenario card showing:

- baseline ending cash;
- downside low;
- upside ending cash;
- shortfall probability as text plus an accessible progressbar;
- buffer days;
- an explicit risk state.

The original `Forecast by horizon` table is retained below as the exact dense comparison surface.

No forecast value is recalculated in presentation. All money values remain provided by `forecastAll`. The only presentation transformation is basis-points-to-percent text/width, which was already present in the prior UI for text display.

### 4. Obligations hierarchy

Targeted CSS strengthens:

- priority visibility;
- numeric scanning;
- dense-table readability;
- narrow-screen overflow behavior.

`fundingSequence`, modal behavior, deletion behavior and obligation values remain unchanged.

### 5. Net Worth position hierarchy

The existing three canonical views — nominal, liquid, liquidation — are visually promoted into a three-part financial-position summary using CSS while leaving the semantic table in place.

On smaller viewports the summary becomes a single-column stack. Asset/FX behavior and the explicit unrated-currency alert remain untouched.

## Dependency/performance posture

Wave 2 adds **zero dependencies**.

No Recharts, ECharts, GSAP, Rive, Three.js, icon bundle or UI framework was added. The forecast visualization is CSS + semantic HTML because the existing decision problem does not yet justify a chart runtime.

## Files changed in Wave 2

- `src/styles/analytics.css` — new
- `src/main.tsx` — analytics stylesheet import
- `src/features/forecast/ForecastView.tsx` — scenario cards + retained comparison table

Wave-2 CSS also intentionally upgrades the existing markup of:

- `src/features/budget/BudgetView.tsx`
- `src/features/obligations/ObligationsView.tsx`
- `src/features/netWorth/NetWorthView.tsx`

without modifying their business/data-entry logic.

## Verification boundary

### Observed

- Branch comparison after Wave 2: ahead of `master`, behind by zero.
- Changed-file set remains frontend/docs only.
- Forecast uses the existing `SectionHeader` API and existing deterministic forecast types.
- Existing dense forecast table and accessible labels remain present.
- No package manifest change occurred.

### Not observed

No executable repository shell or CI is available in this session, so the following are still unproven:

- typecheck;
- lint;
- Vitest;
- production build;
- full repository harness;
- real browser responsive behavior;
- screen-reader/keyboard browser walkthrough;
- tamper proof.

The branch therefore remains **unmerged and not release-ready**.

## Next design wave

After executable verification:

1. Transaction Register density/search/filter hierarchy.
2. Reports decision-quality and chart selection audit.
3. Shared `EmptyState`, `Alert`, `Skeleton`, `StatusBadge` primitives.
4. Modal focus trap + focus restoration.
5. Optional lightweight iconography after bundle/license review.
6. Only then evaluate Recharts for net-worth/forecast time-series where a real temporal series exists and the chart answers a decision question.

## Status

**WAVE 2 IMPLEMENTED ON BRANCH — RUNTIME VERIFICATION STILL REQUIRED.**
