/**
 * NIZAM · Per-agent weekly cap → model selection (the wiring, still store-free)
 * Owning contract: PFOS Contract 06 §6.2.3 / §6.3 (the token-spend ledger feeds the routing policy),
 *   consuming contract 10/11's `modelPolicy`. Owning requirements R5, and R17 through it.
 * Build phase: spec 06-two-agent-vps, Phase 1.4 — token-spend ledger + weekly total.
 * Depends on: spendLedger (pure read model), modelPolicy (pure policy). Nothing else.
 *
 * This is the seam contract 06 §6.3 describes: the same pure `weeklySpend` that the server repository
 * uses over real rows also drives `selectModel`, so the policy is fed WITHOUT the store entering this
 * module graph. Nothing here imports `src/server/**`, `node:sqlite`, or `src/lib/money/`.
 *
 * Two properties matter more than the code:
 *
 *  1. **The cap is injected, per agent.** There is no cap literal in this file. A caller supplies
 *     `capMicroUsd` for the one agent being decided (§6.3 writes it as `<AGENT_WEEKLY_CAP_USD>`
 *     precisely so no figure lands in source).
 *  2. **Agents are never aggregated.** The rows are filtered to one agent inside `weeklySpend`, so
 *     exhausting one agent's total cannot reach the other's decision. That is R17, and
 *     `agentBudget.test.ts` proves it by exhausting one agent and asserting the other still routes.
 *
 * Model cost is provider accounting, not money (§6.1); no function here reads a balance, an
 * obligation, or a safe-to-spend value (steering §4.5).
 */
import {
  agentWeeklyBudget,
  microUsdToUsd,
  type AgentWeeklyBudget,
  type SpendAgent,
  type SpendLedgerRow,
} from './spendLedger';
import { selectModel, type SelectionResult, type Tier } from './modelPolicy';
import { type TokenUsage } from '../benchmark/benchmark.types';

export interface AgentSelectionInput {
  readonly tier: Tier;
  /** The one agent this decision is for. Its own rows, its own cap, its own outcome. */
  readonly agent: SpendAgent;
  /** The week boundary, as an argument. No clock is read anywhere below. */
  readonly weekKey: string;
  /** The ledger rows the repository handed in — for either agent; they are filtered here. */
  readonly rows: readonly SpendLedgerRow[];
  /** Injected per-agent weekly cap, integer micro-USD. Never defaulted in this module. */
  readonly capMicroUsd: number;
  readonly allowPremium?: boolean;
  readonly estTurnUsage?: TokenUsage;
}

export interface AgentSelectionResult {
  /** The per-agent cap decision, in integer micro-USD, that produced the selection. */
  readonly budget: AgentWeeklyBudget;
  /** The policy outcome. `blockedByBudget` is true exactly when this agent's own cap is spent. */
  readonly selection: SelectionResult;
}

/**
 * Decide the model for one agent's turn against that agent's own weekly total.
 *
 * The USD conversion happens here and only here: the ledger's unit is integer micro-USD, while
 * contract 11's governance thresholds are fractions of a cap expressed in USD. Converting at this
 * single seam keeps every stored and totalled figure integral.
 */
export function selectModelForAgent(input: AgentSelectionInput): AgentSelectionResult {
  const budget = agentWeeklyBudget(input.rows, {
    agent: input.agent,
    weekKey: input.weekKey,
    capMicroUsd: input.capMicroUsd,
  });

  const selection = selectModel({
    tier: input.tier,
    spentThisWeekUsd: microUsdToUsd(budget.spentMicroUsd),
    capUsd: microUsdToUsd(budget.capMicroUsd),
    ...(input.allowPremium === undefined ? {} : { allowPremium: input.allowPremium }),
    ...(input.estTurnUsage === undefined ? {} : { estTurnUsage: input.estTurnUsage }),
  });

  return { budget, selection };
}
