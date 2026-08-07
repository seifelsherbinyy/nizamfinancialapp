// @vitest-environment node
/**
 * NIZAM · The vendored schema and this agent's mirror must not drift
 * Implemented by: PFOS Contract 12 / Phase 3.1 (spec 06-two-agent-vps)
 * Owning requirements: R7 (envelope validation), R10 (exclusion)
 * Depends on: nizam-signalbus.envelope.schema.json (read from disk), ./envelopeSchema,
 *   ../ports/signalBus (vocabulary)
 *
 * The two agents share the JSON document and nothing else (steering §1). The finance agent's
 * validator works from `envelopeSchema.ts`. So there are two statements of the same rules in two
 * languages, and the failure mode worth guarding is that one of them changes and the other does
 * not — which would let this agent accept an envelope the Python agent rejects, or the reverse.
 *
 * This reads the document as TEXT and compares it against the vocabulary, rather than importing
 * it as a module, for two reasons: the document is a language-neutral artifact and should not
 * become a TypeScript dependency, and reading it from disk is what proves the file that ships is
 * the file that was checked.
 *
 * The scan FAILS CLOSED. A missing document, an unparseable one, an object level with no closing
 * keyword, or a `$defs` entry the walk did not reach are all failures — a parity test that passes
 * vacuously is worse than none.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CONSENT_SCOPES,
  SIGNAL_DIRECTIONS,
  SIGNAL_KINDS,
  SIGNAL_LEVELS,
  SIGNAL_NOTE_MAX_LENGTH,
  SIGNAL_PRODUCERS,
  SIGNAL_TIERS,
} from '../ports/signalBus';
import {
  DRAFT_ENVELOPE_KEYS,
  ENVELOPE_WIRE_NAMES,
  PERMITTED_PAYLOAD_KEYS,
  SIGNAL_ENVELOPE_SCHEMA_FILE,
  SIGNAL_ENVELOPE_SCHEMA_ID,
  SIGNAL_ID_MAX_LENGTH,
  STORED_ENVELOPE_KEYS,
} from './envelopeSchema';

const SCHEMA_PATH = fileURLToPath(new URL(`./${SIGNAL_ENVELOPE_SCHEMA_FILE}`, import.meta.url));
const RAW = readFileSync(SCHEMA_PATH, 'utf8');
const DOCUMENT = JSON.parse(RAW) as Record<string, unknown>;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('the vendored schema has a node that is not an object where one is required');
  }
  return value as Record<string, unknown>;
}

const DEFS = record(DOCUMENT.$defs);
const PAYLOAD = record(DEFS.payload);
const ENVELOPE_FIELDS = record(DEFS.envelopeFields);
const DRAFT = record(DEFS.draftEnvelope);
const STORED = record(DEFS.storedEnvelope);

/** Every object-typed subschema in the document, by JSON-pointer-ish path. */
function objectLevels(node: unknown, path: string, found: [string, Record<string, unknown>][]): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => objectLevels(item, `${path}/${i}`, found));
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const asRecord = node as Record<string, unknown>;
  const looksLikeAnObjectLevel =
    asRecord.type === 'object' || asRecord.properties !== undefined || asRecord.unevaluatedProperties !== undefined;
  if (looksLikeAnObjectLevel) found.push([path, asRecord]);
  for (const [key, value] of Object.entries(asRecord)) {
    if (key === '$comment' || key === 'required' || key === 'enum') continue;
    objectLevels(value, `${path}/${key}`, found);
  }
}

describe('the vendored envelope schema is a closed document (§4.3.5)', () => {
  it('parses, and declares the identifier this agent expects', () => {
    expect(DOCUMENT.$id).toBe(SIGNAL_ENVELOPE_SCHEMA_ID);
    expect(DOCUMENT.$ref).toBe('#/$defs/storedEnvelope');
    expect(Object.keys(DEFS).sort()).toEqual(['draftEnvelope', 'envelopeFields', 'payload', 'storedEnvelope']);
  });

  it('holds no absolute URI, because the repository is public (steering §0b, R24)', () => {
    // Assembled from fragments so this test never holds a contiguous copy of what it forbids.
    expect(RAW).not.toMatch(new RegExp('ht' + 'tps?:' + '\\/\\/'));
    expect(RAW).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
  });

  it('closes every object level, so no unrecognized field is merely ignored', () => {
    const levels: [string, Record<string, unknown>][] = [];
    objectLevels(DOCUMENT, '#', levels);
    // The walk must reach the payload and both envelope forms, or the assertion below is vacuous.
    const paths = levels.map(([path]) => path);
    expect(paths).toContain('#/$defs/payload');
    expect(paths).toContain('#/$defs/draftEnvelope');
    expect(paths).toContain('#/$defs/storedEnvelope');

    const open = levels.filter(([, level]) => {
      // `envelopeFields` is a fragment composed into both forms; those forms close it with
      // unevaluatedProperties, which is the composable spelling of additionalProperties false.
      const closed = level.additionalProperties === false || level.unevaluatedProperties === false;
      const isComposedFragment = level === ENVELOPE_FIELDS;
      return !closed && !isComposedFragment;
    });
    expect(open.map(([path]) => path)).toEqual([]);
  });

  it('composes the shared fields into both forms, so the two cannot disagree', () => {
    expect(DRAFT.allOf).toEqual([{ $ref: '#/$defs/envelopeFields' }]);
    expect(STORED.allOf).toEqual([{ $ref: '#/$defs/envelopeFields' }]);
    expect(record(ENVELOPE_FIELDS.properties).payload).toEqual({ $ref: '#/$defs/payload' });
  });
});

describe('the schema and this agent state the same envelope (no second shape)', () => {
  const wireNames = Object.values(ENVELOPE_WIRE_NAMES);
  const envelopeProperties = Object.keys(record(ENVELOPE_FIELDS.properties));

  it('maps every TypeScript key to a wire name, in both directions', () => {
    expect(Object.keys(ENVELOPE_WIRE_NAMES).sort()).toEqual([...STORED_ENVELOPE_KEYS].sort());
    expect(new Set(wireNames).size).toBe(wireNames.length);
    // The seven shared fields live in the fragment; `hash` belongs to the stored form only.
    expect(envelopeProperties.sort()).toEqual([...DRAFT_ENVELOPE_KEYS].map((k) => ENVELOPE_WIRE_NAMES[k]).sort());
    expect(Object.keys(record(STORED.properties))).toEqual(['hash']);
    expect(DRAFT.properties).toBeUndefined();
  });

  it('requires the same fields the draft and stored forms require', () => {
    expect(DRAFT.required).toEqual([...DRAFT_ENVELOPE_KEYS].map((k) => ENVELOPE_WIRE_NAMES[k]));
    expect(STORED.required).toEqual([...STORED_ENVELOPE_KEYS].map((k) => ENVELOPE_WIRE_NAMES[k]));
  });

  it('permits exactly the three payload fields, and requires the level', () => {
    expect(Object.keys(record(PAYLOAD.properties))).toEqual([...PERMITTED_PAYLOAD_KEYS]);
    expect(PAYLOAD.required).toEqual(['level']);
  });
});

describe('the schema and this agent state the same vocabulary (one enum set)', () => {
  const properties = record(ENVELOPE_FIELDS.properties);
  const payloadProperties = record(PAYLOAD.properties);

  it('agrees on every enumerated field', () => {
    expect(record(properties.producer).enum).toEqual([...SIGNAL_PRODUCERS]);
    expect(record(properties.kind).enum).toEqual([...SIGNAL_KINDS]);
    expect(record(properties.tier).enum).toEqual([...SIGNAL_TIERS]);
    expect(record(properties.consent_scope).enum).toEqual([...CONSENT_SCOPES]);
    expect(record(payloadProperties.level).enum).toEqual([...SIGNAL_LEVELS]);
    expect(record(payloadProperties.direction).enum).toEqual([...SIGNAL_DIRECTIONS]);
  });

  it('caps the note at the one cap, so there is no second cap to drift (§4.3.4)', () => {
    const note = record(payloadProperties.note);
    expect(note.type).toBe('string');
    expect(note.maxLength).toBe(SIGNAL_NOTE_MAX_LENGTH);
    // No minimum: an empty note is a valid absent-of-direction note, and a cap is not a floor.
    expect(note.minLength).toBeUndefined();
  });

  it('bounds the identifier at the one bound', () => {
    expect(record(properties.signal_id).maxLength).toBe(SIGNAL_ID_MAX_LENGTH);
    expect(record(properties.signal_id).minLength).toBe(1);
  });

  it('excludes the classification whose egress set is empty (R10, T15)', () => {
    const excluded = 'strict_' + 'local_' + 'maximum';
    expect(record(properties.tier).enum).not.toContain(excluded);
    expect(RAW).not.toContain(excluded);
  });
});

describe('the schema has no field that could carry a figure, a date, or an identifier (§4.3.1-§4.3.3)', () => {
  const payloadProperties = record(PAYLOAD.properties);

  it('types no payload field as a number or an integer', () => {
    for (const [name, subschema] of Object.entries(payloadProperties)) {
      const type = record(subschema).type;
      expect(type, `payload.${name}`).not.toBe('number');
      expect(type, `payload.${name}`).not.toBe('integer');
    }
  });

  it('has exactly one temporal field in the whole envelope, and it is the envelope\u2019s own', () => {
    const properties = record(ENVELOPE_FIELDS.properties);
    const dateShaped = Object.entries(properties).filter(([, subschema]) => {
      const pattern = record(subschema).pattern;
      return typeof pattern === 'string' && pattern.includes('T');
    });
    expect(dateShaped.map(([name]) => name)).toEqual(['ts']);
    expect(Object.keys(payloadProperties)).not.toContain('ts');
  });

  it('names no identifier field in the payload', () => {
    // `signal_id` is the producer's own envelope identifier and is not payload content.
    for (const name of Object.keys(payloadProperties)) {
      expect(name).not.toMatch(/id$|ref$|account|transaction|document|file|folder/i);
    }
  });
});
