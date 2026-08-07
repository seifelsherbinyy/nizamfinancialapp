# NIZAM Open-Source UI and Design Research

**As of:** 2026-08-07  
**Baseline:** React 18.3.1, Vite 5.4.11, TypeScript 5.5.4, plain CSS custom properties, Dexie 4.0.10, Zustand 5.0.2.  
**Status:** research and adoption recommendation only. No production dependencies were installed.

## BLUF

Do not migrate NIZAM to a full UI framework or Tailwind starter. Build on the existing plain-CSS system: adopt Radix where the hand-rolled modal needs proven focus behavior; add TanStack Table for transaction ergonomics; use React DayPicker for obligations; and choose modular visx rather than Recharts because Recharts' verified full-import estimate breaches the 100 KB surface gate. Keep Dexie and vite-plugin-pwa. Use Actual Budget, shadcn/ui, Tremor and Wealthfolio as pattern references, not copied runtimes. Arabic readiness starts with CSS logical properties plus native `Intl.NumberFormat`; add react-i18next when localization is scheduled and React Aria only if Hijri or complex date behavior becomes mandatory.

## Method

1. Read NIZAM's live `package.json`, routes, `Modal`, inline-SVG reports and CSS tokens.
2. Discovered **96 canonical GitHub repositories** across all ten axes.
3. Verified final recommendations at repository, LICENSE, npm metadata and Bundlephobia endpoints where available.
4. Scored 0 to 5: surface fit 25%, maintenance 20%, licence 15%, integration cost 15%, design quality 15%, bundle/performance 10%.
5. Applied kill switches. A full-import gzip estimate over 100 KB is blocked unless a real NIZAM build proves a smaller per-surface delta.
6. Enumeration gate: **96 discovered = 12 retained or shortlisted + 84 excluded. PASS.**

### Evidence caveats

- `star_velocity_90d` is `UNKNOWN`: retrieved primary pages expose current stars, not historical snapshots. No velocity was invented.
- Weekly npm downloads were not used because this run did not capture a consistent primary time-windowed endpoint.
- Bundlephobia is a third-party build estimate, not NIZAM's production chunk. Adoption requires a real before/after Vite build.
- GitHub API rate limiting blocked bulk API enumeration. The identity ledger is complete, while numeric claims are limited to successfully captured primary results.

## Trend synthesis

### 1. Headless behavior plus owned visual language
Radix, React Aria, TanStack and shadcn/ui separate behavior from product identity. This fits NIZAM better than importing MUI, Ant, Chakra or Carbon. Evidence: [Radix](https://github.com/radix-ui/primitives), [TanStack Table](https://github.com/TanStack/table), [React Aria](https://github.com/adobe/react-spectrum).

### 2. Native CSS tokens, increasingly expressed in OKLCH
The current pattern is semantic custom properties rather than library-specific theme objects. OKLCH provides perceptual lightness for controlled gain and loss scales. Evidence: [MDN OKLCH](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch), [Tailwind v4 announcement](https://tailwindcss.com/blog/tailwindcss-v4). NIZAM should adopt the token model without adopting Tailwind.

### 3. Component responsiveness is container-driven
Financial widgets should respond to space left by the sidebar, not only viewport width. Evidence: [MDN container queries](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries), [Tailwind v4 container queries](https://tailwindcss.com/blog/tailwindcss-v4).

### 4. Accessibility is architecture, not a final audit
W3C requires semantic relationships, non-color-only meaning and robust focus behavior. Headless libraries reduce risk but do not certify the composed app. Evidence: [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/), [React Aria accessibility](https://react-spectrum.adobe.com/react-aria/accessibility.html).

### 5. RTL readiness begins with logical properties and locale-correct controls
Use `margin-inline`, `padding-inline`, `inset-inline`, `text-align:start`, root `lang/dir`, and native `Intl` for money. React Aria supplies deeper bidirectional keyboard and date behavior when needed. Evidence: [React Aria](https://github.com/adobe/react-spectrum), [DayPicker](https://github.com/gpbl/react-day-picker).

### 6. Finance UI is moving toward quiet density
Actual Budget and current finance OSS patterns emphasize inline editing, transaction density, command access, privacy controls and progressive disclosure. The lesson is not more cards; it is clearer hierarchy, tabular numerals and fewer decorative charts. Evidence: [Actual Budget](https://github.com/actualbudget/actual), [Tremor](https://github.com/tremorlabs/tremor).

### 7. Motion must communicate state
Use motion for saved, synced and reordered state, never decorative balance movement. Respect reduced motion. Evidence: [Motion](https://github.com/motiondivision/motion), [WCAG 2.2](https://www.w3.org/TR/WCAG22/).

## Ranked install shortlist

| Rank | Candidate | Licence | Stars | Last commit | gzip KB | Score | Confidence |
|---:|---|---|---:|---|---:|---:|---|
| 1 | [Radix UI Primitives](https://github.com/radix-ui/primitives) | MIT | 19142 | 2026-07-31 | 12.59 | 4.68 | HIGH |
| 2 | [TanStack React Table](https://github.com/TanStack/table) | MIT | 28284 | 2026-08-07 | 31.37 | 4.59 | HIGH |
| 3 | [React DayPicker](https://github.com/gpbl/react-day-picker) | MIT | UNKNOWN | 2026-06-16 | 19.31 | 4.53 | HIGH |
| 4 | [Lucide React](https://github.com/lucide-icons/lucide) | ISC | UNKNOWN | 2026-08-07 | UNKNOWN: full-import aggregate is misleading | 4.52 | HIGH |
| 5 | [react-i18next](https://github.com/i18next/react-i18next) | MIT | 10036 | 2026-07-22 | 9.96 | 4.46 | HIGH |
| 6 | [visx modular primitives](https://github.com/airbnb/visx) | MIT | 20997 | 2026-06-22 | 28.27 | 4.44 | HIGH |
| 7 | [TanStack React Virtual](https://github.com/TanStack/virtual) | MIT | UNKNOWN | 2026-07-31 | 7.33 | 4.37 | MEDIUM |
| 8 | [Motion](https://github.com/motiondivision/motion) | MIT | 33136 | 2026-08-05 | 45.31 | 4.14 | HIGH |

**Why Recharts is not primary:** Bundlephobia reports 147.53 KB gzip for 3.10.1, over the surface gate. NIZAM's charts are small inline SVG. Modular visx shape plus scale estimates total 28.27 KB gzip before deduplication and preserves the current SVG mental model. Recharts remains a fallback only if a real lazy Vite chunk proves acceptable.

## Popularity lens: top-starred repositories verified in this run

Popularity is a discovery signal, not the recommendation order. The rows below are sorted only by current stars captured from primary GitHub evidence on 2026-08-07; projects with unavailable exact counts remain `UNKNOWN` in the ledgers.

| Rank by stars | Repository | Current stars | Adoption treatment |
|---:|---|---:|---|
| 1 | [shadcn/ui](https://github.com/shadcn-ui/ui) | 120,760 | Borrow layout and component patterns; do not migrate NIZAM to Tailwind now |
| 2 | [Apache ECharts](https://github.com/apache/echarts) | 67,000 | Exclude from runtime: imperative/canvas complexity and weight |
| 3 | [Maybe Finance](https://github.com/maybe-finance/maybe) | 54,344 | Archived AGPL; screenshots and ideas only |
| 4 | [Motion](https://github.com/motiondivision/motion) | 33,136 | Conditional Wave 3 runtime for named state transitions |
| 5 | [Mantine](https://github.com/mantinedev/mantine) | 31,500 | Hold: strong suite but opinionated styling migration |
| 6 | [TanStack Table](https://github.com/TanStack/table) | 28,284 | Wave 1 runtime spike for transaction tables |
| 7 | [Actual Budget](https://github.com/actualbudget/actual) | 28,009 | Highest-fit finance pattern source; avoid importing the whole app |
| 8 | [Recharts](https://github.com/recharts/recharts) | 27,475 | Fallback only if a real lazy Vite chunk passes the size gate |
| 9 | [Firefly III](https://github.com/firefly-iii/firefly-iii) | 24,248 | AGPL/non-React; workflow ideas only |
| 10 | [visx](https://github.com/airbnb/visx) | 20,997 | Wave 2 modular chart primitives |

This view prevents star-worship: only TanStack Table, Motion and visx survive as install candidates. shadcn/ui and Actual Budget remain valuable pattern sources.

## Design and inspiration source map

| Source | What to study | Reuse boundary | NIZAM action |
|---|---|---|---|
| [shadcn/ui](https://github.com/shadcn-ui/ui) | Composable forms, table shells, sidebars, command patterns | MIT/open code, but its Tailwind stack is not adopted | Borrow structure and interaction patterns |
| [Actual Budget](https://github.com/actualbudget/actual) | Inline budget editing, dense transaction register, privacy filter, account hierarchy | MIT; large app, not a package | Reimplement selected patterns against NIZAM models |
| [Tremor](https://github.com/tremorlabs/tremor) | Portfolio tables, KPI hierarchy, finance chart composition | Apache-2.0; maintenance hold | Study blocks, do not add runtime dependency |
| [Wealthfolio](https://github.com/wealthfolio/wealthfolio) | Net-worth dashboard, period controls, multi-currency account grouping | AGPL: ideas only, no code copy | Visual reference only |
| [Tabler](https://github.com/tabler/tabler) | Dense navigation, spacing, finance icon coverage | MIT but Bootstrap-based | Borrow rhythm, not its CSS runtime |
| [Radix Themes](https://github.com/radix-ui/themes) | Neutral scale and component density | MIT; duplicates NIZAM styling | Compare token semantics only |
| [Linear](https://linear.app) | Keyboard-first navigation and disciplined density | Proprietary | Link-only visual inspiration |
| [Revolut](https://www.revolut.com) | Calm hierarchy, balance disclosure, multi-currency patterns | Proprietary | Link-only visual inspiration |
| [YNAB](https://www.ynab.com) | Envelope budgeting hierarchy and goal communication | Proprietary | Link-only product-pattern study |
| [Vercel dashboard](https://vercel.com/dashboard) | Neutral analytics typography and restrained chrome | Proprietary | Link-only visual inspiration |

No proprietary screenshot, design asset or code is copied into NIZAM.

## Per-surface recommendation

| Surface | Primary | Fallback | Why fallback exists |
|---|---|---|---|
| Overview | Existing CSS + token proposal | Borrow shadcn/Tremor patterns | Avoid runtime migration |
| Accounts | Existing sidebar + selective Lucide | Text-only labels | Icons never carry meaning |
| Transactions | TanStack Table | Existing semantic table | Zero-dependency escape hatch |
| Long history | TanStack Virtual after profiling | Pagination | Virtualization can harm a11y if unnecessary |
| Obligations | React DayPicker | Native date input | Mobile-native behavior and fast removal |
| Cashflow forecast | visx primitives | Current inline SVG | Existing code remains small and clear |
| Net-worth history | visx `LinePath` | Current `LineChart` | Reports keep shipping if spike fails |
| Decision cards | Static CSS first; Motion later | No animation | Meaning survives reduced motion |
| Currency switcher | Native `Intl.NumberFormat` | react-i18next when language ships | Format and translation are separate |
| Settings/modal | Radix Dialog | Current `Modal.tsx` | Safe rollback during focus testing |
| Arabic/Hijri dates | Conditional React Aria | DayPicker Gregorian + RTL | Full React Aria import is large |

## Integration playbooks

- [Radix Dialog](integration/radix-dialog.md)
- [TanStack Table](integration/tanstack-table.md)
- [TanStack Virtual](integration/tanstack-virtual.md)
- [React DayPicker](integration/react-day-picker.md)
- [visx](integration/visx.md)
- [Lucide](integration/lucide.md)
- [react-i18next](integration/react-i18next.md)
- [Motion](integration/motion.md)
- [React Aria conditional path](conditional/react-aria.md)

## Design token proposal

Machine-readable file: [tokens/design-tokens.json](tokens/design-tokens.json).

- Body: `Source Sans 3` with `Noto Sans Arabic`; numeric: `IBM Plex Mono`, with `tabular-nums lining-nums`.
- Self-host fonts for the offline PWA. Do not add a remote font dependency.
- Use low-chroma neutral surfaces and one blue accent. Gain/loss colors always pair with a sign, word or icon.
- Spacing remains a restrained 4 px base scale. Controls use 6 px radius; surfaces 8 px.
- Replace physical CSS with logical equivalents before Arabic work.
- Validate every token pair with automated contrast tests; proposal values are not pre-certified.
- Dark mode is a token swap, not a second component tree.

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Framework migration overwhelms value | High | No MUI/Chakra/Ant/Tailwind migration |
| Bundle estimate differs from Vite output | High | Compare `dist/assets` before merge |
| Accessibility assumed from dependency | High | Keyboard and component tests |
| Arabic added after physical CSS spreads | High | Logical-property conversion in Wave 1 |
| Copyleft code copied from references | High | Pattern-only for AGPL/GPL projects |
| Motion becomes decorative | Medium | Reduced-motion test and local wrapper |
| Table/virtual API churn | Medium | Adapter components and flags |
| Multiple icon systems drift | Medium | One icon set, one primitive foundation |
| Star velocity creates false precision | Low | Keep UNKNOWN and exclude from score |

## Exclusion register

| Candidate | Blocker | Decision evidence |
|---|---|---|
| [adobe/react-spectrum](https://github.com/adobe/react-spectrum) | BUNDLE_CONDITIONAL | 271.50 KB gzip full import exceeds gate; conditional only for committed Arabic/Hijri need. |
| [tailwindlabs/headlessui](https://github.com/tailwindlabs/headlessui) | DUPLICATE | Overlaps Radix and adds a second primitive model. |
| [ariakit/ariakit](https://github.com/ariakit/ariakit) | DUPLICATE | Overlaps selected primitives without a NIZAM-only gain. |
| [reach/reach-ui](https://github.com/reach/reach-ui) | MAINTENANCE | Legacy predecessor; current alternatives fit better. |
| [mui/base-ui](https://github.com/mui/base-ui) | MATURITY | Promising recently stable layer; reassess after ecosystem settles. |
| [mui/material-ui](https://github.com/mui/material-ui) | STYLE_COLLISION | Opinionated styling runtime conflicts with plain CSS. |
| [chakra-ui/chakra-ui](https://github.com/chakra-ui/chakra-ui) | STYLE_COLLISION | Runtime and system migration exceed scope. |
| [ant-design/ant-design](https://github.com/ant-design/ant-design) | BUNDLE_STYLE | Enterprise weight and visual-language misfit. |
| [mantinedev/mantine](https://github.com/mantinedev/mantine) | STYLE_COLLISION | Broad styled suite duplicates chosen primitives. |
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | STACK_MIGRATION | Excellent pattern source but requires Tailwind adoption. |
| [heroui-inc/heroui](https://github.com/heroui-inc/heroui) | STYLE_COLLISION | Requires competing styling model. |
| [facebook/astryx](https://github.com/facebook/astryx) | COMPATIBILITY | Requires React 19; NIZAM is React 18.3.1. |
| [TanStack/form](https://github.com/TanStack/form) | NO_CURRENT_NEED | No measured need for a form engine. |
| [pacocoursey/cmdk](https://github.com/pacocoursey/cmdk) | MAINTENANCE | Last observed activity in 2025; not current priority. |
| [react-component/picker](https://github.com/react-component/picker) | LOW_LEVEL | Less direct fit than DayPicker. |
| [wojtekmaj/react-date-picker](https://github.com/wojtekmaj/react-date-picker) | DUPLICATE | DayPicker has stronger localization fit. |
| [bvaughn/react-window](https://github.com/bvaughn/react-window) | DUPLICATE | TanStack Virtual has stronger current RTL fit. |
| [recharts/recharts](https://github.com/recharts/recharts) | BUNDLE | 147.53 KB gzip full import breaches gate. |
| [plouc/nivo](https://github.com/plouc/nivo) | BUNDLE | Heavier and more opinionated than modular visx. |
| [apache/echarts](https://github.com/apache/echarts) | BUNDLE_A11Y | Imperative canvas-default increases bundle and accessibility cost. |
| [chartjs/Chart.js](https://github.com/chartjs/Chart.js) | REACT_INTEGRATION | Canvas-first wrapper path is weaker than React/SVG control. |
| [apexcharts/apexcharts.js](https://github.com/apexcharts/apexcharts.js) | LICENCE_RISK | Commercial terms require added legal review. |
| [tremorlabs/tremor](https://github.com/tremorlabs/tremor) | MAINTENANCE | No observed source push since 2025-10; borrow patterns only. |
| [FormidableLabs/victory](https://github.com/FormidableLabs/victory) | MAINTENANCE | Reduced activity and weaker coverage. |
| [leeoniya/uPlot](https://github.com/leeoniya/uPlot) | SPECIALIZED | Too low-level and time-series-specific. |
| [observablehq/plot](https://github.com/observablehq/plot) | REACT_INTEGRATION | Imperative wrapper and full D3 footprint. |
| [TanStack/charts](https://github.com/TanStack/charts) | MATURITY | Wait for stronger stable API evidence. |
| [tabler/tabler-icons](https://github.com/tabler/tabler-icons) | DUPLICATE | One icon runtime only; Lucide selected. |
| [phosphor-icons/core](https://github.com/phosphor-icons/core) | DUPLICATE | Duplicates Lucide. |
| [react-spring/react-spring](https://github.com/react-spring/react-spring) | DUPLICATE | Motion offers simpler ergonomics. |
| [floating-ui/floating-ui](https://github.com/floating-ui/floating-ui) | TRANSITIVE | Consume through Radix. |
| [formatjs/formatjs](https://github.com/formatjs/formatjs) | DUPLICATE | Use react-i18next plus native Intl first. |
| [maybe-finance/maybe](https://github.com/maybe-finance/maybe) | LICENCE_ARCHIVED | AGPL and archived; visual reference only. |
| [firefly-iii/firefly-iii](https://github.com/firefly-iii/firefly-iii) | LICENCE_STACK | AGPL and non-React; pattern-only. |
| [ghostfolio/ghostfolio](https://github.com/ghostfolio/ghostfolio) | LICENCE_STACK | AGPL and Angular; pattern-only. |
| [beancount/fava](https://github.com/beancount/fava) | STACK | MIT but Svelte/Python; layout reference only. |
| [budgetzero/budgetzero](https://github.com/budgetzero/budgetzero) | EVIDENCE | Insufficient current primary evidence. |
| [envelope-zero/backend](https://github.com/envelope-zero/backend) | LICENCE_SCOPE | AGPL backend, not installable UI. |
| [akaunting/akaunting](https://github.com/akaunting/akaunting) | LICENCE_STACK | Copyleft non-React product; pattern-only. |
| [jakearchibald/idb](https://github.com/jakearchibald/idb) | DUPLICATE | Dexie already supplies richer schema/migrations. |
| [pouchdb/pouchdb](https://github.com/pouchdb/pouchdb) | DUPLICATE | Competing database/sync model. |
| [localForage/localForage](https://github.com/localForage/localForage) | DUPLICATE | Weaker than existing Dexie. |
| [pwa-builder/PWABuilder](https://github.com/pwa-builder/PWABuilder) | DUPLICATE | vite-plugin-pwa already covers build needs. |
| [livestorejs/livestore](https://github.com/livestorejs/livestore) | MATURITY_MIGRATION | Would replace data architecture. |
| [electric-sql/electric](https://github.com/electric-sql/electric) | ARCHITECTURE_MISMATCH | Postgres sync conflicts with SQLite roadmap. |
| [adminmart/shadcn-dashboard](https://github.com/adminmart/shadcn-dashboard) | TEMPLATE | Borrow layout patterns only. |
| [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) | TEMPLATE | Borrow layout patterns only. |
| [TailAdmin/free-react-tailwind-admin-dashboard](https://github.com/TailAdmin/free-react-tailwind-admin-dashboard) | STACK_MIGRATION | Tailwind starter conflicts with plain CSS. |
| [Cruip/tailwind-dashboard-template](https://github.com/Cruip/tailwind-dashboard-template) | STACK_MIGRATION | Visual reference only. |
| [themesberg/flowbite-admin-dashboard](https://github.com/themesberg/flowbite-admin-dashboard) | STACK_MIGRATION | Flowbite/Tailwind runtime collision. |
| [horizon-ui/horizon-ui-chakra](https://github.com/horizon-ui/horizon-ui-chakra) | STACK_MIGRATION | Chakra template conflicts with CSS. |
| [refinedev/refine](https://github.com/refinedev/refine) | FRAMEWORK_OVERREACH | Admin framework migration disproportionate. |
| [microsoft/fluentui](https://github.com/microsoft/fluentui) | STYLE_COLLISION | Microsoft design language misfit. |
| [carbon-design-system/carbon](https://github.com/carbon-design-system/carbon) | STYLE_COLLISION | Heavy enterprise system. |
| [primer/react](https://github.com/primer/react) | STYLE_COLLISION | GitHub product language, not finance-specific. |
| [Shopify/polaris](https://github.com/Shopify/polaris) | STYLE_COLLISION | Commerce-specific design language. |
| [storybookjs/storybook](https://github.com/storybookjs/storybook) | TOOLING | Useful later, not runtime UI. |
| [chakra-ui/ark](https://github.com/chakra-ui/ark) | DUPLICATE | Strong RTL alternative but duplicates Radix/DayPicker. |
| [chakra-ui/park-ui](https://github.com/chakra-ui/park-ui) | STYLE_COLLISION | Requires Panda CSS. |
| [radix-ui/themes](https://github.com/radix-ui/themes) | DUPLICATE | Styled Radix layer duplicates existing token CSS. |
| [argyleink/open-props](https://github.com/argyleink/open-props) | DUPLICATE | Token catalogue useful as reference; custom NIZAM tokens are smaller. |
| [tabler/tabler](https://github.com/tabler/tabler) | STACK_MIGRATION | Bootstrap dashboard; visual reference only. |
| [tailwindlabs/heroicons](https://github.com/tailwindlabs/heroicons) | DUPLICATE | Duplicates Lucide. |
| [phosphor-icons/react](https://github.com/phosphor-icons/react) | DUPLICATE | Duplicates Lucide. |
| [wealthfolio/wealthfolio](https://github.com/wealthfolio/wealthfolio) | LICENCE_PATTERN | AGPL; borrow patterns only. |
| [afaneca/myfin](https://github.com/afaneca/myfin) | LICENCE_PATTERN | GPL; borrow Sankey/forecast patterns only. |
| [spliit-app/spliit](https://github.com/spliit-app/spliit) | PATTERN_ONLY | MIT but full Next.js starter; borrow forms only. |
| [envelope-zero/frontend](https://github.com/envelope-zero/frontend) | LICENCE_SCOPE | AGPL and very small community. |
| [TanStack/query](https://github.com/TanStack/query) | NO_CURRENT_NEED | No server-state cache requirement for this UI scope. |
| [lingui/js-lingui](https://github.com/lingui/js-lingui) | DUPLICATE | Alternative i18n; react-i18next selected for ecosystem fit. |
| [dinerojs/dinero.js](https://github.com/dinerojs/dinero.js) | DUPLICATE | NIZAM integer-money core already enforces arithmetic. |
| [MohammadYounes/rtlcss](https://github.com/MohammadYounes/rtlcss) | MAINTENANCE | Prefer native logical CSS properties. |
| [i18next/i18next](https://github.com/i18next/i18next) | TRANSITIVE | Peer of selected react-i18next, not separately scored. |
| [tradingview/lightweight-charts](https://github.com/tradingview/lightweight-charts) | SPECIALIZED | Price charts do not match current NIZAM surfaces. |
| [hustcc/echarts-for-react](https://github.com/hustcc/echarts-for-react) | BUNDLE_A11Y | Inherits ECharts weight and canvas concerns. |
| [mui/mui-x](https://github.com/mui/mui-x) | STYLE_COLLISION | Requires MUI ecosystem. |
| [d3/d3](https://github.com/d3/d3) | LOW_LEVEL | Use targeted visx/D3 modules instead. |
| [reactivemarkets/react-financial-charts](https://github.com/reactivemarkets/react-financial-charts) | MAINTENANCE | Last publish observed in 2023. |
| [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss) | STACK_MIGRATION | Borrow token/logical-property patterns without migrating. |
| [emilkowalski/vaul](https://github.com/emilkowalski/vaul) | MAINTENANCE | Stale and drawer not current priority. |
| [s-yadav/react-number-format](https://github.com/s-yadav/react-number-format) | DUPLICATE | Existing MoneyInput plus native Intl should be evaluated first. |
| [thesysdev/openui](https://github.com/thesysdev/openui) | MATURITY_SCOPE | Generative UI framework is immature and outside core finance UI. |
| [nexu-io/open-design](https://github.com/nexu-io/open-design) | MATURITY_SCOPE | Design-generation tool, not runtime integration. |
| [ibelick/ui-skills](https://github.com/ibelick/ui-skills) | TOOLING | Design-agent skills are tooling, not runtime UI. |

## Adoption sequence

### Wave 1: foundation, maximum three runtime dependencies
1. Convert physical CSS to logical properties and test proposed token contrast. No runtime dependency.
2. Spike Radix Dialog behind the current Modal contract.
3. Spike TanStack Table on the transaction register.
4. Add Lucide only if a usability review supports it.

Rollback: each spike is isolated behind a local adapter; revert its package and adapter.

### Wave 2: data surfaces
1. Add DayPicker to obligations.
2. Replace one reports chart with modular visx shape and scale.
3. Add TanStack Virtual only after a measured row threshold.

Rollback: native date input, current inline SVG and ordinary table remain implemented.

### Wave 3: conditional localization and motion
1. Add react-i18next when language switching is scheduled.
2. Add React Aria only for committed Arabic/Hijri controls and only if granular build delta passes.
3. Add Motion last, for one named state transition, with a reduced-motion test.

Rollback: English resources, DayPicker and static CSS remain functional.

## Open questions

1. Is Arabic a launch requirement or architectural readiness only?
2. What row count causes the current register to miss its frame budget?
3. Are self-hosted Source Sans 3 and IBM Plex Mono acceptable to the offline asset budget?
4. Does NIZAM need tooltip, zoom or drill-down charts?
5. Should Drive or VPS+SQLite become canonical before UI data adapters change?

## Decision

**Owner: Seif. Next action:** approve a one-day Wave 1 spike limited to Radix Dialog and TanStack Table, keeping existing implementations as fallbacks. Decide after reviewing real Vite bundle deltas, keyboard tests and screenshots.
