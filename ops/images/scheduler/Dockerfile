# NIZAM - the scheduler image. A BUILD RECIPE, NOT A DEPLOYMENT. NOTHING HERE IS RUN BY AN AGENT.
#
# Owning contract: PFOS 12 - Two-Agent VPS Deployment & Operations, §2.1 (the scheduler is one of the
#   six services), §3.2.2 (it is permitted a read-only cross-store view and takes NONE), §7.3 (the
#   readiness command the orchestrator polls), §8.2 (it is one of the four services that honour the
#   kill sentinel).
# Spec: .kiro/specs/06-two-agent-vps/ - task 10.20, closing the other half of finding O2. Owning
#   requirements R34 (a service this repository owns has a process, an image and an internal-only
#   binding), R28 (a Dockerfile for every image this repository owns, and a documented build path
#   producing the tag the topology references), R9, R22, R24, R27, R29.
# Steering: two-agent-vps.md §1 (this repository is the Node + TypeScript side), §2 (writing this file
#   is permitted; BUILDING IT AGAINST A NETWORK IS NOT), §0b (public repo).
# Companion: ops/IMAGE_BUILD.md - the ownership record and the build path, audited on every test run
#   by src/server/ops/imageOwnership.ts, which re-reads the properties asserted below.
#
# ---------------------------------------------------------------------------------------------
# WHAT THIS IMAGE IS, AND WHY IT DID NOT EXIST UNTIL NOW
# ---------------------------------------------------------------------------------------------
#
# Tick delivery is this repository's to own: the topology gives this service the two tick endpoints,
# the internal tick network and its own healthcheck. What did not exist was a PROCESS - nothing
# delivered a tick - so ops/IMAGE_BUILD.md recorded this reference as OWNED_BUILD_PENDING and named
# finding O2 as its blocker. src/server/process/scheduler.ts is that process, and this recipe packages
# it. It is the SMALLEST of the six, and the reason is what it does not hold: no store, no volume, no
# bot token, no model key, no storage credential, no weekly cap, and no bus endpoint.
#
# The contents are the pinned runtime, this repository's source, and its production dependencies.
# Nothing else. There is no compiler step and no bundler step: the runtime major pinned in .nvmrc
# strips TypeScript types natively, so `src/` is the artifact rather than an input to one.
#
# ---------------------------------------------------------------------------------------------
# THE FOUR PROPERTIES R28 REQUIRES, AND WHERE EACH ONE IS
# ---------------------------------------------------------------------------------------------
#
#   1. THE BASE IS PINNED TO THE RUNTIME .nvmrc NAMES. Both stages name the same major, and that major
#      is the one .nvmrc pins. The checker reads both files and reports a finding if they disagree.
#      The tag is a MAJOR and not a patch: a patch this file invented would be a version nobody
#      verified exists, and the immutable identity of the bytes is the DIGEST, resolved at build time
#      and recorded in the operator's own build receipt - never written back here.
#
#   2. IT RUNS AS A NON-ROOT USER. The final stage ends on a `USER` directive naming the unprivileged
#      account the base image already provides. Installing the entry points needs root and happens
#      before that line; nothing after it needs root, and this service creates no directory at all -
#      see the note on the liveness record below.
#
#   3. NO SECRET AND NO DEPLOYMENT PARTICULAR. There is no `ENV`, no `ARG` carrying a value, no
#      endpoint, no cadence, and no default for anything the environment supplies. This service holds
#      no credential of any kind, which is deliberate: a clock that could authenticate could also be
#      made to act. Its five configuration entries arrive at run time from the one file compose gives
#      it (<SCHEDULER_ENV_PATH>), and the loader refuses to boot on an entry that is missing, empty, or
#      still holding its own placeholder, naming every one of them in a single message (R27). A default
#      here would defeat that: it would turn a refused boot into a guessed one, and a scheduler that
#      guessed an endpoint would deliver ticks nowhere while reporting itself healthy.
#
#   4. THE HEALTHCHECK COMMAND EXISTS INSIDE IT. Two commands are installed, because two callers ask
#      two different questions:
#
#        nizam-scheduler-health  no arguments. Reads the liveness record this service's own tick loop
#                                writes and answers with an exit status. This is what
#                                <SCHEDULER_HEALTH_PROBE> in ops/docker-compose.yml resolves to, and
#                                it is why that healthcheck is a `CMD` with a single element and needs
#                                no port.
#        nizam-health-probe      `--store … --throwaway`, the store named as an argument. The grammar
#                                src/server/ops/healthProbe.ts parses. This service has no store of
#                                its own, so it never asks itself this question - but the command is
#                                installed because ops/IMAGE_BUILD.md's audit requires every image
#                                this repository owns to carry the name the restore drill invokes, and
#                                one spelling installed everywhere is cheaper than an exception.
#
#      NEITHER OPENS A SOCKET. For this service that matters twice over: it binds nothing at all, so a
#      health endpoint would have been the only listener in the container and the only reason it would
#      have needed a port.
#
# ---------------------------------------------------------------------------------------------
# WHERE THE LIVENESS RECORD LIVES, AND WHY THERE IS NO VOLUME FOR IT
# ---------------------------------------------------------------------------------------------
#
# The bus and the finance agent write their liveness record beside their store, on their own volume.
# This service mounts NO volume - §3.2.2's read-only cross-store view is deliberately declined,
# because a tick is a signal to the agent that owns a store rather than a query against one - so there
# is no such place, and inventing one would mean a named volume for a file whose whole content is its
# own timestamp.
#
# What it does have is the same CONTAINER as its health command: an exec healthcheck runs inside the
# service's own container, which is the reason the record works across a process boundary in the first
# place. So the record goes in the platform's temporary directory, read from `node:os` by
# src/server/process/schedulerMain.ts. Two consequences, both correct rather than tolerated: the record
# does not survive a container restart, so a restarted container reports not-ready until its new loop
# has recorded itself - which is what should happen, because the old loop's evidence says nothing about
# the new one - and no path in this repository names it, so nothing about it is a deployment particular.
#
# ---------------------------------------------------------------------------------------------
# WHAT IS DELIBERATELY ABSENT
# ---------------------------------------------------------------------------------------------
#
#   - NO `EXPOSE`, and no port of any kind. This service is a CLIENT of two internal endpoints. It has
#     no accept surface at all: `src/server/process/scheduler.ts` publishes an always-empty
#     `listeningPorts` with no code path that appends to it, and the host boundary's `listen` half
#     REFUSES, so an edit that tried to add one fails loudly rather than publishing a port. The
#     topology gives this service no `ports:` key either.
#   - NO `HEALTHCHECK`. The orchestrator's check is declared per service in ops/docker-compose.yml with
#     its interval, timeout, retries and start-up grace period. A second one here would be a second
#     policy, and the two would drift.
#   - NO STORE DIRECTORY, and no `install -d`. The other two owned recipes prepare `/data` so a
#     non-root process can write its own store into an empty named volume. This service has neither, so
#     the line would create a directory nothing mounts and nothing opens.
#   - NO development dependency, and no lifecycle script. `--omit=dev` keeps the test runner, the
#     linter and the browser toolchain out of a running service, and `--ignore-scripts` means no
#     package's install hook executes during the build.
#   - NO `.env` file, no key, no token, and nothing from .secrets/. The build context excludes them at
#     the root .dockerignore, so they cannot arrive by accident through a broad `COPY`.

# ---------------------------------------------------------------------------------------------
# Stage one: production dependencies, resolved from the lockfile and nothing else
# ---------------------------------------------------------------------------------------------
FROM node:24-bookworm-slim AS dependencies

WORKDIR /app

# The lockfile is the whole input. `npm ci` fails rather than resolving a range, which is what makes
# this stage reproducible.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ---------------------------------------------------------------------------------------------
# Stage two: the runtime
# ---------------------------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# The two entry points. Written here rather than committed as scripts because each is one exec line
# whose only content is a path this file already knows; a separate file would be a second place the
# same path is spelled.
RUN printf '%s\n' \
      '#!/bin/sh' \
      'exec node /app/src/server/process/probe.ts "$@"' \
      > /usr/local/bin/nizam-health-probe \
 && printf '%s\n' \
      '#!/bin/sh' \
      'exec node /app/src/server/process/schedulerStart.ts --health' \
      > /usr/local/bin/nizam-scheduler-health \
 && chmod 0555 /usr/local/bin/nizam-health-probe /usr/local/bin/nizam-scheduler-health

# Property 2. Everything after this line runs unprivileged, and nothing after this line needs root.
USER node

# The process, not a shell. `schedulerStart.ts` is one statement wide and turns the outcome into an
# exit status; every behaviour is in `scheduler.ts`, where it is tested with no socket, no disk and no
# signal. This service takes no argument: unlike the agents it has no bot identity, because it is not a
# bot - it is the clock two of them run on.
ENTRYPOINT ["node", "/app/src/server/process/schedulerStart.ts"]
