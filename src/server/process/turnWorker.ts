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
 * {@link TurnFacts} is an extraction step, and it stayed an injected dependency rather than something
 * invented here. `./turnIntake.ts` is that step as of task B5 (spec 07, seam S5): it derives the
 * three facts that are properties of the message and takes the fourteen deterministic-engine verdicts
 * injected, because the model tier never sources a judgement about the owner's money. A deployment
 * with no extractor at all still supplies {@link conservativeTurnFacts}, which classifies every turn
 * `T0`: no model is invoked, no grant is minted, and no spend is possible. That is the fail-closed
 * direction — the alternative, guessing a model-bearing intent from an unparsed body, would spend the
 * owner's cap on a guess.
 *
 * **A failure here never becomes a transport failure.** This module throws nothing of its own: a
 * refusal from the model door, from the halt, or from the provider propagates to
 * {@link drainWorkQueue}, which turns it into a queue retry with backoff or an abandonment with a
 * code (§5.5.4). A halt refusal carries `MODEL_KILL_SWITCH_ENGAGED`, so the failure line records the
 * cause without this module having to interpret it.
 *
 * Nothing below LOGS message content: `queuedRef` is the correlation reference and the only thing
 * that reaches an observer (§6.4, R19). Since task A-G4 the composed answer does travel through this
 * module — that is the whole of the fix — and it travels in one direction only: into the injected
 * {@link TurnReplySender}, which is the owner's own conversation. It is not inspected, not recorded,
 * and not placed in any observation or refusal.
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

// ---------------------------------------------------------------------------------------------
// The outbound capability, injected (task A-G4)
// ---------------------------------------------------------------------------------------------

/**
 * Where a reply goes: the conversation the message arrived on, and nothing else.
 *
 * There is no bot field and no address field, deliberately. Both are deployment particulars (R24),
 * both belong to the transport, and neither is something this module could be given without being
 * able to name a destination of its own — which is precisely the shape "reply on the conversation the
 * message arrived on" rules out. The reference is READ off the update by the injected reader below.
 */
export interface TurnReplyTarget {
  readonly chatRef: string;
}

/** One composed reply. A destination and a sentence; the correlation reference for the operator. */
export interface TurnReply {
  readonly queuedRef: string;
  readonly target: TurnReplyTarget;
  readonly text: string;
}

/**
 * The whole of this module's outbound capability, and it is a parameter.
 *
 * A worker that constructed a transport could not be tested offline, so the socket stays where it
 * already was: `liveTransport.ts`'s outbound port, with its own bounded rate-limit retry. This type
 * is the closure over that port — the bot identity and the base address are bound by the composition
 * root, so nothing here holds either.
 *
 * A rejection means the answer did not reach the owner. It propagates: see the note on
 * {@link createTurnDispatchWorker}.
 */
export type TurnReplySender = (reply: TurnReply) => Promise<void>;

/**
 * What the owner is told when the turn could not be routed.
 *
 * **It is a refusal, not an answer, and it says so.** It names the fact — routing was unavailable —
 * and it does not attempt the question the model could not answer. It carries **no digit**, which is
 * not a stylistic choice: the model tier never sources a monetary number (contract 12 §6's standing
 * invariant), so a refusal composed on this path must not guess a balance, a limit or a date either.
 * A refusal that invented a figure would be worse than the silence it replaces.
 */
export const TURN_ROUTING_UNAVAILABLE_REPLY =
  'I could not route that turn just now: the conversational side is unavailable, so nothing was answered and nothing was computed. Your ledger is untouched. Send it again shortly, or ask for a deterministic answer — a balance recalculation or safe-to-spend — which is answered by code and needs no model.';

/** The attempt on which a refusal is spoken. See {@link createTurnDispatchWorker}. */
const FIRST_ATTEMPT = 1;

/**
 * A reply sender whose port does not exist yet, bound once it does.
 *
 * The composition root builds the worker BEFORE the boot builds the transport — the worker is an
 * argument to the boot — so at the moment the worker is assembled there is no outbound port to hand
 * it. The same shape `createBindableTelemetrySink` already uses for the telemetry store, for the same
 * reason, and it fails closed: an unbound sender REFUSES rather than discarding, so a composition
 * that forgot to bind loses no turn and marks nothing done. Discarding silently is the defect this
 * whole seam exists to remove; it is not reintroduced as a default.
 */
export interface BindableReplySender {
  /** Hand this to the worker. It resolves the bound sender per call, never at assembly. */
  readonly send: TurnReplySender;
  bind(sender: TurnReplySender): void;
}

export function createBindableReplySender(): BindableReplySender {
  let bound: TurnReplySender | null = null;
  return {
    send: async (reply: TurnReply): Promise<void> => {
      if (bound === null) {
        throw Object.assign(
          new Error(
            'NIZAM turn worker: no outbound sender was bound, so this answer has nowhere to go; the turn is not settled as done, because an undelivered answer is not a delivered one',
          ),
          { code: 'TELEGRAM_SEND_REFUSED' },
        );
      }
      return bound(reply);
    },
    bind: (sender: TurnReplySender): void => {
      bound = sender;
    },
  };
}

export interface TurnWorkerDependencies<Answer> {
  /** The dispatch dependencies: the channel, the deterministic executor, the request planner. */
  readonly dispatch: TurnDispatchDependencies<Answer>;
  /** How a queued item becomes classifier facts. Required — see the module note. */
  readonly readTurnFacts: (item: TelegramWorkItem) => TurnFacts;
  /**
   * How a queued item becomes the planner for its own turn (task B5, seam S4). Optional, and the
   * reason it exists at all is a type-level one: {@link TurnFacts} carries "no figure, no free text"
   * by the classifier's own design, so the owner's words cannot travel to a planner through the
   * facts. The item can carry them, and the item is only in scope here.
   *
   * Supplied, it overrides `dispatch.planModelRequest` **for this item only**. Absent, the
   * dependencies are used exactly as given. Either way the planner still takes a
   * {@link ModelInvocationGrant} as its first parameter, so it stays unreachable from a turn
   * classified `T0` — R16 is a capability and nothing here hands one out.
   */
  readonly planTurnRequest?: (item: TelegramWorkItem) => TurnDispatchDependencies<Answer>['planModelRequest'];
  /**
   * Where the reply goes, read off the queued item. Required, and `null` is a legitimate answer: an
   * update that carries no readable conversation has nowhere to be replied to.
   */
  readonly readReplyTarget: (item: TelegramWorkItem) => TurnReplyTarget | null;
  /**
   * How a composed {@link Answer} becomes the sentence the owner reads. Injected because `Answer` is
   * generic here: this module invents no shape for a deterministic result and therefore cannot invent
   * a rendering for one either.
   */
  readonly renderAnswer: (answer: Answer) => string;
  /** The outbound capability. Required: a worker that cannot reply is the defect, not a mode. */
  readonly sendReply: TurnReplySender;
  readonly onDispatch?: (observation: TurnDispatchObservation) => void;
}

/**
 * Build the asynchronous side of {@link TelegramPort} from the dispatch tier.
 *
 * ## `done` means the answer reached the owner (task A-G4)
 *
 * Until this task the composed {@link Answer} was computed and then dropped: the outcome was
 * observed, `{ outcome: 'done' }` was returned, and nothing was sent — six real turns settled with
 * two of them carrying a real deterministic answer that never left the process, and the log showed
 * the read component thirty-five times and the send component not once. So `done` is now the report
 * of a DELIVERED reply and of nothing weaker, and the three failure shapes are settled distinctly:
 *
 *  - **No destination.** An update with no readable conversation is `abandoned` with
 *    `TELEGRAM_SEND_REFUSED`. Retrying would re-read the same body and find the same absence.
 *  - **The send refused.** The rejection PROPAGATES, so the runner settles a retry with backoff or an
 *    abandonment with the code — the same ownership §5.5.4 already gives a downstream failure. No new
 *    retry loop is added here; the bounded one in `liveTransport.ts` is the only one on this path.
 *  - **The turn could not be routed.** A refusal is a reply, so the owner is told
 *    {@link TURN_ROUTING_UNAVAILABLE_REPLY} and the dispatch failure is then re-raised unchanged, so
 *    the row still records the failure rather than settling `done`. The refusal is spoken on the
 *    FIRST attempt only: the runner's bounded retry is a schedule, and repeating the refusal on each
 *    pass would turn one failure into a run of identical messages. A failure to deliver the refusal
 *    is swallowed *there and only there*, because the dispatch failure is the one that must reach the
 *    runner and it already puts the row back on the queue.
 */
export function createTurnDispatchWorker<Answer>(deps: TurnWorkerDependencies<Answer>): TelegramWorkerPort {
  return {
    async process(item: TelegramWorkItem): Promise<TelegramWorkOutcome> {
      // Read first, so a turn with nowhere to answer is settled before anything is computed for it.
      const target = deps.readReplyTarget(item);
      const facts = deps.readTurnFacts(item);
      // One item, one planner. The channel and the deterministic executor are carried through
      // unchanged; only the planner is bound to this turn, and only when one was supplied.
      const dispatch: TurnDispatchDependencies<Answer> =
        deps.planTurnRequest === undefined
          ? deps.dispatch
          : { ...deps.dispatch, planModelRequest: deps.planTurnRequest(item) };

      let outcome: TurnOutcome<Answer>;
      try {
        outcome = await dispatchTurn(dispatch, facts, item.queuedRef);
      } catch (cause) {
        if (target !== null && item.attempt <= FIRST_ATTEMPT) {
          try {
            await deps.sendReply({ queuedRef: item.queuedRef, target, text: TURN_ROUTING_UNAVAILABLE_REPLY });
          } catch {
            // The dispatch failure below is the one the runner must see, and it returns the row to
            // the queue either way. Masking it with a send failure would lose the cause.
          }
        }
        throw cause;
      }

      deps.onDispatch?.({
        queuedRef: item.queuedRef,
        route: outcome.route,
        tier: outcome.tier,
        rule: outcome.rule,
      });

      if (target === null) {
        return { outcome: 'abandoned', code: 'TELEGRAM_SEND_REFUSED' };
      }
      // `ModelResult.text` is the completion; the deterministic answer is rendered by the injected
      // renderer. Neither is inspected, edited or logged here — it is the owner's own reply.
      const text = outcome.route === 'code_only' ? deps.renderAnswer(outcome.answer) : outcome.result.text;
      // A rejection is NOT caught: an undelivered answer must not be recorded as a delivered one.
      await deps.sendReply({ queuedRef: item.queuedRef, target, text });
      return { outcome: 'done' };
    },
  };
}
