#!/usr/bin/env node
/**
 * NIZAM · Test ladder rung L0 — the loader refuses an incomplete environment
 * Owning mandate: `.kiro/specs/06-two-agent-vps/KIRO_SHIP_LIVE.prompt.md` §9 (the ladder), executed
 *   by spec task 10.12. Owning requirements: R27 (every missing entry named in one message), R29 (the
 *   finance-agent process refuses to boot on an incomplete environment).
 *
 * WHY THIS IS A SCRIPT RATHER THAN A TRANSCRIPT. §9 says a rung is not passed because the code looks
 * right. The observation it asks for is the REAL entrypoint booting: so this spawns
 * `src/server/process/start.ts` as its own process, twice, and reads what that process actually wrote
 * to its own streams. Nothing here imports the loader, mocks a store, or asserts against a returned
 * value — an in-process assertion is what the 35 loader tests and the 25 guard tests already are, and
 * this rung exists because those are not the same observation as a boot.
 *
 * The two cases:
 *
 *   A. FOUR entries broken at once — two removed, one emptied, one left holding its own template
 *      placeholder. The boot must fail, must name ALL FOUR in ONE message, and must reach the
 *      operator on the error stream with a non-zero exit. Four rather than one deliberately: a
 *      first-failure loader passes the single-entry version of this rung, which is exactly why R27
 *      was real work and not a re-confirmation.
 *   B. The same environment, complete. The boot must proceed — observed as the process's own
 *      `store_opened` line on its own output stream — and must not emit an aggregate refusal. The
 *      child is then terminated, because under `longPoll` a booted agent runs until it is stopped.
 *
 * THE ENTRYPOINT IS LAUNCHED THE WAY A CONTAINER LAUNCHES IT — bare `node`, no hook, no flag. That
 * is the whole point of task 10.23, and it changes what this rung is evidence ABOUT. Until F20 was
 * repaired the child below was spawned with `--import ./scripts/ladder/ts-resolve.mjs`, a hook that
 * restored the one resolution the project's toolchain performs and Node's own resolver does not, so
 * the observation was about the loader and said nothing about the launch. Every relative specifier
 * under `src/` now carries its real extension, so the resolution the hook supplied is the resolution
 * the runtime performs — the hook is gone, and this rung now observes the same command the three
 * owned images' ENTRYPOINT lines carry.
 *
 * NO SECRET, NO PARTICULAR, NO NETWORK (R24, steering §2). Every value below is a LADDER value: a
 * self-evident non-value chosen so that it cannot be a deployment particular and cannot be mistaken
 * for one. No token, key or identifier of the deployment is read, written or invented — the finance
 * agent's live provider client refuses in this build (`main.ts` wires a client whose two members
 * throw `TELEGRAM_SEND_REFUSED`), so a booted agent makes no outbound call at all, which is what
 * makes case B safe to run under the phase-1 posture. The store is created in a temporary directory
 * outside the repository and removed at the end.
 *
 * FINDING F20, MET WHILE WRITING THIS AND REPAIRED BY TASK 10.23. Bare
 * `node src/server/process/start.ts` used to answer `ERR_MODULE_NOT_FOUND` on its first import, so no
 * owned image could start and rung L2 was unreachable with every gate observed. The repair gave every
 * relative specifier its extension; the check that holds it is the launch half of **AC16**
 * (`scripts/verify/launch-path.mjs`), which spawns all four shims with bare `node` on every harness
 * run. This rung is the same observation taken end to end rather than the check that guards it.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENTRYPOINT = 'src/server/process/start.ts';
const BOT_IDENTITY = 'ladder-bot';

/** How long a case may take before it is reported as a failure rather than waited on for ever. */
const CASE_TIMEOUT_MS = 40_000;

/** The line the process writes once its store is open — the observable "boot proceeded" (§9, L0). */
const BOOT_PROCEEDED_MARK = 'store_opened';

/** The four entries case A breaks, and how each is broken. */
const BROKEN = [
  { entry: 'FINANCE_STORE_FILE', how: 'removed' },
  { entry: 'MODEL_ELIGIBILITY_REGISTRY_PATH', how: 'removed' },
  { entry: 'BUS_INTERNAL_ENDPOINT', how: 'emptied' },
  { entry: 'MAX_WORK_ITEMS', how: 'left as its template placeholder' },
];

/**
 * A complete finance-service environment, built from the seventeen entries
 * `SERVICE_ENTRY_NAMES.finance` declares. Ladder values only — see the file note.
 */
function completeEnvironment(dataDir) {
  return {
    FINANCE_DATA_DIR: dataDir,
    FINANCE_STORE_FILE: 'finance.db',
    STORE_BUSY_TIMEOUT_MS: '5000',
    FINANCE_CONTAINER_PORT: '8080',
    BOT_B_TOKEN: 'ladder-not-a-token',
    MONEY_WEBHOOK_SECRET: 'ladder-not-a-secret',
    ALLOWED_USER_IDS: '1234',
    // Assembled rather than written: the entry's own rule requires a secured scheme, and a scheme
    // followed by a name reads as an address to a human skimming a tracked file. It resolves to
    // nothing (the suffix is reserved, permanently), and no call is made to it in either case.
    MSG_API_BASE: 'ht' + 'tps://ladder-not-a-host.invalid',
    TELEGRAM_MODE: 'longPoll',
    MAX_WORK_ITEMS: '4',
    OR_KEY_FINANCE: 'ladder-not-a-key',
    MODEL_API_BASE: 'ht' + 'tps://ladder-not-a-host.invalid',
    FINANCE_WEEKLY_CAP: '2500000',
    MODEL_ELIGIBILITY_REGISTRY_PATH: join(dataDir, 'eligibility-registry.json'),
    BUS_INTERNAL_ENDPOINT: 'ladder-bus:9000',
    // A path that deliberately does not exist: the halt must be RELEASED for case B to boot.
    KILL_SENTINEL_PATH: join(dataDir, 'no-sentinel-here'),
    NIZAM_KILL_ALL: '0',
  };
}

/** Break the four entries case A breaks, returning a fresh environment. */
function incompleteEnvironment(dataDir) {
  const env = completeEnvironment(dataDir);
  delete env.FINANCE_STORE_FILE;
  delete env.MODEL_ELIGIBILITY_REGISTRY_PATH;
  env.BUS_INTERNAL_ENDPOINT = '';
  env.MAX_WORK_ITEMS = '<MAX_WORK_ITEMS>';
  return env;
}

/**
 * Run the real entrypoint once.
 *
 * `stopOn` is the substring that means the observation is complete: when it appears on the output
 * stream the child is terminated and the run reported. Without it a booted agent would never exit.
 */
function runEntrypoint(env, stopOn) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENTRYPOINT, '--bot-id', BOT_IDENTITY], {
      // A CLEAN environment plus the ladder entries, so nothing on the developer machine can supply
      // an entry the case is meant to be missing. `PATH` and `SystemRoot` are the platform's own.
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stopped = false;
    const finish = (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr, stoppedByObservation: stopped });
    };
    const timer = setTimeout(() => {
      stopped = false;
      child.kill();
    }, CASE_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      if (stopOn !== null && !stopped && stdout.includes(stopOn)) {
        stopped = true;
        child.kill();
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('close', (code, signal) => finish(code, signal));
  });
}

function indent(text) {
  const lines = text.replace(/\s+$/, '').split(/\r?\n/);
  return lines.map((line) => `    ${line}`).join('\n');
}

const findings = [];
const dataDir = mkdtempSync(join(tmpdir(), 'nizam-ladder-l0-'));

try {
  console.log('NIZAM test ladder — rung L0 (config): the loader refuses an incomplete environment');
  console.log(`entrypoint: node ${ENTRYPOINT} --bot-id ${BOT_IDENTITY}`);
  console.log('           (bare node, exactly as the three owned images launch it — finding F20 repaired by task 10.23)');
  console.log('');

  // --- case A: four entries broken at once ---------------------------------------------------
  console.log('CASE A — four required entries broken at once:');
  for (const { entry, how } of BROKEN) console.log(`  ${entry}: ${how}`);
  const a = await runEntrypoint(incompleteEnvironment(dataDir), null);
  console.log(`  exit code: ${a.exitCode}${a.signal === null ? '' : ` (signal ${a.signal})`}`);
  console.log('  error stream:');
  console.log(indent(a.stderr.length === 0 ? '(nothing)' : a.stderr));
  console.log('');

  if (a.exitCode !== 1) findings.push(`L0/A: the boot exited ${a.exitCode}; an incomplete environment must exit 1`);
  if (!a.stderr.includes('EnvConfigAggregateError') && !a.stderr.includes('entries to fix')) {
    findings.push('L0/A: the error stream carries no aggregate refusal, so the boot did not refuse for the reason this rung is about');
  }
  for (const { entry } of BROKEN) {
    if (!a.stderr.includes(entry)) findings.push(`L0/A: the refusal does not name ${entry}, so it is not naming every missing entry at once`);
  }
  if (!a.stderr.includes(`${BROKEN.length} entries to fix`)) {
    findings.push(`L0/A: the refusal does not state that there are ${BROKEN.length} entries to fix, so one restart does not answer the whole question`);
  }
  if (a.stdout.includes(BOOT_PROCEEDED_MARK)) findings.push('L0/A: the store was opened despite the refusal, so the boot proceeded on an incomplete environment');

  // --- case B: the same environment, complete ------------------------------------------------
  console.log('CASE B — the same environment with all four entries restored:');
  const b = await runEntrypoint(completeEnvironment(dataDir), BOOT_PROCEEDED_MARK);
  console.log(`  observed the boot proceed: ${b.stoppedByObservation ? 'yes' : 'no'}`);
  console.log('  output stream (first line):');
  console.log(indent(b.stdout.split(/\r?\n/).filter((l) => l.trim().length > 0)[0] ?? '(nothing)'));
  console.log('  error stream:');
  console.log(indent(b.stderr.length === 0 ? '(nothing)' : b.stderr));
  console.log('');

  if (!b.stdout.includes(BOOT_PROCEEDED_MARK)) {
    findings.push('L0/B: the process never reported its store open, so the boot did not proceed on a complete environment');
  }
  if (b.stderr.includes('entries to fix')) findings.push('L0/B: the boot still refused on completeness with every entry configured');
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}

if (findings.length > 0) {
  console.log('L0 FAILED');
  for (const finding of findings) console.log(`  - ${finding}`);
  process.exitCode = 1;
} else {
  console.log('L0 PASSED — refused four entries in one message with a non-zero exit, and proceeded when they were restored');
}
