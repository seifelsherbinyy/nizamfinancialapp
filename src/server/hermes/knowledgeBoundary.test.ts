/**
 * Hermes evidence boundary tests.
 * Owning authority: PFOS Contract 06, Contract 12, and Contract 13.
 * Phase: Phase 2.5 refined Hermes integration.
 * Depends on: knowledgeBoundary.ts.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_CONFIDENCE,
  KNOWLEDGE_DOMAINS,
  KNOWLEDGE_PRIVACY_CLASSES,
  buildGroundedContext,
  type EvidenceItem,
  type KnowledgeDomain,
  type KnowledgePrivacyClass,
} from './knowledgeBoundary.ts';
import { HERMES_PROFILE_NAMES, HERMES_PROFILE_POLICIES, type HermesProfileName } from './profilePolicy.ts';

const HASH = 'a'.repeat(64);

function item(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    sourceRef: 'drive-file-ref',
    sourceLabel: 'Synthetic source',
    contentHash: HASH,
    versionRef: 'version-1',
    observedAt: '2026-08-16T10:00:00Z',
    domain: 'financial',
    privacyClass: 'cloud_allowed',
    confidence: 'high',
    content: 'Synthetic validated evidence.',
    ...overrides,
  };
}

describe('validated evidence routing', () => {
  it('allows NIZAM to see all approved domains but keeps private content out of cloud calls', () => {
    const context = buildGroundedContext('nizam', [
      item(),
      item({ contentHash: 'b'.repeat(64), domain: 'journal', privacyClass: 'local_only' }),
      item({ contentHash: 'c'.repeat(64), domain: 'health', privacyClass: 'local_only' }),
    ]);
    expect(context.evidence).toHaveLength(3);
    expect(context.localOnlyCount).toBe(2);
    expect(context.modelEligible).toBe(false);
  });

  it('excludes raw journal and health evidence from PFOS', () => {
    const context = buildGroundedContext('pfos', [
      item(),
      item({ contentHash: 'b'.repeat(64), domain: 'journal' }),
      item({ contentHash: 'c'.repeat(64), domain: 'health' }),
    ]);
    expect(context.evidence.map((entry) => entry.domain)).toEqual(['financial']);
    expect(context.excludedCount).toBe(2);
  });

  it('deduplicates the same Drive bytes before context construction', () => {
    const context = buildGroundedContext('nizam', [item(), item({ sourceRef: 'moved-file-ref' })]);
    expect(context.evidence).toHaveLength(1);
    expect(context.citations).toHaveLength(1);
  });

  it('refuses invalid provenance and secret-bearing content', () => {
    expect(() => buildGroundedContext('nizam', [item({ contentHash: 'bad' })])).toThrow('EVIDENCE_CONTENT_HASH_INVALID');
    expect(() => buildGroundedContext('nizam', [item({ content: 'OPENROUTER_API_KEY=secret' })])).toThrow(
      'EVIDENCE_SECRET_PATTERN_DETECTED',
    );
  });
});

describe('Contract 05 — finance transaction and statement domains', () => {
  it('allows financeNIZAM to read cloud-allowed transaction and statement evidence', () => {
    const context = buildGroundedContext('pfos', [
      item({ contentHash: 'd'.repeat(64), domain: 'transaction' }),
      item({ contentHash: 'e'.repeat(64), domain: 'statement' }),
    ]);
    expect(context.evidence.map((entry) => entry.domain)).toEqual(['transaction', 'statement']);
    expect(context.modelEligible).toBe(true);
  });
});


type IncompleteProvenanceField =
  | 'sourceRef'
  | 'sourceLabel'
  | 'versionRef'
  | 'contentHash'
  | 'observedAt'
  | 'domain'
  | 'privacyClass'
  | 'confidence'
  | 'content';

interface ProvenanceScenario {
  readonly profile: HermesProfileName;
  readonly domain: KnowledgeDomain;
  readonly privacyClass: KnowledgePrivacyClass;
  readonly restricted: boolean;
  readonly item: EvidenceItem;
}

function scenarioHash(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

function generatedScenarios(): readonly ProvenanceScenario[] {
  const scenarios: ProvenanceScenario[] = [];
  let sequence = 0;

  for (const profile of HERMES_PROFILE_NAMES) {
    for (const domain of KNOWLEDGE_DOMAINS) {
      for (const privacyClass of KNOWLEDGE_PRIVACY_CLASSES) {
        sequence += 1;
        const restricted = privacyClass !== 'cloud_allowed' || domain === 'health' || domain === 'journal';
        scenarios.push({
          profile,
          domain,
          privacyClass,
          restricted,
          item: {
            sourceRef: `synthetic/source/${sequence}`,
            sourceLabel: `Synthetic source ${sequence}`,
            contentHash: scenarioHash(`property-4-${sequence}`),
            versionRef: `synthetic-version-${sequence}`,
            observedAt: '2026-08-16T10:00:00Z',
            domain,
            privacyClass,
            // The closed tuple is non-empty; the assertion keeps strict indexed access sound.
            confidence: EVIDENCE_CONFIDENCE[sequence % EVIDENCE_CONFIDENCE.length]!,
            content: restricted
              ? `Synthetic restricted content ${sequence}`
              : `Synthetic provider-safe content ${sequence}`,
          },
        });
      }
    }
  }

  return scenarios;
}

function incompleteProvenance(item: EvidenceItem, field: IncompleteProvenanceField): EvidenceItem {
  const invalidValues: Record<IncompleteProvenanceField, string> = {
    sourceRef: '',
    sourceLabel: '',
    versionRef: '',
    contentHash: 'not-a-sha256',
    observedAt: 'not-an-utc-instant',
    domain: 'unknown-domain',
    privacyClass: 'unknown-privacy',
    confidence: 'unknown-confidence',
    content: '   ',
  };
  return { ...item, [field]: invalidValues[field] } as EvidenceItem;
}

describe('Property 4 — provenance completeness and locality', () => {
  // **Validates: Requirements 1.4, 2.4**
  it('admits only complete policy-permitted evidence and never marks restricted content provider-bound', () => {
    for (const scenario of generatedScenarios()) {
      const policy = HERMES_PROFILE_POLICIES[scenario.profile];
      const profilePermitsDomain = policy.allowedDomains.includes(scenario.domain);
      const providerPermitsItem = profilePermitsDomain && !scenario.restricted;
      const context = buildGroundedContext(scenario.profile, [scenario.item]);

      expect(context.evidence).toHaveLength(profilePermitsDomain ? 1 : 0);
      expect(context.excludedCount).toBe(profilePermitsDomain ? 0 : 1);
      expect(context.modelEligible).toBe(providerPermitsItem);
      expect(context.localOnlyCount).toBe(profilePermitsDomain && !providerPermitsItem ? 1 : 0);

      if (profilePermitsDomain && scenario.restricted) {
        expect(context.modelEligible).toBe(false);
        expect(context.localOnlyCount).toBe(1);
      }
      if (!profilePermitsDomain) {
        expect(context.evidence).not.toContain(scenario.item);
        expect(context.localOnlyCount).toBe(0);
      }
    }
  });

  // **Validates: Requirements 1.4, 2.4**
  it('refuses every generated incomplete provenance variant instead of guessing missing metadata', () => {
    const fields: readonly IncompleteProvenanceField[] = [
      'sourceRef',
      'sourceLabel',
      'versionRef',
      'contentHash',
      'observedAt',
      'domain',
      'privacyClass',
      'confidence',
      'content',
    ];

    for (const scenario of generatedScenarios()) {
      for (const field of fields) {
        const incomplete = incompleteProvenance(scenario.item, field);
        expect(() => buildGroundedContext(scenario.profile, [incomplete])).toThrow(/^EVIDENCE_/u);
      }
    }
  });
});
