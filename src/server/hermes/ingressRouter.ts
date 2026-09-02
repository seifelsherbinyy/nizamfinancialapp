/**
 * Deterministic single-window ingress router.
 * Owning authority: PFOS Contract 14; Contracts 06, 12, and 13; UPOI planning rules; money rules.
 * Phase 14 — single-window Slack ingress surface; Stage 2
 * Depends on: ingressPolicy.ts, toolBoundary.ts, turnIntake.ts.
 * This module classifies operator text into a grant target. It never computes money and never
 * reads a credential. Unknown or secret-seeking turns produce zero effect.
 */
import { deriveIntent } from '../process/turnIntake.ts';
import { profileForIngressTool } from './ingressPolicy.ts';
import {
  assertDeterministicFinancialResult,
  type FinancialAnalysisResult,
  type HermesToolName,
} from './toolBoundary.ts';
import type { HermesProfileName } from './profilePolicy.ts';

export const INGRESS_MODULES = [
  'tafrigh',
  'yawmiyat',
  'shura',
  'naqd',
  'qarar',
  'thabat',
  'mal',
  'refuse',
  'clarify',
] as const;
export type IngressModule = (typeof INGRESS_MODULES)[number];

export const INGRESS_ROUTE_CODES = [
  'ROUTED',
  'CLARIFY',
  'REFUSED_SECRET',
  'REFUSED_UNKNOWN_WRITE',
  'REFUSED_UNAUTHORIZED',
] as const;
export type IngressRouteCode = (typeof INGRESS_ROUTE_CODES)[number];

export interface IngressRoute {
  readonly code: IngressRouteCode;
  readonly module: IngressModule;
  readonly profile: HermesProfileName | null;
  readonly tool: HermesToolName | null;
  readonly effect: 'none' | 'read' | 'local_write' | 'pfos_read';
  readonly publicReason: string;
}

const SECRET_SEEKING =
  /(?:api[_-]?key|bot[_-]?token|openrouter|webhook secret|private key|password|credential|secret token)/iu;
const JOURNAL =
  /(?:\bjournal\b|\byawmiyat\b|\bdump\b|\bbrain dump\b|\btafrigh\b|\bwrite this down\b|\bcapture\b)/iu;
const SHURA = /(?:\bbrainstorm\b|\bshura\b|\bplan with me\b|\bco-think\b|\boptions for\b)/iu;
const NAQD = /(?:\bcritique\b|\bnaqd\b|\bred[- ]?team\b|\bchallenge this\b|\bgrill\b)/iu;
const QARAR = /(?:\bdecide\b|\bqarar\b|\bdecision log\b|\bi have decided\b)/iu;
const THABAT = /(?:\bthabat\b|\bclose the loop\b|\bcontinuity\b|\bsession close\b)/iu;
const FINANCE =
  /(?:\bbalance\b|\bbudget\b|\bdebt\b|\bforecast\b|\bsafe to spend\b|\bmilliunit\b|\bcard bill\b|\bnet worth\b|\bmal\b|\bpfos\b)/iu;
const HOST_WRITE = /(?:\bcommit\b|\bpush\b|\bdeploy\b|\brotate\b|\bmint\b|\bwebhook\b|\bdns\b)/iu;

function route(
  code: IngressRouteCode,
  module: IngressModule,
  profile: HermesProfileName | null,
  tool: HermesToolName | null,
  effect: IngressRoute['effect'],
  publicReason: string,
): IngressRoute {
  if (tool !== null) {
    const expected = profileForIngressTool(tool);
    if (profile !== expected) {
      return {
        code: 'REFUSED_UNAUTHORIZED',
        module: 'refuse',
        profile: null,
        tool: null,
        effect: 'none',
        publicReason: 'The requested tool is not reachable from this ingress route.',
      };
    }
  }
  return Object.freeze({ code, module, profile, tool, effect, publicReason });
}

export function routeIngressText(text: string): IngressRoute {
  const body = text.trim();
  if (body === '') {
    return route('CLARIFY', 'clarify', null, null, 'none', 'Say what you want captured, planned, or calculated.');
  }
  if (SECRET_SEEKING.test(body)) {
    return route(
      'REFUSED_SECRET',
      'refuse',
      null,
      null,
      'none',
      'Credential and secret requests are refused. No value is returned.',
    );
  }
  if (HOST_WRITE.test(body) && !FINANCE.test(body) && !JOURNAL.test(body) && !SHURA.test(body) && !NAQD.test(body)) {
    return route(
      'REFUSED_UNKNOWN_WRITE',
      'refuse',
      null,
      null,
      'none',
      'That change needs an explicit owner gate. Nothing was changed.',
    );
  }

  const finance = FINANCE.test(body);
  const journal = JOURNAL.test(body);
  if (finance && journal) {
    return route(
      'ROUTED',
      'mal',
      'pfos',
      'pfos.read_financial_snapshot',
      'pfos_read',
      'Mixed request: financial facts come from PFOS; narrative stays on the NIZAMCORE side.',
    );
  }
  if (finance) {
    const derived = deriveIntent(body);
    const tool: HermesToolName =
      derived.intent === 'evaluate_financial_decision'
        ? 'pfos.run_deterministic_analysis'
        : 'pfos.read_financial_snapshot';
    return route('ROUTED', 'mal', 'pfos', tool, 'pfos_read', 'Financial requests route to the deterministic PFOS engine.');
  }
  if (journal) {
    const tool: HermesToolName = /\b(read|show|what did i)\b/iu.test(body)
      ? 'nizamcore.read_journal_context'
      : 'nizamcore.append_journal_entry';
    return route(
      'ROUTED',
      'yawmiyat',
      'nizam',
      tool,
      tool === 'nizamcore.append_journal_entry' ? 'local_write' : 'read',
      'Journal capture stays on the NIZAMCORE journal tools.',
    );
  }
  if (SHURA.test(body)) {
    return route('ROUTED', 'shura', 'nizam', 'nizamcore.read_journal_context', 'read', 'Planning routes to SHURA context.');
  }
  if (NAQD.test(body)) {
    return route('ROUTED', 'naqd', 'nizam', 'nizamcore.read_journal_context', 'read', 'Critique routes to NAQD context.');
  }
  if (QARAR.test(body)) {
    return route('ROUTED', 'qarar', 'nizam', 'nizamcore.read_journal_context', 'read', 'Decisions route to QARAR context.');
  }
  if (THABAT.test(body)) {
    return route(
      'ROUTED',
      'thabat',
      'nizam',
      'signalbus.read_bounded_signals',
      'read',
      'Continuity routes to the bounded signal record.',
    );
  }

  return route('CLARIFY', 'clarify', null, null, 'none', 'I need one clearer ask: capture, plan, critique, or a money fact.');
}

export function assertRoutedFinancialResult(routeResult: IngressRoute, result: FinancialAnalysisResult): void {
  if (routeResult.module !== 'mal' || routeResult.effect !== 'pfos_read') {
    throw new Error('INGRESS_FINANCE_ROUTE_REQUIRED');
  }
  assertDeterministicFinancialResult(result);
}
