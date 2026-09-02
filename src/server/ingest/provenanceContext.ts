/**
 * NIZAM · Provenance context port over approved local/indexed content.
 * Owning contract: PFOS Contract 05; UPOI task 4.1 §§2, 6, 7, and PFOS Contract 06.
 * Phase: Phase 4.1 — UPOI offline provenance context.
 * Depends on: documentIndexRepository, knowledgeIndex, profilePolicy, knowledgeBoundary, agentReadiness.
 *
 * This port is deliberately local and read-only. It never fetches content, widens a profile's
 * domain, treats retrieved text as instructions, or substitutes for deterministic finance.
 */
import { createHash } from 'node:crypto';

import type { RepositoryContext } from '../db/repositories/support.ts';
import { createDocumentIndexRepository, type DocumentIndexRow } from '../db/repositories/documentIndexRepository.ts';
import {
  buildGroundedContext,
  type EvidenceConfidence,
  type EvidenceItem,
  type GroundedContext,
  type KnowledgeDomain,
  type KnowledgePrivacyClass,
} from '../hermes/knowledgeBoundary.ts';
import {
  getHermesProfilePolicy,
  type HermesProfileName,
} from '../hermes/profilePolicy.ts';
import { KNOWLEDGE_CLASSES, type KnowledgeClass } from './knowledgeIndex.ts';
import { computeAgentReadiness, type AgentReadinessReport } from './agentReadiness.ts';

export const PROVENANCE_AUTHORITY_CLASSES = [
  'owner',
  'governance',
  'deterministic_domain',
  'execution_runtime',
  'operator_interface',
  'context',
  'archive',
  'evidence_only',
] as const;
export type ProvenanceAuthorityClass = (typeof PROVENANCE_AUTHORITY_CLASSES)[number];

export const PROVENANCE_EVIDENCE_LABELS = [
  'FACT',
  'VERIFIED_IMPLEMENTATION',
  'INFERENCE',
  'ASSUMPTION',
  'RECOMMENDATION',
] as const;
export type ProvenanceEvidenceLabel = (typeof PROVENANCE_EVIDENCE_LABELS)[number];

export const DEFAULT_CONTEXT_MAX_ITEMS = 50;
export const DEFAULT_CONTEXT_MAX_BYTES = 64 * 1024;
export const DEFAULT_CONTEXT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1_000;

export type ProvenanceContextErrorCode =
  | 'CONTEXT_QUERY_EMPTY'
  | 'CONTEXT_LIMIT_INVALID'
  | 'CONTEXT_BYTES_INVALID'
  | 'CONTEXT_AGE_INVALID'
  | 'CONTEXT_CONTENT_UNAVAILABLE'
  | 'CONTEXT_CONTENT_NOT_APPROVED'
  | 'CONTEXT_PROVENANCE_INCOMPLETE'
  | 'CONTEXT_CONTENT_HASH_INVALID'
  | 'CONTEXT_CONTENT_CORRUPT'
  | 'CONTEXT_CONTENT_STALE'
  | 'CONTEXT_CONTENT_FUTURE'
  | 'CONTEXT_PROFILE_MISMATCH'
  | 'CONTEXT_PRIVACY_MISMATCH'
  | 'CONTEXT_AUTHORITY_TRANSFER'
  | 'CONTEXT_ITEM_TOO_LARGE'
  | 'CONTEXT_REFERENCE_NOT_FOUND';

export class ProvenanceContextError extends Error {
  readonly code: ProvenanceContextErrorCode;
  readonly subject: string;

  constructor(code: ProvenanceContextErrorCode, subject: string, message: string) {
    super(message);
    this.name = 'ProvenanceContextError';
    this.code = code;
    this.subject = subject;
  }
}

/** The only content input accepted by this port: bytes already approved and retained locally. */
export interface ApprovedLocalContent {
  readonly content: string;
  readonly approved: boolean;
  /** Optional source hash is checked against the immutable index hash when supplied. */
  readonly sourceHash?: string;
  readonly sourceVersion?: string;
  readonly observedAt?: string;
  readonly privacyClass?: KnowledgePrivacyClass;
  readonly confidence?: EvidenceConfidence;
  /** Context cannot promote a source into another authority class. */
  readonly authorityClass?: ProvenanceAuthorityClass;
  readonly evidenceLabel?: ProvenanceEvidenceLabel;
}

export type ApprovedLocalContentResolver = (row: DocumentIndexRow) => ApprovedLocalContent | null;

export interface ProvenanceRecord {
  readonly sourceRef: string;
  readonly sourceVersion: string;
  readonly contentHash: string;
  readonly observedAt: string;
  readonly evidenceLabel: ProvenanceEvidenceLabel;
  readonly authorityClass: ProvenanceAuthorityClass;
  readonly privacyClass: KnowledgePrivacyClass;
  readonly confidence: EvidenceConfidence;
}

export interface ProvenanceContextItem {
  readonly content: string;
  readonly provenance: ProvenanceRecord;
  readonly domain: KnowledgeDomain;
  readonly sourceLabel: string;
}

export interface ContextBundle {
  readonly profile: HermesProfileName;
  readonly items: readonly ProvenanceContextItem[];
  readonly grounded: GroundedContext;
  readonly citations: GroundedContext['citations'];
  readonly totalMatched: number;
  readonly excludedCount: number;
}

export interface ContextQuery {
  readonly profile: HermesProfileName;
  readonly text: string;
  readonly limit?: number;
  readonly maxBytes?: number;
  readonly maxAgeMs?: number;
}

export interface ProfileContextOptions {
  readonly limit?: number;
  readonly maxBytes?: number;
  readonly maxAgeMs?: number;
}

export interface ProvenanceContextPort {
  search(query: ContextQuery): ContextBundle;
  loadProfile(profile: HermesProfileName, options?: ProfileContextOptions): ContextBundle;
  explain(reference: string, options?: { readonly maxAgeMs?: number }): ProvenanceRecord;
  readiness(profile: HermesProfileName): AgentReadinessReport;
}

interface PortOptions {
  readonly contentResolver: ApprovedLocalContentResolver;
  readonly now: () => string;
  readonly defaultMaxAgeMs?: number;
  readonly maxItems?: number;
  readonly maxBytes?: number;
}

interface ValidatedItem {
  readonly row: DocumentIndexRow;
  readonly content: string;
  readonly provenance: ProvenanceRecord;
  readonly domain: KnowledgeDomain;
  readonly sourceLabel: string;
  readonly score?: number;
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

const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/u;
const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'for', 'from', 'how', 'i', 'in', 'is', 'my', 'of', 'the', 'to', 'what', 'with']);

function sourceLabel(sourceRef: string): string {
  const segments = sourceRef.split(/[\\/]/u);
  return segments.at(-1) ?? sourceRef;
}

function queryTerms(text: string): readonly string[] {
  return [...new Set(text.toLocaleLowerCase().match(/[a-z0-9]{2,}/gu) ?? [])].filter((term) => !STOP_WORDS.has(term));
}

function assertUtcInstant(value: string, code: ProvenanceContextErrorCode, subject: string): void {
  if (!ISO_INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ProvenanceContextError(code, subject, `NIZAM context: ${subject} has an invalid UTC timestamp`);
  }
}

function assertBoundedInteger(value: number | undefined, fallback: number, maximum: number, code: ProvenanceContextErrorCode, subject: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new ProvenanceContextError(code, subject, `NIZAM context: ${subject} must be a positive bounded integer`);
  }
  return resolved;
}

function assertAge(value: number | undefined, fallback: number, subject: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new ProvenanceContextError('CONTEXT_AGE_INVALID', subject, `NIZAM context: ${subject} must be a non-negative safe integer`);
  }
  return resolved;
}

function isKnowledgeClass(value: string): value is KnowledgeClass {
  return (KNOWLEDGE_CLASSES as readonly string[]).includes(value);
}

function profileAllows(profile: HermesProfileName, domain: KnowledgeDomain): boolean {
  return getHermesProfilePolicy(profile).allowedDomains.includes(domain);
}

function hashText(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function validateSourceMetadata(
  row: DocumentIndexRow,
  resolved: ApprovedLocalContent | null,
  now: string,
  maxAgeMs: number,
  profile: HermesProfileName | null,
): ValidatedItem {
  const subject = row.documentRef;
  if (resolved === null) {
    throw new ProvenanceContextError('CONTEXT_CONTENT_UNAVAILABLE', subject, 'NIZAM context: approved local content is unavailable');
  }
  if (!resolved.approved) {
    throw new ProvenanceContextError('CONTEXT_CONTENT_NOT_APPROVED', subject, 'NIZAM context: indexed content is not approved for local use');
  }
  if (row.processingState !== 'indexed' && row.processingState !== 'processed') {
    throw new ProvenanceContextError('CONTEXT_CONTENT_NOT_APPROVED', subject, 'NIZAM context: indexed content is not in an approved processing state');
  }
  if (!SHA256.test(row.contentHash)) {
    throw new ProvenanceContextError('CONTEXT_CONTENT_HASH_INVALID', subject, 'NIZAM context: indexed content hash is not a lowercase SHA-256 value');
  }
  if (resolved.sourceHash !== undefined && resolved.sourceHash !== row.contentHash) {
    throw new ProvenanceContextError('CONTEXT_CONTENT_CORRUPT', subject, 'NIZAM context: resolver source hash disagrees with the indexed source hash');
  }
  if (resolved.content.trim() === '') {
    throw new ProvenanceContextError('CONTEXT_PROVENANCE_INCOMPLETE', subject, 'NIZAM context: approved content is empty');
  }
  if (hashText(resolved.content) !== row.contentHash || Buffer.byteLength(resolved.content, 'utf8') !== row.byteCount) {
    throw new ProvenanceContextError('CONTEXT_CONTENT_CORRUPT', subject, 'NIZAM context: local content does not match the indexed bytes');
  }

  const knowledgeClass = row.documentClass;
  if (!isKnowledgeClass(knowledgeClass)) {
    throw new ProvenanceContextError('CONTEXT_PROVENANCE_INCOMPLETE', subject, 'NIZAM context: indexed content has no declared knowledge class');
  }
  const domain = DOMAIN_BY_CLASS[knowledgeClass];
  const expectedPrivacy = PRIVACY_BY_CLASS[knowledgeClass];
  if (resolved.privacyClass !== undefined && resolved.privacyClass !== expectedPrivacy) {
    throw new ProvenanceContextError('CONTEXT_PRIVACY_MISMATCH', subject, 'NIZAM context: source privacy cannot be widened by resolver metadata');
  }
  if (resolved.authorityClass !== undefined && resolved.authorityClass !== 'context') {
    throw new ProvenanceContextError('CONTEXT_AUTHORITY_TRANSFER', subject, 'NIZAM context: retrieved content cannot transfer authority to another class');
  }
  if (profile !== null && !profileAllows(profile, domain)) {
    throw new ProvenanceContextError('CONTEXT_PROFILE_MISMATCH', subject, 'NIZAM context: content is outside the requested profile domain');
  }

  const observedAt = resolved.observedAt ?? row.indexedAt;
  const sourceVersion = resolved.sourceVersion ?? row.id;
  if (sourceVersion.trim() === '') {
    throw new ProvenanceContextError('CONTEXT_PROVENANCE_INCOMPLETE', subject, 'NIZAM context: source version is missing');
  }
  assertUtcInstant(observedAt, 'CONTEXT_PROVENANCE_INCOMPLETE', subject);
  assertUtcInstant(now, 'CONTEXT_PROVENANCE_INCOMPLETE', 'context clock');
  const age = Date.parse(now) - Date.parse(observedAt);
  if (age < 0) {
    throw new ProvenanceContextError('CONTEXT_CONTENT_FUTURE', subject, 'NIZAM context: observed time is in the future of the context clock');
  }
  if (age > maxAgeMs) {
    throw new ProvenanceContextError('CONTEXT_CONTENT_STALE', subject, 'NIZAM context: approved content is older than the permitted freshness window');
  }

  const provenance: ProvenanceRecord = {
    sourceRef: subject,
    sourceVersion,
    contentHash: row.contentHash,
    observedAt,
    evidenceLabel: resolved.evidenceLabel ?? 'FACT',
    authorityClass: resolved.authorityClass ?? 'context',
    privacyClass: expectedPrivacy,
    confidence: resolved.confidence ?? 'medium',
  };
  const evidence: EvidenceItem = {
    sourceRef: subject,
    sourceLabel: sourceLabel(subject),
    contentHash: row.contentHash,
    versionRef: sourceVersion,
    observedAt,
    domain,
    privacyClass: expectedPrivacy,
    confidence: provenance.confidence,
    content: resolved.content,
  };
  // The existing boundary validates content, hash, timestamp, privacy, confidence, and secret refusal.
  buildGroundedContext(profile ?? 'nizam', [evidence]);
  return { row, content: resolved.content, provenance, domain, sourceLabel: sourceLabel(subject) };
}

function getCandidateRows(repo: ReturnType<typeof createDocumentIndexRepository>): DocumentIndexRow[] {
  return KNOWLEDGE_CLASSES.flatMap((knowledgeClass) => repo.listClass(knowledgeClass));
}

function buildBundle(profile: HermesProfileName, selected: readonly ValidatedItem[], totalMatched: number): ContextBundle {
  const evidence = selected.map((item): EvidenceItem => ({
    sourceRef: item.provenance.sourceRef,
    sourceLabel: item.sourceLabel,
    contentHash: item.provenance.contentHash,
    versionRef: item.provenance.sourceVersion,
    observedAt: item.provenance.observedAt,
    domain: item.domain,
    privacyClass: item.provenance.privacyClass,
    confidence: item.provenance.confidence,
    content: item.content,
  }));
  const grounded = buildGroundedContext(profile, evidence);
  const acceptedHashes = new Set(grounded.evidence.map((item) => item.contentHash));
  const items = selected.filter((item) => acceptedHashes.has(item.provenance.contentHash));
  return {
    profile,
    items,
    grounded,
    citations: grounded.citations,
    totalMatched,
    excludedCount: grounded.excludedCount,
  };
}

export function createProvenanceContextPort(ctx: RepositoryContext, options: PortOptions): ProvenanceContextPort {
  const repo = createDocumentIndexRepository(ctx);
  const defaultMaxAgeMs = options.defaultMaxAgeMs ?? DEFAULT_CONTEXT_MAX_AGE_MS;
  const maxItems = options.maxItems ?? DEFAULT_CONTEXT_MAX_ITEMS;
  const maxBytes = options.maxBytes ?? DEFAULT_CONTEXT_MAX_BYTES;
  if (!Number.isSafeInteger(defaultMaxAgeMs) || defaultMaxAgeMs < 0) {
    throw new ProvenanceContextError('CONTEXT_AGE_INVALID', 'defaultMaxAgeMs', 'NIZAM context: default age is invalid');
  }
  if (!Number.isSafeInteger(maxItems) || maxItems <= 0 || maxItems > DEFAULT_CONTEXT_MAX_ITEMS) {
    throw new ProvenanceContextError('CONTEXT_LIMIT_INVALID', 'maxItems', 'NIZAM context: max items exceed the fixed bound');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > DEFAULT_CONTEXT_MAX_BYTES) {
    throw new ProvenanceContextError('CONTEXT_BYTES_INVALID', 'maxBytes', 'NIZAM context: max bytes exceed the fixed bound');
  }

  const validateRows = (
    profile: HermesProfileName,
    rows: readonly DocumentIndexRow[],
    limit: number,
    byteLimit: number,
    ageLimit: number,
  ): readonly ValidatedItem[] => {
    const validated: ValidatedItem[] = [];
    let bytes = 0;
    const now = options.now();
    for (const row of rows.slice(0, limit)) {
      const item = validateSourceMetadata(row, options.contentResolver(row), now, ageLimit, profile);
      const itemBytes = Buffer.byteLength(item.content, 'utf8');
      if (itemBytes > byteLimit || bytes + itemBytes > byteLimit) {
        throw new ProvenanceContextError('CONTEXT_ITEM_TOO_LARGE', row.documentRef, 'NIZAM context: bounded context byte limit would be exceeded');
      }
      validated.push(item);
      bytes += itemBytes;
    }
    return validated;
  };

  return {
    search(query: ContextQuery): ContextBundle {
      if (query.text.trim() === '') throw new ProvenanceContextError('CONTEXT_QUERY_EMPTY', query.profile, 'NIZAM context: search query is empty');
      const terms = queryTerms(query.text);
      if (terms.length === 0) throw new ProvenanceContextError('CONTEXT_QUERY_EMPTY', query.profile, 'NIZAM context: search query has no searchable terms');
      const limit = assertBoundedInteger(query.limit, maxItems, maxItems, 'CONTEXT_LIMIT_INVALID', 'query limit');
      const byteLimit = assertBoundedInteger(query.maxBytes, maxBytes, maxBytes, 'CONTEXT_BYTES_INVALID', 'query byte limit');
      const ageLimit = assertAge(query.maxAgeMs, defaultMaxAgeMs, 'query age');
      const ranked = getCandidateRows(repo)
        .map((row) => {
          const haystack = `${row.documentRef}\n${row.documentClass}`.toLocaleLowerCase();
          const content = options.contentResolver(row)?.content ?? '';
          const contentHaystack = `${haystack}\n${content}`;
          const score = terms.reduce((total, term) => total + (contentHaystack.includes(term) ? 1 : 0), 0);
          return { row, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score || right.row.indexedAt.localeCompare(left.row.indexedAt) || left.row.documentRef.localeCompare(right.row.documentRef));
      const selected = validateRows(query.profile, ranked.map((entry) => entry.row), limit, byteLimit, ageLimit);
      return buildBundle(query.profile, selected, ranked.length);
    },

    loadProfile(profile: HermesProfileName, profileOptions: ProfileContextOptions = {}): ContextBundle {
      const limit = assertBoundedInteger(profileOptions.limit, maxItems, maxItems, 'CONTEXT_LIMIT_INVALID', 'profile limit');
      const byteLimit = assertBoundedInteger(profileOptions.maxBytes, maxBytes, maxBytes, 'CONTEXT_BYTES_INVALID', 'profile byte limit');
      const ageLimit = assertAge(profileOptions.maxAgeMs, defaultMaxAgeMs, 'profile age');
      const rows = getCandidateRows(repo)
        .filter((row) => {
          if (!isKnowledgeClass(row.documentClass)) return false;
          return profileAllows(profile, DOMAIN_BY_CLASS[row.documentClass]);
        })
        .sort((left, right) => right.indexedAt.localeCompare(left.indexedAt) || left.documentRef.localeCompare(right.documentRef));
      const selected = validateRows(profile, rows, limit, byteLimit, ageLimit);
      return buildBundle(profile, selected, rows.length);
    },

    explain(reference: string, explainOptions: { readonly maxAgeMs?: number } = {}): ProvenanceRecord {
      const subject = reference.trim();
      if (subject === '') throw new ProvenanceContextError('CONTEXT_REFERENCE_NOT_FOUND', reference, 'NIZAM context: provenance reference is empty');
      const row = getCandidateRows(repo).find((candidate) => candidate.id === subject || candidate.documentRef === subject);
      if (row === undefined) throw new ProvenanceContextError('CONTEXT_REFERENCE_NOT_FOUND', subject, 'NIZAM context: provenance reference is not indexed');
      const validated = validateSourceMetadata(row, options.contentResolver(row), options.now(), assertAge(explainOptions.maxAgeMs, defaultMaxAgeMs, 'explain age'), null);
      return validated.provenance;
    },

    readiness(profile: HermesProfileName): AgentReadinessReport {
      return computeAgentReadiness(ctx, profile);
    },
  };
}
