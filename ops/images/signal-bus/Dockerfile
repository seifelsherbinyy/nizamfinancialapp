# NIZAM - the signal-bus image. A BUILD RECIPE, NOT A DEPLOYMENT. NOTHING HERE IS RUN BY AN AGENT.
#
# Owning contract: PFOS 12 - Two-Agent VPS Deployment & Operations, §2.1 (the bus is one of the six
#   services), §2.2.5/§2.2.6 (internal network only; a connection from outside is refused at the
#   network layer rather than authenticated on a reachable port), §4.1 (the append-only store on its
#   own volume, with its audit mirror), §4.5 (the consent gate on every read), §7.3 (the readiness
#   command the orchestrator polls).
# Spec: .kiro/specs/06-two-agent-vps/ - task 10.19, closing finding O2. Owning requirements R34 (a
#   service this repository owns has a process, an image and an internal-only binding), R28 (a
#   Dockerfile for every image this repository owns, and a documented build path producing the tag
#   the topology references), R9, R22, R24.
# Steering: two-agent-vps.md §1 (this repository is the Node + TypeScript side), §2 (writing this
#   file is permitted; BUILDING IT AGAINST A NETWORK IS NOT), §4.2 (the bus is the only channel),
#   §0b (public repo).
# Companion: ops/IMAGE_BUILD.md - the ownership record and the build path, audited on every test run
#   by src/server/ops/imageOwnership.ts, which re-reads the properties asserted below.
#
# ---------------------------------------------------------------------------------------------
# WHAT THIS IMAGE IS, AND WHY IT DID NOT EXIST UNTIL NOW
# ---------------------------------------------------------------------------------------------
#
# The consent bus is this repository's: the envelope schema, its validator, the consent gate and the
# append-only store with its audit mirror all live here and are tested. What did not exist was a
# PROCESS - nothing listened on the endpoint the two agents dial - so ops/IMAGE_BUILD.md recorded this
# reference as OWNED_BUILD_PENDING and named finding O2 as its blocker. That mattered more than a
# missing image usually does: ops/docker-compose.yml gives both agents a dependency on this service
# reporting healthy, so its absence was the reason a fully gated host still could not stand the
# phase-1 stack up. src/server/process/busServer.ts is that process, and this recipe packages it.
#
# The contents are the pinned runtime, this repository's source, and its production dependencies.
# Nothing else. There is no compiler step and no bundler step: the runtime major pinned in .nvmrc
# strips TypeScript types natively, so `src/` is the artifact rather than an input to one.
#
# ---------------------------------------------------------------------------------------------
# THE FOUR PROPERTIES R28 REQUIRES, AND WHERE EACH ONE IS
# ---------------------------------------------------------------------------------------------
#
#   1. THE BASE IS PINNED TO THE RUNTIME .nvmrc NAMES. Both stages name the same major, and that
#      major is the one .nvmrc pins. The checker reads both files and reports a finding if they
#      disagree. The tag is a MAJOR and not a patch: a patch this file invented would be a version
#      nobody verified exists, and the immutable identity of the bytes is the DIGEST, resolved at
#      build time and recorded in the operator's own build receipt - never written back here.
#
#   2. IT RUNS AS A NON-ROOT USER. The final stage ends on a `USER` directive naming the
#      unprivileged account the base image already provides. Everything needing root - installing the
#      entry points, preparing the store directory - happens before that line, and nothing after it
#      needs root.
#
#   3. NO SECRET AND NO DEPLOYMENT PARTICULAR. There is no `ENV`, no `ARG` carrying a value, no
#      endpoint, no port, and no default for anything the environment supplies. This is the service
#      where holding either agent's secret would be worst, and it holds none: it has no bot token, no
#      model key and no storage credential. Its three configuration entries arrive at run time from
#      the one file compose gives it (<BUS_ENV_PATH>), and the loader refuses to boot on an entry that
#      is missing, empty, or still holding its own placeholder, naming every one of them in a single
#      message (R27). A default in the image would defeat that: it would turn a refused boot into a
#      guessed one, on the one service both agents wait for.
#
#   4. THE HEALTHCHECK COMMAND EXISTS INSIDE IT. Two commands are installed, because two callers ask
#      two different questions:
#
#        nizam-bus-health     no arguments. Derives the store from this service's own environment,
#                             reads the liveness record the server writes beside it, and answers with
#                             an exit status. This is what <BUS_HEALTH_PROBE> in
#                             ops/docker-compose.yml resolves to, and it is why that healthcheck is a
#                             `CMD` with a single element and needs no port.
#        nizam-health-probe   `--store … --throwaway`, the store named as an argument. The grammar
#                             src/server/ops/healthProbe.ts parses and ops/restore/restore.sh invokes
#                             when it boots a throwaway instance over a restored artifact. The name is
#                             not invented here: that module exports it as PROBE_COMMAND_NAME, so the
#                             script, the parser and this file agree on one spelling.
#
#      NEITHER OPENS A SOCKET, and for this service that is the load-bearing half of R9. The
#      readiness answer is computed in process against local files - the store, and the liveness
#      record - so nothing has to be reachable for the orchestrator to get a verdict. A health
#      endpoint would have been a second listener on a service whose whole guarantee is that it is
#      addressable from one internal network and nowhere else.
#
# ---------------------------------------------------------------------------------------------
# WHAT IS DELIBERATELY ABSENT
# ---------------------------------------------------------------------------------------------
#
#   - NO `EXPOSE`, and no port of any kind. The process binds the port its internal endpoint entry
#     names, on the internal network the topology attaches it to, and the topology gives this service
#     no `ports:` key at all - not even one bound to a loopback address, because a published port is
#     reachable from the host and the host is what the proxy runs on. `EXPOSE` documents an intent
#     this image must not have.
#   - NO `HEALTHCHECK`. The orchestrator's check is declared per service in ops/docker-compose.yml
#     with its interval, timeout, retries and start-up grace period. A second one here would be a
#     second policy, and the two would drift.
#   - NO KILL SENTINEL MOUNT AND NO HALT ENTRY. Contract 12 §8.2 names the two agents, the scheduler
#     and the backup service; a publish is halted at the PUBLISHER, before the envelope is built, so
#     halting the store as well would add a second place for the halt to be wrong without closing
#     anything the first place leaves open. The refusal is observed in src/server/process/busServer.ts's
#     own test suite, which shows a halted publish never reaching this store.
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
      'exec node /app/src/server/process/busStart.ts --health' \
      > /usr/local/bin/nizam-bus-health \
 && chmod 0555 /usr/local/bin/nizam-health-probe /usr/local/bin/nizam-bus-health

# The store directory, owned by the unprivileged account BEFORE any volume is attached to it. An
# empty named volume is initialized from the image's own directory at the same path, ownership
# included, so this one line is what lets a non-root process write its own store and the liveness
# record beside it. The alternative is an entrypoint that starts as root to adjust ownership and then
# drops privilege, which reintroduces the root the directive below exists to remove.
RUN install -d -m 0700 -o node -g node /data

# Property 2. Everything after this line runs unprivileged, and nothing after this line needs root.
USER node

# The process, not a shell. `busStart.ts` is one statement wide and turns the outcome into an exit
# status; every behaviour is in `busServer.ts` and the signals tier below it, where it is tested with
# no socket, no disk and no signal. This service takes no argument: unlike the agents it has no bot
# identity, because it is not a bot - it is the channel between two of them.
ENTRYPOINT ["node", "/app/src/server/process/busStart.ts"]
