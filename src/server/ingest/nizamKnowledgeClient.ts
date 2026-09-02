/**
 * NIZAM · myNIZAM profile Drive knowledge traversal.
 * Owning contract: PFOS Contract 05 §2.1 and §9, plus PFOS Contract 06 knowledge ingestion.
 * Phase: Phase 2.5 extended knowledge integration.
 * Depends on: ./driveKnowledge.
 *
 * This profile-specific reader preserves the same bounded, read-only Drive client and
 * classifier as financeNIZAM but does not apply financeNIZAM's journal/health exclusion.
 * Journal and health content remains local_only at the Hermes evidence boundary and is
 * never eligible for cloud model context.
 */
import {
  refreshDriveKnowledgeWithPolicy,
  type DriveKnowledgeClient,
  type DriveKnowledgeCorpus,
} from './driveKnowledge.ts';
import type { RepositoryContext } from '../db/repositories/support.ts';
import { classifyKnowledgeDocument } from './knowledgeIndex.ts';

export function isNizamKnowledgeReference(reference: string): boolean {
  try {
    return classifyKnowledgeDocument(reference) !== null;
  } catch {
    return false;
  }
}

export function refreshNizamKnowledge(
  ctx: RepositoryContext,
  client: DriveKnowledgeClient,
  rootFolderId: string,
  now: () => string,
): Promise<DriveKnowledgeCorpus> {
  return refreshDriveKnowledgeWithPolicy(ctx, client, rootFolderId, now, isNizamKnowledgeReference);
}
