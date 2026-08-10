# NIZAM - the finance-agent image. A BUILD RECIPE, NOT A DEPLOYMENT. NOTHING HERE IS RUN BY AN AGENT.
#
# Owning contract: PFOS 12 - Two-Agent VPS Deployment & Operations, §2.1 (the finance agent is one of
#   the six services), §3.2.1 (its store lives on its own volume), §7.3 (the readiness command the
#   orchestrator polls), §8 (the halt sentinel is examined, never cleared, from inside).
# Spec: .kiro/specs/06-two-agent-vps/ - task 10.8. Owning requirements R28 (a Dockerfile for every
#   image this repository owns, and a documented build path producing the tag compose references),
#   R29 (the process this image runs), R22 (a healthcheck command that actually exists in here),
#   R24 (no secret and no deployment particular in a tracked file).
# Steering: two-agent-vps.md §1 (this agent is Node + TypeScript and reuses the tested money core),
#   §2 (writing this file is permitted; BUILDING IT AGAINST A NETWORK IS NOT), §0b (public repo).
# Companion: ops/IMAGE_BUILD.md - the ownership record and the build path. It is the document that
#   answers "how does <FINANCE_IMAGE_REF> become a tag", and it is audited on every test run by
#   src/server/ops/imageOwnership.ts, which also re-reads the properties asserted below.
#
# ---------------------------------------------------------------------------------------------
# WHAT THIS IMAGE IS, IN ONE PARAGRAPH
# ---------------------------------------------------------------------------------------------
#
# The pinned runtime, this repository's source, and its production dependencies. Nothing else. There
# is no compiler step and no bundler step: the runtime major pinned in .nvmrc strips TypeScript types
# natively, so `src/` is the artifact rather than an input to one. That is a deliberate property and
# not a shortcut - a build step would produce a second copy of the money core, and steering §1 states
# the one invariant this repository never trades: there will never be a second implementation of money.
#
# ---------------------------------------------------------------------------------------------
# THE FOUR PROPERTIES TASK 10.8 REQUIRES, AND WHERE EACH ONE IS
# ---------------------------------------------------------------------------------------------
#
#   1. THE BASE IS PINNED TO THE RUNTIME .nvmrc NAMES. Both stages below name the same major, and
#      that major is the one .nvmrc pins. The checker reads .nvmrc and this file and reports a
#      finding if they disagree, so bumping one without the other is a failing test rather than an
#      image that runs a runtime the gates were never verified on.
#
#      The tag is a MAJOR and not a patch, and that is a decision rather than laziness: a patch this
#      file invented would be a version nobody verified exists. The immutable identity of the bytes
#      is the DIGEST, which is resolved at build time and recorded in the operator's own build
#      receipt (ops/IMAGE_BUILD.md, step 4) - never written back here, because a digest is a
#      deployment particular in the same sense a tag is (contract 12 §10.1).
#
#   2. IT RUNS AS A NON-ROOT USER. The final stage ends on a `USER` directive naming the unprivileged
#      account the base image already provides, so the process has no privilege to lose and nothing
#      in this file creates one. Everything that needs root - installing the two entry points,
#      preparing the store directory - happens BEFORE that directive and nothing after it needs it.
#
#   3. NO SECRET AND NO DEPLOYMENT PARTICULAR. There is no `ENV`, no `ARG` carrying a value, no
#      endpoint, no path outside this image, and no default for anything the environment supplies.
#      Every configuration entry arrives at run time from the one file compose gives this service
#      (<FINANCE_ENV_PATH>), and the loader refuses to boot on an entry that is missing, empty, or
#      still holding its own placeholder (R27). An image with a default would defeat that: it would
#      turn a refused boot into a guessed one.
#
#   4. THE HEALTHCHECK COMMAND EXISTS INSIDE IT. Two commands are installed, because two callers ask
#      two different questions, and one command that served both would have to take an argument the
#      orchestrator has nowhere to put:
#
#        nizam-finance-health   no arguments. Derives the store from the service's own environment
#                               and answers with an exit status. This is what <FINANCE_HEALTH_PROBE>
#                               in ops/docker-compose.yml resolves to, and it is why that healthcheck
#                               is a `CMD` with a single element and needs no port.
#        nizam-health-probe     `--store … --throwaway`, the store named as an argument. The grammar
#                               src/server/ops/healthProbe.ts parses and ops/restore/restore.sh
#                               invokes when it boots a throwaway instance over a restored artifact.
#                               The name is not invented here: that module exports it as
#                               PROBE_COMMAND_NAME so the script, the parser and this file agree on
#                               one spelling.
#
#      Neither opens a socket. The probe is an exec check computed in process against a local file,
#      so a readiness answer costs no listener - which is what lets §2.2.1 hold that no agent process
#      binds a public port.
#
# ---------------------------------------------------------------------------------------------
# WHAT IS DELIBERATELY ABSENT
# ---------------------------------------------------------------------------------------------
#
#   - NO `EXPOSE`, and no port of any kind. Phase 1 runs the transport in long-poll mode, which is
#     outbound only and binds nothing (R29). In webhook mode the process listens on
#     FINANCE_CONTAINER_PORT inside the container and the proxy reaches it over the agent's own
#     network; a published port belongs to the proxy service and to nothing else (§2.2.1). `EXPOSE`
#     documents an intent this image must not have.
#   - NO `HEALTHCHECK`. The orchestrator's check is declared per service in ops/docker-compose.yml,
#     with the interval, timeout, retries and start-up grace period that file already carries. A
#     second one here would be a second policy, and the two would drift.
#   - NO development dependency, and no lifecycle script. `--omit=dev` keeps the test runner, the
#     linter and the browser toolchain out of a running service, and `--ignore-scripts` means no
#     package's install hook executes during the build.
#   - NO `.env` file, no key, no token, and nothing from .secrets/. The build context excludes them
#     at the root .dockerignore, so they cannot arrive by accident through a broad `COPY`.

# ---------------------------------------------------------------------------------------------
# Stage one: production dependencies, resolved from the lockfile and nothing else
# ---------------------------------------------------------------------------------------------
FROM node:24-bookworm-slim AS dependencies

WORKDIR /app

# The lockfile is the whole input. `npm ci` fails rather than resolving a range, which is what makes
# this stage reproducible; AC16 holds the same property for the development tree.
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
      'exec node /app/src/server/process/start.ts --health' \
      > /usr/local/bin/nizam-finance-health \
 && chmod 0555 /usr/local/bin/nizam-health-probe /usr/local/bin/nizam-finance-health

# The store directory, owned by the unprivileged account BEFORE any volume is attached to it.
# An empty named volume is initialized from the image's own directory at the same path, ownership
# included, so this one line is what lets a non-root process write its own store. It is not a
# workaround: the alternative is an entrypoint that starts as root to adjust ownership and then drops
# privilege, which reintroduces the root the directive below exists to remove.
RUN install -d -m 0700 -o node -g node /data

# Property 2. Everything after this line runs unprivileged, and nothing after this line needs root.
USER node

# The process, not a shell. `start.ts` is one statement wide and turns the outcome into an exit
# status; every behaviour is in `main.ts` and below it, where it can be tested with no socket, no
# disk and no signal. The bot identity is an ARGUMENT rather than an entry (finding F19), so the
# operator appends `--bot-id …` in the service command; absent or empty, the loader refuses the boot.
ENTRYPOINT ["node", "/app/src/server/process/start.ts"]
