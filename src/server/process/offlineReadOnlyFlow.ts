// NIZAM · Offline read-only operator flow composition
// Owning contract: PFOS Contract 12 and UPOI task 5.3; requirements 1.1, 1.3, 2.1, 2.2, 2.4; design §§6.1, 6.2, 6.4, 8.1, 9.1
// Phase: Phase 5.3 UPOI offline integration; all providers are injected and synthetic-safe
// This module reuses the authenticated operator message port and durable queue. Governance and PFOS
// are provider-shaped dependencies so this seam cannot create a second planner or financial engine.

import type { TelegramDelivery, TelegramWorkItem } from '../ports/telegram.ts';
import type { OperatorAcceptDecision, OperatorMessagePort } from '../telegram/operatorMessagePort.ts';

export interface OfflineReadOnlyTurn {
  readonly intent: string;
  readonly requestedAction: string;
  readonly targetAuthority: string;
  readonly scope: readonly string[];
  readonly idempotencyKey: string;
  readonly queryRef: string;
  readonly queryFilters: Readonly<Record<string, unknown>>;
  readonly replyTarget: { readonly chatRef: string };
  readonly explanationRequested?: boolean;
}

export interface OfflineGovernanceTrace {
  readonly contractRefs: readonly string[];
  readonly requirementRefs: readonly string[];
}

export interface OfflineReadOnlyPlan {
  readonly planRef: string;
  readonly targetAuthority: 'deterministic_domain';
  readonly risk: 'READ_ONLY';
  readonly governanceTrace: OfflineGovernanceTrace;
}

export type OfflinePlanDecision =
  | { readonly status: 'planned'; readonly plan: OfflineReadOnlyPlan }
  | { readonly status: 'blocked'; readonly publicReason: string };

export type OfflineAuthorizationDecision =
  | { readonly status: 'accepted'; readonly plan: OfflineReadOnlyPlan }
  | { readonly status: 'blocked'; readonly publicReason: string };

/** A dependency-injected projection of the existing governance planning/authorization boundary. */
export interface OfflineGovernanceProvider {
  plan(turn: OfflineReadOnlyTurn): OfflinePlanDecision;
  authorize(plan: OfflineReadOnlyPlan, turn: OfflineReadOnlyTurn): OfflineAuthorizationDecision;
}

export interface OfflineFinanceQuery {
  readonly queryRef: string;
  readonly filters: Readonly<Record<string, unknown>>;
}

/** The only monetary result shape accepted by this flow: PFOS-produced safe integer milliunits. */
export interface OfflinePfosSnapshot {
  readonly versionRef: string;
  readonly sourceVersion: string;
  readonly observedAt: string;
  readonly values: Readonly<Record<string, number>>;
}

/** A dependency-injected projection of the authoritative PFOS read port. */
export interface OfflinePfosReadProvider {
  readFinancialSnapshot(query: OfflineFinanceQuery): OfflinePfosSnapshot;
}

export interface OfflineContextItem {
  readonly sourceRef: string;
  readonly sourceVersion: string;
  readonly text: string;
}

/** Context is optional and can only enter the explanation provider, never the PFOS query. */
export interface OfflineContextProvider {
  read(turn: OfflineReadOnlyTurn): readonly OfflineContextItem[];
}

export interface OfflineExplanationInput {
  readonly context: readonly OfflineContextItem[];
  readonly pfosVersionRef: string;
  readonly pfosSourceVersion: string;
}

/** The explanation provider receives references, not financial values. */
export interface OfflineExplanationProvider {
  explain(input: OfflineExplanationInput): string;
}

export interface OfflineReply {
  readonly queuedRef: string;
  readonly target: { readonly chatRef: string };
  readonly text: string;
}

export type OfflineReplySender = (reply: OfflineReply) => Promise<void>;
export type OfflineTurnDecoder = (item: TelegramWorkItem) => OfflineReadOnlyTurn;

export interface OfflineReadOnlyFlowContext {
  readonly operator: OperatorMessagePort;
  readonly decodeTurn: OfflineTurnDecoder;
  readonly governance: OfflineGovernanceProvider;
  readonly pfos: OfflinePfosReadProvider;
  readonly sendReply: OfflineReplySender;
  readonly context?: OfflineContextProvider;
  readonly explanation?: OfflineExplanationProvider;
  /** Injected retry instant; no wall clock or retry policy is acquired by this module. */
  readonly retryNotBefore: (item: TelegramWorkItem) => string;
}

export type OfflineFlowRunResult =
  | { readonly status: 'idle' }
  | { readonly status: 'replied'; readonly queuedRef: string; readonly versionRef: string }
  | { readonly status: 'blocked'; readonly queuedRef: string }
  | { readonly status: 'unavailable'; readonly queuedRef: string }
  | { readonly status: 'retry'; readonly queuedRef: string };

export class OfflineReadOnlyFlowError extends Error {
  readonly code: 'PFOS_SNAPSHOT_INVALID' | 'PFOS_SOURCE_UNAVAILABLE' | 'TURN_INVALID';

  constructor(code: OfflineReadOnlyFlowError['code'], message: string) {
    super(message);
    this.name = 'OfflineReadOnlyFlowError';
    this.code = code;
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function validateSnapshot(snapshot: OfflinePfosSnapshot): OfflinePfosSnapshot {
  if (
    snapshot === null ||
    typeof snapshot !== 'object' ||
    !nonEmpty(snapshot.versionRef) ||
    !nonEmpty(snapshot.sourceVersion) ||
    !nonEmpty(snapshot.observedAt) ||
    snapshot.values === null ||
    typeof snapshot.values !== 'object'
  ) {
    throw new OfflineReadOnlyFlowError('PFOS_SNAPSHOT_INVALID', 'The deterministic finance result was malformed.');
  }
  for (const [key, value] of Object.entries(snapshot.values)) {
    if (!nonEmpty(key) || !Number.isSafeInteger(value)) {
      throw new OfflineReadOnlyFlowError('PFOS_SNAPSHOT_INVALID', 'The deterministic finance result was not a safe integer envelope.');
    }
  }
  return snapshot;
}

function renderSnapshot(snapshot: OfflinePfosSnapshot): string {
  const values = Object.entries(snapshot.values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value} milliunits`)
    .join('; ');
  return [
    'PFOS read-only result',
    `PFOS version: ${snapshot.versionRef}`,
    `PFOS source version: ${snapshot.sourceVersion}`,
    `Values: ${values}`,
  ].join('\n');
}

/**
 * Explanations are an optional reply-layer projection. Numeric text is refused here so a model
 * cannot place an authoritative-looking magnitude beside the PFOS result, even though the result
 * itself is never taken from the model.
 */
function stripControlCharacters(text: string): string {
  return [...text].filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return !(code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f) || code === 0x7f);
  }).join('');
}

function safeExplanation(text: string): string | null {
  if (!nonEmpty(text) || text.length > 4_000 || /\d/u.test(text)) return null;
  const normalized = stripControlCharacters(text).trim();
  return normalized === '' ? null : normalized;
}

function redactedBlock(text: string): string {
  return stripControlCharacters(text).trim();
}

function refusalText(): string {
  return 'This read-only request was refused by governance. No financial result was produced.';
}

function unavailableText(): string {
  return 'The deterministic finance source is unavailable. No monetary result was estimated or synthesized.';
}

async function sendAndSettle(
  ctx: OfflineReadOnlyFlowContext,
  item: TelegramWorkItem,
  target: { readonly chatRef: string },
  text: string,
): Promise<'done' | 'retry'> {
  try {
    await ctx.sendReply({ queuedRef: item.queuedRef, target, text: redactedBlock(text) });
  } catch {
    ctx.operator.queue.settle(item.queuedRef, {
      outcome: 'retry',
      notBefore: ctx.retryNotBefore(item),
    });
    return 'retry';
  }
  ctx.operator.queue.settle(item.queuedRef, { outcome: 'done' });
  return 'done';
}

/**
 * Compose the worker side of the existing operator port. Acceptance remains synchronous and is
 * delegated unchanged; this method only claims already durable work, then runs the read-only path.
 */
export function createOfflineReadOnlyFlow(ctx: OfflineReadOnlyFlowContext): {
  accept(delivery: TelegramDelivery): OperatorAcceptDecision;
  runOnce(): Promise<OfflineFlowRunResult>;
} {
  return {
    accept(delivery): OperatorAcceptDecision {
      return ctx.operator.accept(delivery);
    },

    async runOnce(): Promise<OfflineFlowRunResult> {
      const item = ctx.operator.queue.claim(1)[0];
      if (item === undefined) return { status: 'idle' };

      let turn: OfflineReadOnlyTurn | null = null;
      try {
        turn = ctx.decodeTurn(item);
        if (!nonEmpty(turn.replyTarget.chatRef)) {
          throw new OfflineReadOnlyFlowError('TURN_INVALID', 'The read-only turn has no reply target.');
        }

        const planned = ctx.governance.plan(turn);
        if (planned.status !== 'planned') {
          const delivery = await sendAndSettle(ctx, item, turn.replyTarget, refusalText());
          return delivery === 'retry'
            ? { status: 'retry', queuedRef: item.queuedRef }
            : { status: 'blocked', queuedRef: item.queuedRef };
        }
        const authorized = ctx.governance.authorize(planned.plan, turn);
        if (authorized.status !== 'accepted') {
          const delivery = await sendAndSettle(ctx, item, turn.replyTarget, refusalText());
          return delivery === 'retry'
            ? { status: 'retry', queuedRef: item.queuedRef }
            : { status: 'blocked', queuedRef: item.queuedRef };
        }

        // The query is fixed before context is read and is the only input sent to PFOS.
        const snapshot = validateSnapshot(ctx.pfos.readFinancialSnapshot({
          queryRef: turn.queryRef,
          filters: turn.queryFilters,
        }));
        let reply = renderSnapshot(snapshot);

        if (turn.explanationRequested && ctx.context !== undefined && ctx.explanation !== undefined) {
          try {
            const context = ctx.context.read(turn);
            const explanation = safeExplanation(ctx.explanation.explain({
              context,
              pfosVersionRef: snapshot.versionRef,
              pfosSourceVersion: snapshot.sourceVersion,
            }));
            if (explanation !== null) {
              reply += `\nExplanation (non-authoritative): ${explanation}\nCitations: PFOS version ${snapshot.versionRef}; source version ${snapshot.sourceVersion}`;
            }
          } catch {
            // Optional context/explanation failure cannot suppress or replace deterministic PFOS truth.
          }
        }

        const delivery = await sendAndSettle(ctx, item, turn.replyTarget, reply);
        return delivery === 'retry'
          ? { status: 'retry', queuedRef: item.queuedRef }
          : { status: 'replied', queuedRef: item.queuedRef, versionRef: snapshot.versionRef };
      } catch (error) {
        const target = turn?.replyTarget;
        if (error instanceof OfflineReadOnlyFlowError && error.code === 'PFOS_SOURCE_UNAVAILABLE' && target !== undefined) {
          const delivery = await sendAndSettle(ctx, item, target, unavailableText());
          return delivery === 'retry'
            ? { status: 'retry', queuedRef: item.queuedRef }
            : { status: 'unavailable', queuedRef: item.queuedRef };
        }
        ctx.operator.queue.settle(item.queuedRef, {
          outcome: 'retry',
          notBefore: ctx.retryNotBefore(item),
        });
        return { status: 'retry', queuedRef: item.queuedRef };
      }
    },
  };
}
