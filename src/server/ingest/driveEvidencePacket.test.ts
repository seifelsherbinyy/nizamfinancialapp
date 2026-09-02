/**
 * Drive evidence packet tests.
 * Owning authority: PFOS Contract 06, Contract 12, and Contract 13.
 * Phase: Phase 2.5 refined Hermes integration.
 * Depends on: driveEvidencePacket.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyDriveSource,
  prepareDriveEvidence,
  type DriveEvidencePacket,
  type DriveSourcePacket,
} from './driveEvidencePacket.ts';

const packet: DriveEvidencePacket = {
  fileRef: 'drive-file-ref',
  fileLabel: 'Synthetic source',
  versionRef: 'version-1',
  contentHash: 'a'.repeat(64),
  modifiedAt: '2026-08-16T10:00:00Z',
  domain: 'operational',
  privacyClass: 'cloud_allowed',
  confidence: 'high',
  content: 'Synthetic Drive content.',
};

describe('Drive evidence consumer boundary', () => {
  it('converts an authorized packet into provenance-carrying evidence', () => {
    expect(prepareDriveEvidence(packet)).toMatchObject({
      sourceRef: 'drive-file-ref',
      sourceLabel: 'Synthetic source',
      contentHash: 'a'.repeat(64),
      domain: 'operational',
    });
  });

  it('does not create a financial-service Drive read path', () => {
    expect(prepareDriveEvidence(packet).sourceRef).toBe('drive-file-ref');
  });

  it('refuses a packet that contains a credential pattern', () => {
    expect(() => prepareDriveEvidence({ ...packet, content: 'TELEGRAM_BOT_TOKEN=secret' })).toThrow(
      'EVIDENCE_SECRET_PATTERN_DETECTED',
    );
  });

  it('keeps journal and health source content local by role', () => {
    const source: DriveSourcePacket = {
      fileRef: 'drive-journal-ref',
      fileLabel: 'Synthetic journal',
      versionRef: 'version-1',
      contentHash: 'b'.repeat(64),
      modifiedAt: '2026-08-16T10:00:00Z',
      folderRole: 'journal',
      confidence: 'high',
      content: 'Synthetic private journal content.',
    };
    expect(classifyDriveSource(source)).toMatchObject({ domain: 'journal', privacyClass: 'local_only' });
  });

  it('classifies contracts and plans without storing folder identifiers', () => {
    expect(classifyDriveSource({ ...packet, folderRole: 'contracts' })).toMatchObject({
      domain: 'contract',
      privacyClass: 'cloud_allowed',
    });
    expect(classifyDriveSource({ ...packet, folderRole: 'plans' })).toMatchObject({
      domain: 'operational',
      privacyClass: 'cloud_allowed',
    });
  });
});

describe('Contract 05 — extended Drive folder roles', () => {
  const basePacket = {
    fileRef: 'drive-ref',
    fileLabel: 'Synthetic file',
    versionRef: 'v1',
    contentHash: 'c'.repeat(64),
    modifiedAt: '2026-08-18T10:00:00Z',
    confidence: 'high' as const,
    content: 'Synthetic content.',
  };

  it('classifies transactions role as transaction domain, cloud_allowed', () => {
    const result = classifyDriveSource({ ...basePacket, folderRole: 'transactions' });
    expect(result.domain).toBe('transaction');
    expect(result.privacyClass).toBe('cloud_allowed');
  });

  it('classifies statements role as statement domain, cloud_allowed', () => {
    const result = classifyDriveSource({ ...basePacket, folderRole: 'statements' });
    expect(result.domain).toBe('statement');
    expect(result.privacyClass).toBe('cloud_allowed');
  });

  it('classifies personas role as persona domain, cloud_allowed', () => {
    const result = classifyDriveSource({ ...basePacket, folderRole: 'personas' });
    expect(result.domain).toBe('persona');
    expect(result.privacyClass).toBe('cloud_allowed');
  });

  it('classifies goals role as goal domain, cloud_allowed', () => {
    const result = classifyDriveSource({ ...basePacket, folderRole: 'goals' });
    expect(result.domain).toBe('goal');
    expect(result.privacyClass).toBe('cloud_allowed');
  });
});
