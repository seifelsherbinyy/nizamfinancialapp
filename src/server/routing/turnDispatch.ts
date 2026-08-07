/**
 * NIZAM · Turn dispatch — the one door to the model port, and it needs a grant to open
 * Implemented by: PFOS Contract 12 / Phase 5.1 (spec 06-two-agent-vps)
 * Owning requirements: R16 (a turn classified `T0` invokes no model)
 * Depends on: ./turnClassifier, ../ports/openrouter (types), ../ports/shapeGuards (type level)
 *
 * The classifier makes the T0 guarantee expressible; this module makes it unavoidable. Contract 12
 * §6.1 wants the property proved "structurally: on the `T0` path the model port is **not called**".
 * So the port is not handed to the dispatcher at all. It is wrapped once, in
 * {@link createModelChannel}, and the wrapper's only member demands a
 * {@link ModelInvocationGrant} — which {@link classifyTurn} mints for a non-T0 turn and for
 * nothing else. The deterministic branch of {@link dispatchTurn} therefore has no argument it
 * could pass, and `modelGrant` on a T0 classification is typed `never`, so writing the call is a
 * compile error rather than a code-review question.
 *
 * Three runtime belts sit behind the type, because a `as unknown as` cast defeats any brand and
 * because a planner can be wrong without being malicious. Each one throws BEFORE the port is
 * touched, which is why the negative tests can assert both the refusal and an empty invocation
 * record:
 *
 *  1. **The grant must have been minted** ({@link isMintedGrant}). A forged or hand-built grant is
 *     refused. The registry behind this can only refuse — it never invents a grant — so its
 *     failure mode stops a call rather than permitting one.
 *  2. **The request's tier must equal the grant's tier.** `ModelRequest.tier` is already
 *     `Exclude<Tier, 'T0'>`, so a T0 request does not compile; this closes the remaining gap,
 *     where a `T1` grant is used to issue a `T4` request and buy a more expensive model than the
 *     turn was classified for.
 *  3. **The request's correlation reference must equal the grant's turn reference.** One grant, one
 *     turn: a grant cannot be carried forward and spent on a later turn that was never classified.
 *
 * What this module deliberately does NOT do: pick a model, read the eligibility registry, score
 * candidates, or record spend. Those are Phase 5.2 and 5.3, and `modelPolicy` already owns the
 * selection decision — nothing here forks it. The request is built by an injected planner, so the
 * only thing this file decides is whether the door opens.
 *
 * No money appears here and none can: no arithmetic, no figure, no `src/lib/money` import (§6). No
 * host, path, token, or other deployment particular appears either (R24), and nothing is logged —
 * a caller that wants telemetry uses the redacted {@link ModelCallTelemetry} projection the port
 * defines, which cannot hold prompt or completion text (§6.4, R19).
 */
import type { ModelRequest, ModelResult, OpenRouterPort } from '../ports/openrouter';
import type { Exact } from '../ports/shapeGuards';
import {
  classifyTurn,
  DETERMINISTIC_TIER,
  isMintedGrant,
  type ClassificationRule,
  type DeterministicTier,
  type ModelBearingTier,
  type ModelInvocationGrant,
  type TurnFacts,
} from './turnClassifier';

/** Discriminator for every refusal on this path. A caller matches `code`, never a message. */
export const TURN_ROUTING_ERROR_CODES = [
  'TURN_MODEL_GRANT_NOT_MINTED',
  'TURN_MODEL_GRANT_TIER_MISMATCH',
  'TURN_MODEL_GRANT_TURN_MISMATCH',
] as const;
export type TurnRoutingErrorCode = (typeof TURN_ROUTING_ERROR_CODES)[number];

/**
 * A typed refusal at the model door.
 *
 * `detail` holds references and enum values only — a tier, a rule name, a correlation reference.
 * There is no field for turn content, a prompt, or a completion, so an error travelling through a
 * log cannot carry what the turn said (§6.4, R19).
 */
export class TurnRoutingError extends Error {
  readonly code: TurnRoutingErrorCode;
  readonly detail: Readonly<Record<string, string>>;

  constructor(code: TurnRoutingErrorCode, message: string, detail: Record<string, string> = {}) {
    super(message);
    this.name = 'TurnRoutingError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

/**
 * The only way to reach {@link OpenRouterPort} from the routing tier. A channel holds the port;
 * a caller holds the channel and must produce a grant to use it.
 */
export interface ModelChannel {
  invoke(grant: ModelInvocationGrant, request: ModelRequest): Promise<ModelResult>;
}

/**
 * Wrap a port so every call through it presents a grant. The port itself is captured in the
 * closure and is not exposed on the returned object, so a caller cannot retrieve it and step
 * around the three checks.
 */
export function createModelChannel(port: OpenRouterPort): ModelChannel {
  return {
    async invoke(grant: ModelInvocationGrant, request: ModelRequest): Promise<ModelResult> {
      if (!isMintedGrant(grant)) {
        throw new TurnRoutingError(
          'TURN_MODEL_GRANT_NOT_MINTED',
          'NIZAM turn dispatch: this grant was not minted by classifyTurn, so no classified turn authorized this call (§6.1, R16)',
          { correlationRef: request.correlationRef },
        );
      }
      if (request.tier !== grant.tier) {
        throw new TurnRoutingError(
          'TURN_MODEL_GRANT_TIER_MISMATCH',
          `NIZAM turn dispatch: the request is labelled ${request.tier} but the turn was classified ${grant.tier}; a grant authorizes the tier it was minted for and no other`,
          { requestTier: request.tier, grantTier: grant.tier, correlationRef: request.correlationRef },
        );
      }
      if (request.correlationRef !== grant.turnRef) {
        throw new TurnRoutingError(
          'TURN_MODEL_GRANT_TURN_MISMATCH',
          'NIZAM turn dispatch: the request belongs to a different turn than the grant; one classification authorizes one turn',
          { requestRef: request.correlationRef, grantRef: grant.turnRef },
        );
      }
      return port.complete(request);
    },
  };
}

/**
 * What dispatch needs. The port is absent on purpose: only the channel is present, and only the
 * model branch can satisfy it.
 *
 * `executeDeterministically` is contract 10's `deterministic_service.execute(turn)` — the code-only
 * route. It is generic in its answer, so this module invents no shape for a deterministic result
 * and never touches the engines that produce one.
 */
export interface TurnDispatchDependencies<Answer> {
  readonly channel: ModelChannel;
  readonly executeDeterministically: (facts: TurnFacts, turnRef: string) => Answer;
  /**
   * Builds the request for a model-bearing turn. It takes the grant, so it is unreachable without
   * one: there is no way to plan a request for a turn that was classified `T0`.
   */
  readonly planModelRequest: (grant: ModelInvocationGrant, facts: TurnFacts) => ModelRequest;
}

/** The outcome, discriminated on `route`, mirroring contract 10's `execution: "code_only"`. */
export type TurnOutcome<Answer> =
  | {
      readonly route: 'code_only';
      readonly tier: DeterministicTier;
      readonly rule: ClassificationRule;
      readonly turnRef: string;
      readonly answer: Answer;
    }
  | {
      readonly route: 'model';
      readonly tier: ModelBearingTier;
      readonly rule: ClassificationRule;
      readonly turnRef: string;
      readonly result: ModelResult;
    };

/**
 * Classify a turn and route it. The whole of R16 is the shape of the branch below: the
 * deterministic case returns before any `await`, and it holds no grant, so there is no expression
 * it could write that reaches the channel.
 */
export async function dispatchTurn<Answer, F extends Exact<TurnFacts, F>>(
  deps: TurnDispatchDependencies<Answer>,
  facts: F,
  turnRef: string,
): Promise<TurnOutcome<Answer>> {
  const classification = classifyTurn(facts, turnRef);

  if (classification.tier === DETERMINISTIC_TIER) {
    return {
      route: 'code_only',
      tier: DETERMINISTIC_TIER,
      rule: classification.rule,
      turnRef: classification.turnRef,
      answer: deps.executeDeterministically(facts, classification.turnRef),
    };
  }

  const grant = classification.modelGrant;
  const request = deps.planModelRequest(grant, facts);
  const result = await deps.channel.invoke(grant, request);
  return {
    route: 'model',
    tier: classification.tier,
    rule: classification.rule,
    turnRef: classification.turnRef,
    result,
  };
}
