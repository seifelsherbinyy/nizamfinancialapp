/**
 * NIZAM · Profile memory loader — boots agent context from the knowledge index.
 * Owning contract: PFOS Contract 05 §7 (Profile memory loader).
 * Phase: Phase 2.5 extended knowledge integration.
 * Depends on: ./knowledgeIndex, ../hermes/knowledgeBoundary, ../hermes/profilePolicy,
 *             ../db/repositories/documentIndexRepository.
 *
 * The document index stores provenance pointers and hashes, not document bodies. A caller
 * therefore injects a content resolver backed by its local Drive/GitHub cache. Missing content
 * is omitted rather than replaced with a fabricated summary, so readiness and context remain
 * honest when ingestion has indexed metadata but has not retained readable bytes.
 */
import type { HermesProfileName } from '../hermes/profilePolicy.ts';
import {
  buildGroundedContext,
  type EvidenceItem,
  type GroundedContext,
  type KnowledgeDomain,
  type KnowledgePrivacyClass,
} from '../hermes/knowledgeBoundary.ts';
import { createDocumentIndexRepository, type DocumentIndexRow } from '../db/repositories/documentIndexRepository.ts';
import type { RepositoryContext } from '../db/repositories/support.ts';
import type { KnowledgeClass } from './knowledgeIndex.ts';
import { PROFILE_WEIGHTS } from './agentReadiness.ts';

export interface ProfileMemoryOptions {
  /** Maximum number of evidence items to include. Default: 50. */
  readonly limit?: number;
  /** Filter to specific knowledge classes. If absent, all profile-weighted classes are included. */
  readonly classes?: readonly KnowledgeClass[];
  /** Resolve actual cached bytes for an indexed pointer. Null means content is unavailable. */
  readonly contentResolver?: (row: DocumentIndexRow) => string | null;
}

export interface ProfileMemorySummary {
  readonly profile: HermesProfileName;
  readonly context: GroundedContext;
  readonly totalIndexed: number;
  readonly limitApplied: number;
  readonly classesSampled: readonly KnowledgeClass[];
}

const DOMAIN_BY_CLASS: Readonly<Record<KnowledgeClass, KnowledgeDomain>> = {
  recovery_plan: 'financial',
  financial_research: 'financial',
  agent_contract: 'contract',
  architecture: 'operational',
  transaction_history: 'transaction',
  bank_statement: 'statement',
  persona: 'persona',
  journal_entry: 'journal',
  health_record: 'health',
  goal: 'goal',
  life_context: 'life_context',
  github_content: 'operational',
};

const PRIVACY_BY_CLASS: Readonly<Record<KnowledgeClass, KnowledgePrivacyClass>> = {
  recovery_plan: 'cloud_allowed',
  financial_research: 'cloud_allowed',
  agent_contract: 'cloud_allowed',
  architecture: 'cloud_allowed',
  transaction_history: 'cloud_allowed',
  bank_statement: 'cloud_allowed',
  persona: 'cloud_allowed',
  journal_entry: 'local_only',
  health_record: 'local_only',
  goal: 'cloud_allowed',
  life_context: 'cloud_allowed',
  github_content: 'cloud_allowed',
};

function sourceLabel(documentRef: string): string {
  const segments = documentRef.split(/[\\/]/u);
  return segments.at(-1) ?? documentRef;
}

function rowToEvidenceItem(
  row: DocumentIndexRow,
  contentResolver: ((row: DocumentIndexRow) => string | null) | undefined,
): EvidenceItem | null {
  if (row.processingState === 'tombstoned' || contentResolver === undefined) return null;
  const knowledgeClass = row.documentClass as KnowledgeClass;
  const content = contentResolver(row);
  if (content === null || content.trim().length === 0) return null;

  return {
    sourceRef: row.documentRef,
    sourceLabel: sourceLabel(row.documentRef),
    contentHash: row.contentHash,
    versionRef: row.id,
    observedAt: row.indexedAt,
    domain: DOMAIN_BY_CLASS[knowledgeClass],
    privacyClass: PRIVACY_BY_CLASS[knowledgeClass],
    confidence: 'medium',
    content,
  };
}

/**
 * Load profile memory from indexed metadata and caller-supplied cached content.
 *
 * This function never fetches remotely and never invents content. An empty index, absent
 * resolver, or cache miss returns an empty grounded context with modelEligible false.
 */
export function loadProfileMemory(
  ctx: RepositoryContext,
  profile: HermesProfileName,
  options: ProfileMemoryOptions = {},
): ProfileMemorySummary {
  const limit = options.limit ?? 50;
  const allowedClasses = options.classes ?? PROFILE_WEIGHTS[profile].map((entry) => entry.knowledgeClass);
  const repo = createDocumentIndexRepository(ctx);
  const rows = allowedClasses.flatMap((knowledgeClass) => repo.listClass(knowledgeClass));
  rows.sort((left, right) => right.indexedAt.localeCompare(left.indexedAt));

  const limited = rows.slice(0, limit);
  const items = limited
    .map((row) => rowToEvidenceItem(row, options.contentResolver))
    .filter((item): item is EvidenceItem => item !== null);
  const context = buildGroundedContext(profile, items);

  return {
    profile,
    context,
    totalIndexed: rows.length,
    limitApplied: limit,
    classesSampled: [...new Set(limited.map((row) => row.documentClass as KnowledgeClass))],
  };
}
