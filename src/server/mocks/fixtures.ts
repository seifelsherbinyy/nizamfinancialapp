/**
 * NIZAM · Recorded-fixture loader — replay a real-shaped exchange with no network
 * Implemented by: PFOS Contract 12 / Phase 2.2 (spec 06-two-agent-vps)
 * Owning requirements: R24 (no deployment particular in a tracked file); steering §3
 *   (a fixture-backed run marks the registry provisional)
 * Depends on: ../ports/* (type level only), node:fs and node:url in ONE factory
 *
 * Steering §3 gives fixtures a job: when the dev key is absent or exhausted, the harness runs
 * against recorded fixtures instead of the provider. That is the difference between a tier
 * that can be exercised offline and one that cannot, so the fixture has to be a first-class,
 * validated artifact rather than an object literal somebody pasted into a test.
 *
 * Three properties, each a type rather than a convention:
 *
 *  1. **The loader performs no I/O.** {@link loadRecordedInteractions} takes a
 *     {@link FixtureSource} and a name. It reads no file, resolves no path, and consults no
 *     environment. {@link nodeFixtureSource} is the one place in this directory that touches
 *     a filesystem, and a caller has to hand it in on purpose. That is what "no filesystem
 *     beyond an explicitly injected fixture source" means mechanically.
 *  2. **A fixture-backed run is provisional.** {@link LoadedFixture.provisional} is the
 *     literal `true`, the same single-member-literal technique the port tier uses for
 *     `plaintextShredded`. There is no value meaning "fixture-backed but authoritative", so
 *     steering §3's rule — a provisional registry may never promote a model for live routing —
 *     cannot be lost by an assignment.
 *  3. **A fixture that is not synthetic will not load.** `synthetic` is the literal `true`,
 *     and before anything is parsed the raw text is scanned for a deployment particular. The
 *     scan FAILS CLOSED: an unrecognised shape is refused, never loaded with a warning. The
 *     repository is public (steering §0b), so a fixture is exactly the file where anonymized
 *     real data would look harmless and would not be. Task 9.0 adds the same scan at the
 *     gate; this one runs at load time so a bad fixture never reaches a test at all.
 *
 * A fixture carries no `note` on a signal payload. `SignalNote` is branded and Phase 3 owns
 * the only mint (`ports/signalBus.ts`), so minting one here would take a decision that is not
 * this phase's to take.
 *
 * Money note: `costMicroUsd` is provider accounting in integer micro-USD (contract 06 §6.1),
 * which is a different unit from the owner's ledger and never routes through `src/lib/money`.
 * No arithmetic on it happens in this file.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { SNAPSHOT_ENCRYPTION_SCHEMES, type EncryptedSnapshotArtifact, type SnapshotEncryptionScheme } from '../ports/drive';
import { WHOOP_RECOVERY_BANDS, type WhoopRecoveryBand, type WhoopRecoveryState } from '../ports/whoop';
import {
  CONSENT_SCOPES,
  SIGNAL_DIRECTIONS,
  SIGNAL_KINDS,
  SIGNAL_LEVELS,
  SIGNAL_PRODUCERS,
  SIGNAL_TIERS,
  type ConsentScope,
  type SignalDirection,
  type SignalKind,
  type SignalLevel,
  type SignalProducer,
  type SignalDraft,
  type SignalPayload,
  type SignalTier,
} from '../ports/signalBus';
import type { TelegramDelivery } from '../ports/telegram';
import type { RecordedModelExchange } from './openrouterMock';

// One definition of a recorded exchange, re-exported so a fixture document and a replay agree.
export type { RecordedModelExchange };

/** Why a fixture was refused. A caller discriminates on this, never on the message. */
export const FIXTURE_ERROR_CODES = [
  'FIXTURE_NOT_FOUND',
  'FIXTURE_NOT_JSON',
  'FIXTURE_VERSION_UNSUPPORTED',
  'FIXTURE_NOT_MARKED_SYNTHETIC',
  'FIXTURE_SHAPE_INVALID',
  'FIXTURE_DEPLOYMENT_PARTICULAR',
] as const;
export type FixtureErrorCode = (typeof FIXTURE_ERROR_CODES)[number];

/** A refused fixture. Carries the fixture name and the offending field, never file contents. */
export class FixtureError extends Error {
  readonly code: FixtureErrorCode;
  readonly fixtureName: string;
  /** The offending field or pattern label. Never the value, which may be the thing we forbid. */
  readonly at: string | null;

  constructor(code: FixtureErrorCode, message: string, detail: { fixtureName: string; at?: string | null }) {
    super(message);
    this.name = 'FixtureError';
    this.code = code;
    this.fixtureName = detail.fixtureName;
    this.at = detail.at ?? null;
  }
}

/**
 * Where fixture text comes from. Injected, so the loader itself is pure.
 * `null` means "no such fixture", which the loader turns into `FIXTURE_NOT_FOUND`.
 */
export interface FixtureSource {
  read(name: string): string | null;
}

/** The version of the fixture document this phase understands. */
export const FIXTURE_VERSION = 1;

/** A recorded snapshot. Ciphertext travels as hex because a fixture is a text document. */
export interface RecordedSnapshot {
  readonly storeName: string;
  readonly capturedAt: string;
  readonly scheme: SnapshotEncryptionScheme;
  readonly recipientPublicKeyRef: string;
  readonly ciphertextHex: string;
  readonly sizeBytes: number;
  readonly digestHex: string;
}

/** A recorded signal draft. No `note`: the brand's only mint is Phase 3's validator. */
export interface RecordedSignal {
  readonly signalId: string;
  readonly ts: string;
  readonly producer: SignalProducer;
  readonly kind: SignalKind;
  readonly tier: SignalTier;
  readonly consentScope: ConsentScope;
  readonly payload: { readonly level: SignalLevel; readonly direction?: SignalDirection };
}

/** A whole recorded interaction set — one document, five boundaries. */
export interface RecordedInteractionSet {
  readonly fixtureVersion: typeof FIXTURE_VERSION;
  /** Literal `true`. A fixture that is not synthetic is not expressible (steering §0b). */
  readonly synthetic: true;
  readonly name: string;
  readonly telegramDeliveries: readonly TelegramDelivery[];
  readonly modelExchanges: readonly RecordedModelExchange[];
  readonly recoveryObservations: readonly WhoopRecoveryState[];
  readonly snapshots: readonly RecordedSnapshot[];
  readonly signals: readonly RecordedSignal[];
}

/**
 * A loaded fixture. `provisional` is the literal `true` — see the module note: steering §3
 * ties fixture-backed replay to a provisional registry, and this is that tie as a type.
 */
export interface LoadedFixture {
  readonly set: RecordedInteractionSet;
  readonly provisional: true;
}

/**
 * Patterns that mean "this text reveals how to reach or impersonate the running system"
 * (steering §0b, R24). Assembled from fragments, the technique the acceptance harness uses,
 * so this module never holds a contiguous copy of what it forbids and never matches itself.
 */
const DEPLOYMENT_PARTICULARS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'an endpoint', pattern: new RegExp('ht' + 'tps?:' + '\\/\\/') },
  { label: 'a host address', pattern: /\b\d{1,3}(?:\.\d{1,3}){3}\b/ },
  {
    label: 'a bare domain',
    pattern: new RegExp('\\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.(?:c' + 'om|n' + 'et|o' + 'rg|d' + 'ev|i' + 'o|a' + 'pp|c' + 'o|m' + 'e|x' + 'yz|cl' + 'oud)\\b', 'i'),
  },
  { label: 'a long numeric identifier', pattern: /\b\d{7,}\b/ },
  { label: 'a two-decimal monetary figure', pattern: /\b\d+\.\d{2}\b/ },
  { label: 'a recipient key literal', pattern: new RegExp('\\ba' + 'ge1[0-9a-z]{20,}') },
  { label: 'a provider key literal', pattern: new RegExp('\\bs' + 'k-[A-Za-z0-9]{20,}') },
  { label: 'a storage identifier field', pattern: /"[A-Za-z_]*(?:file|folder|drive)_?[Ii]d"\s*:/ },
];

/** Fail closed: any match refuses the whole fixture. */
function refuseDeploymentParticular(name: string, raw: string): void {
  for (const particular of DEPLOYMENT_PARTICULARS) {
    if (particular.pattern.test(raw)) {
      throw new FixtureError(
        'FIXTURE_DEPLOYMENT_PARTICULAR',
        `NIZAM fixture "${name}" contains ${particular.label}; fixtures are synthetic and hold no deployment particular`,
        { fixtureName: name, at: particular.label },
      );
    }
  }
}

function fail(name: string, at: string, what: string): never {
  throw new FixtureError('FIXTURE_SHAPE_INVALID', `NIZAM fixture "${name}": ${at} ${what}`, {
    fixtureName: name,
    at,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(name: string, at: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) fail(name, at, 'must be a non-empty string');
  return value;
}

function requireInteger(name: string, at: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(name, at, 'must be a safe integer');
  return value;
}

function requireBoolean(name: string, at: string, value: unknown): boolean {
  if (typeof value !== 'boolean') fail(name, at, 'must be a boolean');
  return value;
}

function requireMember<T extends string>(name: string, at: string, value: unknown, members: readonly T[]): T {
  if (typeof value !== 'string' || !(members as readonly string[]).includes(value)) {
    fail(name, at, `must be one of ${members.join(', ')}`);
  }
  return value as T;
}

function requireArray(name: string, at: string, value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) fail(name, at, 'must be an array');
  return value;
}

const HEX_ONLY = /^[0-9a-f]*$/;

function requireHex(name: string, at: string, value: unknown, evenLength: boolean): string {
  const text = typeof value === 'string' ? value : fail(name, at, 'must be a lowercase hex string');
  if (!HEX_ONLY.test(text)) fail(name, at, 'must be a lowercase hex string');
  if (evenLength && text.length % 2 !== 0) fail(name, at, 'must have an even number of hex digits');
  return text;
}

function readDelivery(name: string, index: number, raw: unknown): TelegramDelivery {
  const at = `telegramDeliveries[${index}]`;
  if (!isRecord(raw)) fail(name, at, 'must be an object');
  const header = raw.secretTokenHeader;
  if (header !== null && typeof header !== 'string') fail(name, `${at}.secretTokenHeader`, 'must be a string or null');
  return {
    botId: requireString(name, `${at}.botId`, raw.botId),
    updateId: requireInteger(name, `${at}.updateId`, raw.updateId),
    senderId: requireString(name, `${at}.senderId`, raw.senderId),
    secretTokenHeader: header,
    receivedAt: requireString(name, `${at}.receivedAt`, raw.receivedAt),
    // Untrusted data, carried verbatim. A delivery body is never an instruction (§6.4).
    rawBody: typeof raw.rawBody === 'string' ? raw.rawBody : fail(name, `${at}.rawBody`, 'must be a string'),
  };
}

function readExchange(name: string, index: number, raw: unknown): RecordedModelExchange {
  const at = `modelExchanges[${index}]`;
  if (!isRecord(raw)) fail(name, at, 'must be an object');
  const parsed = raw.parsed;
  if (parsed !== null && !isRecord(parsed)) fail(name, `${at}.parsed`, 'must be an object or null');
  return {
    correlationRef: requireString(name, `${at}.correlationRef`, raw.correlationRef),
    modelIdServed: requireString(name, `${at}.modelIdServed`, raw.modelIdServed),
    text: typeof raw.text === 'string' ? raw.text : fail(name, `${at}.text`, 'must be a string'),
    parsed,
    schemaValid: requireBoolean(name, `${at}.schemaValid`, raw.schemaValid),
    promptTokens: requireInteger(name, `${at}.promptTokens`, raw.promptTokens),
    cachedTokens: requireInteger(name, `${at}.cachedTokens`, raw.cachedTokens),
    completionTokens: requireInteger(name, `${at}.completionTokens`, raw.completionTokens),
    reasoningTokens: requireInteger(name, `${at}.reasoningTokens`, raw.reasoningTokens),
    costMicroUsd: requireInteger(name, `${at}.costMicroUsd`, raw.costMicroUsd),
    latencyMs: requireInteger(name, `${at}.latencyMs`, raw.latencyMs),
  };
}

function readObservation(name: string, index: number, raw: unknown): WhoopRecoveryState {
  const at = `recoveryObservations[${index}]`;
  if (!isRecord(raw)) fail(name, at, 'must be an object');
  const band: WhoopRecoveryBand = requireMember(name, `${at}.band`, raw.band, WHOOP_RECOVERY_BANDS);
  const observedAt = requireString(name, `${at}.observedAt`, raw.observedAt);
  if (raw.trend === undefined) return { observedAt, band };
  return {
    observedAt,
    band,
    trend: requireMember(name, `${at}.trend`, raw.trend, SIGNAL_DIRECTIONS),
  };
}

function readSnapshot(name: string, index: number, raw: unknown): RecordedSnapshot {
  const at = `snapshots[${index}]`;
  if (!isRecord(raw)) fail(name, at, 'must be an object');
  const ciphertextHex = requireHex(name, `${at}.ciphertextHex`, raw.ciphertextHex, true);
  const sizeBytes = requireInteger(name, `${at}.sizeBytes`, raw.sizeBytes);
  if (sizeBytes * 2 !== ciphertextHex.length) {
    fail(name, `${at}.sizeBytes`, 'must agree with the length of the recorded ciphertext');
  }
  return {
    storeName: requireString(name, `${at}.storeName`, raw.storeName),
    capturedAt: requireString(name, `${at}.capturedAt`, raw.capturedAt),
    scheme: requireMember(name, `${at}.scheme`, raw.scheme, SNAPSHOT_ENCRYPTION_SCHEMES),
    recipientPublicKeyRef: requireString(name, `${at}.recipientPublicKeyRef`, raw.recipientPublicKeyRef),
    ciphertextHex,
    sizeBytes,
    digestHex: requireHex(name, `${at}.digestHex`, raw.digestHex, false),
  };
}

function readSignal(name: string, index: number, raw: unknown): RecordedSignal {
  const at = `signals[${index}]`;
  if (!isRecord(raw)) fail(name, at, 'must be an object');
  const payloadRaw = raw.payload;
  if (!isRecord(payloadRaw)) fail(name, `${at}.payload`, 'must be an object');
  const permitted = new Set(['level', 'direction']);
  for (const key of Object.keys(payloadRaw)) {
    // §4.3.5 at the fixture boundary: a surplus payload key is refused, not dropped, because
    // dropping it would load a fixture that silently differs from the one on disk.
    if (!permitted.has(key)) fail(name, `${at}.payload.${key}`, 'is not a permitted payload field');
  }
  const level: SignalLevel = requireMember(name, `${at}.payload.level`, payloadRaw.level, SIGNAL_LEVELS);
  const payload =
    payloadRaw.direction === undefined
      ? { level }
      : { level, direction: requireMember(name, `${at}.payload.direction`, payloadRaw.direction, SIGNAL_DIRECTIONS) };
  return {
    signalId: requireString(name, `${at}.signalId`, raw.signalId),
    ts: requireString(name, `${at}.ts`, raw.ts),
    producer: requireMember(name, `${at}.producer`, raw.producer, SIGNAL_PRODUCERS),
    kind: requireMember(name, `${at}.kind`, raw.kind, SIGNAL_KINDS),
    tier: requireMember(name, `${at}.tier`, raw.tier, SIGNAL_TIERS),
    consentScope: requireMember(name, `${at}.consentScope`, raw.consentScope, CONSENT_SCOPES),
    payload,
  };
}

/**
 * Load one recorded interaction set. Pure with respect to the world: the only input is the
 * text the injected source returns.
 *
 * The order of checks is deliberate. The deployment-particular scan runs on the RAW TEXT
 * before parsing, so a fixture carrying a real host is refused even if its shape is wrong in
 * some other way and would have been rejected anyway — the more serious refusal is the one a
 * reader should see.
 */
export function loadRecordedInteractions(source: FixtureSource, name: string): LoadedFixture {
  const raw = source.read(name);
  if (raw === null) {
    throw new FixtureError('FIXTURE_NOT_FOUND', `NIZAM fixture "${name}" was not found in the supplied source`, {
      fixtureName: name,
    });
  }

  refuseDeploymentParticular(name, raw);

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (cause) {
    throw new FixtureError('FIXTURE_NOT_JSON', `NIZAM fixture "${name}" is not parseable JSON`, {
      fixtureName: name,
      at: String((cause as Error).message),
    });
  }

  if (!isRecord(document)) fail(name, 'document', 'must be an object');

  if (document.fixtureVersion !== FIXTURE_VERSION) {
    throw new FixtureError(
      'FIXTURE_VERSION_UNSUPPORTED',
      `NIZAM fixture "${name}" declares version ${String(document.fixtureVersion)}; this phase reads ${FIXTURE_VERSION}`,
      { fixtureName: name, at: 'fixtureVersion' },
    );
  }

  if (document.synthetic !== true) {
    throw new FixtureError(
      'FIXTURE_NOT_MARKED_SYNTHETIC',
      `NIZAM fixture "${name}" is not marked synthetic; the repository is public and a fixture is constructed for the test, never derived from real data`,
      { fixtureName: name, at: 'synthetic' },
    );
  }

  const set: RecordedInteractionSet = {
    fixtureVersion: FIXTURE_VERSION,
    synthetic: true,
    name: requireString(name, 'name', document.name),
    telegramDeliveries: requireArray(name, 'telegramDeliveries', document.telegramDeliveries).map((entry, i) =>
      readDelivery(name, i, entry),
    ),
    modelExchanges: requireArray(name, 'modelExchanges', document.modelExchanges).map((entry, i) =>
      readExchange(name, i, entry),
    ),
    recoveryObservations: requireArray(name, 'recoveryObservations', document.recoveryObservations).map((entry, i) =>
      readObservation(name, i, entry),
    ),
    snapshots: requireArray(name, 'snapshots', document.snapshots).map((entry, i) => readSnapshot(name, i, entry)),
    signals: requireArray(name, 'signals', document.signals).map((entry, i) => readSignal(name, i, entry)),
  };

  return { set, provisional: true };
}

/** Bytes from a lowercase hex string. Integer arithmetic only; no float anywhere near it. */
export function bytesFromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Turn a recorded snapshot into the only thing {@link import('../ports/drive').DrivePort} will
 * upload. Every literal field of the artifact is fixed here because the type fixes it: a
 * fixture cannot describe an unshredded plaintext, a host-resident private key, a file copy,
 * or a payload containing secrets.
 */
export function snapshotArtifactFrom(recorded: RecordedSnapshot): EncryptedSnapshotArtifact {
  return {
    storeName: recorded.storeName,
    capturedAt: recorded.capturedAt,
    source: 'engine_snapshot',
    encryption: {
      scheme: recorded.scheme,
      recipientPublicKeyRef: recorded.recipientPublicKeyRef,
      privateKeyPresentOnHost: false,
    },
    ciphertext: bytesFromHex(recorded.ciphertextHex),
    sizeBytes: recorded.sizeBytes,
    digest: { algorithm: 'sha256', hex: recorded.digestHex },
    plaintextShredded: true,
    containsSecrets: false,
  };
}

/**
 * Turn a recorded signal into a draft the bus will accept. The payload is rebuilt field by field
 * rather than spread, so a key that somehow survived validation still cannot reach the envelope.
 * There is no `note`: the brand's only mint is Phase 3's validator, so a fixture cannot forge one.
 */
export function signalDraftFrom(recorded: RecordedSignal): SignalDraft {
  const payload: SignalPayload =
    recorded.payload.direction === undefined
      ? { level: recorded.payload.level }
      : { level: recorded.payload.level, direction: recorded.payload.direction };
  return {
    signalId: recorded.signalId,
    ts: recorded.ts,
    producer: recorded.producer,
    kind: recorded.kind,
    tier: recorded.tier,
    consentScope: recorded.consentScope,
    payload,
  };
}

/** An in-memory source. The default for a unit test: no path, no disk, nothing to clean up. */
export function inlineFixtureSource(entries: Readonly<Record<string, string>>): FixtureSource {
  return {
    read(name) {
      return Object.prototype.hasOwnProperty.call(entries, name) ? (entries[name] as string) : null;
    },
  };
}

/** The directory this phase keeps its fixture documents in, beside this module. */
export const FIXTURE_DIRECTORY = fileURLToPath(new URL('./fixtures/', import.meta.url));

/**
 * The one filesystem-touching source in this directory. A caller has to construct it
 * explicitly, which is exactly the "explicitly injected fixture source" the phase permits —
 * nothing here is reached by default, and {@link loadRecordedInteractions} never calls it.
 */
export function nodeFixtureSource(directory: string = FIXTURE_DIRECTORY): FixtureSource {
  return {
    read(name) {
      try {
        return readFileSync(join(directory, `${name}.json`), 'utf8');
      } catch {
        return null;
      }
    },
  };
}
