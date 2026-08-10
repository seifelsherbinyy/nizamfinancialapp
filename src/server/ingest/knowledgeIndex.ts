/**
 * NIZAM · The knowledge tier — spec 08 wave A4 (tasks A4.1, A4.2, A4.3)
 * Implemented by: PFOS Contract 06 / Phase 2.4 (spec 08-knowledge-ingestion, wave A4)
 * Depends on: ../db/repositories/documentIndexRepository.ts, ../db/errors.ts
 *
 * ## What the knowledge tier is for
 *
 * Spec 08 §1: this is what turns a calculator into an adviser that knows the owner's own situation and
 * stated intentions. Without it the agent invents advice; with it the agent applies advice the owner has
 * already agreed to. So these documents belong in an INDEX the agent can consult, not in a prompt string
 * where nobody can see what was consulted or when it changed.
 *
 * ## Three properties, and the failure each one prevents
 *
 *  1. A DOCUMENT NO RULE CLAIMS IS REFUSED (A4.1). Classification is a declared set of rules over the
 *     document's reference, and a document that matches none of them is REPORTED rather than filed under
 *     a default class. A default class is how an unrelated file becomes "financial knowledge" the agent
 *     later quotes.
 *  2. THE SAME BYTES INDEX ONCE (A4.1, K5). The key is the content hash, so a document that moved
 *     reference but kept its bytes is recognised as the same document, and a re-index is a no-op rather
 *     than a second row. That property lives in the repository, on a unique index, not here.
 *  3. THE RECOVERY PLAN IS ONE ORDERED SET (A4.2). Its horizons run from immediate triage to a year of
 *     monitoring, and the ORDER IS THE MEANING: an agent that applied the year-long horizon as though it
 *     were the immediate one would be giving advice the owner never agreed to. So a member carries an
 *     explicit position, and — the part that actually protects the owner — an INCOMPLETE set is refused
 *     for use rather than served in whatever order it happens to hold. A partial ordered set is more
 *     dangerous than an absent one, because it looks usable.
 *
 * ## No reference is a literal here
 *
 * Every document reference arrives from the caller, resolved from the operator environment or from the
 * local cache. This module holds classification RULES — patterns over a reference — and no reference.
 */
import { IngestionRefusalError } from '../db/errors.ts';
import {
  createDocumentIndexRepository,
  type DocumentIndexRow,
  type DocumentProcessingState,
} from '../db/repositories/documentIndexRepository.ts';
import type { RepositoryContext } from '../db/repositories/support.ts';

/** The classes this spec's tier-2 sources fall into. A document outside them is refused, not filed. */
export const KNOWLEDGE_CLASSES = ['recovery_plan', 'financial_research', 'agent_contract', 'architecture'] as const;
export type KnowledgeClass = (typeof KNOWLEDGE_CLASSES)[number];

/** The owner's staged recovery plan, as one ordered set. */
export const RECOVERY_PLAN_SET = 'owner_recovery_plan';

/**
 * The five horizons, in order, named by DURATION rather than by file. A duration is a property of the
 * plan; a file name is a particular of where the plan happens to be stored, and this repository is public.
 */
export const RECOVERY_HORIZONS = ['72h', '30d', '90d', '180d', '365d'] as const;
export type RecoveryHorizon = (typeof RECOVERY_HORIZONS)[number];

export interface KnowledgeSourceRule {
  readonly knowledgeClass: KnowledgeClass;
  /** Matched against the document's reference. Patterns, never references. */
  readonly referencePattern: RegExp;
  /** Set membership, when this class is an ordered set. */
  readonly setName?: string;
}

/**
 * The declared classification rules, most specific first. Order matters: the recovery plan's own subtree
 * is checked before the generic research rule, so a horizon document cannot be filed as research and lose
 * its position in the set.
 */
export const KNOWLEDGE_SOURCE_RULES: readonly KnowledgeSourceRule[] = [
  { knowledgeClass: 'recovery_plan', referencePattern: /(?:^|\/)recovery\/[^/]+\.md$/i, setName: RECOVERY_PLAN_SET },
  { knowledgeClass: 'agent_contract', referencePattern: /(?:^|\/)contracts\/pfos\/[^/]+\.md$/i },
  { knowledgeClass: 'architecture', referencePattern: /(?:^|\/)docs\/(?:architecture|adr)\/[^/]+\.md$/i },
  { knowledgeClass: 'architecture', referencePattern: /(?:^|\/)docs\/[A-Z0-9_]+\.md$/ },
  { knowledgeClass: 'financial_research', referencePattern: /(?:^|\/)(?:docs\/)?research(?:es)?\/[^/]+\.md$/i },
];

export interface Classification {
  readonly knowledgeClass: KnowledgeClass;
  readonly setName: string | null;
  readonly setOrdinal: number | null;
}

/**
 * Resolve a recovery-plan horizon's POSITION from its reference, or null when the reference names none.
 *
 * Longest token first, so a shorter duration cannot match inside a longer one and file a horizon at the
 * wrong position — which would be worse than not filing it at all.
 */
export function resolveRecoveryHorizonOrdinal(reference: string): number | null {
  const ordered = [...RECOVERY_HORIZONS].sort((a, b) => b.length - a.length);
  for (const horizon of ordered) {
    const pattern = new RegExp(`(?:^|[^0-9a-z])${horizon}(?:[^0-9a-z]|$)`, 'i');
    if (pattern.test(reference)) return RECOVERY_HORIZONS.indexOf(horizon) + 1;
  }
  return null;
}

/** Classify a document by its reference, or return null so the caller reports it rather than files it. */
export function classifyKnowledgeDocument(reference: string): Classification | null {
  for (const rule of KNOWLEDGE_SOURCE_RULES) {
    if (!rule.referencePattern.test(reference)) continue;
    if (rule.setName === undefined) {
      return { knowledgeClass: rule.knowledgeClass, setName: null, setOrdinal: null };
    }
    const ordinal = resolveRecoveryHorizonOrdinal(reference);
    if (ordinal === null) {
      // A set member whose position cannot be resolved is not filed at an arbitrary one. The repository
      // would refuse a membership with no position anyway; this refuses earlier, with a better reason.
      throw new IngestionRefusalError(
        'INGEST_DOCUMENT_SET_POSITION_INCOMPLETE',
        `NIZAM ingest: a document belongs to the ordered set "${rule.setName}" and its reference names none of the declared horizons, so its position is unknown. It is refused rather than filed at a guessed position, because a horizon at the wrong position is advice given for the wrong moment.`,
        { subject: rule.knowledgeClass },
      );
    }
    return { knowledgeClass: rule.knowledgeClass, setName: rule.setName, setOrdinal: ordinal };
  }
  return null;
}

/** One document offered for indexing. The caller reads the bytes and hashes them; this module does not. */
export interface KnowledgeDocument {
  /** Resolved by the caller. Never a literal in this module. */
  readonly reference: string;
  readonly contentHash: string;
  readonly byteCount: number;
  readonly processingState?: DocumentProcessingState;
}

export interface OrderedSetStatus {
  readonly setName: string;
  readonly expectedSize: number;
  readonly presentSize: number;
  readonly ordinalsPresent: readonly number[];
  readonly ordinalsMissing: readonly number[];
  readonly complete: boolean;
}

export interface KnowledgeIndexReport {
  readonly offered: number;
  readonly indexed: number;
  readonly alreadyIndexed: number;
  /** Offered but claimed by no rule. Reported, never filed under a default class. */
  readonly unclassified: readonly string[];
  readonly refused: readonly { readonly reference: string; readonly reason: string }[];
  readonly byClass: Readonly<Record<string, number>>;
  readonly sets: readonly OrderedSetStatus[];
  readonly distinctContentHashes: number;
}

/**
 * Index a set of documents. Classification is per-document and a refusal does not abandon the run: an
 * unclassifiable document is reported and the rest are indexed, because a knowledge index that refuses
 * everything because of one stray file is a knowledge index nobody can use.
 */
export function indexKnowledgeDocuments(
  ctx: RepositoryContext,
  documents: readonly KnowledgeDocument[],
): KnowledgeIndexReport {
  const repo = createDocumentIndexRepository(ctx);
  const unclassified: string[] = [];
  const refused: { reference: string; reason: string }[] = [];
  const byClass = new Map<string, number>();
  const hashes = new Set<string>();
  let indexed = 0;
  let alreadyIndexed = 0;

  for (const document of documents) {
    let classification: Classification | null;
    try {
      classification = classifyKnowledgeDocument(document.reference);
    } catch (e) {
      refused.push({ reference: document.reference, reason: e instanceof Error ? e.message : String(e) });
      continue;
    }
    if (classification === null) {
      unclassified.push(document.reference);
      continue;
    }
    hashes.add(document.contentHash);
    try {
      const outcome = repo.indexDocument({
        id: `doc_${document.contentHash.slice(0, 24)}`,
        documentRef: document.reference,
        contentHash: document.contentHash,
        byteCount: document.byteCount,
        documentClass: classification.knowledgeClass,
        processingState: document.processingState ?? 'indexed',
        setName: classification.setName,
        setOrdinal: classification.setOrdinal,
      });
      if (outcome.indexed) indexed += 1;
      else alreadyIndexed += 1;
      byClass.set(classification.knowledgeClass, (byClass.get(classification.knowledgeClass) ?? 0) + 1);
    } catch (e) {
      refused.push({ reference: document.reference, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    offered: documents.length,
    indexed,
    alreadyIndexed,
    unclassified,
    refused,
    byClass: Object.fromEntries(byClass),
    sets: [orderedSetStatus(ctx, RECOVERY_PLAN_SET, RECOVERY_HORIZONS.length)],
    distinctContentHashes: hashes.size,
  };
}

/** What an ordered set holds, and what it is missing. A status, not a judgement. */
export function orderedSetStatus(ctx: RepositoryContext, setName: string, expectedSize: number): OrderedSetStatus {
  const members = createDocumentIndexRepository(ctx).listSet(setName);
  const ordinalsPresent = members.map((m) => m.setOrdinal ?? 0).sort((a, b) => a - b);
  const ordinalsMissing: number[] = [];
  for (let i = 1; i <= expectedSize; i += 1) if (!ordinalsPresent.includes(i)) ordinalsMissing.push(i);
  return {
    setName,
    expectedSize,
    presentSize: members.length,
    ordinalsPresent,
    ordinalsMissing,
    complete: members.length === expectedSize && ordinalsMissing.length === 0,
  };
}

/**
 * Read an ordered set FOR USE, in position order — and refuse when it is incomplete.
 *
 * This is the property A4.2 is really about. An incomplete plan set is more dangerous than an absent one:
 * serving three of five horizons in ordinal order looks exactly like serving a complete plan, and the
 * consumer has no way to tell that the horizon it is applying is not the one the owner meant for now. So
 * an incomplete set refuses to be read, rather than being read partially.
 */
export function readOrderedSetForUse(
  ctx: RepositoryContext,
  setName: string,
  expectedSize: number,
): readonly DocumentIndexRow[] {
  const status = orderedSetStatus(ctx, setName, expectedSize);
  if (!status.complete) {
    throw new IngestionRefusalError(
      'INGEST_DOCUMENT_SET_POSITION_INCOMPLETE',
      `NIZAM ingest: the ordered set "${setName}" holds ${status.presentSize} of ${expectedSize} member(s), missing position(s) ${status.ordinalsMissing.join(', ')}. It refuses to be read for use: serving part of an ordered plan looks identical to serving all of it, and the consumer cannot tell that the horizon it is applying is not the one intended for now.`,
      { subject: setName },
    );
  }
  return createDocumentIndexRepository(ctx).listSet(setName);
}
