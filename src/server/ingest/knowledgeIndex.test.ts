/**
 * NIZAM · The knowledge tier's three properties, on synthetic documents — spec 08 wave A4.
 * Implemented by: PFOS Contract 06 / Phase 2.4 (spec 08-knowledge-ingestion, wave A4)
 * Depends on: knowledgeIndex.ts, ../db/repositories/testStore.ts
 *
 * Synthetic references and synthetic hashes throughout, so these run on a clean checkout. They assert:
 *
 *   A4.1 / K5  the same bytes index once, a moved reference with the same bytes is the same document, and
 *              a document no rule claims is reported rather than filed under a default class.
 *   A4.2       a horizon carries its position, two documents cannot hold one position, a position that
 *              cannot be resolved is refused, and an INCOMPLETE ordered set refuses to be read for use.
 *   A4.3       the contract set and the architecture documents classify.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { openTestStore, type TestStore } from '../db/repositories/testStore.ts';
import { createDocumentIndexRepository } from '../db/repositories/documentIndexRepository.ts';
import {
  RECOVERY_HORIZONS,
  RECOVERY_PLAN_SET,
  classifyKnowledgeDocument,
  indexKnowledgeDocuments,
  orderedSetStatus,
  readOrderedSetForUse,
  resolveRecoveryHorizonOrdinal,
  type KnowledgeDocument,
} from './knowledgeIndex.ts';

let store: TestStore | null = null;
afterEach(() => {
  store?.close();
  store = null;
});

/** A synthetic content hash. Distinct per label, stable across calls. */
function hashOf(label: string): string {
  return label.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'a');
}

function document(reference: string, label = reference): KnowledgeDocument {
  return { reference, contentHash: hashOf(label), byteCount: 1_024 };
}

describe('A4.1 / K5 — the same bytes index once', () => {
  it('indexes a document and treats a re-index of the same bytes as a no-op', () => {
    store = openTestStore('nizam-knowledge-');
    const docs = [document('docs/research/synthetic-topic.md')];
    const first = indexKnowledgeDocuments(store.ctx, docs);
    expect(first.indexed).toBe(1);
    expect(first.alreadyIndexed).toBe(0);

    const second = indexKnowledgeDocuments(store.ctx, docs);
    expect(second.indexed).toBe(0);
    expect(second.alreadyIndexed).toBe(1);
    expect(createDocumentIndexRepository(store.ctx).count()).toBe(1);
  });

  it('recognises the same bytes under a different reference as the same document', () => {
    store = openTestStore('nizam-knowledge-');
    indexKnowledgeDocuments(store.ctx, [document('docs/research/first-location.md', 'sharedbytes')]);
    const moved = indexKnowledgeDocuments(store.ctx, [document('docs/research/second-location.md', 'sharedbytes')]);
    expect(moved.indexed).toBe(0);
    expect(moved.alreadyIndexed).toBe(1);
    expect(createDocumentIndexRepository(store.ctx).count()).toBe(1);
  });

  it('reports a document no rule claims, rather than filing it under a default class', () => {
    store = openTestStore('nizam-knowledge-');
    const report = indexKnowledgeDocuments(store.ctx, [
      document('some/unrelated/place/notes.txt'),
      document('docs/research/synthetic-topic.md'),
    ]);
    expect(report.unclassified).toEqual(['some/unrelated/place/notes.txt']);
    expect(report.indexed).toBe(1);
    expect(createDocumentIndexRepository(store.ctx).count()).toBe(1);
  });

  it('gives every indexed document a distinct content hash', () => {
    store = openTestStore('nizam-knowledge-');
    const report = indexKnowledgeDocuments(store.ctx, [
      document('docs/research/one.md', 'bbb'),
      document('docs/research/two.md', 'ccc'),
      document('docs/research/three.md', 'ddd'),
    ]);
    expect(report.indexed).toBe(3);
    expect(report.distinctContentHashes).toBe(3);
    expect(createDocumentIndexRepository(store.ctx).count()).toBe(3);
  });

  it('moves a document to a tombstoned STATE rather than deleting it', () => {
    store = openTestStore('nizam-knowledge-');
    indexKnowledgeDocuments(store.ctx, [document('docs/research/synthetic-topic.md')]);
    const repo = createDocumentIndexRepository(store.ctx);
    const row = repo.listClass('financial_research')[0];
    expect(row).toBeDefined();
    const moved = repo.setProcessingState(row?.id ?? '', 'tombstoned');
    expect(moved.processingState).toBe('tombstoned');
    expect(moved.tombstonedAt).not.toBeNull();
    // Still one row: a deleted pointer would make the same document look new and be indexed again.
    expect(repo.count()).toBe(1);
  });
});

describe('A4.2 — the recovery plan is one ordered set, and the order is the meaning', () => {
  it('resolves each declared horizon to its own position, longest token first', () => {
    expect(resolveRecoveryHorizonOrdinal('recovery/triage_72h.md')).toBe(1);
    expect(resolveRecoveryHorizonOrdinal('recovery/stabilize_30d.md')).toBe(2);
    expect(resolveRecoveryHorizonOrdinal('recovery/consolidate_90d.md')).toBe(3);
    expect(resolveRecoveryHorizonOrdinal('recovery/rebuild_180d.md')).toBe(4);
    expect(resolveRecoveryHorizonOrdinal('recovery/monitor_365d.md')).toBe(5);
    expect(resolveRecoveryHorizonOrdinal('recovery/overview.md')).toBeNull();
  });

  it('indexes the five horizons at their own positions and serves them in order', () => {
    store = openTestStore('nizam-knowledge-');
    const docs = RECOVERY_HORIZONS.map((h, i) => document(`recovery/stage_${h}.md`, `horizon${String(i)}`));
    // Offered in a scrambled order on purpose: the stored order must come from the position, not arrival.
    const report = indexKnowledgeDocuments(store.ctx, [docs[3], docs[0], docs[4], docs[1], docs[2]] as KnowledgeDocument[]);
    expect(report.indexed).toBe(5);

    const served = readOrderedSetForUse(store.ctx, RECOVERY_PLAN_SET, RECOVERY_HORIZONS.length);
    expect(served.map((m) => m.setOrdinal)).toEqual([1, 2, 3, 4, 5]);
    expect(served[0]?.documentRef).toContain('72h');
    expect(served[4]?.documentRef).toContain('365d');
  });

  it('refuses a set member whose position cannot be resolved, rather than filing it at a guessed one', () => {
    store = openTestStore('nizam-knowledge-');
    expect(() => classifyKnowledgeDocument('recovery/_index.md')).toThrow(/names none of the declared horizons/);
    const report = indexKnowledgeDocuments(store.ctx, [document('recovery/_index.md')]);
    expect(report.indexed).toBe(0);
    expect(report.refused).toHaveLength(1);
    expect(report.refused[0]?.reason).toContain('advice given for the wrong moment');
  });

  it('refuses a second document claiming a position another already holds', () => {
    store = openTestStore('nizam-knowledge-');
    indexKnowledgeDocuments(store.ctx, [document('recovery/first_72h.md', 'first')]);
    const clash = indexKnowledgeDocuments(store.ctx, [document('recovery/second_72h.md', 'second')]);
    expect(clash.indexed).toBe(0);
    expect(clash.refused[0]?.reason).toContain('already held by another document');
    expect(orderedSetStatus(store!.ctx, RECOVERY_PLAN_SET, 5).presentSize).toBe(1);
  });

  it('refuses to serve an INCOMPLETE ordered set, because a partial plan looks like a whole one', () => {
    store = openTestStore('nizam-knowledge-');
    indexKnowledgeDocuments(store.ctx, [
      document('recovery/a_72h.md', 'aa'),
      document('recovery/b_30d.md', 'bb'),
      document('recovery/c_90d.md', 'cc'),
    ]);
    const status = orderedSetStatus(store.ctx, RECOVERY_PLAN_SET, 5);
    expect(status.presentSize).toBe(3);
    expect(status.ordinalsMissing).toEqual([4, 5]);
    expect(status.complete).toBe(false);
    expect(() => readOrderedSetForUse(store!.ctx, RECOVERY_PLAN_SET, 5)).toThrow(/refuses to be read for use/);
  });

  it('reports the set status even when the set is entirely absent, so absence is visible', () => {
    store = openTestStore('nizam-knowledge-');
    const status = orderedSetStatus(store.ctx, RECOVERY_PLAN_SET, 5);
    expect(status.presentSize).toBe(0);
    expect(status.ordinalsMissing).toEqual([1, 2, 3, 4, 5]);
    expect(status.complete).toBe(false);
  });
});

describe('A4.3 — the contract set and the architecture documents classify', () => {
  it('classifies a contract document, an architecture document and a research document distinctly', () => {
    expect(classifyKnowledgeDocument('contracts/pfos/06_PFOS_Database_and_Knowledge_Model.md')?.knowledgeClass).toBe(
      'agent_contract',
    );
    expect(classifyKnowledgeDocument('docs/architecture/OVERVIEW.md')?.knowledgeClass).toBe('architecture');
    expect(classifyKnowledgeDocument('docs/adr/ADR-0001-drive-as-database.md')?.knowledgeClass).toBe('architecture');
    expect(classifyKnowledgeDocument('docs/research/synthetic-topic.md')?.knowledgeClass).toBe('financial_research');
  });

  it('checks the recovery rule before the research rule, so a horizon keeps its position', () => {
    // A path that both a research-shaped rule and the recovery rule could plausibly claim.
    const classified = classifyKnowledgeDocument('out/recovery/triage_72h.md');
    expect(classified?.knowledgeClass).toBe('recovery_plan');
    expect(classified?.setOrdinal).toBe(1);
  });

  it('indexes a mixed set and counts it by class', () => {
    store = openTestStore('nizam-knowledge-');
    const report = indexKnowledgeDocuments(store.ctx, [
      document('contracts/pfos/01_one.md', 'c1'),
      document('contracts/pfos/02_two.md', 'c2'),
      document('docs/architecture/OVERVIEW.md', 'a1'),
      document('docs/research/topic.md', 'r1'),
    ]);
    expect(report.byClass['agent_contract']).toBe(2);
    expect(report.byClass['architecture']).toBe(1);
    expect(report.byClass['financial_research']).toBe(1);
    expect(report.sets[0]?.complete).toBe(false);
  });
});
