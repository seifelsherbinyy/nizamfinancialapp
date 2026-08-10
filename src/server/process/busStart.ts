/**
 * NIZAM · The signal bus's executable shell
 * Implemented by: PFOS Contract 12 / Phase 10.19 (spec 06-two-agent-vps)
 * Owning requirements: R34 (the bus service has a process), R27 (an incomplete environment refuses
 *   the boot with a non-zero exit rather than starting degraded), R22 (`--health` answers readiness)
 * Depends on: ./busMain. Nothing else, and deliberately nothing else.
 *
 * This file exists so that `busMain.ts` can be IMPORTED without being RUN. A module that starts a
 * process as a side effect of being loaded cannot be tested: the first import would open the store,
 * bind the listener and register signal handlers. So the split is one statement wide — this is the
 * only file that turns an outcome into an exit status, and it holds no logic of its own to get wrong.
 * The same split, for the same reason, as `start.ts` and `probe.ts`.
 *
 * An exit code of 1 means the boot was refused, or `--health` found the bus not ready. The refusal
 * message has already been written and names every incomplete entry at once (R27), so one restart
 * answers the whole question.
 */
import nodeProcess from 'node:process';
import { busMain } from './busMain';

const outcome = await busMain(nodeProcess.argv.slice(2));
nodeProcess.exitCode = outcome.exitCode;
