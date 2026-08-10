// @vitest-environment node
/**
 * NIZAM · The bus store refuses an edit at the engine, and mirrors what it refuses
 * Implemented by: PFOS Contract 12 / Phase 3.3 (spec 06-two-agent-vps)
 * Owning requirements: R7 (validated on write AND on read), R9 (documented in ops)
 * Depends on: ./signalStore, ./signalStoreSchema, ./envelopeValidation, ../ports/signalBus
 *
 * A real store on a temporary directory, because the properties under test are properties OF
 * the engine: that a trigger refuses an UPDATE whatever the caller, that a STRICT table holds
 * only what it declared, and that a row inserted behind the module's back is still refused when
 * it is read. A double would assert none of those.
 *
 * Every negative case is shown refusing the guarded OPERATION, not merely returning a value:
 * the store is inspected afterwards to confirm nothing landed, or that what was there is
 * unchanged.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONSENT_SCOPES,
  SIGNAL_DIRECTIONS,
  SIGNAL_KINDS,
  SIGNAL_LEVELS,
  SIGNAL_NOTE_MAX_LENGTH,
  SIGNAL_PRODUCERS,
  SIGNAL_TIERS,
  type SignalDraft,
} from '../ports/signalBus.ts';
import { signalEnvelopeHash, unwrapSignalValidation, validateSignalNote, SignalValidationError } from './envelopeValidation.ts';
import {
  appendSignal,
  openSignalStore,
  readAudit,
  readSignals,
  SIGNAL_STORE_MIGRATIONS,
  SignalStoreError,
  storedSignalCount,
  type SignalStoreContext,
} from './signalStore.ts';
import { AUDIT_FORBIDDEN_COLUMNS, SIGNAL_SCHEMA_STATEMENTS, SIGNAL_STORE_FILE_NAME } from './signalStoreSchema.ts';

// ---------------------------------------------------------------------------------------------
// Scaffolding — a real store, an injected clock, an injected id source
// ---------------------------------------------------------------------------------------------

interface Fixture {
  readonly ctx: SignalStoreContext;
  readonly dataDir: string;
  close(): void;
}

function openFixture(): Fixture {
  const dataDir = mkdtempSync(join(tmpdir(), 'nizam-signals-'));
  let tick = 0;
  const base = Date.UTC(2026, 2, 2, 9, 0, 0);
  const now = (): string => {
    tick += 1;
    return new Date(base + tick * 1_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  };
  let audits = 0;
  const newAuditId = (): string => {
    audits += 1;
    return `aud-${String(audits).padStart(4, '0')}`;
  };
  const { handle } = openSignalStore({ dataDir, fileName: SIGNAL_STORE_FILE_NAME, busyTimeoutMs: 5_000 }, now);
  return {
    ctx: { handle, now, newAuditId },
    dataDir,
    close(): void {
      handle.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

let fx: Fixture;
beforeEach(() => {
  fx = openFixture();
});
afterEach(() => {
  fx.close();
});

const DRAFT = {
  signalId: 'sig-finance-one',
  ts: '2026-03-02T09:05:00Z',
  producer: 'finance',
  kind: 'money_pressure',
  tier: 'money_safe',
  consentScope: 'producer_only',
  payload: { level: 'amber', direction: 'downshift' },
} as const;

function draft(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...DRAFT, payload: { ...DRAFT.payload }, ...patch };
}

function columnsOf(table: string): { name: string; type: string; notnull: number }[] {
  return fx.ctx.handle.db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => {
      const r = row as Record<string, unknown>;
      return { name: String(r.name), type: String(r.type), notnull: Number(r.notnull) };
    });
}

/** Insert straight into the table, bypassing this module — how a "stored row" gets tampered with. */
function insertRawSignal(values: Record<string, string | null>): void {
  fx.ctx.handle.db
    .prepare(
      `INSERT INTO signals (signal_id, ts, producer, kind, tier, consent_scope, level, direction, note, hash, stored_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      values.signal_id ?? 'sig-raw',
      values.ts ?? '2026-03-02T09:06:00Z',
      values.producer ?? 'finance',
      values.kind ?? 'money_pressure',
      values.tier ?? 'money_safe',
      values.consent_scope ?? 'producer_only',
      values.level ?? 'amber',
      values.direction ?? null,
      values.note ?? null,
      values.hash ?? 'f'.repeat(64),
      values.stored_at ?? '2026-03-02T09:06:01Z',
    );
}

// ---------------------------------------------------------------------------------------------
// The store and its migration
// ---------------------------------------------------------------------------------------------

describe('the signals store is its own migration series, applied once (§4.1, contract 06 §5)', () => {
  it('is a single-entry series at version 1, because signals.db has its own bookkeeping', () => {
    expect(SIGNAL_STORE_MIGRATIONS.map((m) => m.version)).toEqual([1]);
    expect(SIGNAL_STORE_MIGRATIONS[0]?.statements.length).toBe((SIGNAL_SCHEMA_STATEMENTS[1] ?? []).length);
    const recorded = fx.ctx.handle.db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all();
    expect(recorded).toEqual([{ version: 1, name: 'signal_store_append_only' }]);
  });

  it('re-opening applies nothing, so the migration is a no-op the second time (contract 06 §5.2.4)', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'nizam-signals-reopen-'));
    try {
      const first = openSignalStore({ dataDir, fileName: SIGNAL_STORE_FILE_NAME, busyTimeoutMs: 5_000 });
      expect(first.migrations.applied).toEqual([1]);
      first.handle.close();

      const second = openSignalStore({ dataDir, fileName: SIGNAL_STORE_FILE_NAME, busyTimeoutMs: 5_000 });
      expect(second.migrations.applied).toEqual([]);
      expect(second.migrations.skipped).toEqual([1]);
      second.handle.close();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('inherits the engine invariants from the one connection factory rather than restating them', () => {
    // §4.1: "engine invariants are contract 06 §2.2's, applied to this third store."
    expect(fx.ctx.handle.pragmas.journalMode).toBe('wal');
    expect(fx.ctx.handle.pragmas.foreignKeys).toBe(1);
  });

  it('records its own identity, including the two claims contract 12 makes about it', () => {
    const row = fx.ctx.handle.db.prepare('SELECT * FROM signal_store_meta WHERE id = 1').get() as Record<string, unknown>;
    expect(row.store_name).toBe('signals');
    expect(row.append_only).toBe('true');
    expect(row.validated_on).toBe('write_and_read');
    expect(row.journal_mode).toBe('wal');
    expect(row.foreign_keys).toBe('ON');
  });
});

// ---------------------------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------------------------

describe('a valid signal is appended, sealed by the one validator (§4.2, R7)', () => {
  it('stores the envelope and returns the digest 3.1 computed, not one of its own', () => {
    const record = appendSignal(fx.ctx, draft());
    expect(record.envelope.signalId).toBe('sig-finance-one');
    expect(record.envelope.hash).toMatch(/^[0-9a-f]{64}$/);
    // The proof that the digest is reused rather than reimplemented.
    expect(record.envelope.hash).toBe(signalEnvelopeHash(record.envelope));
    expect(storedSignalCount(fx.ctx)).toBe(1);
  });

  it('serves back exactly what it stored, note and direction included', () => {
    const note = unwrapSignalValidation(validateSignalNote('pressure easing, hold the plan'));
    appendSignal(fx.ctx, draft({ payload: { level: 'amber', direction: 'hold', note } }));
    const served = readSignals(fx.ctx, { limit: 10 });
    expect(served.length).toBe(1);
    expect(served[0]?.payload).toEqual({ level: 'amber', direction: 'hold', note });
  });

  it('refuses a producer-asserted digest, because integrity is the bus\u2019s claim (§4.2)', () => {
    expect(() => appendSignal(fx.ctx, draft({ hash: 'a'.repeat(64) }))).toThrow(SignalValidationError);
    expect(storedSignalCount(fx.ctx)).toBe(0);
  });

  it('refuses a repeated signal identifier rather than overwriting the stored one', () => {
    appendSignal(fx.ctx, draft());
    const first = fx.ctx.handle.db.prepare('SELECT hash FROM signals WHERE signal_id = ?').get('sig-finance-one');
    expect(() => appendSignal(fx.ctx, draft({ payload: { level: 'red' } }))).toThrow(SignalStoreError);
    expect(fx.ctx.handle.db.prepare('SELECT hash FROM signals WHERE signal_id = ?').get('sig-finance-one')).toEqual(first);
    expect(storedSignalCount(fx.ctx)).toBe(1);
  });

  it('filters by kind, producer, lower-bound instant and limit', () => {
    appendSignal(fx.ctx, draft());
    appendSignal(fx.ctx, draft({ signalId: 'sig-finance-two', ts: '2026-03-02T10:00:00Z', kind: 'budget_breach' }));
    expect(readSignals(fx.ctx, { limit: 10 }).length).toBe(2);
    expect(readSignals(fx.ctx, { kind: 'budget_breach', limit: 10 }).length).toBe(1);
    expect(readSignals(fx.ctx, { producer: 'life', limit: 10 }).length).toBe(0);
    expect(readSignals(fx.ctx, { since: '2026-03-02T09:30:00Z', limit: 10 }).length).toBe(1);
    expect(readSignals(fx.ctx, { limit: 1 }).length).toBe(1);
    expect(readSignals(fx.ctx, { limit: 0 })).toEqual([]);
  });

  it('refuses a limit that is not a non-negative integer', () => {
    expect(() => readSignals(fx.ctx, { limit: -1 })).toThrow(SignalStoreError);
  });
});

// ---------------------------------------------------------------------------------------------
// Append-only, at the engine
// ---------------------------------------------------------------------------------------------

describe('append-only is enforced by the engine, so every path is bound (§4.1)', () => {
  it('refuses an UPDATE against signals, and the stored row is unchanged', () => {
    appendSignal(fx.ctx, draft());
    expect(() => fx.ctx.handle.db.prepare("UPDATE signals SET level = 'red' WHERE signal_id = ?").run('sig-finance-one'))
      .toThrow(/append-only/);
    expect(fx.ctx.handle.db.prepare('SELECT level FROM signals WHERE signal_id = ?').get('sig-finance-one')).toEqual({
      level: 'amber',
    });
  });

  it('refuses a DELETE against signals, and the row is still there', () => {
    appendSignal(fx.ctx, draft());
    expect(() => fx.ctx.handle.db.prepare('DELETE FROM signals WHERE signal_id = ?').run('sig-finance-one')).toThrow(
      /append-only/,
    );
    expect(storedSignalCount(fx.ctx)).toBe(1);
  });

  it('refuses an UPDATE against the audit mirror — an editable audit trail is not one', () => {
    appendSignal(fx.ctx, draft());
    expect(() => fx.ctx.handle.db.prepare("UPDATE signal_audit SET event = 'accepted'").run()).toThrow(/append-only/);
  });

  it('refuses a DELETE against the audit mirror', () => {
    appendSignal(fx.ctx, draft());
    expect(() => fx.ctx.handle.db.prepare('DELETE FROM signal_audit').run()).toThrow(/append-only/);
    expect(readAudit(fx.ctx).length).toBe(1);
  });

  it('a correction is a NEW row, and both rows remain (§4.1)', () => {
    appendSignal(fx.ctx, draft({ payload: { level: 'red' } }));
    appendSignal(fx.ctx, draft({ signalId: 'sig-finance-correction', ts: '2026-03-02T09:20:00Z', payload: { level: 'green' } }));
    const served = readSignals(fx.ctx, { kind: 'money_pressure', limit: 10 });
    expect(served.map((s) => [s.signalId, s.payload.level])).toEqual([
      ['sig-finance-one', 'red'],
      ['sig-finance-correction', 'green'],
    ]);
    // The superseded signal is still readable, which is the difference between a correction and
    // an edit. There is no `supersedes` field to point back with, by design.
    expect(Object.keys(served[1] ?? {}).includes('supersedes')).toBe(false);
  });

  it('exposes no update path and no delete path in its executable source', () => {
    const source = readFileSync(fileURLToPath(new URL('./signalStore.ts', import.meta.url)), 'utf8');
    const code = source
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        return t !== '' && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('*/') && !t.startsWith('//');
      })
      .join('\n');
    expect(code.length).toBeGreaterThan(500); // the scan below must not pass vacuously
    for (const verb of ['UPDATE', 'DELETE', 'REPLACE INTO']) {
      expect(code.includes(verb), `${verb} must not appear in the store source`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The audit mirror
// ---------------------------------------------------------------------------------------------

describe('the audit mirror records the accept and the refusal (§4.1, §4.3.6)', () => {
  it('mirrors an accepted signal with its digest and the note measured, not copied', () => {
    const note = unwrapSignalValidation(validateSignalNote('hold the plan'));
    const record = appendSignal(fx.ctx, draft({ payload: { level: 'amber', note } }));
    const lines = readAudit(fx.ctx);
    expect(lines.length).toBe(1);
    expect(lines[0]).toEqual({
      id: 'aud-0001',
      occurredAt: expect.any(String),
      event: 'accepted',
      producer: 'finance',
      kind: 'money_pressure',
      signalIdRef: 'sig-finance-one',
      reason: null,
      atPath: null,
      failureCode: null,
      noteLength: note.length,
      hash: record.envelope.hash,
    });
  });

  it('mirrors a refused signal, stores nothing, and names the rule that fired', () => {
    const leaky = draft({ payload: { level: 'amber', dueOn: '2026-04-01' } });
    expect(() => appendSignal(fx.ctx, leaky)).toThrow(SignalValidationError);
    expect(storedSignalCount(fx.ctx)).toBe(0);
    const lines = readAudit(fx.ctx);
    expect(lines.length).toBe(1);
    expect(lines[0]?.event).toBe('refused_on_write');
    expect(lines[0]?.reason).toBe('field_temporal');
    expect(lines[0]?.atPath).toBe('payload.dueOn');
    expect(lines[0]?.failureCode).toBe('SIGNAL_PAYLOAD_FIELD_FORBIDDEN');
    expect(lines[0]?.hash).toBe(null);
  });

  it('mirrors a repeated identifier as a refusal too, so an operator can see it afterwards', () => {
    appendSignal(fx.ctx, draft());
    expect(() => appendSignal(fx.ctx, draft())).toThrow(SignalStoreError);
    const lines = readAudit(fx.ctx);
    expect(lines.map((l) => l.event)).toEqual(['accepted', 'refused_on_write']);
    expect(lines[1]?.reason).toBe('signal_id_already_stored');
  });

  it('mirrors a refusal even when nothing about the envelope was well formed', () => {
    expect(() => appendSignal(fx.ctx, { producer: 'nobody', payload: 7 })).toThrow(SignalValidationError);
    const lines = readAudit(fx.ctx);
    expect(lines.length).toBe(1);
    // A non-member is recorded as absent rather than quoted, because the column has a CHECK and
    // refusing to record a refusal would be the worst available failure.
    expect(lines[0]?.producer).toBe(null);
    expect(lines[0]?.kind).toBe(null);
    expect(lines[0]?.event).toBe('refused_on_write');
  });
});

describe('a refusal retains no refused value (§4.3.6)', () => {
  it('has no column that could hold one', () => {
    const names = columnsOf('signal_audit').map((c) => c.name.toLowerCase());
    expect(names.length).toBeGreaterThan(0);
    for (const forbidden of AUDIT_FORBIDDEN_COLUMNS) {
      expect(names, `signal_audit must never grow a "${forbidden}" column`).not.toContain(forbidden);
    }
  });

  it('has no field on the refusal object either — 3.1\u2019s property, asserted here', () => {
    const overCap = 'this note names a distinctive phrase and is far too long '.repeat(4);
    expect(overCap.length).toBeGreaterThan(SIGNAL_NOTE_MAX_LENGTH);
    let refusalKeys: string[] = [];
    try {
      appendSignal(fx.ctx, draft({ payload: { level: 'amber', note: overCap } }));
    } catch (error) {
      if (!(error instanceof SignalValidationError)) throw error;
      refusalKeys = Object.keys(error.refusal).sort();
    }
    expect(refusalKeys).toEqual(['at', 'code', 'message', 'noteLength', 'reason', 'signalIdRef']);
    for (const forbidden of ['value', 'payload', 'received', 'note', 'text']) {
      expect(refusalKeys).not.toContain(forbidden);
    }
  });

  it('does not persist the refused text anywhere in the store', () => {
    const phrase = 'distinctivephraseneverstored';
    const overCap = `${phrase} ${'x'.repeat(SIGNAL_NOTE_MAX_LENGTH)}`;
    expect(() => appendSignal(fx.ctx, draft({ payload: { level: 'amber', note: overCap } }))).toThrow(
      SignalValidationError,
    );
    expect(storedSignalCount(fx.ctx)).toBe(0);
    const line = readAudit(fx.ctx)[0];
    expect(line?.reason).toBe('note_exceeds_cap');
    // The length was measured; the text was not kept. Not a prefix of it, either — truncation is
    // exactly what §4.3.4 forbids.
    expect(line?.noteLength).toBe(overCap.length);
    expect(JSON.stringify(readAudit(fx.ctx)).includes(phrase)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Read re-validates
// ---------------------------------------------------------------------------------------------

describe('a stored row is served only if it validates NOW (§4.2, R7)', () => {
  it('refuses a read when a stored digest does not cover the stored envelope, and audits it', () => {
    insertRawSignal({ signal_id: 'sig-tampered', hash: 'a'.repeat(64) });
    expect(() => readSignals(fx.ctx, { limit: 10 })).toThrow(SignalValidationError);
    const lines = readAudit(fx.ctx);
    expect(lines.length).toBe(1);
    expect(lines[0]?.event).toBe('refused_on_read');
    expect(lines[0]?.reason).toBe('hash_mismatch');
    // The row is still in the store — append-only means a bad row is not deleted either. It is
    // simply never served.
    expect(storedSignalCount(fx.ctx)).toBe(1);
  });

  it('refuses a stored note the current rules reject, even though the column accepted it', () => {
    // The engine's own CHECK only caps length. A note carrying a figure passes the column and
    // fails the current envelope rules — which is precisely the case write-path validation alone
    // would miss, and why §4.2 requires re-validation before serving.
    const note = 'owed 47 this month';
    expect(note.length).toBeLessThanOrEqual(SIGNAL_NOTE_MAX_LENGTH);
    insertRawSignal({
      signal_id: 'sig-figure',
      note,
      // The cast is the point: no mint would produce this note, which is why no producer could
      // have written this row through the module. Only a direct insert can, and the read path is
      // what has to catch it.
      hash: signalEnvelopeHash({
        signalId: 'sig-figure',
        ts: '2026-03-02T09:06:00Z',
        producer: 'finance',
        kind: 'money_pressure',
        tier: 'money_safe',
        consentScope: 'producer_only',
        payload: { level: 'amber', note },
      } as unknown as SignalDraft),
    });
    expect(() => readSignals(fx.ctx, { limit: 10 })).toThrow(SignalValidationError);
    expect(readAudit(fx.ctx)[0]?.reason).toBe('note_carries_a_figure');
    expect(readAudit(fx.ctx)[0]?.noteLength).toBe(note.length);
  });

  it('serves a genuine row from the same store, so the refusals above are one field away', () => {
    appendSignal(fx.ctx, draft());
    expect(readSignals(fx.ctx, { limit: 10 }).map((s) => s.signalId)).toEqual(['sig-finance-one']);
    expect(readAudit(fx.ctx).map((l) => l.event)).toEqual(['accepted']);
  });
});

// ---------------------------------------------------------------------------------------------
// No second vocabulary
// ---------------------------------------------------------------------------------------------

describe('the DDL admits exactly the schema vocabulary and nothing numeric (§4.3.1)', () => {
  const ddl = (SIGNAL_SCHEMA_STATEMENTS[1] ?? []).join('\n');

  const enumChecks: readonly [column: string, members: readonly string[]][] = [
    ['producer', SIGNAL_PRODUCERS],
    ['kind', SIGNAL_KINDS],
    ['tier', SIGNAL_TIERS],
    ['consent_scope', CONSENT_SCOPES],
    ['level', SIGNAL_LEVELS],
    ['direction', SIGNAL_DIRECTIONS],
  ];

  for (const [column, members] of enumChecks) {
    it(`the CHECK on ${column} lists exactly the schema members, so the DDL cannot drift`, () => {
      const match = new RegExp(`${column}\\s+IN\\s*\\(([^)]*)\\)`).exec(ddl);
      expect(match, `no CHECK ... IN (...) found for ${column}`).not.toBe(null);
      const listed = [...(match?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
      expect(listed.sort()).toEqual([...members].sort());
    });
  }

  it('caps the stored note at the schema cap, taken from one source', () => {
    expect(ddl).toContain(`length(note) <= ${SIGNAL_NOTE_MAX_LENGTH}`);
  });

  it('declares no numeric column on signals — a level is an enum, not a magnitude', () => {
    const columns = columnsOf('signals');
    expect(columns.length).toBe(11);
    expect(columns.filter((c) => c.type !== 'TEXT')).toEqual([]);
  });

  it('declares the audit mirror STRICT with one integer, and it counts characters', () => {
    const integers = columnsOf('signal_audit').filter((c) => c.type === 'INTEGER');
    expect(integers.map((c) => c.name)).toEqual(['note_length']);
  });
});
