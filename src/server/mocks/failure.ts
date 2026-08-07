/**
 * NIZAM · Mock port failure — one thrower for five boundaries
 * Implemented by: PFOS Contract 12 / Phase 2.2 (spec 06-two-agent-vps)
 * Depends on: ../ports/errors (type level only)
 *
 * `src/server/ports/errors.ts` declares the failure SHAPE and deliberately ships no class,
 * because Phase 2.1 ships no implementation. The shape has to be thrown by somebody, and for
 * the mocks that somebody is this file — one class, so a test can assert on a single
 * constructor and every mock discriminates on `code` exactly as the store tier does
 * (`src/server/db/errors.ts` is the house pattern).
 *
 * What this error cannot carry is the point. {@link import('../ports/errors').PortFailure} has
 * no field for a prompt, a completion, an amount, or the name of the check that failed
 * (§5.2, §6.4, §4.3), so neither does this. `correlationRef` points at a telemetry row; it is
 * a reference, never content.
 */
import type { PortFailure, PortFailureCode } from '../ports/errors';

/**
 * The failure every mock rejects with. `message` is diagnostic prose for a developer reading
 * a test run; a caller discriminates on `code`, never on the prose.
 */
export class MockPortFailure extends Error implements PortFailure {
  readonly code: PortFailureCode;
  readonly correlationRef: string | null;

  constructor(code: PortFailureCode, message: string, correlationRef: string | null = null) {
    super(message);
    this.name = 'MockPortFailure';
    this.code = code;
    this.correlationRef = correlationRef;
  }
}

/** Narrowing helper, so a test can assert the code without an unchecked cast. */
export function isMockPortFailure(value: unknown): value is MockPortFailure {
  return value instanceof MockPortFailure;
}
