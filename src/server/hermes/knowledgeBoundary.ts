/**
 * NIZAM validated evidence boundary for Hermes.
 * Owning authority: PFOS Contract 06, Contract 12, and Contract 13, Drive scope rules, and money rules.
 * Phase: Phase 2.5 refined Hermes integration.
 * Depends on: ./profilePolicy only through the profile name type.
 * This module accepts evidence packets from a separately authorized Drive ingestion worker.
 */
import type { HermesProfileName } from './profilePolicy.ts';

export const KNOWLEDGE_DOMAINS = ['contract', 'financial', 'journal', 'health', 'operational', 'persona', 'goal', 'life_context', 'transaction', 'statement'] as const;
export type KnowledgeDomain = (typeof KNOWLEDGE_DOMAINS)[number];

export const KNOWLEDGE_PRIVACY_CLASSES = ['cloud_allowed', 'owner_only', 'local_only', 'bounded_signal'] as const;
export type KnowledgePrivacyClass = (typeof KNOWLEDGE_PRIVACY_CLASSES)[number];

export const EVIDENCE_CONFIDENCE = ['high', 'medium', 'low', 'unknown'] as const;
export type EvidenceConfidence = (typeof EVIDENCE_CONFIDENCE)[number];

export interface EvidenceItem {
  readonly sourceRef: string;
  readonly sourceLabel: string;
  readonly contentHash: string;
  readonly versionRef: string;
  readonly observedAt: string;
  readonly domain: KnowledgeDomain;
  readonly privacyClass: KnowledgePrivacyClass;
  readonly confidence: EvidenceConfidence;
  readonly content: string;
}

export interface EvidenceCitation {
  readonly sourceRef: string;
  readonly sourceLabel: string;
  readonly versionRef: string;
  readonly observedAt: string;
}

export interface GroundedContext {
  readonly profile: HermesProfileName;
  readonly evidence: readonly EvidenceItem[];
  readonly citations: readonly EvidenceCitation[];
  readonly modelEligible: boolean;
  readonly localOnlyCount: number;
  readonly excludedCount: number;
}

const SHA256 = /^[0-9a-f]{64}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const SECRET_PATTERNS = [
  /sk-or-[a-z0-9_-]+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /(?:openrouter|telegram|bot|client)[_-]?(?:api[_-]?key|token|secret)\s*=/i,
  /client_secret\s*=/i,
];

function isAllowed<T extends readonly string[]>(values: T, value: string): value is T[number] {
  return values.includes(value as T[number]);
}

function hasSecretPattern(content: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(content));
}

export function validateEvidenceItem(item: EvidenceItem): void {
  if (item.sourceRef.trim() === '' || item.sourceLabel.trim() === '' || item.versionRef.trim() === '') {
    throw new Error('EVIDENCE_PROVENANCE_INCOMPLETE');
  }
  if (!SHA256.test(item.contentHash)) throw new Error('EVIDENCE_CONTENT_HASH_INVALID');
  if (!ISO_INSTANT.test(item.observedAt)) throw new Error('EVIDENCE_TIMESTAMP_INVALID');
  if (!isAllowed(KNOWLEDGE_DOMAINS, item.domain)) throw new Error('EVIDENCE_DOMAIN_UNKNOWN');
  if (!isAllowed(KNOWLEDGE_PRIVACY_CLASSES, item.privacyClass)) throw new Error('EVIDENCE_PRIVACY_CLASS_UNKNOWN');
  if (!isAllowed(EVIDENCE_CONFIDENCE, item.confidence)) throw new Error('EVIDENCE_CONFIDENCE_UNKNOWN');
  if (item.content.trim() === '') throw new Error('EVIDENCE_CONTENT_EMPTY');
  if (hasSecretPattern(item.content)) throw new Error('EVIDENCE_SECRET_PATTERN_DETECTED');
}

function canProfileRead(profile: HermesProfileName, item: EvidenceItem): boolean {
  if (profile === 'nizam') return true;
  return item.domain === 'contract' || item.domain === 'financial' || item.domain === 'operational' || item.domain === 'transaction' || item.domain === 'statement';
}

function canSendToCloud(item: EvidenceItem): boolean {
  return item.privacyClass === 'cloud_allowed' && item.domain !== 'health' && item.domain !== 'journal';
}

export function buildGroundedContext(
  profile: HermesProfileName,
  items: readonly EvidenceItem[],
): GroundedContext {
  const accepted: EvidenceItem[] = [];
  const citations: EvidenceCitation[] = [];
  let localOnlyCount = 0;
  let excludedCount = 0;
  const seenHashes = new Set<string>();

  for (const item of items) {
    validateEvidenceItem(item);
    if (seenHashes.has(item.contentHash)) continue;
    seenHashes.add(item.contentHash);
    if (!canProfileRead(profile, item)) {
      excludedCount += 1;
      continue;
    }
    accepted.push(item);
    citations.push({
      sourceRef: item.sourceRef,
      sourceLabel: item.sourceLabel,
      versionRef: item.versionRef,
      observedAt: item.observedAt,
    });
    if (!canSendToCloud(item)) localOnlyCount += 1;
  }

  return {
    profile,
    evidence: accepted,
    citations,
    modelEligible: accepted.length > 0 && accepted.every(canSendToCloud),
    localOnlyCount,
    excludedCount,
  };
}
