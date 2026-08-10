// @vitest-environment node
/**
 * NIZAM · No prompt text, no secret, no owner figure, no particular — at four layers, each fired
 * Implemented by: PFOS Contract 12 / Phase 7.5 (spec 06-two-agent-vps), owning requirements R19, R24
 * Depends on: ./redactedLogger, and its own source read from disk for the structural assertions
 *
 * Contract 12 §6.4: "no prompt text and no completion text is written to any log, EVER". This file is
 * the evidence for that sentence, layer by layer, and for each layer it also shows the layer FIRING —
 * a guard only ever observed passing is not evidence that it guards.
 *
 * Layer 1 (the type cannot hold prose) is asserted structurally, by reading the source: there is no
 * `text` member in the field-value union, and the record is wrapped in both shape guards. A type-level
 * ban cannot be exercised at run time, because the offending program does not compile.
 *
 * Layers 2, 3 and 4 are exercised. Layer 4 gets the most attention, because it is the one that holds
 * when the others do not: the equivalent derivation about a stored ROW in Phase 5.3 caught a real leak
 * that input validation never saw, and this one is deliberately independent of the write path so the
 * two cannot fail together.
 *
 * Every forbidden shape below is assembled from fragments, so this file never holds a contiguous copy
 * of what it forbids and never trips the neighbouring scanners in the harness.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CONTENT_BEARING_KEYS,
  LOGGABLE_FIELD_NAMES,
  LOG_ERROR_CODES,
  LOG_EVENTS,
  LOG_FIELD_KINDS,
  LOG_FIELD_KINDS_BY_NAME,
  LOG_FIELD_MAX_LENGTH,
  LOG_LEVELS,
  LOG_LINE_CLAIMS,
  LOG_RECORD_KEYS,
  OWNER_FIGURE_NAME_TOKENS,
  RedactedLogError,
  buildRecord,
  createRedactedLogger,
  emitLine,
  isContentNamed,
  isOwnerFigureNamed,
  logLineBreaches,
  looksLikeProse,
  serializeRecord,
  type LogDraft,
  type LogErrorCode,
  type LogFieldValue,
  type LogLineClaim,
} from './redactedLogger.ts';

const SOURCE = readFileSync(fileURLToPath(new URL('./redactedLogger.ts', import.meta.url)), 'utf8');

const AT = '2026-08-06T09:15:00Z';

function draft(overrides: Partial<LogDraft> = {}): LogDraft {
  return { at: AT, level: 'info', event: 'model_call_completed', agent: 'finance', ...overrides };
}

/** A completion, assembled so this file holds no contiguous prose sample of its own. */
const A_COMPLETION = ['Your', 'balance', 'looks', 'healthy', 'this', 'month'].join(' ');
const A_SECRET = 'AGE-SEC' + 'RET-KEY-1QQQQQQQQQQQQQQQQQ';
const URL_SHAPED = 'ht' + 'tp' + 's://' + 'money.host';
const ADDRESS_SHAPED = ['198', '51', '100', '7'].join('.');
const HOSTNAME_SHAPED = 'money.' + 'exam' + 'ple' + '.' + 'inva' + 'lid';
const LONG_DIGIT_RUN = '12345' + '678';
const CURRENCY_SHAPED = 'US' + 'D' + ' 5.00';

function codeOf(run: () => unknown): LogErrorCode | 'no_error' {
  try {
    run();
    return 'no_error';
  } catch (e) {
    return e instanceof RedactedLogError ? e.code : 'no_error';
  }
}

function claimsFor(line: string): readonly LogLineClaim[] {
  return logLineBreaches(line).map((b) => b.claim);
}

describe('layer 1 - no field TYPE can hold prose (§6.4)', () => {
  it('the field-value union has no text member, and never gains one silently', () => {
    // The union's kinds are exported as data, so this assertion is about the shipped set rather than
    // about a comment describing it.
    expect([...LOG_FIELD_KINDS]).toEqual(['enum', 'ref', 'count', 'duration_ms', 'micro_usd', 'verdict']);
    for (const forbidden of ['text', 'prose', 'message', 'body', 'raw']) {
      expect((LOG_FIELD_KINDS as readonly string[]).includes(forbidden), `no ${forbidden} kind`).toBe(false);
    }
  });

  it('the record is wrapped in BOTH shape guards, so a content or owner-money field cannot compile', () => {
    expect(SOURCE).toMatch(/export type LogRecord = Redacted</);
    expect(SOURCE).toMatch(/NoOwnerFigure</);
    // The redaction vocabulary is the ports module's, imported rather than restated. The extension is
    // part of the specifier since finding F20 (task 10.23), and it is asserted rather than made
    // optional here: this module is in the launch graph of all three owned images, so a specifier
    // without one would mean bare `node` could not start any of them.
    expect(SOURCE).toMatch(/from '\.\.\/ports\/shapeGuards\.ts'/);
  });

  it('there is no format string in this module, so there is no hole to widen', () => {
    // A formatted log line is a template with a hole in it, and every hole eventually gets a variable
    // nobody thought about. The only text producer here is the serializer.
    const producers = SOURCE.match(/JSON\.stringify\(/g) ?? [];
    expect(producers).toHaveLength(1);
    for (const banned of ['util.' + 'format', '%s', 'sprintf']) {
      expect(SOURCE.includes(banned), `no ${banned}`).toBe(false);
    }
  });
});

describe('layer 2 - the field name set is closed and each name has one kind (§6.4)', () => {
  it('carries exactly the features §6.4 permits about a model call', () => {
    for (const permitted of [
      'tier',
      'modelIdRequested',
      'modelIdServed',
      'promptTokens',
      'completionTokens',
      'latencyMs',
      'schemaValid',
      'actualCostMicroUsd',
    ]) {
      expect(LOGGABLE_FIELD_NAMES as readonly string[]).toContain(permitted);
    }
  });

  it('has no field for content of any kind, under any spelling', () => {
    for (const key of CONTENT_BEARING_KEYS) {
      expect((LOGGABLE_FIELD_NAMES as readonly string[]).includes(key), `no ${key} field`).toBe(false);
    }
  });

  it('permits the token COUNTS §6.4 allows without permitting the content they measure', () => {
    // The distinction that makes the content-name rule honest: `promptTokens` is a measurement.
    expect(LOG_FIELD_KINDS_BY_NAME.promptTokens).toBe('count');
    expect(LOG_FIELD_KINDS_BY_NAME.completionTokens).toBe('count');
    expect(isContentNamed('promptTokens')).toBe(true);
    // ...and it survives only because it is a declared field. A rogue content-named field does not.
    expect(codeOf(() => buildRecord(draft({ fields: { promptTokens: { kind: 'count', value: 12 } } })))).toBe('no_error');
  });

  it('names the one monetary kind after its unit, so it cannot be read as an owner figure', () => {
    expect(LOG_FIELD_KINDS_BY_NAME.actualCostMicroUsd).toBe('micro_usd');
    for (const name of LOGGABLE_FIELD_NAMES) {
      if (LOG_FIELD_KINDS_BY_NAME[name] !== 'micro_usd') continue;
      expect(name.endsWith('MicroUsd'), `${name} names its unit`).toBe(true);
    }
    expect(OWNER_FIGURE_NAME_TOKENS.has('amount')).toBe(true);
    expect(OWNER_FIGURE_NAME_TOKENS.has('cost'), 'provider cost is a permitted feature').toBe(false);
  });
});

describe('layer 3 - the write path re-checks what the types state', () => {
  it('accepts a well-formed line and produces a stable serialization', () => {
    const record = buildRecord(
      draft({
        correlationRef: 'req-0a1b2c',
        fields: {
          tier: { kind: 'enum', value: 'T2' },
          modelIdServed: { kind: 'ref', value: 'vendor/model-a' },
          promptTokens: { kind: 'count', value: 480 },
          latencyMs: { kind: 'duration_ms', value: 912 },
          schemaValid: { kind: 'verdict', value: true },
          actualCostMicroUsd: { kind: 'micro_usd', value: 1370 },
        },
      }),
    );
    expect(Object.keys(record)).toEqual(expect.arrayContaining([...LOG_RECORD_KEYS]));
    expect(serializeRecord(record)).toBe(serializeRecord(record));
    expect(logLineBreaches(serializeRecord(record))).toEqual([]);
  });

  it('refuses a completion under a content-named field rather than dropping it (R19)', () => {
    for (const key of CONTENT_BEARING_KEYS) {
      const fields = { [key]: { kind: 'ref', value: A_COMPLETION } } as unknown as LogDraft['fields'];
      expect(codeOf(() => buildRecord(draft({ fields }))), `${key} must be refused`).toBe('LOG_FIELD_CONTENT_NAMED');
    }
  });

  it('refuses a field named for an owner figure, whatever its value', () => {
    for (const key of ['amountMilli', 'accountBalance', 'payeeRef', 'inflowMilli']) {
      const fields = { [key]: { kind: 'count', value: 1 } } as unknown as LogDraft['fields'];
      expect(codeOf(() => buildRecord(draft({ fields }))), `${key} must be refused`).toBe('LOG_FIELD_OWNER_FIGURE_NAMED');
      expect(isOwnerFigureNamed(key)).toBe(true);
    }
  });

  it('refuses an unrecognized field rather than dropping it, because dropping makes the next one a leak', () => {
    // Neither content-named nor money-named: it is refused purely for being undeclared, which is the
    // rule that keeps the next surplus field from being the one that leaks.
    const fields = { retryAttempts: { kind: 'count', value: 2 } } as unknown as LogDraft['fields'];
    expect(isContentNamed('retryAttempts')).toBe(false);
    expect(isOwnerFigureNamed('retryAttempts')).toBe(false);
    expect(codeOf(() => buildRecord(draft({ fields })))).toBe('LOG_FIELD_NOT_LOGGABLE');
  });

  it('refuses a content-named field even when the name reads as innocuous operational prose', () => {
    const fields = { operatorNoteRef: { kind: 'ref', value: 'x' } } as unknown as LogDraft['fields'];
    expect(codeOf(() => buildRecord(draft({ fields })))).toBe('LOG_FIELD_CONTENT_NAMED');
  });

  it('gives the correlation reference its own refusal, because it is the link and not a feature', () => {
    expect(codeOf(() => buildRecord(draft({ correlationRef: '   ' })))).toBe('LOG_CORRELATION_REF_INVALID');
    expect(codeOf(() => buildRecord(draft({ correlationRef: A_COMPLETION })))).toBe('LOG_CORRELATION_REF_INVALID');
    expect(codeOf(() => buildRecord(draft({ correlationRef: 42 as unknown as string })))).toBe('LOG_CORRELATION_REF_INVALID');
  });

  it('refuses a value whose kind is not the one its name declares', () => {
    const fields = { promptTokens: { kind: 'ref', value: '480' } } as unknown as LogDraft['fields'];
    expect(codeOf(() => buildRecord(draft({ fields })))).toBe('LOG_FIELD_KIND_WRONG');
  });

  it('refuses prose in a string feature, and in the correlation reference', () => {
    expect(codeOf(() => buildRecord(draft({ fields: { modelIdServed: { kind: 'ref', value: A_COMPLETION } } })))).toBe(
      'LOG_FIELD_VALUE_IS_PROSE',
    );
    expect(codeOf(() => buildRecord(draft({ fields: { tier: { kind: 'enum', value: 'T2\nT3' } } })))).toBe(
      'LOG_FIELD_VALUE_IS_PROSE',
    );
    expect(codeOf(() => buildRecord(draft({ fields: { tier: { kind: 'enum', value: 'x'.repeat(LOG_FIELD_MAX_LENGTH + 1) } } })))).toBe(
      'LOG_FIELD_VALUE_IS_PROSE',
    );
  });

  it('refuses a non-integer, negative, or absent measurement - no rounding at this boundary', () => {
    for (const value of [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const fields = { latencyMs: { kind: 'duration_ms', value } } as unknown as LogDraft['fields'];
      expect(codeOf(() => buildRecord(draft({ fields }))), `${String(value)} must be refused`).toBe('LOG_FIELD_VALUE_INVALID');
    }
    const wrong = { schemaValid: { kind: 'verdict', value: 'yes' } } as unknown as LogDraft['fields'];
    expect(codeOf(() => buildRecord(draft({ fields: wrong })))).toBe('LOG_FIELD_VALUE_INVALID');
  });

  it('refuses an unknown level, event, or agent, and a non-UTC instant', () => {
    expect(codeOf(() => buildRecord(draft({ level: 'trace' as never })))).toBe('LOG_LEVEL_UNKNOWN');
    expect(codeOf(() => buildRecord(draft({ event: 'prompt_logged' as never })))).toBe('LOG_EVENT_UNKNOWN');
    expect(codeOf(() => buildRecord(draft({ agent: 'admin' as never })))).toBe('LOG_AGENT_UNKNOWN');
    // The spend ledger's instant rule, reused: an offset is refused rather than assumed.
    expect(codeOf(() => buildRecord(draft({ at: '2026-08-06T09:15:00+02:00' })))).toBe('LOG_TIMESTAMP_MALFORMED');
    expect(codeOf(() => buildRecord(draft({ at: '' })))).toBe('LOG_TIMESTAMP_MALFORMED');
  });

  it('never quotes the refused value in its own error message (§6.4, R19)', () => {
    try {
      buildRecord(draft({ fields: { modelIdServed: { kind: 'ref', value: A_COMPLETION } } }));
      expect.unreachable('the prose value should have been refused');
    } catch (e) {
      const error = e as RedactedLogError;
      expect(error.message).not.toContain(A_COMPLETION);
      expect(JSON.stringify(error.detail)).not.toContain(A_COMPLETION);
      // What it does carry is the field name and a length: a measurement, never the measurement's subject.
      expect(error.detail.field).toBe('modelIdServed');
    }
    try {
      buildRecord(draft({ fields: { modelIdServed: { kind: 'ref', value: A_SECRET } } }));
      expect.unreachable('a secret-shaped value should have been refused as prose or invalid');
    } catch (e) {
      expect((e as RedactedLogError).message).not.toContain(A_SECRET);
    }
  });
});

describe('layer 4 - an independent derivation about the EMITTED LINE', () => {
  it('is independent of the write path, not a call back into it', () => {
    // The two would fail together otherwise, and the case worth catching is the one layer 3 never saw.
    const start = SOURCE.indexOf('// Layer 4 \u2014 the independent derivation about the EMITTED LINE');
    const end = SOURCE.indexOf('// The emitter');
    expect(start, 'the layer 4 section is still marked').toBeGreaterThan(0);
    expect(end, 'the emitter section is still marked').toBeGreaterThan(start);
    const layerFour = SOURCE.slice(start, end);
    for (const writeGuard of ['buildRecord(', 'checkedField(', 'requireFeatureString(', 'requireIntegerFeature(']) {
      expect(layerFour.includes(writeGuard), `layer 4 must not call ${writeGuard}`).toBe(false);
    }
    // It does re-derive from the exported constants, which is what makes it a second derivation about
    // the same rule rather than a second copy of the first derivation's code.
    expect(layerFour).toContain('LOGGABLE_FIELD_NAMES');
    expect(layerFour).toContain('LOG_FIELD_KINDS_BY_NAME');
    expect(layerFour).toContain('scanForParticulars(');
  });

  it('finds prose in a line the write path never saw', () => {
    // A line assembled by something other than this module - the case layer 3 cannot possibly catch.
    const smuggled = JSON.stringify({ at: AT, level: 'info', event: 'model_call_completed', agent: 'finance', correlationRef: null, fields: { tier: { kind: 'enum', value: A_COMPLETION } } });
    expect(claimsFor(smuggled)).toContain('no_free_text');
  });

  it('finds a content-named key nested inside an otherwise legal line', () => {
    const smuggled = JSON.stringify({
      at: AT,
      level: 'info',
      event: 'model_call_completed',
      agent: 'finance',
      correlationRef: null,
      fields: { completion: { kind: 'ref', value: 'ok' } },
    });
    expect(claimsFor(smuggled)).toContain('no_content_bearing_field');
  });

  it('finds a decimal figure anywhere in the line, because a decimal is the shape of an owner figure', () => {
    const smuggled = JSON.stringify({
      at: AT,
      level: 'info',
      event: 'model_call_completed',
      agent: 'finance',
      correlationRef: null,
      fields: { actualCostMicroUsd: { kind: 'micro_usd', value: 1370.5 } },
    });
    expect(claimsFor(smuggled)).toContain('no_owner_figure');
  });

  it('finds an owner-money-named key nested in the fields', () => {
    const smuggled = JSON.stringify({
      at: AT,
      level: 'info',
      event: 'model_call_completed',
      agent: 'finance',
      correlationRef: null,
      fields: { amountMilli: { kind: 'count', value: 1 } },
    });
    expect(claimsFor(smuggled)).toContain('no_owner_figure');
  });

  it('finds every deployment particular, by REUSING the one particular scan (R24)', () => {
    for (const particular of [URL_SHAPED, ADDRESS_SHAPED, HOSTNAME_SHAPED, LONG_DIGIT_RUN, CURRENCY_SHAPED]) {
      const smuggled = JSON.stringify({
        at: AT,
        level: 'info',
        event: 'model_call_completed',
        agent: 'finance',
        correlationRef: null,
        fields: { modelIdServed: { kind: 'ref', value: particular } },
      });
      expect(claimsFor(smuggled), `${particular} must be found`).toContain('no_deployment_particular');
    }
  });

  it('reports the scan CODE and never the offending token, because the detail would quote it', () => {
    const smuggled = JSON.stringify({
      at: AT,
      level: 'info',
      event: 'model_call_completed',
      agent: 'finance',
      correlationRef: null,
      fields: { modelIdServed: { kind: 'ref', value: HOSTNAME_SHAPED } },
    });
    for (const breach of logLineBreaches(smuggled)) {
      if (breach.claim !== 'no_deployment_particular') continue;
      expect(breach.at).not.toContain(HOSTNAME_SHAPED);
      expect(breach.at).toMatch(/^[A-Z_]+$/);
    }
  });

  it('finds a key beyond the record shape, and a key of the record shape that is missing', () => {
    const surplus = JSON.stringify({ at: AT, level: 'info', event: 'model_call_completed', agent: 'finance', correlationRef: null, fields: {}, host: 'x' });
    expect(claimsFor(surplus)).toContain('no_field_beyond_the_record_shape');
    const missing = JSON.stringify({ at: AT, level: 'info', event: 'model_call_completed', agent: 'finance' });
    expect(claimsFor(missing)).toContain('no_field_beyond_the_record_shape');
  });

  it('treats a line that is not an object, or not parseable at all, as breached', () => {
    expect(claimsFor('not json at all')).toEqual(['no_field_beyond_the_record_shape']);
    expect(claimsFor('"a bare string"')).toEqual(['no_field_beyond_the_record_shape']);
    expect(claimsFor('[]')).toEqual(['no_field_beyond_the_record_shape']);
  });

  it('every claim is reachable, so none is decoration', () => {
    const reached = new Set<string>();
    const lines = [
      'not json',
      JSON.stringify({ at: AT, level: 'info', event: 'model_call_completed', agent: 'finance', correlationRef: null, fields: { completion: { kind: 'ref', value: 'x' } } }),
      JSON.stringify({ at: AT, level: 'info', event: 'model_call_completed', agent: 'finance', correlationRef: null, fields: { balanceMilli: { kind: 'count', value: 1 } } }),
      JSON.stringify({ at: AT, level: 'info', event: 'model_call_completed', agent: 'finance', correlationRef: null, fields: { tier: { kind: 'enum', value: A_COMPLETION } } }),
      JSON.stringify({ at: AT, level: 'info', event: 'model_call_completed', agent: 'finance', correlationRef: null, fields: { modelIdServed: { kind: 'ref', value: ADDRESS_SHAPED } } }),
    ];
    for (const line of lines) for (const claim of claimsFor(line)) reached.add(claim);
    expect(LOG_LINE_CLAIMS.filter((c) => !reached.has(c))).toEqual([]);
  });

  it('emitLine throws rather than returning a breached line', () => {
    // Reached through a cast, which is exactly the layer-1 bypass layer 4 exists to catch: the field
    // name is declared and its kind is right, and the value carries a particular anyway.
    const evasive = draft({ fields: { modelIdServed: { kind: 'ref', value: HOSTNAME_SHAPED } } });
    expect(codeOf(() => emitLine(evasive))).toBe('LOG_LINE_BREACHED');
    try {
      emitLine(evasive);
      expect.unreachable('the breached line should not have been returned');
    } catch (e) {
      expect((e as RedactedLogError).message).not.toContain(HOSTNAME_SHAPED);
    }
  });
});

describe('the logger surface offers no way to write arbitrary text', () => {
  it('writes a checked line to its sink and returns the same text', () => {
    const written: string[] = [];
    const logger = createRedactedLogger('finance', (line) => written.push(line), () => AT);
    const line = logger.log('info', 'readiness_probed', {
      component: { kind: 'enum', value: 'store_opens' },
      verdict: { kind: 'enum', value: 'pass' },
      schemaVersion: { kind: 'count', value: 7 },
    });
    expect(written).toEqual([line]);
    expect(logLineBreaches(line)).toEqual([]);
    expect(JSON.parse(line)).toMatchObject({ agent: 'finance', event: 'readiness_probed', level: 'info' });
  });

  it('writes NOTHING when a line is refused, at either layer', () => {
    const written: string[] = [];
    const logger = createRedactedLogger('finance', (line) => written.push(line), () => AT);
    const bad = { completion: { kind: 'ref', value: A_COMPLETION } } as unknown as Record<string, LogFieldValue>;
    expect(() => logger.log('error', 'model_call_refused', bad)).toThrow(RedactedLogError);
    expect(() => logger.log('info', 'model_call_completed', { modelIdServed: { kind: 'ref', value: URL_SHAPED } })).toThrow(
      RedactedLogError,
    );
    expect(written).toEqual([]);
  });

  it('reads no ambient clock: the instant is supplied by the caller', () => {
    expect(SOURCE.includes('new Date('), 'no ambient clock in this module').toBe(false);
    expect(SOURCE.includes('Date.now('), 'no ambient clock in this module').toBe(false);
  });

  it('holds no sink, no path, and no stream of its own', () => {
    for (const banned of ['console.', 'process.stdout', 'writeFileSync', 'appendFileSync', 'createWriteStream']) {
      expect(SOURCE.includes(banned), `no ${banned}`).toBe(false);
    }
  });

  it('imports no arithmetic, so no figure can be derived here', () => {
    // A mention in prose is documentation; an import is a capability. Only the second is banned.
    expect(/from\s+['"][^'"]*lib\/money/.test(SOURCE), 'the logger imports no money arithmetic').toBe(false);
  });

  it('declares a level for every severity a service needs, and an event set that is reviewable', () => {
    expect([...LOG_LEVELS]).toEqual(['debug', 'info', 'warn', 'error']);
    expect(LOG_EVENTS.length).toBeGreaterThan(0);
    // Not one event names content, so "what gets logged" cannot be content by name either.
    for (const event of LOG_EVENTS) expect(isContentNamed(event), `${event} is not content-named`).toBe(false);
  });

  it('every error code is reachable, so none is decoration', () => {
    const reached = new Set<string>([
      codeOf(() => buildRecord(draft({ at: 'yesterday' }))),
      codeOf(() => buildRecord(draft({ level: 'trace' as never }))),
      codeOf(() => buildRecord(draft({ event: 'x' as never }))),
      codeOf(() => buildRecord(draft({ agent: 'x' as never }))),
      codeOf(() => buildRecord(draft({ correlationRef: '  ' }))),
      codeOf(() => buildRecord(draft({ fields: { retryAttempts: { kind: 'count', value: 1 } } as unknown as LogDraft['fields'] }))),
      codeOf(() => buildRecord(draft({ fields: { completion: { kind: 'ref', value: 'x' } } as unknown as LogDraft['fields'] }))),
      codeOf(() => buildRecord(draft({ fields: { amountMilli: { kind: 'count', value: 1 } } as unknown as LogDraft['fields'] }))),
      codeOf(() => buildRecord(draft({ fields: { promptTokens: { kind: 'ref', value: 'x' } } as unknown as LogDraft['fields'] }))),
      codeOf(() => buildRecord(draft({ fields: { promptTokens: { kind: 'count', value: -1 } } }))),
      codeOf(() => buildRecord(draft({ fields: { tier: { kind: 'enum', value: A_COMPLETION } } }))),
      codeOf(() => emitLine(draft({ fields: { modelIdServed: { kind: 'ref', value: HOSTNAME_SHAPED } } }))),
    ]);
    expect(LOG_ERROR_CODES.filter((c) => !reached.has(c))).toEqual([]);
  });

  it('the prose heuristic is decisive on the things that distinguish a value from a narrative', () => {
    expect(looksLikeProse('vendor/model-a')).toBe(false);
    expect(looksLikeProse('T2')).toBe(false);
    expect(looksLikeProse(AT)).toBe(false);
    expect(looksLikeProse(A_COMPLETION)).toBe(true);
    expect(looksLikeProse('a\nb')).toBe(true);
    expect(looksLikeProse('x'.repeat(LOG_FIELD_MAX_LENGTH + 1))).toBe(true);
  });
});
