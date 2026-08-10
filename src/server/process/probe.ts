/**
 * NIZAM · The readiness command — `nizam-health-probe --store <path> [--throwaway]`
 * Implemented by: PFOS Contract 12 / Phase 10.8 (spec 06-two-agent-vps)
 * Owning requirements: R22 (a service reports actual readiness and the orchestrator acts on it),
 *   R21 (the restore drill boots a throwaway instance over a restored artifact before trusting it),
 *   R28 (the healthcheck command an image declares has to exist inside that image)
 * Depends on: ../ops/healthProbe. Nothing else, and deliberately nothing else.
 *
 * `healthProbe.ts` already owns the whole answer: it parses the invocation grammar, opens the store
 * read-only, reads each required pragma back, and returns a report plus an exit status. What it
 * deliberately does NOT do is exit, because a module that ends the process cannot be tested. So this
 * file is the one statement that turns the answer into a status, and it holds no logic of its own to
 * get wrong — the same split, for the same reason, as `start.ts` and `main.ts`.
 *
 * `ops/images/finance-agent/Dockerfile` installs this as {@link PROBE_COMMAND_NAME} on the path.
 * `ops/restore/restore.sh` invokes that name, and `healthProbe.ts` exports it, so the script, the
 * parser and the image all spell it once.
 *
 * An exit code of 1 means not ready. It is never a crash and never a usage message: a refused
 * invocation is itself a not-ready answer, because the only alternative would be inspecting some
 * other store, and inspecting the wrong store is the failure this whole path exists to prevent.
 *
 * Nothing is written to any stream here. The report carries no figure of any kind, and
 * `redactedLogger.ts` is the only module in this tier permitted to write a line down.
 */
import nodeProcess from 'node:process';

import { runProbe } from '../ops/healthProbe.ts';

const { exitCode } = runProbe(nodeProcess.argv.slice(2));
nodeProcess.exitCode = exitCode;
