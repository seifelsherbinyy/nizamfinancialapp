/**
 * NIZAM · Invocation recorder — how a test asserts that a call did NOT happen
 * Implemented by: PFOS Contract 12 / Phase 2.2 (spec 06-two-agent-vps)
 * Owning requirements: R16 (the deterministic tier invokes no model), and the recording
 *   half of every negative test in Phases 3/4/5
 * Depends on: ../ports/shapeGuards (type level only)
 *
 * Contract 12 §6.1 states the acceptance shape directly: "the test asserts against a port
 * mock that records invocations, then asserts the record is empty." An absence is only
 * observable if something was watching, so every mock in this directory writes to one of
 * these and nothing else. `isEmpty` and `callsTo` exist so that the empty case is the
 * shortest thing to write, not the longest.
 *
 * Determinism (design key decision 1): `seq` is a counter that starts at one. There is no
 * clock read, no random source, and no wall-time field, so two runs of the same script
 * produce byte-identical records and a test may compare the whole log rather than probing
 * it field by field.
 *
 * Why `detail` is scalars only, and why the content keys are typed away
 *   §6.4 (owning requirement R19) forbids prompt or completion text in anything written
 *   down. A recorder whose detail were `unknown` would invite a caller to record the whole
 *   request object, messages included, and the ban would survive only as a habit.
 *   {@link RecordableDetail} therefore admits a scalar per key and types every
 *   content-bearing key `never`, reusing the port tier's own `ContentBearingKey` list so
 *   there is one definition of "this key carries content" rather than two that can drift.
 *   Recording `{ content: '…' }` is a compile error, not a review comment.
 */
import type { ContentBearingKey } from '../ports/shapeGuards';

/** The five boundaries this directory mocks. Enumerated, so a typo is a compile error. */
export const MOCK_PORT_NAMES = ['telegram', 'openrouter', 'drive', 'whoop', 'signalBus'] as const;
export type MockPortName = (typeof MOCK_PORT_NAMES)[number];

/** What one detail entry may hold. A scalar, so a nested payload cannot be smuggled in. */
export type DetailValue = string | number | boolean | null;

/**
 * A recordable detail bag: any scalar keyed however the caller likes, EXCEPT that every
 * content-bearing key is optional-`never`. Optional rather than required, so an ordinary
 * bag still type checks; `never`, so a content key can never hold a value.
 */
export type RecordableDetail = Readonly<Record<string, DetailValue>> & {
  readonly [K in ContentBearingKey]?: never;
};

/** One recorded call. `detail` is the redacted projection the mock chose to keep. */
export interface Invocation {
  readonly seq: number;
  readonly port: MockPortName;
  readonly member: string;
  readonly detail: Readonly<Record<string, DetailValue>>;
}

/**
 * The recorder every mock in this directory writes to.
 *
 * `isEmpty()` with no argument answers for the whole log, which is the assertion R16 wants;
 * with a port, or a port and a member, it narrows without the caller filtering by hand.
 */
export interface InvocationRecorder {
  /** Append one call and answer with its sequence number. */
  record(port: MockPortName, member: string, detail?: RecordableDetail): number;
  /** Every call so far, oldest first. A snapshot: mutating it cannot corrupt the log. */
  readonly all: readonly Invocation[];
  callsTo(port: MockPortName, member?: string): readonly Invocation[];
  countOf(port: MockPortName, member?: string): number;
  /** True when nothing matching was recorded. The R16 assertion, in one call. */
  isEmpty(port?: MockPortName, member?: string): boolean;
  /** Drop the log and restart the sequence, so one recorder can serve several phases. */
  reset(): void;
}

function matches(entry: Invocation, port?: MockPortName, member?: string): boolean {
  if (port !== undefined && entry.port !== port) return false;
  if (member !== undefined && entry.member !== member) return false;
  return true;
}

/**
 * Build a recorder. Deterministic and self-contained: no clock, no randomness, no ambient
 * state, so two recorders driven by the same script hold equal logs.
 */
export function createInvocationRecorder(): InvocationRecorder {
  let log: Invocation[] = [];
  let next = 1;

  return {
    record(port, member, detail) {
      const seq = next;
      next += 1;
      log.push({ seq, port, member, detail: { ...(detail ?? {}) } as Readonly<Record<string, DetailValue>> });
      return seq;
    },
    get all() {
      return [...log];
    },
    callsTo(port, member) {
      return log.filter((entry) => matches(entry, port, member));
    },
    countOf(port, member) {
      return log.filter((entry) => matches(entry, port, member)).length;
    },
    isEmpty(port, member) {
      return !log.some((entry) => matches(entry, port, member));
    },
    reset() {
      log = [];
      next = 1;
    },
  };
}
