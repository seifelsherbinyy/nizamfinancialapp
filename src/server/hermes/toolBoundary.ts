/**
 * Governed Hermes tool boundary for NIZAMCORE and PFOS.
 * Owning authority: PFOS Contract 06, Contract 12, and Contract 13, money rules, and the capability split.
 * Phase: Phase 2.5 refined Hermes integration.
 * Depends on: money core, Whoop boundary, signal bus types, and profilePolicy.
 * This file defines ports and allowlists. It does not open a database, socket, or provider call.
 */
import type { Money } from '../../lib/money/money.ts';
import type { WhoopRecoveryOutcome } from '../ports/whoop.ts';
import type { HermesProfileName } from './profilePolicy.ts';

export const HERMES_TOOL_NAMES = [
  'nizamcore.read_journal_context',
  'nizamcore.append_journal_entry',
  'nizamcore.read_recovery_state',
  'nizamcore.request_pfos_analysis',
  'pfos.read_financial_snapshot',
  'pfos.run_deterministic_analysis',
  'signalbus.publish_bounded_signal',
  'signalbus.read_bounded_signals',
  // Contract 05 §8.1 — knowledge tools
  'knowledge.read_github_content',
  'knowledge.load_profile_memory',
] as const;
export type HermesToolName = (typeof HERMES_TOOL_NAMES)[number];

export const HERMES_TOOLS_BY_PROFILE: Readonly<Record<HermesProfileName, readonly HermesToolName[]>> = {
  nizam: [
    'nizamcore.read_journal_context',
    'nizamcore.append_journal_entry',
    'nizamcore.read_recovery_state',
    'nizamcore.request_pfos_analysis',
    'signalbus.publish_bounded_signal',
    'signalbus.read_bounded_signals',
    'knowledge.read_github_content',
    'knowledge.load_profile_memory',
  ],
  pfos: [
    'pfos.read_financial_snapshot',
    'pfos.run_deterministic_analysis',
    'signalbus.publish_bounded_signal',
    'signalbus.read_bounded_signals',
    'knowledge.read_github_content',
    'knowledge.load_profile_memory',
  ],
};

export interface JournalContextRequest {
  readonly queryRef: string;
  readonly limit: number;
}

export interface JournalContextResult {
  readonly sourceRefs: readonly string[];
  readonly context: string;
  readonly confidence: 'high' | 'medium' | 'low' | 'unknown';
}

export interface JournalEntryDraft {
  readonly text: string;
  readonly sourceRef: string;
  readonly observedAt: string;
}

export interface DeterministicFinancialFact {
  readonly factRef: string;
  readonly label: string;
  readonly amountMilliunits: Money;
  readonly currency: string;
  readonly computedAt: string;
  readonly deterministicEngine: true;
}

export interface FinancialAnalysisRequest {
  readonly taskRef: string;
  readonly question: string;
  readonly requiresOwnerConfirmation: boolean;
}

export interface FinancialAnalysisResult {
  readonly resultRef: string;
  readonly facts: readonly DeterministicFinancialFact[];
  readonly explanation: string;
  readonly deterministicEngine: true;
}

export interface NizamcoreToolPort {
  readJournalContext(request: JournalContextRequest): Promise<JournalContextResult>;
  appendJournalEntry(entry: JournalEntryDraft): Promise<{ readonly entryRef: string }>;
  readRecoveryState(notOlderThan: string): Promise<WhoopRecoveryOutcome>;
  requestPfosAnalysis(request: FinancialAnalysisRequest): Promise<FinancialAnalysisResult>;
}

export interface PfosToolPort {
  readFinancialSnapshot(taskRef: string): Promise<FinancialAnalysisResult>;
  runDeterministicAnalysis(request: FinancialAnalysisRequest): Promise<FinancialAnalysisResult>;
}

export function isHermesToolAllowed(profile: HermesProfileName, tool: HermesToolName): boolean {
  return HERMES_TOOLS_BY_PROFILE[profile].includes(tool);
}

export function assertHermesToolAllowed(profile: HermesProfileName, tool: HermesToolName): void {
  if (!isHermesToolAllowed(profile, tool)) throw new Error('HERMES_TOOL_NOT_ALLOWED');
}

export function assertDeterministicFinancialResult(result: FinancialAnalysisResult): void {
  if (result.deterministicEngine !== true) throw new Error('PFOS_RESULT_NOT_DETERMINISTIC');
  for (const fact of result.facts) {
    if (fact.deterministicEngine !== true) throw new Error('PFOS_FACT_NOT_DETERMINISTIC');
    if (!Number.isSafeInteger(fact.amountMilliunits)) throw new Error('PFOS_FACT_MILLIUNITS_INVALID');
  }
}
