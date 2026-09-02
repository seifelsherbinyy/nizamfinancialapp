/**
 * NIZAM · Provenance context port tests — UPOI task 4.1.
 * Owning contract: PFOS Contract 05; UPOI task 4.1 §§2, 6, 7.
 * Phase: Phase 4.1 — UPOI offline provenance context.
 * Depends on: provenanceContext.ts, knowledgeIndex.ts, ../db/repositories/testStore.ts.
 *
 * All content and references are synthetic. These tests never contact Drive, GitHub, Hermes, or a provider.
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { openTestStore, type TestStore } from '../db/repositories/testStore.ts';
import { indexKnowledgeDocuments, type KnowledgeDocument } from './knowledgeIndex.ts';
import {
  createProvenanceContextPort,
  ProvenanceContextError,
  type ApprovedLocalContent,
} from './provenanceContext.ts';

let store: TestStore | null = null;

afterEach(() => {
  store?.close();
  store = null;
});

const NOW = '2026-01-02T00:00:00Z';

function hash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function doc(reference: string, content: string): KnowledgeDocument {
  return {
    reference,
    contentHash: hash(content),
    byteCount: Buffer.byteLength(content, 'utf8'),
  };
}

function contentFor(map: Readonly<Record<string, string>>, overrides: Partial<ApprovedLocalContent> = {}) {
  return (row: { readonly documentRef: string }): ApprovedLocalContent | null => {
    const content = map[row.documentRef];
    return content === undefined ? null : { content, approved: true, ...overrides };
  };
}

function port(
  map: Readonly<Record<string, string>>,
  options: { readonly defaultMaxAgeMs?: number } = {},
) {
  return createProvenanceContextPort(store!.ctx, {
    contentResolver: contentFor(map),
    now: () => NOW,
    ...options,
  });
}

describe('provenance context port — approved local/indexed content', () => {
  it('loads bounded profile-local content with complete provenance', () => {
    store = openTestStore('nizam-provenance-');
    const content = 'Synthetic financial contract evidence for the profile.';
    indexKnowledgeDocuments(store.ctx, [doc('contracts/pfos/01_synthetic.md', content)]);

    const context = port({ 'contracts/pfos/01_synthetic.md': content }).loadProfile('pfos');
    expect(context.items).toHaveLength(1);
    expect(context.items[0]?.provenance).toMatchObject({
      sourceRef: 'contracts/pfos/01_synthetic.md',
      contentHash: hash(content),
      observedAt: expect.stringMatching(/^2026-01-01T00:00:\d{2}\.000Z$/u),
      authorityClass: 'context',
      privacyClass: 'cloud_allowed',
      confidence: 'medium',
    });
    expect(context.items[0]?.provenance.sourceVersion).toMatch(/^doc_[0-9a-f]{24}$/u);
    expect(context.grounded.modelEligible).toBe(true);
  });

  it('searches locally with a result and byte bound', () => {
    store = openTestStore('nizam-provenance-search-');
    const first = 'Synthetic budget review context.';
    const second = 'Synthetic unrelated context.';
    indexKnowledgeDocuments(store.ctx, [
      doc('docs/research/budget.md', first),
      doc('docs/research/other.md', second),
    ]);

    const context = port({
      'docs/research/budget.md': first,
      'docs/research/other.md': second,
    }).search({ profile: 'nizam', text: 'budget review', limit: 1 });
    expect(context.totalMatched).toBe(1);
    expect(context.items.map((item) => item.content)).toEqual([first]);
  });

  it('keeps local-only content in local context and out of model-eligible context', () => {
    store = openTestStore('nizam-provenance-local-');
    const content = 'Synthetic private journal entry.';
    indexKnowledgeDocuments(store.ctx, [doc('journals/private.md', content)]);

    const context = port({ 'journals/private.md': content }).loadProfile('nizam');
    expect(context.items).toHaveLength(1);
    expect(context.items[0]?.provenance.privacyClass).toBe('local_only');
    expect(context.grounded.localOnlyCount).toBe(1);
    expect(context.grounded.modelEligible).toBe(false);
  });
});

describe('provenance context port — fail closed', () => {
  it('refuses missing local bytes rather than fabricating content', () => {
    store = openTestStore('nizam-provenance-missing-');
    indexKnowledgeDocuments(store.ctx, [doc('docs/research/missing.md', 'Synthetic retained bytes.')]);

    expect(() => port({}).loadProfile('nizam')).toThrowError(
      expect.objectContaining({ code: 'CONTEXT_CONTENT_UNAVAILABLE' }),
    );
  });

  it('refuses corrupt bytes whose hash or byte count differs from the index', () => {
    store = openTestStore('nizam-provenance-corrupt-');
    indexKnowledgeDocuments(store.ctx, [doc('docs/research/corrupt.md', 'Synthetic original bytes.')]);

    expect(() => port({ 'docs/research/corrupt.md': 'Synthetic changed bytes.' }).loadProfile('nizam')).toThrowError(
      expect.objectContaining({ code: 'CONTEXT_CONTENT_CORRUPT' }),
    );
  });

  it('refuses stale content using the injected freshness clock', () => {
    store = openTestStore('nizam-provenance-stale-');
    const content = 'Synthetic stale research.';
    indexKnowledgeDocuments(store.ctx, [doc('docs/research/stale.md', content)]);

    expect(() => port({ 'docs/research/stale.md': content }, { defaultMaxAgeMs: 60 * 60 * 1_000 }).loadProfile('nizam')).toThrowError(
      expect.objectContaining({ code: 'CONTEXT_CONTENT_STALE' }),
    );
  });

  it('refuses resolver metadata that widens privacy or transfers authority', () => {
    store = openTestStore('nizam-provenance-policy-');
    const content = 'Synthetic journal bytes.';
    indexKnowledgeDocuments(store.ctx, [doc('journals/private.md', content)]);

    const privacyPort = createProvenanceContextPort(store.ctx, {
      contentResolver: contentFor({ 'journals/private.md': content }, { privacyClass: 'cloud_allowed' }),
      now: () => NOW,
    });
    expect(() => privacyPort.loadProfile('nizam')).toThrowError(
      expect.objectContaining({ code: 'CONTEXT_PRIVACY_MISMATCH' }),
    );

    const authorityPort = createProvenanceContextPort(store.ctx, {
      contentResolver: contentFor({ 'journals/private.md': content }, { authorityClass: 'deterministic_domain' }),
      now: () => NOW,
    });
    expect(() => authorityPort.loadProfile('nizam')).toThrowError(
      expect.objectContaining({ code: 'CONTEXT_AUTHORITY_TRANSFER' }),
    );
  });

  it('refuses a search result that belongs to another profile', () => {
    store = openTestStore('nizam-provenance-profile-');
    const content = 'Synthetic private journal budget note.';
    indexKnowledgeDocuments(store.ctx, [doc('journals/private.md', content)]);

    const financePort = port({ 'journals/private.md': content });
    expect(() => financePort.search({ profile: 'pfos', text: 'private journal' })).toThrowError(
      expect.objectContaining({ code: 'CONTEXT_PROFILE_MISMATCH' }),
    );
  });

  it('explains provenance without returning content and reports unknown references', () => {
    store = openTestStore('nizam-provenance-explain-');
    const content = 'Synthetic explanation source.';
    indexKnowledgeDocuments(store.ctx, [doc('docs/research/explain.md', content)]);
    const context = port({ 'docs/research/explain.md': content });
    const item = context.loadProfile('nizam').items[0];

    expect(context.explain(item?.provenance.sourceRef ?? '')).toMatchObject({
      sourceRef: 'docs/research/explain.md',
      contentHash: hash(content),
      authorityClass: 'context',
    });
    expect(() => context.explain('not-indexed')).toThrowError(
      new ProvenanceContextError('CONTEXT_REFERENCE_NOT_FOUND', 'not-indexed', 'NIZAM context: provenance reference is not indexed'),
    );
  });
});
