/**
 * NIZAM · Profile memory loader tests — Contract 05 §7.
 * Owning contract: PFOS Contract 05 §7 (Profile memory loader).
 * Phase: Phase 2.5 extended knowledge integration.
 * Depends on: profileMemoryLoader.ts, knowledgeIndex.ts, ../db/repositories/testStore.ts.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { openTestStore, type TestStore } from '../db/repositories/testStore.ts';
import { loadProfileMemory } from './profileMemoryLoader.ts';
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

describe('loadProfileMemory — empty index (Contract 05 §7.3 — AC-K7)', () => {
  it('returns empty context without throwing on a fresh index', () => {
    store = openTestStore('nizam-memory-empty-');
    const summary = loadProfileMemory(store.ctx, 'nizam');
    expect(summary.context.evidence).toHaveLength(0);
    expect(summary.context.modelEligible).toBe(false);
    expect(summary.totalIndexed).toBe(0);
    expect(summary.profile).toBe('nizam');
  });

  it('pfos profile also returns empty context without throwing', () => {
    store = openTestStore('pfos-memory-empty-');
    const summary = loadProfileMemory(store.ctx, 'pfos');
    expect(summary.context.evidence).toHaveLength(0);
    expect(summary.context.modelEligible).toBe(false);
  });
});

describe('loadProfileMemory — with indexed documents', () => {
  it('loads cloud_allowed evidence and marks it model-eligible for nizam', () => {
    store = openTestStore('nizam-memory-docs-');
    indexKnowledgeDocuments(store.ctx, [
      doc('contracts/pfos/01_one.md', 'ac1'),
      doc('transactions/bank-export.csv', 'tx1'),
      doc('personas/owner-persona.md', 'pe1'),
    ]);
    const summaryWithoutCache = loadProfileMemory(store.ctx, 'nizam');
    expect(summaryWithoutCache.totalIndexed).toBeGreaterThan(0);
    expect(summaryWithoutCache.context.evidence).toHaveLength(0);
    const summary = loadProfileMemory(store.ctx, 'nizam', {
      contentResolver: (row) => `Synthetic cached bytes for ${row.documentRef}`,
    });
    expect(summary.context.evidence.length).toBeGreaterThan(0);
  });

  it('journal and health evidence is local_only and never model-eligible (AC-K9)', () => {
    store = openTestStore('nizam-memory-privacy-');
    indexKnowledgeDocuments(store.ctx, [
      doc('journals/entry-2026-08-01.md', 'je1'),
      doc('health_records/whoop-2026-08.json', 'hr1'),
    ]);
    const summary = loadProfileMemory(store.ctx, 'nizam', {
      contentResolver: (row) => `Synthetic private bytes for ${row.documentRef}`,
    });
    // Items are loaded locally but not model-eligible
    expect(summary.context.modelEligible).toBe(false);
    expect(summary.context.localOnlyCount).toBeGreaterThan(0);
  });

  it('pfos profile cannot read journal or health documents (AC-K9)', () => {
    store = openTestStore('pfos-memory-privacy-');
    indexKnowledgeDocuments(store.ctx, [
      doc('journals/entry-2026-08-01.md', 'je1'),
      doc('health_records/whoop-2026-08.json', 'hr1'),
      doc('contracts/pfos/01_one.md', 'ac1'),
    ]);
    const summary = loadProfileMemory(store.ctx, 'pfos', {
      contentResolver: (row) => `Synthetic cached bytes for ${row.documentRef}`,
    });
    // pfos only loads its allowed classes; journal/health are not in pfos weight list
    const domainSet = new Set(summary.context.evidence.map((e) => e.domain));
    expect(domainSet.has('journal')).toBe(false);
    expect(domainSet.has('health')).toBe(false);
  });

  it('respects the limit option', () => {
    store = openTestStore('nizam-memory-limit-');
    indexKnowledgeDocuments(store.ctx, [
      doc('contracts/pfos/01_one.md', 'ac1'),
      doc('contracts/pfos/02_two.md', 'ac2'),
      doc('contracts/pfos/03_three.md', 'ac3'),
      doc('transactions/bank-export.csv', 'tx1'),
      doc('personas/owner-persona.md', 'pe1'),
    ]);
    const summary = loadProfileMemory(store.ctx, 'nizam', { limit: 2 });
    expect(summary.limitApplied).toBe(2);
    expect(summary.context.evidence.length).toBeLessThanOrEqual(2);
  });

  it('classesSampled reflects what was loaded', () => {
    store = openTestStore('nizam-memory-classes-');
    indexKnowledgeDocuments(store.ctx, [
      doc('contracts/pfos/01_one.md', 'ac1'),
      doc('transactions/bank-export.csv', 'tx1'),
    ]);
    const summary = loadProfileMemory(store.ctx, 'nizam');
    expect(summary.classesSampled).toContain('agent_contract');
    expect(summary.classesSampled).toContain('transaction_history');
  });
});
