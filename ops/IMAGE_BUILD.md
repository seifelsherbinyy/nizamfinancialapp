# Images - who owns each one, and how a placeholder becomes a built tag

> Owning contract: PFOS 12 - Two-Agent VPS Deployment & Operations, §2.1 (the six services),
> §10.1 (every value that could identify or reach a deployment is injected, image references
> included). Spec: `.kiro/specs/06-two-agent-vps/` - task 10.8. Owning requirements R28 (a
> Dockerfile for every image this repository owns, and a documented build path producing the exact tag
> the topology references), R24 (no deployment particular in a tracked file), R22 (the
> healthcheck command an image declares exists inside it).
>
> Audited on every test run by `src/server/ops/imageOwnership.ts`. That module reads
> `ops/docker-compose.yml` for the set of image references, reads the table below for the ownership
> record, reads `.nvmrc` for the pinned runtime, and reads each recipe this repository owns. Every
> failure mode is a finding rather than a skip: a reference with no row, a row for a reference the
> topology does not name, a state nobody declared, a recipe a row names and the tree does not hold, a
> recipe the tree holds and no row claims.
>
> Nothing here is executed. Steering §2 permits writing a build recipe and forbids running one, so
> no image is built, no registry is contacted, and no tag is resolved by this repository.

## The defect this document closes, stated plainly

`ops/docker-compose.yml` names six image references and, until this task, the tree held zero
build recipes. That is finding O1. Its consequence is worth stating without hedging: after every
one of the gates G1 through G8 clears, `docker compose up` still could not run, because nothing in
either repository produced the six artifacts the topology names.

R28's answer is not "write six recipes". Four of the six are not this repository's to write, or are
not writable yet, and a recipe that pretended otherwise would be a worse defect than the absence -
an image that builds and then fails at its first real step is harder to diagnose than one that was
never there. So the answer is a complete record: every reference is accounted for, in exactly one
of three states, and the state is checked rather than asserted in prose.

## The three states

| State | What it means | What the audit requires of the row |
|---|---|---|
| `BUILT_HERE` | This repository owns the image and the recipe is in the tree. | A recipe path that exists, pins its base to the `.nvmrc` major, ends on a non-root `USER`, and installs the command the topology's healthcheck resolves to. No blocking task. |
| `EXTERNAL` | Another party owns it. This repository must not build it. | No recipe path. A reason naming who owns it. No blocking task. |
| `OWNED_BUILD_PENDING` | This repository owns it and cannot honestly build it yet, because the process or the entry point the image would run does not exist. | No recipe path. A reason. A blocking task or finding, so the gap has an owner rather than a hope. |

`OWNED_BUILD_PENDING` is a state R28 did not anticipate, and it is recorded rather than avoided.
R28 has a binary ownership axis - the repository owns an image, or it does not - and some of the six
sit in neither box: they are owned here in library form and have no process to package.
Collapsing them into `EXTERNAL` would hand them to a repository that does not have their code;
collapsing them into `BUILT_HERE` would need an entry point nobody has written. The third state is
the honest shape, and the audit makes it strictly stronger than silence, because a row in it must
name the task that closes it.

The state is a waiting room, not a resting place, and it is emptying. Task 10.8 opened it with
three rows. Task 10.19 closed the bus row by writing the process the state existed to admit was
missing - which is the point of recording the gap this way rather than as prose: the row named its
blocker, the blocker was finding O2, and closing O2 for one service moved exactly one row. Two
remain, and each still names what closes it.

## The record

| Image reference | State | Recipe | Blocked by | Why this state, and not another |
|---|---|---|---|---|
| `<FINANCE_IMAGE_REF>` | `BUILT_HERE` | `ops/images/finance-agent/Dockerfile` | - | This repository is the finance agent (steering §1). The process exists as of task 10.7, the readiness command exists, and both are inside the image. |
| `<LIFE_IMAGE_REF>` | `EXTERNAL` | - | - | The life agent is Python and lives in the other repository. Read-only inspection on 2026-08-15 confirmed that its current main revision has no Dockerfile, its webhook module still uses the standard-library server, and its dedup store is not namespaced by bot. No life image is deployable under Contract 12 until the owner-reviewed cross-repository changes and production image are complete. |
| `<PROXY_IMAGE_REF>` | `EXTERNAL` | - | - | The proxy is an upstream release, configured entirely by the file `ops/docker-compose.yml` mounts read-only at its configuration path. There is nothing of this repository's inside it, so a wrapper recipe would add a build step, a supply-chain surface and a second place the version is pinned, in exchange for nothing. Its healthcheck must therefore resolve to a command that upstream provides - see the note below, which is the one obligation this state carries. |
| `<BUS_IMAGE_REF>` | `BUILT_HERE` | `ops/images/signal-bus/Dockerfile` | - | The envelope schema, the validation, the consent gate and the append-only store all live here, so the bus is this repository's. As of task 10.19 the server process does too - `src/server/process/busServer.ts` binds the internal endpoint, refuses an incomplete environment, enforces the schema on every write and the consent gate on every read, and answers readiness as an exec check against local files. It installs the restore drill's probe command and a no-argument health command, and it publishes no port. |
| `<SCHEDULER_IMAGE_REF>` | `BUILT_HERE` | `ops/images/scheduler/Dockerfile` | - | Tick delivery is this repository's to own, and as of task 10.20 a process performs it: `src/server/process/scheduler.ts` refuses an incomplete environment naming every finding at once, honours the kill sentinel in both forms with the file form re-read per tick, parses both tick endpoints through the same internal-endpoint rule the bus uses, retries a failed tick with a bounded backoff instead of dying, and answers readiness as an exec command. It is the smallest of the six because of what it does not hold: no store, no volume, no credential, no cap and no bus endpoint. Its readiness therefore rests on one fact rather than four - the liveness record its own loop writes, read in the `storeless` probe mode - and the record lives in the platform's temporary directory because an exec healthcheck runs in the service's own container and this service mounts nothing. |
| `<BACKUP_IMAGE_REF>` | `OWNED_BUILD_PENDING` | - | `task 10.9` | `ops/backup/backup.sh` lives here and fixes the tool set exactly - the engine's snapshot statement, the public-key encryption, the shred, and the readiness probe the drill under `ops/restore/restore.sh` invokes. But the script's fourth step calls the `nizam-backup` uploader, and that uploader does not exist: the live storage adapter is gated on G5. An image whose entrypoint fails at step four after writing a plaintext snapshot is not a partial backup, it is a new failure mode. Task 10.9 owns the wiring and therefore owns the recipe. |

### The one obligation the `EXTERNAL` proxy row carries

`ops/docker-compose.yml` declares a healthcheck for every service, the proxy included, and R22 is
satisfied only if the command a healthcheck names exists inside the container it runs in. For a
`BUILT_HERE` image this repository guarantees that, and the audit checks it. For the proxy it cannot:
the command must be one the upstream release already ships. So `<PROXY_HEALTH_PROBE>` resolves to a
subcommand of the proxy's own binary, which is present in every published variant of it, and not
to a downloader or a shell utility that a minimal variant may well omit. Recorded here because it is
the kind of assumption that is discovered at first start, in the one place where nothing else is
working either.

## How a placeholder becomes a built tag

The property this section exists to establish is that one value is resolved once, and both the
build and the topology receive that same value - so they cannot disagree. Not "a documented
convention that they should match": there is nothing to match, because there is only one string.

1. The operator resolves the reference in the deployment session, outside this repository, in the
   untracked file that already holds every other particular. Its shape is
   `<IMAGE_NAMESPACE>/<IMAGE_NAME>:<IMAGE_TAG>` - a namespace the operator controls, the image's own
   name, and a tag. This repository never learns any of the three (R24, contract 12 §10.1).
2. The tag is immutable. `ops/runbook/ROLLBACK.md` reverts a service by naming its previous tag
   and relies on that tag still naming the same bytes it named while it was serving. A tag that moves
   turns a rollback into a coin flip. So the tag is derived from something that cannot be reused - the
   source revision the image was built from - and never from a word like *latest*, which is the exact
   shape of a moving tag.
3. The build is run from the repository root, with the recipe named explicitly and the resolved
   reference given as the tag:

   ```
   docker build --file ops/images/finance-agent/Dockerfile --tag <FINANCE_IMAGE_REF> .
   docker build --file ops/images/signal-bus/Dockerfile --tag <BUS_IMAGE_REF> .
   docker build --file ops/images/scheduler/Dockerfile --tag <SCHEDULER_IMAGE_REF> .
   ```

   Each recipe names its own reference on its own statement, which is the whole of the property: one
   value is resolved once and both the build and the topology receive that same string, so there is
   nothing to reconcile. The context is the root because the recipe copies `package.json`, `package-lock.json` and `src`,
   and the root `.dockerignore` is what keeps the untracked secret material, the local environment
   files and the browser bundle out of that context. Read that file before widening any `COPY`.
4. The digest is recorded in the operator's own build receipt, not here. `docker image inspect`
   reports it; it is the immutable identity of the bytes, and it belongs beside every other
   particular in the untracked operator file. A digest written back into this repository would be a
   deployment particular, for the same reason a tag is.
5. The same resolved value is substituted into `ops/docker-compose.yml`'s `image:` entry for that
   service when the operator materializes the topology. One value, two consumers, no reconciliation
   step - which is the whole of the property. The audit holds the other half: the template's `image:`
   entries stay placeholders in the tree, so a resolved reference can never be committed back.

A reference in state `EXTERNAL` skips steps 3 and 4: the operator resolves it in step 1 to a release
the owning party published, and pulls it. A reference in state `OWNED_BUILD_PENDING` has no step at
all yet, which is precisely why it carries a blocking task.

## Why there is still no build step, and what had to change instead (F20, resolved)

The decision: every relative specifier under `src/` and `tests/` carries its real extension, and
`allowImportingTsExtensions` is enabled. There is no compile step, no emitted output, and `src/` is
still the artifact. Recorded here because this document owns the build path, and the alternative
would have changed it.

### The defect

Every relative import in this repository used to be written extensionless - `import { main } from './main'`.
The project's own toolchain resolves that: `moduleResolution: "bundler"`, and Vite and Vitest search
the same way. Node's ESM resolver performs no extension search. Every recipe above launches source
directly with bare `node`, so:

```
node src/server/process/start.ts
  → Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/src/server/process/main'
```

It failed on the first import, before any environment was read, on every host, in every mode - measured
against Node v24.14.1, the major `.nvmrc` pins. It took down all three `ENTRYPOINT` lines, all four
`--health` commands, the restore drill's `probe.ts`, and `npm start` / `npm run health`. That is finding
F20, and its consequence is the same shape as O1's, one layer in: with every gate G1 through G8
observed, `docker compose up` still stood up nothing, because each container exited immediately.

It hid behind a green suite. Tasks 10.7, 10.19, 10.20 and 10.21 proved these processes through Vitest,
which imports them through the project's resolver rather than the container's. 2126 passing tests
were evidence about the logic and no evidence at all about the launch.

### The two candidates, weighed on speed

The owner's ranking criterion is speed: between two correct options, the one that is live sooner.

| | (a) an extension on every relative specifier | (b) a build step emitting runnable modules |
|---|---|---|
| Artifacts that move | `tsconfig.json`, and 205 files under `src/`+`tests/` - mechanically, one token each | the three recipes above, this document, `package.json`, plus a new emitted tree |
| This document's own claim | unchanged: `src/` stays the artifact | contradicted: every recipe's opening paragraph states there is no compiler step |
| Steering §1's invariant | untouched | at risk - a compile output is a second copy of the money core, and §1 states the one invariant this repository never trades |
| Browser build | unchanged; Vite resolves an explicit extension natively | a second output tree to keep out of the bundle (AC08b) |
| Vitest | unchanged; it resolves an explicit extension natively | tests would run against source while images ran against output - two resolutions, one of them unobserved |
| Can it regress silently? | no, and this is the deciding row | yes: a stale or partial emit produces an image that starts and is wrong |

(a) was chosen. It moves more files and fewer *kinds* of thing, and the count is the wrong measure:
205 single-token edits in one mechanical pass are cheaper and far less dangerous than four coupled
artifacts plus a new output tree, and every audit already written against these recipes keeps holding
without an edit. Zero Dockerfile lines changed, which is the clearest statement of why it was
faster - the recipes were correct all along, and the source they copy was not.

`allowImportingTsExtensions` is legal only alongside `noEmit`, which this project already sets, and the
pairing is asserted. The permission is therefore not a loosening: it is the compiler agreeing with a
runtime that emits nothing.

### The check that holds it

The lesson of F20 is that a suite passing through a different resolver proved nothing, so the guard
asserts the real launch path, and it is reported under AC16 rather than as a twenty-first check
- the harness still runs twenty, and that count is asserted in several documents. AC16 already owned
the claim *this repository runs on the runtime it pins*; `scripts/verify/launch-path.mjs` finishes it:

- Static. No relative specifier in the repository's own content is extensionless. Catches a module
  that is not reachable from an entrypoint *yet*, which is where the next instance would begin.
- Launch. All four shims are spawned with bare `node` and an environment holding nothing of the
  developer machine. Each must reach the loader - refuse the environment with the aggregate, or
  answer not-ready - rather than die on module resolution.
- Vacuity. A missing entrypoint, an empty case list, an exit code that is not the refusal, output on
  a stream that must stay silent, and a specifier count below its floor are all findings. So is a
  dead detector: the launch half ends by spawning a synthetic module with exactly the F20 shape and
  requiring it to fail, because a guard that cannot fail is not a guard.

`src/server/ops/launchPath.test.ts` holds the cross-artifact half at test time: each recipe's
`ENTRYPOINT`, each installed `exec node …` line, and both npm scripts name a file that exists and is one
of the four; the launch graph resolves with no search; and it contains no path alias, which the
extension rule would accept and the runtime would still refuse.

One workaround died with the finding. `scripts/ladder/ts-resolve.mjs` supplied exactly the one
resolution Node lacked so rung L0 could be observed at all; the runtime now performs that resolution
itself, so the hook is deleted and `scripts/ladder/l0-config.mjs` launches the entrypoint with bare
`node` - which is what turns L0's evidence into evidence about the real launch path rather than about
a resolver no container has.

## The port posture this build path assumes (F12, resolved)

The certificate challenge is TLS-ALPN-01 on `<TLS_PORT>` alone. The cleartext challenge port is
neither opened in the firewall nor bound by the topology. Requirement R30 set out two
admissible resolutions and deliberately did not choose; the design delta D5 said the same and
named this task as the one that decides. This is the decision, with its reasoning.

Why this one. The owner's ranking criterion is speed, and speed here is a question of how many
artifacts have to change and how many of them are the kind a mistake hides in.

- The alternative - publishing the cleartext port as a second port on the proxy service - costs four
  edits that all have to land together: a second `ports:` entry in the topology, the removal of the
  challenge-disabling directive from both sites in `ops/Caddyfile`, a widened firewall allowance,
  and a relaxation of the assertion in `src/server/ops/composeTemplate.ts` that exactly one host port
  is published. Each is small; together they widen the public surface of the deployment from one port
  to two, permanently, in exchange for a challenge that is not needed.
- This resolution costs one edit, to the certificate-challenge line inside G1 of
  `ops/DEPLOYMENT_CONTROL.md`, because every other artifact was already in this posture and nothing had
  noticed: the topology publishes exactly one host port, and `ops/Caddyfile` already disables the
  cleartext challenge on both sites and turns off the redirect hosts that would otherwise stand up on
  that port. The choice that requires no artifact to move is the fast one, and here it is also the
  narrower one, which is unusual enough to be worth stating rather than assuming.
- It settles the direction the existing files already leaned. Choosing the alternative would have
  meant undoing two correct, commented, asserted decisions in order to reopen a port.

What it obliges, and where it is checked. `ops/DEPLOYMENT_CONTROL.md`'s G1 now records the resolution
and states that no cleartext challenge port is required - which is the record R30 demands, and the one
edit R30 obliges, since the advice that section previously carried is wrong under this choice.
`src/server/ops/imageOwnership.ts` holds the cross-artifact assertion in both directions: it reads
which challenge the register names, and requires the ports the topology binds and the directive the
proxy configuration carries to match that choice. It is neutral about which resolution was picked,
so it would have held the other one just as tightly - what it refuses is a resolution recorded in one
artifact and contradicted by another. It also compares the firewall allowance the register records
against the host ports the topology publishes, excluding the administrative port, which is the literal
assertion R30 asks for.

It is recorded here as well as in the register because it is a property of what these images run: an
image built for the cleartext challenge would need that port published for it, and no recipe in this
directory asks for one.

Phase 1 is unaffected either way. It ships on long polling, publishes no host port and obtains no
certificate. The decision binds phase 2, which is why R30 requires it closed before phase 2 begins
rather than during it.

## The phase-1 posture is a property of the topology, not a habit

Phase 1 publishes no host port at all. That used to be an operator convention - remember not to
start the proxy - and a bare `docker compose up` broke it silently. It is now structural: the proxy
service, the only service with a published port, carries a `profiles:` entry, so it does not start
unless that profile is named explicitly. `src/server/ops/composeTemplate.ts` asserts both directions
of it - the port-publishing service is profile-gated, and every service phase 1 actually needs is
not - so the property cannot be removed by an edit that looks tidy.

### Which services phase 1 starts, written down (task 10.22)

Three of the six, named explicitly:

```
docker compose --file <COMPOSE_FILE> up --detach signalbus finance-agent scheduler
```

Task 10.20 flagged that no file said this, which left the selection to whatever the operator
typed. It is now stated here and held as data in `PHASE_ONE_SERVICES` in
`src/server/ops/composeTemplate.ts`, and the audit reads this command back and compares the two, so
neither can move alone.

The three absences each have a reason rather than an omission:

| Service | Why phase 1 does not start it |
|---|---|
| `caddy` | Phase 2. It is the only service with a published port and it carries `profiles: [phase2]`, so it does not start unless that profile is named. |
| `life-agent` | The other repository's, which steering §6 forbids this session from modifying. Under the authorised option (b) it stays created, hardened and idle while the finance agent ships first. |
| `backup` | Its image is `OWNED_BUILD_PENDING` on task 10.9: the uploader the fourth step of `ops/backup/backup.sh` calls does not exist yet, and an entrypoint that fails after writing a plaintext snapshot is a new failure mode rather than a partial backup. |

Naming the services is what makes the selection safe, not what makes it convenient. A bare start
would bring up `life-agent` and `backup` as well, and until task 10.22 the `scheduler` additionally
declared a start dependency on `life-agent`, so a bare start waited for ever on a service phase 1
does not run - and naming the scheduler dragged the life agent in with it. The owner relaxed that
dependency on 2026-08-10: a tick to an absent agent is already an abandoned delivery with a bounded
backoff rather than a crash, so the condition bought a start-up wait and no safety property. The rule
that replaced it is general and asserted: no service phase 1 runs declares a start dependency on a
service phase 1 does not run (R35). `caddy` keeps its own life dependency, because it is phase 2
and profile-gated anyway, so it costs phase 1 nothing.

## What this document never contains

No namespace, no image name, no tag, no digest, no registry, no address, no port literal, and no
credential. Every one of them is a deployment particular, and this file is tracked in a public
repository (steering §0b). What it contains is the shape of the command and the record of who owns
what, which is what a reader needs and what an attacker cannot use.
