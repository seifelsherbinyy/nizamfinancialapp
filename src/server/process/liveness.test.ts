// @vitest-environment node
/**
 * NIZAM · The shared liveness record — one rule, and every ambiguity fails closed
 * Implemented by: PFOS Contract 12 / Phase 10.21 (spec 06-two-agent-vps)
 * Owning requirements: R22 (readiness is an exec check computed in process against local files, and
 *   a liveness answer dressed as readiness is forbidden), R24 (the record carries no value — its age
 *   is the whole of the signal)
 * Depends on: ./liveness, ./busServer (to show the bus is on the SHARED rule rather than a copy of
 *   it), a temporary directory. No socket, no network, no wall clock: `nowMs` is injected, so a
 *   stale record and a future-dated one are both states a case SETS rather than waits for.
 *
 * Every value below is synthetic. No host, path fragment, identifier or figure from any deployment
 * appears (R24).
 */
import { existsSync, readFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BUS_HEARTBEAT_INTERVAL_MS,
  BUS_HEARTBEAT_MAX_AGE_MS,
  heartbeatIsFresh,
} from './busServer';
import { createFileLivenessRecord, LIVENESS_TOUCH_INTERVAL_MS, livenessIsFresh } from './liveness';

const RECORD_NAME = 'service-liveness';
const WINDOW_MS = 30_000;

const directories: string[] = [];

function freshDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nizam-liveness-'));
  directories.push(dir);
  return dir;
}

afterEach(() => {
  while (directories.length > 0) {
    const dir = directories.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('the freshness rule fails closed in every direction (R22)', () => {
  it('reads an absent record as not fresh: silence is not health', () => {
    expect(livenessIsFresh(null, WINDOW_MS)).toBe(false);
  });

  it('reads a record dated in the future as not fresh, which is the clock-moved-backwards direction', () => {
    expect(livenessIsFresh(-1, WINDOW_MS)).toBe(false);
    expect(livenessIsFresh(-WINDOW_MS, WINDOW_MS)).toBe(false);
  });

  it('reads an age nobody can compare as not fresh', () => {
    expect(livenessIsFresh(Number.NaN, WINDOW_MS)).toBe(false);
    expect(livenessIsFresh(Number.POSITIVE_INFINITY, WINDOW_MS)).toBe(false);
  });

  it('reads the boundary as fresh and one millisecond past it as not', () => {
    expect(livenessIsFresh(0, WINDOW_MS)).toBe(true);
    expect(livenessIsFresh(WINDOW_MS, WINDOW_MS)).toBe(true);
    expect(livenessIsFresh(WINDOW_MS + 1, WINDOW_MS)).toBe(false);
  });

  it('has no default window, so no service inherits another service\u2019s one silently', () => {
    // A window is a statement about a service's own loop. The rule takes it as an argument, so the
    // type system refuses a call that does not state one.
    expect(livenessIsFresh.length).toBe(2);
  });
});

describe('the bus is on the shared rule rather than a second copy of it', () => {
  it('uses the shared touch interval', () => {
    expect(BUS_HEARTBEAT_INTERVAL_MS).toBe(LIVENESS_TOUCH_INTERVAL_MS);
  });

  it('answers exactly what the shared rule answers, under the bus\u2019s own window', () => {
    for (const age of [null, -1, 0, 1, BUS_HEARTBEAT_MAX_AGE_MS, BUS_HEARTBEAT_MAX_AGE_MS + 1, Number.NaN]) {
      expect(heartbeatIsFresh(age)).toBe(livenessIsFresh(age, BUS_HEARTBEAT_MAX_AGE_MS));
    }
  });

  it('keeps the staleness window wider than the touch interval, so one slow tick is not an outage', () => {
    expect(BUS_HEARTBEAT_MAX_AGE_MS).toBeGreaterThan(BUS_HEARTBEAT_INTERVAL_MS);
  });
});

describe('the file-backed record carries an age and nothing else (R24)', () => {
  it('writes an EMPTY file: there is no argument a value could arrive through', () => {
    const dir = freshDirectory();
    const record = createFileLivenessRecord(dir, RECORD_NAME);
    record.touch();

    const path = join(dir, RECORD_NAME);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('');
    expect(statSync(path).size).toBe(0);
  });

  it('answers an age a caller can date, computed against the injected clock', () => {
    const dir = freshDirectory();
    const record = createFileLivenessRecord(dir, RECORD_NAME, () => statSync(join(dir, RECORD_NAME)).mtimeMs + 1_500);
    record.touch();
    expect(record.ageMs()).toBe(1_500);
  });

  it('answers null before anything was recorded, and null again once it is cleared', () => {
    const dir = freshDirectory();
    const record = createFileLivenessRecord(dir, RECORD_NAME);
    expect(record.ageMs()).toBeNull();

    record.touch();
    expect(record.ageMs()).not.toBeNull();

    record.clear();
    expect(existsSync(join(dir, RECORD_NAME))).toBe(false);
    expect(record.ageMs()).toBeNull();
  });

  it('clears an absent record without complaint, so shutdown is idempotent', () => {
    const dir = freshDirectory();
    const record = createFileLivenessRecord(dir, RECORD_NAME);
    expect(() => record.clear()).not.toThrow();
    expect(() => record.clear()).not.toThrow();
  });
});

describe('the record cannot land outside the directory the service was given', () => {
  it('REFUSES the write for a name that escapes the directory', () => {
    const dir = freshDirectory();
    const escaping = createFileLivenessRecord(dir, `../${RECORD_NAME}`);

    // The guarded operation itself refuses; it does not merely answer something unhelpful.
    expect(() => escaping.touch()).toThrow(/outside the configured data directory/);
    expect(() => escaping.clear()).toThrow(/outside the configured data directory/);
    expect(escaping.ageMs()).toBeNull();
    expect(existsSync(join(dir, '..', RECORD_NAME))).toBe(false);
  });

  it('REFUSES the write when the directory is absent, rather than choosing another location', () => {
    const dir = freshDirectory();
    const missing = join(dir, 'not-mounted');
    const record = createFileLivenessRecord(missing, RECORD_NAME);

    expect(() => record.touch()).toThrow(/does not exist/);
    expect(record.ageMs()).toBeNull();
  });

  it('resolves nothing at construction, so an unconfigured directory refuses the boot elsewhere', () => {
    // `main.ts` and `busMain.ts` both assemble dependencies BEFORE the environment has been refused.
    // Constructing must therefore be inert: the aggregate that names every unfilled entry at once has
    // to be what the operator sees, not a path error about one of them.
    expect(() => createFileLivenessRecord('', RECORD_NAME)).not.toThrow();
    expect(createFileLivenessRecord('', RECORD_NAME).ageMs()).toBeNull();
  });
});
