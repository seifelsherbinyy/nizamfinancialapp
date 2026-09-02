/**
 * NIZAM · The backup service's executable shell
 * Implemented by: PFOS Contract 12 / Phase 10.9 (spec 06-two-agent-vps)
 * Owning requirements: R20 (consistent snapshot, public-key encryption, shred, verified upload,
 *   bounded retention), R27 (an incomplete environment refuses the boot with a non-zero exit rather
 *   than starting degraded), R22 (`--health` answers readiness)
 * Depends on: ./backupMain. Nothing else, and deliberately nothing else.
 *
 * This file exists so that `backupMain.ts` can be IMPORTED without being RUN. A module that starts
 * a process as a side effect of being loaded cannot be tested: the first import would begin the
 * schedule loop and register signal handlers. So the split is one statement wide — this is the only
 * file that turns an outcome into an exit status, and it holds no logic of its own to get wrong.
 * The same split, for the same reason, as `start.ts`, `busStart.ts`, `schedulerStart.ts` and
 * `probe.ts`.
 *
 * An exit code of 1 means the boot was refused, or `--health` found the backup service not ready.
 * The refusal message has already been written and names every incomplete entry at once (R27), so
 * one restart answers the whole question.
 */
import nodeProcess from 'node:process';
import { backupMain } from './backupMain.ts';

const outcome = await backupMain(nodeProcess.argv.slice(2));
nodeProcess.exitCode = outcome.exitCode;
