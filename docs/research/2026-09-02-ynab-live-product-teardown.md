<!--
NIZAM RESEARCH DOCUMENT — firsthand observation record.
owning contract: contracts/CONTRACT_4_ui_ynab.md (C4 — UI/UX, YNAB-style)
supporting contracts: contracts/pfos/04_PFOS_UX_UI_User_Journeys_Research_and_Delivery_Roadmap.md
                      contracts/pfos/06_PFOS_Database_and_Knowledge_Model.md
phase: C4 pre-implementation research (informs Phases 4.1-4.7)
status: BACKGROUND RESEARCH — not authority. Contracts + steering outrank this file.
observed: 2026-09-02 (UTC) against the live public YNAB surface
money rule: all amounts below are integer milliunits unless explicitly marked derived
-->

# YNAB — Live Product Teardown (2026-09-02)

Firsthand observation of YNAB's **public** product surface, recorded for NIZAM's C4 UI work.

## 1. Why this file exists alongside the older research

`docs/research/budgeting-app-ynab-architecture.md` (899 lines, imported 2026-07-29) is **secondhand**:
it reasons from Actual Budget as a reference implementation, proposes a SQLite/Tauri/desktop stack, and
`_RESEARCH_INDEX.md` already flags it as contradicting the intended web + Drive + Dexie architecture.

This file is different in kind: it is a **dated, firsthand record of what YNAB actually ships**, taken
from their live pages, their published CSS custom properties, their HTTP response headers, and their
public OpenAPI specification. Where the two disagree, prefer this file for *observed facts about YNAB*
and prefer the contracts for *what NIZAM should build*.

## 2. Method and boundaries (read before extending this work)

**What was done:** read public marketing/product pages as a normal reader; read published CSS custom
properties via ordinary page rendering; read public HTTP response headers; downloaded and parsed the
public OpenAPI spec at `https://api.ynab.com/papi/open_api_spec.yaml`.

**What was deliberately NOT done, and should not be done later:**

- No automated testing, fuzzing, form submission, or endpoint probing against ynab.com. It is a third
  party's production system; that would be unauthorized testing and a likely ToS breach.
- No account was created and no credentialed session was used. The budgeting app behind the login was
  therefore **not** inspected. Everything below the login is unobserved.
- No YNAB source (CSS/JS/markup) was copied into this repository. Their code and brand identity are
  their IP. Only *structural patterns* and *published interface facts* are recorded.
- No real financial data of any kind is present in this file.

**Redactions applied:** their Datadog client key and CSP script nonce appeared in response headers and
are redacted here as `[REDACTED]` per the repository's no-secrets rule, even though they are theirs.

## 3. Public page inventory and information architecture

Primary nav is deliberately narrow — two commercial destinations, everything else is education:

| Path | Role |
|------|------|
| `/` | positioning, social proof, single CTA |
| `/features` | capability list |
| `/pricing` | plans + FAQ (richest factual page) |
| `/why-ynab-is-different` | differentiation |
| `/our-free-34-day-trial` | trial mechanics |
| `/guide/the-ultimate-get-started-guide` | onboarding education |
| `/free-workshops`, `/blog`, `/help-center` | education / support |
| `/referral-program`, `/give-ynab`, `/features/subscription-sharing` | growth loops |
| `/signup`, `app.ynab.com` (login) | conversion, app entry |

**Observation worth copying:** the entire site funnels to one CTA string ("Start Your Free Trial",
`/signup`) repeated at every scroll depth — the homepage exposed 5 instances of it and no competing
primary action. NIZAM is single-user so conversion is irrelevant, but the *discipline of one primary
action per view* transfers directly to the budget view's "Assign" affordance.

**Signup form (observed, not submitted):** email, password, TOS checkbox, submit, plus Apple and Google
SSO. That is the whole form — no name, no card, no plan choice at signup.

## 4. Positioning and pricing — and two structural gaps NIZAM fills

Pricing (observed 2026-09-02): **$109 USD/year** ($9.08/mo equivalent) or **$14.99 USD/month**, plus tax.
34-day trial, **no credit card required** when signing up directly. 365-day free trial for students.

Two statements from `/pricing` are strategically decisive for NIZAM:

> "Direct import currently supports select US, Canadian, UK, and EU Banks. If you don't live in any of
> those regions, File-Based Import works like a charm."

> "You can select the currency you want to use in YNAB, but you can't use multiple currencies together
> in a single spending plan."

**Gap 1 — Egypt is structurally unserved for automated import.** Their bank aggregation is Plaid and MX
(confirmed independently in their CSP, section 6). Neither covers Egyptian retail banks, so an Egyptian
user is permanently on manual file import. This is precisely the void NIZAM's ingestion path targets.

**Gap 2 — single currency per plan.** A user holding EGP alongside USD brokerage exposure cannot model
both in one YNAB plan. NIZAM must decide this explicitly rather than inherit it.

**Cost framing:** $109/yr is charged in USD with no purchasing-power adjustment ("Exchange rates are not
reflected in the price"), which is materially expensive in EGP terms. The build-vs-buy case for NIZAM
does not rest on features alone.

## 5. Design system (observed tokens — structure to adopt, palette NOT to adopt)

81 CSS custom properties are published on the marketing site under a strict naming convention:

```
--design-system---<family>--<family|shade>
--design-system---sizing--<t-shirt size>
--design-system---fonts--<face>
```

Observed families and representative values:

| Family | Role inferred from usage | Sample |
|--------|--------------------------|--------|
| Blurple | primary brand / action | `#545bfe`, ramp 100 `#f1f1ff`, 200 `#d4d5ff`, 300 `#a3acff`, 600 `#383ca3` |
| Meadow | positive money / success | `#41d298`, ramp 100 `#edfaf4`, 200 `#bbf6dd`, 300 `#6be9b8` |
| Firefly | lime accent | `#aee865`, 500 `#93d53e` |
| Mulberry | negative money | 600 `#b83646` |
| Sunset | error / alert | 600 `#c72c1e` |
| Neutrals | surface + text | `white`, buttermilk `#fef9ed`, midnight `#1c1f58`, neutral 200-500 |

Sizing scale (rem): `xs .75` · `s 1` · `m 2` · `l 3` · `xhuge 8`.
Typography: body `Figtree` (variable weight, 16px base); display `Wishfarm Semibold`.

**Three transferable patterns:**

1. **Named colour families with numeric ramps**, not `primary`/`secondary`. A family owns a semantic
   role; shades serve state. This is why their green never accidentally means "brand".
2. **A coarse, memorable spacing scale** (5 steps, roughly doubling) instead of a fine-grained 4px grid.
   Fewer choices, more consistency.
3. **Semantic money colour is a first-class family**, not a utility class. Meadow = positive,
   Mulberry/Sunset = negative.

**Direct mapping to C4 Phase 4.1**, which specifies `MoneyCell (RAG: green RTA, red/amber overspend)`:
the token structure validates that design, and supplies the missing third state — YNAB carries a full
amber/lime family (Firefly, buttermilk) for the "funded but at risk" case, not just green/red.

> **IP boundary:** the hex values and family names above are recorded to *understand* their system.
> NIZAM must define its own palette and its own names. Do not copy Blurple/Meadow/Mulberry into
> `src/styles/theme.ts`. Copy the *structure* only.

## 6. Stack and infrastructure (inferred from public response headers)

From `app.ynab.com` response headers:

- **Rails on Heroku.** `x-runtime`, `/assets/application-<digest>.css` (Sprockets), `/assets/packs/js/*`
  (Webpacker/Shakapacker), `heroku-dyno-name: web.5`, `heroku-desired-backends: 5`, region `us-east-1f`.
- **Cloudflare** in front (`cf-cache-status: DYNAMIC`).
- Their CSP report tag self-identifies as `service:ynab-api`, `env:production`, **`version:26.127.1`**.
- `'wasm-unsafe-eval'` in `script-src` — WebAssembly is in use in the client.
- `ynab://*` in `child-src` — custom scheme for web-to-mobile handoff.

Third parties, read off the CSP allowlist (each one is an architectural commitment):

| Concern | Vendor |
|---------|--------|
| Bank aggregation | **Plaid** (`cdn.plaid.com`), **MX** (`atrium.mx.com`, `widgets.moneydesktop.com`) |
| Realtime sync | **PubNub** (`*.pndsn.com`) |
| Billing | **Recurly** + **Stripe** |
| Product analytics / experiments | **Amplitude**, `experiments.ynab.com` |
| Observability | **Datadog** (`browser-intake-datadoghq.com`) |
| Support / messaging | **Kustomer**, **Braze**, Forethought |
| Consent | **OneTrust / CookiePro** |
| Fraud / bot defence | **Castle** (`m.castle.io`) |

**The PubNub finding explains the product claim.** `/features` advertises "real-time syncing across
devices" and offline use; a managed pub/sub layer is how that is delivered. NIZAM's equivalent seam is
Google Drive (`drive.file`) plus Dexie, with no third-party realtime broker — a deliberate and
defensible divergence, since NIZAM's threat model forbids handing a broker any ledger metadata.

**Also note what the vendor list costs them:** twelve third parties in the critical path of a finance
app. NIZAM's offline-first, zero-vendor posture is a genuine privacy advantage, not merely a limitation.

## 7. Security baseline (the most directly reusable artifact here)

Their production header set is a good target for NIZAM's own web app:

```
content-security-policy: upgrade-insecure-requests; base-uri 'self'; default-src 'self';
                         script-src 'self' ... 'nonce-[REDACTED]'; frame-ancestors 'self';
                         worker-src 'self'; manifest-src 'self'
strict-transport-security: max-age=63072000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: SAMEORIGIN
referrer-policy: strict-origin-when-cross-origin
cross-origin-opener-policy: same-origin-allow-popups
x-xss-protection: 0
```

Points worth internalising:

- `default-src 'self'` with an explicit per-directive allowlist, and **nonce-based** `script-src` rather
  than `unsafe-inline`. NIZAM should reach the same bar; a local-first app has a far smaller allowlist,
  so this is *easier* for us, not harder.
- `x-xss-protection: 0` is **correct, not a mistake** — the legacy auditor is deliberately disabled in
  favour of CSP.
- HSTS is 2 years with `includeSubDomains`.
- `style-src` still needs `'unsafe-inline'` — a real-world concession, worth expecting in our own build.

## 8. Data model (from the public OpenAPI 3.1.1 spec)

Ten top-level resources: `User · Plans · Accounts · Categories · Payees · Payee Locations · Months ·
Money Movements · Transactions · Scheduled Transactions`.

### 8.1 Money representation — external validation of NIZAM's core rule

The spec states plainly:

> "Transaction amounts are specified in **milliunits format**."

**YNAB stores money as integer milliunits, exactly as `money-rules.md` requires (1 unit = 1000
milliunits).** The most mature product in the category independently arrives at NIZAM's convention.

More instructive is *how they expose decimals safely*. `Account` is `allOf[AccountBase, …]` where the
base carries canonical integers and the extension adds clearly-named derived fields:

| Canonical (integer milliunits) | Derived for presentation only |
|--------------------------------|-------------------------------|
| `balance` | `balance_formatted` (string, locale-applied), `balance_currency` (double) |
| `cleared_balance` | `cleared_balance_formatted`, `cleared_balance_currency` |
| `uncleared_balance` | `uncleared_balance_formatted`, `uncleared_balance_currency` |

The double **never** feeds arithmetic; it is a leaf output. This is the pattern NIZAM should follow when
the UI needs a decimal: derive at the boundary, name it unmistakably, never read it back.

`CurrencyFormat` (8 fields) is the presentation contract: `iso_code`, `example_format`,
`decimal_digits`, `decimal_separator`, `group_separator`, `currency_symbol`, `symbol_first`,
`display_symbol`. NIZAM needs an equivalent for EGP rendering, and it must be data, not hardcoding.

### 8.2 Accounts — `AccountBase`, 18 fields

`id`, `name`, `type`, `on_budget`, `closed`, `note`, `balance`, `cleared_balance`, `uncleared_balance`,
`transfer_payee_id`, `direct_import_linked`, `direct_import_in_error`, `last_reconciled_at`,
`debt_original_balance`, `debt_interest_rates`, `debt_minimum_payments`, `debt_escrow_amounts`, `deleted`.

`AccountType` enum (13 values) — note how much of it is debt:
`checking · savings · cash · creditCard · lineOfCredit · otherAsset · otherLiability · mortgage ·
autoLoan · studentLoan · personalLoan · medicalDebt · otherDebt`

Design consequences:

- **Three balances, not one.** `balance` / `cleared_balance` / `uncleared_balance` is what makes
  reconciliation tractable (C4 Phase 4.6) and must exist before the reconcile UI is built.
- **`on_budget` is the budget/tracking split** — the sidebar grouping in Phase 4.2 is a data property.
- **Every account owns a `transfer_payee_id`.** Transfers are not a separate type; they are ordinary
  transactions pointed at an account's shadow payee (see 8.4).
- **Debt is modelled on the account**, with interest rates, minimum payments and escrow as first-class
  fields. This is the substrate for their loan calculator, and it aligns with NIZAM's Egypt debt/iScore
  research already in `docs/research/`.
- **`deleted` is a tombstone, not a hard delete** — required for sync (see 8.6).

### 8.3 Categories — `CategoryBase`, 27 fields, and this is where the product depth lives

Core: `id`, `category_group_id`, `category_group_name`, `name`, `hidden`, `internal`,
`original_category_group_id`, `note`, `budgeted`, `activity`, `balance`, `deleted`.

**The budget triple is `budgeted` / `activity` / `balance`** (all integer milliunits) — assigned this
month, net movement this month, and resulting available. C4 Phase 4.3's grid is exactly this triple
plus month navigation.

**Sixteen of the 27 fields are the goal/target subsystem:** `goal_type`, `goal_needs_whole_amount`,
`goal_day`, `goal_cadence`, `goal_cadence_frequency`, `goal_creation_month`, `goal_target`,
`goal_target_month`, `goal_target_date`, `goal_percentage_complete`, `goal_months_to_budget`,
`goal_under_funded`, `goal_overall_funded`, `goal_overall_left`, `goal_snoozed_at`.

`goal_type` enum with the spec's own glosses:

| Code | Meaning |
|------|---------|
| `TB` | Target Category Balance |
| `TBD` | Target Category Balance by Date |
| `MF` | Monthly Funding |
| `NEED` | Plan Your Spending |
| `DEBT` | debt payoff goal |

`goal_needs_whole_amount` encodes the monthly rollover behaviour of `NEED` goals — the
"Set Aside" vs "Refill" distinction. That single boolean is the difference between two mental models of
a sinking fund, and it is the kind of detail that separates a real budgeting engine from a toy.

**Judgement for NIZAM:** targets are not a nice-to-have bolted on later — they are over half the
category model, and derived fields like `goal_under_funded` and `goal_months_to_budget` must be engine
outputs (deterministic, C3), never LLM outputs.

`internal` marks system categories (e.g. the Ready-to-Assign / deferred-income machinery), so the schema
must reserve space for categories the user may not edit.

### 8.4 Transactions — `TransactionSummaryBase`, 19 fields

`id`, `date`, `amount`, `memo`, `cleared`, `approved`, `flag_color`, `flag_name`, `account_id`,
`payee_id`, `category_id`, `transfer_account_id`, `transfer_transaction_id`, `matched_transaction_id`,
`import_id`, `import_payee_name`, `import_payee_name_original`, `debt_transaction_type`, `deleted`.

Verified enums:

- **`cleared`: `cleared | uncleared | reconciled`** — three states. It is *not* a boolean.
  (My first parse of the spec wrongly reported boolean; re-reading the schema corrected it. The
  reconciled state is a lock, and C4 Phase 4.6 depends on it.)
- **`approved`: boolean, and orthogonal to `cleared`.** Imported transactions land unapproved; approval
  is a separate human gate from bank clearing. Two independent axes, four meaningful combinations.
- `flag_color`: `red | orange | yellow | green | blue | purple | "" | null`, with a companion
  `flag_name` for user-renamed flags.
- `debt_transaction_type`: `payment | refund | fee | interest | escrow | balanceAdjustment | credit |
  charge | null` — so a payment against a loan is classified, which is what makes principal-vs-interest
  reporting possible.

**Transfers** are a doubly-linked pair: `transfer_account_id` plus `transfer_transaction_id`, resolved
through the counterpart account's transfer payee. C4 Phase 4.5's gate ("transfer create correct linked
rows") is precisely this invariant.

**Import and dedupe** are modelled explicitly: `import_id` (the idempotency key),
`import_payee_name` and `import_payee_name_original` (preserving the raw bank string alongside the
cleaned one), and `matched_transaction_id` for match-to-existing. C4 Phase 4.7's dedupe preview needs
all four; keeping the original payee string is the part most implementations forget.

**Splits** use `subtransactions`, with two hard rules stated in the spec:

> "Splits are not allowed on tracking accounts or on transfers between on-budget accounts; a transfer to
> a tracking account can be a split."

> "Updating `subtransactions` on an existing split transaction is not supported and will return an error."

The second is a genuine limitation of their API, not a design ideal — editing a split means replacing it.
NIZAM should decide deliberately whether to accept the same constraint.

### 8.5 Months and scheduled transactions

`Months` is a **first-class entity, not a computed view** — "Each plan contains one or more months,
which is where Ready to Assign …". Month-scoping is structural. NIZAM's budget engine should persist
month state rather than recompute it from the transaction log on every render.

`ScheduledTransactionFrequency` enum: `never · daily · weekly · everyOtherWeek · twiceAMonth ·
every4Weeks · monthly · everyOtherMonth · every3Months · …`. Note `everyOtherWeek` and `every4Weeks`
are distinct from `twiceAMonth` and `monthly` — real salary and bill cadences do not reduce to a cron
expression, and Egyptian payroll cadences will need the same care.

`Money Movements` is its own resource: "money moved between two categories" — reassignment is a modelled
event, not an untracked edit.

### 8.6 Sync design — `server_knowledge` delta requests

> "Some endpoints support Delta Requests, where you can request to receive only what has changed since
> the last response. It is highly recommended…"

A monotonic `server_knowledge` cursor drives incremental sync, and crucially:

> "Deleted transactions will only be included in delta requests."

**Tombstones are visible only through the delta channel.** A full fetch shows live rows; the delta
channel carries deletions. Any client that syncs only by full fetch will never learn about deletions and
will silently resurrect them.

This is the single most important lesson for NIZAM's Drive sync: **deletion must be a replicated event
with its own channel, not the absence of a record.** The C2 Drive data layer needs an explicit tombstone
and cursor design, and it should be tested for the resurrection case.

Their guidance also states rate limits exist and that clients should cache, use the most specific
endpoint available, and tolerate faults — standard, but it confirms the API is not intended as a
real-time query layer.

## 9. Decisions for NIZAM

**Adopt:**
- Integer milliunits canonical, decimals only as clearly-named derived leaf fields (8.1).
- Three account balances: total / cleared / uncleared, before building reconcile (8.2).
- `cleared` as a three-state enum including `reconciled` as a lock; `approved` as an orthogonal axis (8.4).
- Import fields: idempotency key, original *and* cleaned payee string, match pointer (8.4).
- Transfers as doubly-linked ordinary transactions via a per-account transfer payee (8.2, 8.4).
- Months as persisted first-class entities (8.5).
- Tombstones plus a monotonic sync cursor, with deletion as a replicated event (8.6).
- Token structure: named semantic colour families with numeric ramps; coarse spacing scale (5).
- The security header baseline in section 7.
- Targets/goals as a first-class part of the category model, computed deterministically (8.3).

**Reject or diverge:**
- No third-party realtime broker, aggregator, or analytics vendor. Drive + Dexie only (6).
- Do not adopt their palette or brand vocabulary — structure only (5).
- Do not inherit "splits cannot be edited" without an explicit decision (8.4).

**Decide explicitly (open questions):**
- **Multi-currency.** YNAB forbids it per plan. NIZAM's EGP-plus-USD-exposure reality may require it,
  and it is far cheaper to design in than to retrofit.
- Whether Egyptian bank ingestion is file-import-only, or file plus Telegram (per PFOS 14).
- Whether `Money Movements` deserves a distinct event type in NIZAM's ledger.

## 10. Provenance — exact commands run

```
browser navigate "https://www.ynab.com"                      # then /signup, /features
browser eval  <read :root CSS custom properties, 81 tokens>
web_fetch     "https://www.ynab.com/features"
web_fetch     "https://www.ynab.com/pricing"
web_fetch     "https://api.ynab.com/#formats"
powershell    Invoke-WebRequest https://app.ynab.com          # headers + raw HTML
powershell    Invoke-WebRequest https://api.ynab.com/papi/open_api_spec.yaml -OutFile spec_full.yaml
```

Spec parsed locally: OpenAPI **3.1.1**, 4031 lines, `components.schemas` at line 1837.
Working copies under `~/.aki/tmp/ynab/` (outside the repository; nothing fetched was committed).

Note: `web_fetch` truncates at 50,000 characters and silently cut `components.schemas` from the first
download, which is why the raw `Invoke-WebRequest` copy was used for all schema claims.

## 11. Limitations — what this document does not know

- **The app itself was never seen.** No account, no login. Every claim about the budget grid, register,
  reconcile flow, or import wizard UI is absent here by design; only the API and marketing copy inform
  section 8 and 9.
- **Stack claims in section 6 are inference from headers**, not confirmation. Rails/Sprockets/Webpacker
  is a strong read of `x-runtime` plus asset digest paths, but it is a read.
- Vendor list is the CSP *allowlist* — permission to connect, not proof of use on every request.
- Pricing and the direct-import region list are point-in-time (2026-09-02) and will drift.
- Enum and field lists are from the public API, which is a deliberately narrowed projection of their
  internal schema. Absence from the API is not absence from their database.
- Their geo-detection served an Australian interstitial during this session, so any locale-sensitive
  copy observed may not match what an Egyptian visitor sees.
