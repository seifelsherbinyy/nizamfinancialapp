/**
 * Drive evidence packet boundary for Hermes.
 * Owning authority: PFOS Contract 06 knowledge ingestion, PFOS Contract 12 Drive scope, and Contract 13.
 * Phase: Phase 2.5 refined Hermes integration.
 * Depends on: ../hermes/knowledgeBoundary.
 * This is a consumer boundary. It does not add a Drive read path to the financial service.
 */
import {
  type EvidenceConfidence,
  type EvidenceItem,
  type KnowledgeDomain,
  type KnowledgePrivacyClass,
  validateEvidenceItem,
} from '../hermes/knowledgeBoundary.ts';

export const DRIVE_FOLDER_ROLES = ['contracts', 'plans', 'financial', 'journal', 'health', 'operational', 'transactions', 'statements', 'personas', 'goals'] as const;
export type DriveFolderRole = (typeof DRIVE_FOLDER_ROLES)[number];

export interface DriveSourcePacket extends Omit<DriveEvidencePacket, 'domain' | 'privacyClass'> {
  readonly folderRole: DriveFolderRole;
}

const DRIVE_ROLE_POLICY: Readonly<Record<DriveFolderRole, {
  readonly domain: KnowledgeDomain;
  readonly privacyClass: KnowledgePrivacyClass;
}>> = {
  contracts: { domain: 'contract', privacyClass: 'cloud_allowed' },
  plans: { domain: 'operational', privacyClass: 'cloud_allowed' },
  financial: { domain: 'financial', privacyClass: 'cloud_allowed' },
  journal: { domain: 'journal', privacyClass: 'local_only' },
  health: { domain: 'health', privacyClass: 'local_only' },
  operational: { domain: 'operational', privacyClass: 'cloud_allowed' },
  transactions: { domain: 'transaction', privacyClass: 'cloud_allowed' },
  statements: { domain: 'statement', privacyClass: 'cloud_allowed' },
  personas: { domain: 'persona', privacyClass: 'cloud_allowed' },
  goals: { domain: 'goal', privacyClass: 'cloud_allowed' },
};

export function classifyDriveSource(packet: DriveSourcePacket): DriveEvidencePacket {
  const policy = DRIVE_ROLE_POLICY[packet.folderRole];
  if (policy === undefined) throw new Error('DRIVE_FOLDER_ROLE_UNKNOWN');
  return { ...packet, ...policy };
}

export interface DriveEvidencePacket {
  readonly fileRef: string;
  readonly fileLabel: string;
  readonly versionRef: string;
  readonly contentHash: string;
  readonly modifiedAt: string;
  readonly domain: KnowledgeDomain;
  readonly privacyClass: KnowledgePrivacyClass;
  readonly confidence: EvidenceConfidence;
  readonly content: string;
}

export function prepareDriveEvidence(packet: DriveEvidencePacket): EvidenceItem {
  const item: EvidenceItem = {
    sourceRef: packet.fileRef,
    sourceLabel: packet.fileLabel,
    contentHash: packet.contentHash,
    versionRef: packet.versionRef,
    observedAt: packet.modifiedAt,
    domain: packet.domain,
    privacyClass: packet.privacyClass,
    confidence: packet.confidence,
    content: packet.content,
  };
  validateEvidenceItem(item);
  return item;
}
