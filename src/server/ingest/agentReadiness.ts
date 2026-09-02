/**
 * NIZAM · Agent readiness scorer — measures how loaded each profile's knowledge index is.
 * Owning contract: PFOS Contract 05 §6 (Readiness metric).
 * Phase: Phase 2.5 extended knowledge integration.
 * Depends on: ./knowledgeIndex, ../db/repositories/documentIndexRepository, ../hermes/profilePolicy.
 *
 * ## What readiness means
 *
 * Contract 05 §6.1: readiness is a score from 0 to 100 computed per profile from the
 * document index. It answers: "what fraction of the data types this agent is responsible
 * for are currently indexed?"
 *
 * ## What readiness does not do
 *
 * Readiness does not fabricate data. A score of 0 when no data is indexed is correct and
 * expected (§6.6). The scorer never generates synthetic indexed documents to inflate the
 * number. It never triggers Drive or GitHub ingestion — that is the caller's responsibility.
 *
 * ## Weights
 *
 * Weights are declared as compile-time constants per §6.3 (nizam) and §6.4 (pfos).
 * They must sum to 1.0 for each profile. Tests assert this invariant.
 */
import type { HermesProfileName } from '../hermes/profilePolicy.ts';
import type { KnowledgeClass } from './knowledgeIndex.ts';
import { createDocumentIndexRepository } from '../db/repositories/documentIndexRepository.ts';
import type { RepositoryContext } from '../db/repositories/support.ts';

export type ReadinessLevel = 'not_ready' | 'partial' | 'operational' | 'full';

export interface ReadinessBreakdownEntry {
  readonly knowledgeClass: KnowledgeClass;
  readonly weight: number;
  readonly threshold: number;
  readonly count: number;
  /** Fractional contribution to the total score: weight * min(count/threshold, 1.0) */
  readonly contribution: number;
}

export interface AgentReadinessReport {
  readonly profile: HermesProfileName;
  /** 0–100 integer. */
  readonly score: number;
  readonly readinessLevel: ReadinessLevel;
  readonly breakdown: readonly ReadinessBreakdownEntry[];
  /** Classes with weight > 0 and count === 0. What the owner needs to provide. */
  readonly blockers: readonly KnowledgeClass[];
  /** Whether Drive config was present when this report was computed. */
  readonly drivenByDrive: boolean;
  /** Whether GitHub config was present when this report was computed. */
  readonly drivenByGitHub: boolean;
}

interface WeightEntry {
  readonly knowledgeClass: KnowledgeClass;
  readonly weight: number;
  /** Minimum doc count for full weight (always 1 per Contract 05 §6.2). */
  readonly threshold: number;
}

// Contract 05 §6.3 — myNIZAM weights (must sum to 1.0)
const NIZAM_WEIGHTS: readonly WeightEntry[] = [
  { knowledgeClass: 'transaction_history', weight: 0.20, threshold: 1 },
  { knowledgeClass: 'bank_statement', weight: 0.15, threshold: 1 },
  { knowledgeClass: 'persona', weight: 0.20, threshold: 1 },
  { knowledgeClass: 'goal', weight: 0.15, threshold: 1 },
  { knowledgeClass: 'journal_entry', weight: 0.10, threshold: 1 },
  { knowledgeClass: 'health_record', weight: 0.10, threshold: 1 },
  { knowledgeClass: 'life_context', weight: 0.05, threshold: 1 },
  { knowledgeClass: 'agent_contract', weight: 0.05, threshold: 1 },
] as const;

// Contract 05 §6.4 — financeNIZAM weights (must sum to 1.0)
const PFOS_WEIGHTS: readonly WeightEntry[] = [
  { knowledgeClass: 'transaction_history', weight: 0.30, threshold: 1 },
  { knowledgeClass: 'bank_statement', weight: 0.20, threshold: 1 },
  { knowledgeClass: 'financial_research', weight: 0.15, threshold: 1 },
  { knowledgeClass: 'agent_contract', weight: 0.15, threshold: 1 },
  { knowledgeClass: 'github_content', weight: 0.10, threshold: 1 },
  { knowledgeClass: 'architecture', weight: 0.10, threshold: 1 },
] as const;

export const PROFILE_WEIGHTS: Readonly<Record<HermesProfileName, readonly WeightEntry[]>> = {
  nizam: NIZAM_WEIGHTS,
  pfos: PFOS_WEIGHTS,
};

/**
 * Assert that a weight set sums to 1.0 (within floating-point tolerance).
 * This is exported so tests can call it directly.
 */
export function assertWeightsSumToOne(weights: readonly WeightEntry[], profile: string): void {
  const weightTotal = weights.reduce((acc, w) => acc + w.weight, 0);
  if (Math.abs(weightTotal - 1.0) > 1e-9) {
    throw new Error(`READINESS_WEIGHTS_DO_NOT_SUM_TO_ONE: profile=${profile} sum=${weightTotal}`);
  }
}

/**
 * Map score to readiness level per Contract 05 §6.5.
 *
 *   not_ready  < 30
 *   partial    30 ≤ score < 60
 *   operational 60 ≤ score < 90
 *   full       ≥ 90
 */
export function scoreToReadinessLevel(score: number): ReadinessLevel {
  if (score >= 90) return 'full';
  if (score >= 60) return 'operational';
  if (score >= 30) return 'partial';
  return 'not_ready';
}

/**
 * Compute the readiness report for a profile from the current document index.
 *
 * @param ctx             Repository context.
 * @param profile         The agent profile to score.
 * @param drivenByDrive   Whether Drive config was present at call time (informational).
 * @param drivenByGitHub  Whether GitHub config was present at call time (informational).
 */
export function computeAgentReadiness(
  ctx: RepositoryContext,
  profile: HermesProfileName,
  drivenByDrive = false,
  drivenByGitHub = false,
): AgentReadinessReport {
  const weights = PROFILE_WEIGHTS[profile];
  const repo = createDocumentIndexRepository(ctx);

  const breakdown: ReadinessBreakdownEntry[] = [];
  const blockers: KnowledgeClass[] = [];
  let rawScore = 0;

  for (const entry of weights) {
    const count = repo.listClass(entry.knowledgeClass).length;
    const contribution = entry.weight * Math.min(count / entry.threshold, 1.0);
    rawScore += contribution;
    breakdown.push({ knowledgeClass: entry.knowledgeClass, weight: entry.weight, threshold: entry.threshold, count, contribution });
    if (count === 0) blockers.push(entry.knowledgeClass);
  }

  // Clamp to [0, 100] and round to integer
  const score = Math.min(100, Math.max(0, Math.round(rawScore * 100)));

  return {
    profile,
    score,
    readinessLevel: scoreToReadinessLevel(score),
    breakdown,
    blockers,
    drivenByDrive,
    drivenByGitHub,
  };
}
