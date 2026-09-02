/**
 * Single-window offline operator flow.
 * Owning authority: PFOS Contract 14; Contracts 06, 12, and 13; UPOI tasks 5.3 and 5.5; money rules.
 * Phase 14 — offline single-window composition; Stage 5
 * Depends on: operatorMessagePort.ts, ingressRouter.ts, offlineReadOnlyFlow.ts.
 *
 * One namespace, one allowlisted operator, deterministic routing, PFOS-only money.
 * No provider, secret, host, or second bot is resolved here.
 */
import type { TelegramDelivery, TelegramWorkItem } from '../ports/telegram.ts';
import { routeIngressText, type IngressRoute } from '../hermes/ingressRouter.ts';
import { assertDeterministicFinancialResult, type FinancialAnalysisResult } from '../hermes/toolBoundary.ts';
import type { OperatorAcceptDecision, OperatorMessagePort } from '../telegram/operatorMessagePort.ts';

export type SingleWindowStatus =
  | 'idle'
  | 'replied'
  | 'clarified'
  | 'blocked'
  | 'unavailable'
  | 'retry';

export interface SingleWindowRunResult {
  readonly status: SingleWindowStatus;
  readonly queuedRef?: string;
  readonly route: IngressRoute | null;
}

export interface SingleWindowJournalRecord {
  readonly entryRef: string;
  readonly sourceRef: string;
  readonly recordedAt: string;
}

export interface SingleWindowJournalPort {
  append(text: string, sourceRef: string, recordedAt: string): SingleWindowJournalRecord;
}

export interface SingleWindowPfosPort {
  readFinancialSnapshot(queryRef: string): FinancialAnalysisResult;
  runDeterministicAnalysis(queryRef: string): FinancialAnalysisResult;
}

export type SingleWindowReplySender = (queuedRef: string, text: string) => Promise<void>;

export interface SingleWindowFlowContext {
  readonly operator: OperatorMessagePort;
  readonly ownerSenderId: string;
  readonly journal: SingleWindowJournalPort;
  readonly pfos: SingleWindowPfosPort;
  readonly sendReply: SingleWindowReplySender;
  readonly now: () => string;
  readonly retryNotBefore: (item: TelegramWorkItem) => string;
}

export class SingleWindowFlowError extends Error {
  readonly code: 'OWNER_REQUIRED' | 'PFOS_UNAVAILABLE' | 'PFOS_INVALID';

  constructor(code: SingleWindowFlowError['code'], message: string) {
    super(message);
    this.name = 'SingleWindowFlowError';
    this.code = code;
  }
}

function decodeText(item: TelegramWorkItem): string {
  const raw = item.rawBody.trim();
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as { readonly text?: unknown };
      if (typeof parsed.text === 'string') return parsed.text;
    } catch {
      return '';
    }
  }
  return raw;
}

function renderFinance(result: FinancialAnalysisResult): string {
  assertDeterministicFinancialResult(result);
  const values = result.facts
    .map((fact) => `${fact.label}=${fact.amountMilliunits} milliunits`)
    .join('; ');
  return [
    'PFOS result',
    `PFOS result: ${result.resultRef}`,
    `Values: ${values}`,
    'Explanation is non-authoritative and cites the PFOS result only.',
  ].join('\n');
}

export function createSingleWindowFlow(ctx: SingleWindowFlowContext): {
  accept(delivery: TelegramDelivery): OperatorAcceptDecision;
  runOnce(): Promise<SingleWindowRunResult>;
} {
  if (ctx.ownerSenderId.trim() === '') {
    throw new SingleWindowFlowError('OWNER_REQUIRED', 'The single window has no owner allowlist entry.');
  }

  return {
    accept(delivery): OperatorAcceptDecision {
      return ctx.operator.accept(delivery);
    },

    async runOnce(): Promise<SingleWindowRunResult> {
      const item = ctx.operator.queue.claim(1)[0];
      if (item === undefined) return { status: 'idle', route: null };

      const settleRetry = (): SingleWindowRunResult => {
        ctx.operator.queue.settle(item.queuedRef, {
          outcome: 'retry',
          notBefore: ctx.retryNotBefore(item),
        });
        return { status: 'retry', queuedRef: item.queuedRef, route: null };
      };

      if (item.senderId !== ctx.ownerSenderId) {
        ctx.operator.queue.settle(item.queuedRef, { outcome: 'done' });
        return {
          status: 'blocked',
          queuedRef: item.queuedRef,
          route: routeIngressText(''),
        };
      }

      const route = routeIngressText(decodeText(item));
      const reply = async (text: string, status: Exclude<SingleWindowStatus, 'idle' | 'retry'>): Promise<SingleWindowRunResult> => {
        try {
          await ctx.sendReply(item.queuedRef, text);
        } catch {
          return settleRetry();
        }
        ctx.operator.queue.settle(item.queuedRef, { outcome: 'done' });
        return { status, queuedRef: item.queuedRef, route };
      };

      if (route.effect === 'none') {
        const status: Exclude<SingleWindowStatus, 'idle' | 'retry'> = route.code === 'CLARIFY' ? 'clarified' : 'blocked';
        return reply(route.publicReason, status);
      }

      if (route.effect === 'local_write') {
        const recorded = ctx.journal.append(decodeText(item), item.queuedRef, ctx.now());
        return reply(`Captured locally as ${recorded.entryRef}. Continuity recorded.`, 'replied');
      }

      if (route.effect === 'pfos_read') {
        try {
          const result =
            route.tool === 'pfos.run_deterministic_analysis'
              ? ctx.pfos.runDeterministicAnalysis(item.queuedRef)
              : ctx.pfos.readFinancialSnapshot(item.queuedRef);
          return reply(renderFinance(result), 'replied');
        } catch (error) {
          if (error instanceof SingleWindowFlowError && error.code === 'PFOS_UNAVAILABLE') {
            return reply('The deterministic finance source is unavailable. No monetary result was estimated.', 'unavailable');
          }
          return reply('The deterministic finance source refused the result. No substitute figure was produced.', 'unavailable');
        }
      }

      return reply(route.publicReason, 'replied');
    },
  };
}
