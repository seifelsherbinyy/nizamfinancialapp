/**
 * NIZAM · Drive knowledge environment boundary tests
 * Implemented by: PFOS Contract 12 / Phase 10, extended by Contract 13 §5
 * Owning requirements: optional offline mode, complete capability configuration, and secret redaction
 * Depends on: ./knowledgeEnvironment, ./environment
 *
 * All values below are synthetic test values. No provider credential or Drive identifier is used.
 */
import { describe, expect, it } from 'vitest';

import type { EnvSource } from './environment.ts';
import {
  KNOWLEDGE_DRIVE_ENTRIES,
  KnowledgeEnvironmentError,
  describeKnowledgeDrivePresence,
  loadKnowledgeDriveConfig,
} from './knowledgeEnvironment.ts';

const completeEnv: EnvSource = Object.freeze({
  [KNOWLEDGE_DRIVE_ENTRIES.rootFolderId]: 'synthetic-root',
  [KNOWLEDGE_DRIVE_ENTRIES.refreshToken]: 'synthetic-refresh',
  [KNOWLEDGE_DRIVE_ENTRIES.clientId]: 'synthetic-client',
  [KNOWLEDGE_DRIVE_ENTRIES.clientSecret]: 'synthetic-secret',
  [KNOWLEDGE_DRIVE_ENTRIES.tokenUrl]: 'https://provider.invalid/token',
});

describe('optional Drive knowledge environment', () => {
  it('returns offline mode when every knowledge entry is absent', () => {
    expect(loadKnowledgeDriveConfig({})).toBeNull();
    expect(describeKnowledgeDrivePresence({})[KNOWLEDGE_DRIVE_ENTRIES.rootFolderId]).toBe(false);
  });

  it('refuses a partial capability without naming or exposing a secret value', () => {
    expect(() => loadKnowledgeDriveConfig({ [KNOWLEDGE_DRIVE_ENTRIES.rootFolderId]: 'synthetic-root' })).toThrow(KnowledgeEnvironmentError);
    try {
      loadKnowledgeDriveConfig({
        [KNOWLEDGE_DRIVE_ENTRIES.rootFolderId]: 'synthetic-root',
        [KNOWLEDGE_DRIVE_ENTRIES.refreshToken]: 'synthetic-refresh',
      });
      throw new Error('expected a partial configuration refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeEnvironmentError);
      expect(String(error)).toContain(KNOWLEDGE_DRIVE_ENTRIES.clientId);
      expect(String(error)).not.toContain('synthetic-refresh');
    }
  });

  it('keeps refresh tokens and client secrets redacted after loading', () => {
    const config = loadKnowledgeDriveConfig(completeEnv);
    if (config === null) throw new Error('expected a configured capability');
    expect(JSON.stringify(config)).toContain('[redacted]');
    expect(JSON.stringify(config)).not.toContain('synthetic-refresh');
    expect(JSON.stringify(config)).not.toContain('synthetic-secret');
  });
});
