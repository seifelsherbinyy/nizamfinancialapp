# HSBC PDF → Tabular Store → Analytics → HTML Report Pipeline
## Architecture Decision Record & Complete Implementation Guide

**Version:** 1.0 | **Date:** 2026-06-08 | **Status:** APPROVED — Ready for Phase 2 Extraction Pilot

***

## Executive Summary

This document presents the full Architecture Decision Record (ADR) and implementation guide for a 7-stage local pipeline that transforms 20 HSBC PDF bank statements (across three accounts: `debit`, `8071`, `5411`) into a canonical tabular data store, runs comprehensive personal financial analytics, and emits a single-file offline HTML report. If distress indicators are detected, the pipeline generates a tiered 5-document financial recovery plan adapted from institutional turnaround frameworks.

The deliverable package includes:
- `run.ps1` — PowerShell orchestrator (one-command execution)
- `scripts/extract.py` — Stage 1: PDF ingestion
- `scripts/normalize.py` — Stage 2: raw JSON → staging Parquet
- `scripts/validate.py` — Stage 3: 7-layer reconciliation + quarantine
- `scripts/enrich.py` — Stage 4: merchant / category / recurrence / transfers
- `scripts/analytics.py` — Stage 5: all financial metrics + health index
- `scripts/recovery.py` — Stage 6: recovery/optimization plan generator
- `scripts/render.py` — Stage 7: Jinja2 + Plotly offline HTML report
- `docs/ADR.md` — Full architecture decision record
- `docs/canonical_schema.md` — Complete table schemas

***

## Track A — PDF Extraction

### Problem

HSBC UK PDFs use two distinct table layouts: current-account statements (`debit` suffix) have a single debit column plus running balance, while credit-card statements (`8071`, `5411`) have separate debit/credit/balance columns in a bordered-table style. Some pages may be image-scanned (e.g., older archived statements), requiring an OCR fallback path.

### Library Decision Matrix

| Library | Table Accuracy | Scanned Support | Speed | Decision |
|---------|---------------|-----------------|-------|----------|
| `pdfplumber` | ★★★★★ | ✗ (needs bridge) | Medium | **PRIMARY** |
| `camelot-py` lattice | ★★★★☆ | ✗ | Medium | Fallback-1 (bordered tables) |
| `camelot-py` stream | ★★★☆☆ | ✗ | Medium | Fallback-2 (borderless) |
| `pymupdf` (fitz) | ★★★☆☆ | ✓ via Tesseract | ★★★★★ | Scanned router + metadata |
| `ocrmypdf` + Tesseract | ★★★☆☆ | ✓ | Slow | OCR fallback |
| Docling (IBM) | ★★★★☆ | ✓ | Slow | Reserve |

`pdfplumber` is chosen as the primary extractor because it exposes `extract_words()` for deriving column anchors from header rows, handles multi-page tables with repeated headers, and provides fine-grained `page.crop()` control. `pymupdf` is used exclusively for a lightweight text-length heuristic to detect scanned pages before any extraction attempt.[^1]

### Fallback Chain

```
pdfplumber → camelot-lattice → camelot-stream → ocrmypdf+tesseract → quarantine
```

### Acceptance Criteria

- ≥99.5% row recall vs. hand-counted transactions on 3-statement gold sample
- 100% L2 balance-equation pass per statement
- Deterministic re-run: SHA-256 hash of extracted rows identical on second execution

***

## Track B — Canonical Schema

### Standards Surveyed

The canonical schema synthesizes four industry standards:

| Standard | Elements Adopted |
|----------|-----------------|
| ISO 20022 camt.053 | Statement-level metadata: `period_start`, `period_end`, `opening_balance`, `closing_balance` |
| OFX 2.x / QFX | `TRNTYPE` enum, `FITID`-style surrogate key for deduplication |
| Plaid PFCv2 (Dec 2025) | Two-tier category: `primary` + `detailed`; ~100 detailed categories across ~10 primaries |
| Beancount / Ledger-CLI | Double-entry semantics; `transfer_group_id` pairs opposing legs[^2][^3] |

### Transaction ID Derivation

Every transaction receives a deterministic 16-hex surrogate key:

```
transaction_id = sha256(account_id | posted_date | signed_amount | description_clean | seq)[:16]
```

This ensures: (1) idempotent re-runs produce identical IDs, (2) cross-account duplicates are distinguishable by `account_id`, and (3) same-day same-amount transactions are disambiguated by sequence number.

### Sign Convention

`signed_amount` uses the cash-flow sign convention standard in FP&A: outflows are negative (< 0), inflows are positive (> 0). This allows direct arithmetic on columns without conditional branching — the net cashflow for any period is simply `SUM(signed_amount)`.

### Supporting Tables

Five tables form the full schema: `transactions`, `statements`, `accounts`, `categories`, `quarantine`, and the derived `transfers` table. See `docs/canonical_schema.md` for complete DDL.

***

## Track C — Storage & Query Layer

### Decision

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Portable export | CSV per table | Human-readable; importable to Excel / Google Sheets |
| Analytical store | Parquet (Snappy compression) | Arrow-native; predicate pushdown; 3–10× smaller than CSV |
| Query engine | DuckDB | SQL-native; reads Parquet directly; zero-config; fast window functions |
| Schema enforcement | `pyarrow.Schema` on write | Hard-fail on type mismatch at write time |
| Partition strategy | `account_id/year/` | Low cardinality (3 accounts × ~3 years = 9 partitions) |

DuckDB is selected over pandas/polars because at analytical query scale (group-bys, window functions, self-joins for transfer pairing), DuckDB reads Parquet natively with hive partition pruning — no explicit load step required. Published benchmarks show DuckDB is approximately 94× faster than pandas for aggregation-heavy workloads.

### Append-Only Time-Travel

Each run writes a new `part-{run_id}.parquet` file per partition — it never overwrites. The canonical view is obtained via `MAX(run_id)` in DuckDB queries. This provides a lightweight audit trail without a full version-control system.

```
marts/transactions/account_id=HSBC_debit/year=2024/part-20260601_120000.parquet
marts/transactions/account_id=HSBC_8071/year=2024/part-20260601_120000.parquet
```

***

## Track D — Validation Engine

### 7-Layer Validation Stack

| Layer | Description | Tool | Failure Action |
|-------|-------------|------|---------------|
| L1 | Row sanity: types, non-null required fields, direction enum, currency length | `pandera` | Quarantine row |
| L2 | Balance equation: `opening + Σ(signed_amount) == closing` (tolerance: 0.01) | Python assertion | **Hard fail — stop pipeline** |
| L3 | Cross-statement continuity: prior closing == current opening per account | DuckDB LAG | Warning + flag |
| L4 | Transfer pairing: every `transfer_group_id` has exactly 2 legs | DuckDB GROUP BY | Flag unmatched |
| L5 | Duplicate detection: same (account, date, amount, desc_clean) | DuckDB window | Quarantine duplicate |
| L6 | Re-extraction drift: SHA-256 of canonical rows == prior run hash | Python hashlib | Warning if drift |
| L7 | Anomaly: per-category z-score > 3.0 on `signed_amount` | pandas z-score | Flag for review |

L2 is the critical gate: if any statement fails the balance equation beyond a 1p tolerance, the pipeline hard-stops and exits with code 1. This prevents corrupted data from flowing into analytics and producing false health scores.

### Reconciliation Output

Stage 3 produces two artifacts: `validation_report_{run_id}.html` (interactive per-statement table with ✅/❌ status and variance) and `quarantine/{run_id}.parquet` (all quarantined rows with reasons for manual review).

***

## Track E — Financial Analytics

### Metric Catalogue

| Metric | Formula | Distress Threshold | Framework Origin |
|--------|---------|-------------------|------------------|
| **Burn Rate** | `Σ(outflows) − Σ(inflows)` trailing 3m avg | Positive = net cash burn | VC/startup finance[^4] |
| **Cash Runway** | `liquid_balance / net_burn_rate` | < 3 months = critical | VC/startup finance[^4] |
| **FOIR** | `Σ(fixed obligations) / net income` | > 50% = high-risk | Lending / credit underwriting[^5][^6] |
| **Personal DSCR** | `net income / total debt service` | < 1.0 = unable to service | Commercial lending[^6][^7] |
| **Emergency Fund Coverage** | `liquid_balance / monthly_essential_spend` | < 3 months = vulnerable | CFP standards |
| **Lifestyle Inflation Index** | `rolling_12m_spend / rolling_12m_income` | > 85% = danger zone | Personal finance research |
| **Recurring Annualized Total** | `Σ(is_recurring=True, debit) × 12` | > 20% of income = review | Subscription analytics |
| **Benford's Law Conformity** | Chi-sq on leading digits of `signed_amount` | p < 0.05 = anomaly signal | Forensic accounting[^8][^9][^10] |

### Financial Health Index (0–100)

The pipeline's composite distress indicator:

```
health_index =
    0.30 × liquidity_score       # (runway_months / 6) × 100, capped at 100
  + 0.25 × leverage_score        # 100 − (foir × 100), floored at 0
  + 0.20 × discipline_score      # savings_rate × 200, capped at 100
  + 0.15 × resilience_score      # (emergency_fund_months / 6) × 100
  + 0.10 × efficiency_score      # 100 − (recurring_to_income × 200)
```

**Distress gates:**
- `health_index < 50` OR `runway_months < 3` OR `dscr_personal < 1.0` → full 5-document recovery plan
- `health_index 50–70` → optimization plan
- `health_index > 70` → monitoring mode

### Benford's Law Anomaly Detection

Benford's Law states that in many naturally occurring numerical datasets, the leading digit is 1 approximately 30% of the time, while 9 appears less than 5% of the time. The analytics stage applies a chi-squared test against this expected distribution across all transaction amounts. A p-value below 0.05 signals deviation — a forensic red flag warranting manual review of the flagged transactions.[^8][^11][^10][^12]

***

## Track F — Visualization & HTML Output

### Stack Decision

| Stack | Single-file | Offline | Interactivity | Decision |
|-------|-------------|---------|---------------|----------|
| Plotly + Jinja2 + inline Tailwind | ✓ | ✓ | ✓ (hover, zoom) | **CHOSEN** |
| Altair/Vega-Lite | ✓ | ✓ | ✓ | Runner-up |
| Streamlit / Dash | ✗ | ✗ | ✓ | Rejected (requires server) |

Plotly is selected because it bundles its own JavaScript renderer and can be fully inlined into a single `.html` file. The `to_html(full_html=False, include_plotlyjs=False)` pattern embeds the `plotly.min.js` once at the top, then each chart injects only its div — keeping the file compact and fully offline.[^1]

### Visualization Catalogue (10 Charts)

1. **KPI strip** — liquid balance, 30/90d net cash, runway months, FOIR, health index  
2. **Monthly cash flow bar+line** — gross inflow (green), gross outflow (red), net (blue line)
3. **Category treemap** — merchant share within top categories (RdYlGn color scale)
4. **Category Pareto bar+line** — spend by category with cumulative % overlay and 80% line
5. **Health gauge** — Plotly Indicator gauge with traffic-light color zones
6. **Cash runway Monte Carlo fan** — base / stress (+20% burn) / optimistic (−20% burn) scenarios
7. **Recurring charges table** — annualized cost + cancel-candidate flag per merchant
8. **Reconciliation status panel** — per-statement ✅/❌ with variance column
9. **Analytics metrics table** — all KPIs vs. thresholds with status emoji
10. **Distress / health banner** — contextual call-to-action linked to recovery plan

***

## Track G — Recovery Framework

### Framework Evidence Hierarchy

| Framework | Adopted | Rationale |
|-----------|---------|-----------|
| **13-Week Cash Flow Forecast** | ✓ Full | Institutional turnaround standard (AlixPartners, PKF OD)[^13][^14][^15]; week-level cash visibility |
| **YNAB Four Rules** | ✓ Adapted | Rule 1 (Give Every Dollar a Job) + Rule 2 (Embrace True Expenses) + Rule 4 (Age Your Money) directly address HSBC cash-flow timing patterns[^16][^17] |
| **Debt Avalanche** | ✓ Default | Mathematically optimal: minimizes total interest; code generates a dated payoff schedule |
| **Debt Snowball** | ✓ Optional | Behavioral wins via small-balance payoffs; offered as alternative per YNAB guidance[^18][^19] |
| **Conscious Spending Plan (Sethi)** | ✓ Partial | Fixed/investments/savings/spending allocation guides category budget caps |
| **FIRE Savings Rate Model** | ✓ Monitoring | Savings rate as primary long-run lever for resilience |
| **Corporate Turnaround Triage** | ✓ Adapted | 72-hour cash conservation triage logic adapted to household scale[^13][^20] |

### Recovery Plan Documents (Distress Trigger)

When `health_index < 50` OR `runway_months < 3` OR `dscr_personal < 1.0`, Stage 6 generates five pre-filled Markdown documents:

| Document | Horizon | Contents |
|----------|---------|----------|
| `triage_72h.md` | 72 hours | Freeze spending; cancel-candidate subscriptions; check upcoming auto-debits; no new debt |
| `stabilize_30d.md` | 30 days | Zero-based budget allocation; hardship letter templates; weekly checkpoints |
| `reconcile_90d.md` | 90 days | Debt avalanche/snowball schedule; category rationalization; income acceleration |
| `recover_12m.md` | 12 months | Milestone table with key metrics; driver-based levers; FOIR/DSCR targets |
| `resilience_36m.md` | 36 months | Emergency fund target; income diversification; FIRE savings rate progression |

All financial figures in these documents are pre-filled with the user's actual extracted numbers from `analytics_summary.json`.

***

## Decision Gates

| Gate | Trigger | Go Condition | No-Go Action |
|------|---------|-------------|-------------|
| Extraction Adequacy | After Stage 1 pilot | ≥99.5% recall + 100% balance-eq pass | Add OCR fallback |
| Schema Lock | After Stage 2 normalization | All 20 PDFs load without pandera errors | Iterate schema |
| Reconciliation Clean | After Stage 3 validation | Zero L2/L3 breaks | Quarantine + re-extract |
| Distress Detection | After Stage 5 analytics | health_index stable across 2 re-runs | Tune thresholds |
| HTML Deliverable | After Stage 7 render | < 10 MB, offline, all charts interactive | Refactor template |

***

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| HSBC PDFs are image-scanned | 30% | HIGH | pymupdf text-length heuristic routes to OCR fallback |
| Date locale ambiguity (DD/MM vs MM/DD) | 40% | MEDIUM | Validate dates against statement period bounds; default `dayfirst=True` (UK) |
| Category misclassification | 60% | MEDIUM | Rule-based first; user-editable `merchant_dictionary.csv` |
| Recovery plan giving unsafe advice | 30% | HIGH | Prominent `DISCLAIMER` on all plan documents; flag regulated actions |
| HTML report exposing PII | 20% | HIGH | `--Redact` flag; `description_raw` excluded from HTML |
| Silent data loss | 30% | HIGH | L2 hard-fail gate; quarantine log |

***

## Implementation Notes

### Running the Pipeline

```powershell
# One-command execution
.\run.ps1 -InputDir "C:\Users\selsherb\Documents\Archive\personal_statements\hsbc"

# Skip extraction, restart from Stage 4 enrichment
.\run.ps1 -InputDir ".\pdfs" -SkipTo 4

# Specify reproducible run ID
.\run.ps1 -InputDir ".\pdfs" -RunId "2026-06"
```

### Layout Calibration (Required Before First Full Run)

Run `extract.py` on one PDF per account suffix. Inspect the raw JSON output and adjust `LAYOUT_TEMPLATES` in `extract.py` to match the actual column header texts in your HSBC statements. This is a one-time calibration step.

### Extending the Merchant Dictionary

Add rows to `resources/merchant_dictionary.csv`:
```
raw_pattern,merchant_name
VIRGIN MEDIA,Virgin Media
SKY SPORTS,Sky Sports
```

The `enrich.py` stage applies fuzzy matching via `rapidfuzz` with an 85% similarity threshold, so partial matches (e.g., "TESCO STORE 3241") resolve correctly without exhaustive enumeration.

### Privacy

All computation is entirely local — no network calls during any stage. No data reaches any third-party service. Use `run.ps1 -Redact` to strip `description_raw` and masked account numbers from the HTML output before sharing.

***

## Disclaimer

This pipeline is a personal financial awareness tool. It does not constitute regulated financial advice. For formal debt restructuring, bankruptcy proceedings, investment decisions, or consumer proposals, consult a licensed financial advisor (FCA-regulated in the UK). Free UK debt advice resources: **StepChange** (stepchange.org), **Citizens Advice** (citizensadvice.org.uk/debt-and-money/).

---

## References

1. [How to use Dashboard API from python plotly offline?](https://stackoverflow.com/questions/43541488/how-to-use-dashboard-api-from-python-plotly-offline) - I'm interessted in using plotly offline for analytical charts. This works fine for single charts, bu...

2. [Beancount: Lightweight FOSS Double-Entry Accounting... ...](https://lowendbox.com/blog/beancount-lightweight-foss-double-entry-accounting-from-the-command-line/) - Beancount is a neat FOSS project with a simple concept: full double-entry accounting from the comman...

3. [Beancount: Double-Entry Accounting from Text Files. - GitHub](https://github.com/beancount/beancount/) - A double-entry bookkeeping computer language that lets you define financial transaction records in a...

4. [Startup Runway: Reducing Cash Burn & Extending Your Runway](https://www.jpmorgan.com/insights/business-planning/does-your-startup-have-enough-runway-to-survive) - Calculating cash runway ; Net Burn Rate = Monthly Cash Expenses - Monthly Cash Revenue ; Cash Runway...

5. [Debt Service Coverage Ratio Calculator (DSCR)](https://www.omnicalculator.com/finance/dscr) - The debt service coverage ratio calculator (DSCR) finds the proportion between your incoming cash fl...

6. [Debt Service Coverage Ratio - Guide on How to Calculate DSCR](https://corporatefinanceinstitute.com/resources/commercial-lending/debt-service-coverage-ratio/) - Learn what the debt service coverage ratio (DSCR) is, how to calculate it, what a good DSCR looks li...

7. [Debt service coverage ratio - Wikipedia](https://en.wikipedia.org/wiki/Debt_service_coverage_ratio)

8. [How to Detect Fraud with Data Analysis: Benford's Law](https://mike-flanagan.medium.com/how-to-detect-fraud-with-data-analysis-benfords-law-c8ef9ad272a8) - There is a frequency distribution often seen in the natural world that on first glance may challenge...

9. [Newcomb–Benford law and the detection of frauds in international trade | PNAS](https://www.pnas.org/doi/10.1073/pnas.1806617115) - The contrast of fraud in international trade is a crucial task of modern economic regulations. We de...

10. [Benford’s Law Explained with Examples](https://statisticsbyjim.com/probability/benfords-law/) - Benford’s law describes the frequencies for leading digits of numbers in datasets. Smaller values oc...

11. [[PDF] Fraud Detection with Benford's Law - Stockholms universitet](https://kurser.math.su.se/pluginfile.php/20130/mod_folder/content/0/Kandidat/2021/2021_10_report.pdf?forcedownload=1)

12. [Benford's law - Wikipedia](https://en.wikipedia.org/wiki/Benford's_law)

13. [A CFO's Lifeline: Mastering the 13-Week Cash Flow Forecast](https://www.pkfod.com/insights/a-cfos-lifeline-mastering-the-13-week-cash-flow-forecast/) - A 13-week cash flow forecast helps financial leaders improve liquidity, strengthen decision-making a...

14. [Strategic Financial Planning & Analysis (FP&A) - AlixPartners](https://www.alixpartners.com/what-we-do/office-of-the-cfo/strategic-financial-planning-analysis-fpa/) - Predictive and AI-driven forecasting, including cash flow Quality of Earnings. Developed global 13-w...

15. [[PDF] HEALTHCARE INDUSTRY - AlixPartners](https://www.alixpartners.com/media/16499/jcr_september2020-pp6-11.pdf) - A 13-week cash forecast enables management to understand troughs that may not have been visible when...

16. [How to Stress Less About Money: 4 Simple Rules](https://www.ynab.com/blog/ynab-four-rules-less-stress) - You're not bad at money. You just need a method. Learn how to stress less about money with YNAB's 4 ...

17. [I Hate Debt, But the Reasons Why Might Surprise You - YNAB](https://www.ynab.com/blog/a-look-at-debt-through-the-eyes-of-the-four-rules) - I hate debt, and the reasons might surprise you. Learn how debt restricts financial freedom through ...

18. [Escaping the Slippery Slope of Debt | YNAB](https://www.ynab.com/blog/escaping-the-slippery-slope-of-debt) - Buried under a pile of credit card debt? This Whiteboard Wednesday is for you. Learn how to escape t...

19. [How to Get Out (and Stay Out) of Debt - YNAB](https://www.ynab.com/guide/how-to-get-out-of-debt) - Debt keeps you shackled to past decisions. Clear the path for a future of freedom and get out (and s...

20. [13-Week Cash Flow Template for Turnarounds: How to Build and Run](https://nmsconsulting.com/13-week-cash-flow-template/) - Includes a copy/paste template, trend review frequency, 13-week rolling meaning, and how to create a...

