/**
 * NIZAM · Agent readiness scorer tests — Contract 05 §6.
 * Owning contract: PFOS Contract 05 §6 (Readiness metric).
 * Phase: Phase 2.5 extended knowledge integration.
 * Depends on: agentReadiness.ts, knowledgeIndex.ts, ../db/repositories/testStore.ts.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { openTestStore, type TestStore } from '../db/repositories/testStore.ts';
import {
  computeAgentReadiness,
  assertWeightsSumToOne,
  scoreToReadinessLevel,
  PROFILE_WEIGHTS,
} from './agentReadiness.ts';
import { indexKnowledgeDocuments, type KnowledgeDocument } from './knowledgeIndex.ts';

let store: TestStore | null = null;
afterEach(() => {
  store?.close();
  store = null;
});

function hashOf(label: string): string {
  return label.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'a');
}

function doc(reference: string, label = reference): KnowledgeDocument {
  return { reference, contentHash: hashOf(label), byteCount: 512 };
}

describe('weight invariants (Contract 05 §6.2)', () => {
  it('nizam weights sum to 1.0', () => {
    expect(() => assertWeightsSumToOne(PROFILE_WEIGHTS.nizam, 'nizam')).not.toThrow();
  });

  it('pfos weights sum to 1.0', () => {
    expect(() => assertWeightsSumToOne(PROFILE_WEIGHTS.pfos, 'pfos')).not.toThrow();
  });

  it('throws when weights do not sum to 1.0', () => {
    expect(() =>
      assertWeightsSumToOne([{ knowledgeClass: 'persona', weight: 0.5, threshold: 1 }], 'test'),
    ).toThrow(/READINESS_WEIGHTS_DO_NOT_SUM_TO_ONE/);
  });
});

describe('scoreToReadinessLevel', () => {
  it('maps 0 to not_ready', () => expect(scoreToReadinessLevel(0)).toBe('not_ready'));
  it('maps 29 to not_ready', () => expect(scoreToReadinessLevel(29)).toBe('not_ready'));
  it('maps 30 to partial', () => expect(scoreToReadinessLevel(30)).toBe('partial'));
  it('maps 59 to partial', () => expect(scoreToReadinessLevel(59)).toBe('partial'));
  it('maps 60 to operational', () => expect(scoreToReadinessLevel(60)).toBe('operational'));
  it('maps 89 to operational', () => expect(scoreToReadinessLevel(89)).toBe('operational'));
  it('maps 90 to full', () => expect(scoreToReadinessLevel(90)).toBe('full'));
  it('maps 100 to full', () => expect(scoreToReadinessLevel(100)).toBe('full'));
});

describe('computeAgentReadiness — nizam profile', () => {
  it('score is 0 on an empty index (AC-K4 §6.6)', () => {
    store = openTestStore('nizam-readiness-0-');
    const report = computeAgentReadiness(store.ctx, 'nizam');
    expect(report.score).toBe(0);
    expect(report.readinessLevel).toBe('not_ready');
    expect(report.blockers.length).toBe(PROFILE_WEIGHTS.nizam.length);
  });

  it('score ≥ 90 when all weighted classes have ≥ 1 document (AC-K4)', () => {
    store = openTestStore('nizam-readiness-full-');
    indexKnowledgeDocuments(store.ctx, [
      doc('transactions/bank-export.csv', 'aa0001'),
      doc('statements/statement-jan.csv', 'bb0002'),
      doc('personas/owner-persona.md', 'cc0003'),
      doc('goals/goal-financial-freedom.md', 'dd0004'),
      doc('journals/entry-2026-08-01.md', 'ee0005'),
      doc('health_records/whoop-2026-08.json', 'ff0006'),
      doc('life_context/bio.md', 'ab0007'),
      doc('contracts/pfos/01_one.md', 'ac0008'),
    ]);
    const report = computeAgentReadiness(store.ctx, 'nizam');
    expect(report.score).toBeGreaterThanOrEqual(90);
    expect(report.readinessLevel).toBe('full');
    expect(report.blockers).toHaveLength(0);
  });

  it('partial score when only some classes are indexed', () => {
    store = openTestStore('nizam-readiness-partial-');
    // Only index transactions (0.20 weight) and persona (0.20) = 40%
    indexKnowledgeDocuments(store.ctx, [
      doc('transactions/bank-export.csv', 'aa0021'),
      doc('personas/owner-persona.md', 'cc0022'),
    ]);
    const report = computeAgentReadiness(store.ctx, 'nizam');
    expect(report.score).toBeGreaterThan(0);
    expect(report.score).toBeLessThan(90);
  });

  it('blockers list contains classes with count 0', () => {
    store = openTestStore('nizam-readiness-blockers-');
    indexKnowledgeDocuments(store.ctx, [doc('transactions/tx.csv', 'aa0099')]);
    const report = computeAgentReadiness(store.ctx, 'nizam');
    expect(report.blockers).toContain('bank_statement');
    expect(report.blockers).toContain('persona');
    expect(report.blockers).not.toContain('transaction_history');
  });

  it('carries drivenByDrive and drivenByGitHub flags', () => {
    store = openTestStore('nizam-readiness-flags-');
    const report = computeAgentReadiness(store.ctx, 'nizam', true, false);
    expect(report.drivenByDrive).toBe(true);
    expect(report.drivenByGitHub).toBe(false);
  });
});

describe('computeAgentReadiness — pfos profile', () => {
  it('score is 0 on an empty index', () => {
    store = openTestStore('pfos-readiness-0-');
    const report = computeAgentReadiness(store.ctx, 'pfos');
    expect(report.score).toBe(0);
    expect(report.readinessLevel).toBe('not_ready');
  });

  it('score ≥ 90 when all pfos weighted classes have ≥ 1 document (AC-K4)', () => {
    store = openTestStore('pfos-readiness-full-');
    indexKnowledgeDocuments(store.ctx, [
      doc('transactions/bank-export.csv', 'aa0011'),
      doc('statements/statement-jan.csv', 'bb0012'),
      doc('docs/research/topic.md', 'cc0013'),
      doc('contracts/pfos/01_one.md', 'dd0014'),
      doc('github://synthetic-owner/synthetic-repo/some/file.md', 'ee0015'),
      doc('docs/architecture/OVERVIEW.md', 'ff0016'),
    ]);
    const report = computeAgentReadiness(store.ctx, 'pfos');
    expect(report.score).toBeGreaterThanOrEqual(90);
    expect(report.readinessLevel).toBe('full');
    expect(report.blockers).toHaveLength(0);
  });

  it('breakdown entries match declared weights', () => {
    store = openTestStore('pfos-readiness-breakdown-');
    const report = computeAgentReadiness(store.ctx, 'pfos');
    const txEntry = report.breakdown.find((e) => e.knowledgeClass === 'transaction_history');
    expect(txEntry?.weight).toBe(0.30);
    expect(txEntry?.threshold).toBe(1);
    expect(txEntry?.count).toBe(0);
    expect(txEntry?.contribution).toBe(0);
  });
});
