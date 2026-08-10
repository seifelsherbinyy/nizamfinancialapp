/**
 * NIZAM · The slow side, wired to `routing/turnDispatch`
 * Implemented by: PFOS Contract 12 / Phase 10.7 (spec 06-two-agent-vps)
 * Owning requirements: R29 (the entrypoint wires `acceptHandler` + `workerRunner` +
 *   `routing/turnDispatch`), R16 (a `T0` turn invokes no model), R15 (everything slow lives after
 *   the acknowledgement), R19 (no prompt text, no completion text, anywhere)
 * Depends on: ../routing/turnDispatch, ../routing/turnClassifier (types), ../ports/telegram (the
 *   worker contract). No store, no clock, no network.
 *
 * `workerRunner` drains the durable queue and settles each row; `turnDispatch` decides whether a
 * turn reaches the model port at all. This module is the seam between them, and it is deliberately
 * the whole of that seam: it composes {@link dispatchTurn} and adds nothing to the decision.
 *
 * **The facts reader is injected, and that is the honest boundary.** Turning a raw provider body into
 * {@link TurnFacts} is an extraction step this repository does not have yet — every fact in that type
 * is a deterministic engine's verdict or an enumerated intent, and no module today derives them from
 * a message. So `readTurnFacts` is a required dependency rather than something invented here. A
 * deployment that has no extractor supplies {@link conservativeTurnFacts}, which classifies every
 * turn `T0`: no model is invoked, no grant is minted, and no spend is possible. That is the
 * fail-closed direction — the alternative, guessing a model-bearing intent from an unparsed body,
 * would spend the owner's cap on a guess.
 *
 * **A failure here never becomes a transport failure.** This module throws nothing of its own: a
 * refusal from the model door, from the halt, or from the provider propagates to
 * {@link drainWorkQueue}, which turns it into a queue retry with backoff or an abandonment with a
 * code (§5.5.4). A halt refusal carries `MODEL_KILL_SWITCH_ENGAGED`, so the failure line records the
 * cause without this module having to interpret it.
 *
 * Nothing below reads or writes message content: `queuedRef` is the correlation reference and the
 * only thing that reaches an observer (§6.4, R19).
 */
import type { TelegramWorkerPort, TelegramWorkItem, TelegramWorkOutcome } from '../ports/telegram.ts';
import type { TurnFacts, TurnIntent } from '../routing/turnClassifier.ts';
import { dispatchTurn, type TurnDispatchDependencies, type TurnOutcome } from '../routing/turnDispatch.ts';

/**
 * The most conservative facts a turn can carry: a deterministic intent and every verdict false.
 *
 * `validate_schema` is in the deterministic family, so {@link classifyTurn} returns `T0` by the
 * `deterministic_intent` rule and mints no grant — which is why this default cannot reach the model
 * port even if a later edit handed it a channel. It is the placeholder for the extraction step
 * described in the module note, and it is a placeholder that spends nothing.
 */
export const CONSERVATIVE_INTENT: TurnIntent = 'validate_schema';

export function conservativeTurnFacts(): TurnFacts {
  return {
    intent: CONSERVATIVE_INTENT,
    reversibility: 'reversible',
    dataFreshness: 'fresh',
    missingInformation: false,
    toolRequirement: false,
    securitySensitive: false,
    amountOverOwnerThreshold: false,
    exceedsSafeToSpendAllowance: false,
    materialShareOfLiquidNetWorth: false,
    criticalObligationImpact: false,
    newDebt: false,
    assetSale: false,
    majorIncomeChange: false,
    longHorizonDecision: false,
    forecastShortfallLikely: false,
    evidenceConflicts: false,
    lowConfidence: false,
  };
}

/** One observed dispatch. A route, a tier and a reference — never turn content (§6.4, R19). */
export interface TurnDispatchObservation {
  readonly queuedRef: string;
  readonly route: 'code_only' | 'model';
  readonly tier: string;
  readonly rule: string;
}

export interface TurnWorkerDependencies<Answer> {
  /** The dispatch dependencies: the channel, the deterministic executor, the request planner. */
  readonly dispatch: TurnDispatchDependencies<Answer>;
  /** How a queued item becomes classifier facts. Required — see the module note. */
  readonly readTurnFacts: (item: TelegramWorkItem) => TurnFacts;
  readonly onDispatch?: (observation: TurnDispatchObservation) => void;
}

/**
 * Build the asynchronous side of {@link TelegramPort} from the dispatch tier.
 *
 * Returns `done` when the turn was dispatched. It does not invent a `retry` or an `abandoned`
 * outcome: those are the runner's settlements, and duplicating the decision here would give one
 * failure two owners.
 */
export function createTurnDispatchWorker<Answer>(deps: TurnWorkerDependencies<Answer>): TelegramWorkerPort {
  return {
    async process(item: TelegramWorkItem): Promise<TelegramWorkOutcome> {
      const facts = deps.readTurnFacts(item);
      const outcome: TurnOutcome<Answer> = await dispatchTurn(deps.dispatch, facts, item.queuedRef);
      deps.onDispatch?.({
        queuedRef: item.queuedRef,
        route: outcome.route,
        tier: outcome.tier,
        rule: outcome.rule,
      });
      return { outcome: 'done' };
    },
  };
}
