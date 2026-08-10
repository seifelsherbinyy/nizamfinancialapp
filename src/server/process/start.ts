/**
 * NIZAM · The executable shell — `npm start`
 * Implemented by: PFOS Contract 12 / Phase 10.7 (spec 06-two-agent-vps)
 * Owning requirements: R29 (the finance-agent process starts, refuses an incomplete environment with
 *   a non-zero exit, and shuts down cleanly on a termination signal)
 * Depends on: ./main. Nothing else, and deliberately nothing else.
 *
 * This file exists so that `main.ts` can be IMPORTED without being RUN. A module that starts a
 * process as a side effect of being loaded cannot be tested: the first import would open a store,
 * bind a listener and register signal handlers. So the split is one statement wide — this is the only
 * file that turns an outcome into an exit status, and it holds no logic of its own to get wrong.
 *
 * An exit code of 1 means the boot was refused. The refusal message has already been written, and it
 * names every incomplete entry at once (R27), so one restart answers the whole question.
 */
import nodeProcess from 'node:process';
import { main } from './main.ts';

const outcome = await main(nodeProcess.argv.slice(2));
nodeProcess.exitCode = outcome.exitCode;
