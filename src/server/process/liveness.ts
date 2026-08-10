/**
 * NIZAM · The liveness record — ONE rule, shared by every service whose readiness is an exec check
 * Implemented by: PFOS Contract 12 / Phase 10.21 (spec 06-two-agent-vps)
 * Owning requirements: R22 (a service reports ACTUAL readiness, and the answer is computed in
 *   process against local files rather than by dialling anything), R24 (the record carries no
 *   value at all — its AGE is the whole of the signal), R9 (readiness needs no listener, so a
 *   service can report healthy while binding nothing publicly)
 * Depends on: ../db/paths (the ONE containment guard) and `node:fs`. Nothing else, and nothing
 *   above it: this module holds no service identity, no window and no path.
 *
 * ## Why this module exists rather than a second copy of the same idea
 *
 * `ops/docker-compose.yml` declares every healthcheck as an EXEC command — `test: [CMD, <…>]` — so
 * the answer has to be computable by a SECOND process that shares nothing with the server but the
 * container it runs in. Task 10.19 worked that out for the signal bus: the server records that it is
 * alive in a content-free file, shutdown removes the record, and the health command reads how old
 * the record is. Task 10.21 needed exactly the same fact for the finance agent, whose health command
 * had no liveness fact at all and therefore could never report ready.
 *
 * Two copies of a liveness rule is two places for it to be wrong, and the interesting half of the
 * rule is the fail-closed direction — absent is not ready, stale is not ready, and a record dated in
 * the FUTURE is not ready either. A second implementation would eventually get one of those three
 * generous, on the service where being wrong is least visible. So the rule lives here, once, and
 * each service supplies only the two things that are legitimately its own:
 *
 *   - **its file name**, because the record sits beside whatever that service already has, and
 *   - **its staleness window**, because a window is a statement about that service's own loop. The
 *     bus records itself every few seconds; the finance agent's loop blocks on a long-poll read, so
 *     its window has to clear that read or a perfectly healthy agent reads as wedged. There is
 *     deliberately no default here: a service states its window, so nobody inherits one silently.
 *
 * ## No content, and no room for any (R24)
 *
 * {@link LivenessRecord.touch} writes an EMPTY file. Not "a file we are careful not to put anything
 * in": there is no argument through which a caller could pass a value, so no identifier, no count,
 * no path and no figure can ride along to a place the health answer would then be able to read. What
 * crosses the process boundary is a modification time, and a modification time is not a value about
 * the deployment.
 *
 * ## The path is resolved late, and through the one guard
 *
 * {@link createFileLivenessRecord} resolves nothing at construction. A caller assembles its
 * dependencies BEFORE `requireServiceEnvironment` has had the chance to refuse an incomplete
 * environment (`main.ts` and `busMain.ts` both do), so resolving eagerly would replace a boot
 * refusal that names every unfilled entry at once with a path error naming one. Resolution happens
 * inside each operation, through `resolveStorePath` — the ONE containment guard — so a record cannot
 * land outside the directory the service was given, and a missing mount refuses rather than
 * inventing a location.
 */
import { rmSync, statSync, writeFileSync } from 'node:fs';

import { resolveStorePath } from '../db/paths.ts';

/**
 * The shared fact a SECOND process can read: is the service that owns this record alive?
 *
 * Three operations, and no fourth. There is nothing to read but the age and nothing to write but
 * the moment, which is what keeps the record incapable of carrying a value (R24).
 */
export interface LivenessRecord {
  /** Record that the owning service is alive right now. Writes an EMPTY file. */
  readonly touch: () => void;
  /** Remove the record, so a stopped service reads not-ready at once rather than after the window. */
  readonly clear: () => void;
  /** Milliseconds since the record was last written, or `null` when there is no record. */
  readonly ageMs: () => number | null;
}

/**
 * How often a service that has nothing else to do records itself.
 *
 * A service with a loop of its own touches the record as part of that loop instead, which is
 * strictly better evidence: it says the loop turned, not merely that a timer fired.
 */
export const LIVENESS_TOUCH_INTERVAL_MS = 5_000;

/**
 * Is this age fresh enough to mean the owning service is alive?
 *
 * Every ambiguity answers **false**, and each of the four is a way a not-ready service could
 * otherwise be reported ready:
 *
 *  - **`null`** — there is no record. Silence is not health (§7.3); it is what a service that never
 *    started, and a service that has gone, both look like.
 *  - **not finite** — an age nobody can compare is not an age.
 *  - **negative** — the record is dated in the future, which means a clock moved backwards. Reading
 *    that generously would report a service ready on the strength of a record it cannot date.
 *  - **over the window** — the loop has stopped turning. A wedged service is exactly what R22's
 *    prohibition on liveness-as-readiness is about.
 *
 * `maxAgeMs` is REQUIRED. A default here would be one service's window silently applied to another,
 * and the two differ for reasons that are about their loops rather than about this rule.
 */
export function livenessIsFresh(ageMs: number | null, maxAgeMs: number): boolean {
  return ageMs !== null && Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= maxAgeMs;
}

/**
 * The bound on how far the two clocks in {@link createFileLivenessRecord.ageMs} can disagree while
 * both are working correctly.
 *
 * This is not a tolerance for a wrong answer; it is the resolution of the question. An age is the
 * difference between two DIFFERENT time sources: the filesystem's record of when a file was written,
 * which carries sub-millisecond precision, and the wall clock this process reads, which is quantized.
 * A record written and then read inside the same quantum therefore produces a small NEGATIVE age -
 * the file appears to have been written a fraction of a millisecond in the future - with no clock
 * having moved anywhere.
 *
 * **This was a live defect, not a theoretical one.** `livenessIsFresh` reads a negative age as "the
 * clock moved backwards" and answers not-fresh, which is the correct treatment of a real backwards
 * jump and the wrong treatment of quantization. A service that had just recorded itself therefore
 * reported **not ready at random**, roughly once per few thousand readings, and under §7.3 the
 * orchestrator restarts what reports unhealthy - so the failure mode was a healthy service being
 * restarted, or a stack that never became healthy, for no reason an operator could reproduce. It
 * surfaced as an unidentified single test failure in one intermediate run of task 10.20, and task
 * 10.18 reproduced it and traced it here.
 *
 * The fix belongs at the MEASUREMENT and not in the rule, which is why this constant lives beside
 * `ageMs` rather than inside `livenessIsFresh`: the artefact is a property of comparing two clocks,
 * and the rule's fail-closed treatment of a future-dated record is correct and stays exactly as it
 * was. The bound is generous enough to cover the coarsest wall-clock quantum this runtime is
 * observed to have on any supported platform, and small enough to be irrelevant next to any real
 * clock movement: a backwards jump worth refusing is seconds or hours, never a few milliseconds.
 */
export const CLOCK_QUANTIZATION_MS = 16;

/**
 * A liveness record as a file inside `directory`, named `fileName`.
 *
 * `nowMs` is injected so a test dates a record without waiting and without touching a system clock,
 * which is the only way the stale and future-dated directions above are observable rather than
 * asserted.
 *
 * `ageMs` answers `null` for every reason a record cannot be dated — absent file, absent directory,
 * a name that escapes the directory, an unreadable entry — because all of them mean the same thing
 * to a health answer: nothing is reporting.
 */
export function createFileLivenessRecord(
  directory: string,
  fileName: string,
  nowMs: () => number = () => Date.now(),
): LivenessRecord {
  // Resolved per operation rather than once: see the module note on late resolution.
  const pathOf = (): string => resolveStorePath(directory, fileName);
  return {
    touch: () => writeFileSync(pathOf(), ''),
    clear: () => rmSync(pathOf(), { force: true }),
    ageMs: () => {
      try {
        const raw = nowMs() - statSync(pathOf()).mtimeMs;
        // A negative age INSIDE the quantization bound is two clocks disagreeing about the same
        // instant, not a clock that moved: it is reported as zero, which is what it means - the
        // record was written just now. A negative age BEYOND the bound is a record genuinely dated
        // ahead of this process's clock, and it is returned unchanged so `livenessIsFresh` refuses
        // it. See CLOCK_QUANTIZATION_MS for the defect this removes and why the rule is untouched.
        if (raw < 0 && raw > -CLOCK_QUANTIZATION_MS) return 0;
        return raw;
      } catch {
        return null;
      }
    },
  };
}
