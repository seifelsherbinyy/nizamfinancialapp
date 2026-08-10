# Images - who owns each one, and how a placeholder becomes a built tag

> Owning contract: **PFOS 12 - Two-Agent VPS Deployment & Operations**, §2.1 (the six services),
> §10.1 (every value that could identify or reach a deployment is injected, image references
> included). Spec: `.kiro/specs/06-two-agent-vps/` - **task 10.8**. Owning requirements **R28** (a
> Dockerfile for every image this repository owns, and a documented build path producing the exact tag
> the topology references), **R24** (no deployment particular in a tracked file), **R22** (the
> healthcheck command an image declares exists inside it).
>
> **Audited on every test run** by `src/server/ops/imageOwnership.ts`. That module reads
> `ops/docker-compose.yml` for the set of image references, reads the table below for the ownership
> record, reads `.nvmrc` for the pinned runtime, and reads each recipe this repository owns. Every
> failure mode is a finding rather than a skip: a reference with no row, a row for a reference the
> topology does not name, a state nobody declared, a recipe a row names and the tree does not hold, a
> recipe the tree holds and no row claims.
>
> **Nothing here is executed.** Steering §2 permits writing a build recipe and forbids running one, so
> no image is built, no registry is contacted, and no tag is resolved by this repository.

## The defect this document closes, stated plainly

`ops/docker-compose.yml` names **six** image references and, until this task, the tree held **zero**
build recipes. That is finding **O1**. Its consequence is worth stating without hedging: after every
one of the gates G1 through G8 clears, `docker compose up` still could not run, because nothing in
either repository produced the six artifacts the topology names.

R28's answer is not "write six recipes". Four of the six are not this repository's to write, or are
not writable yet, and a recipe that pretended otherwise would be a worse defect than the absence -
an image that builds and then fails at its first real step is harder to diagnose than one that was
never there. So the answer is a **complete record**: every reference is accounted for, in exactly one
of three states, and the state is checked rather than asserted in prose.

## The three states

| State | What it means | What the audit requires of the row |
|---|---|---|
| `BUILT_HERE` | This repository owns the image and the recipe is in the tree. | A recipe path that **exists**, pins its base to the `.nvmrc` major, ends on a non-root `USER`, and installs the command the topology's healthcheck resolves to. No blocking task. |
| `EXTERNAL` | Another party owns it. This repository must not build it. | No recipe path. A reason naming **who** owns it. No blocking task. |
| `OWNED_BUILD_PENDING` | This repository owns it and **cannot honestly build it yet**, because the process or the entry point the image would run does not exist. | No recipe path. A reason. A **blocking task or finding**, so the gap has an owner rather than a hope. |

`OWNED_BUILD_PENDING` is a state R28 did not anticipate, and it is recorded rather than avoided.
R28 has a binary ownership axis - the repository owns an image, or it does not - and two of the six
sit in neither box: the consent bus and the scheduler are owned here **in library form** and have no
process to package. Collapsing them into `EXTERNAL` would hand them to a repository that does not
have their code; collapsing them into `BUILT_HERE` would need an entry point nobody has written. The
third state is the honest shape, and the audit makes it strictly stronger than silence, because a row
in it must name the task that closes it.

## The record

| Image reference | State | Recipe | Blocked by | Why this state, and not another |
|---|---|---|---|---|
| `<FINANCE_IMAGE_REF>` | `BUILT_HERE` | `ops/images/finance-agent/Dockerfile` | - | This repository is the finance agent (steering §1). The process exists as of task 10.7, the readiness command exists, and both are inside the image. |
| `<LIFE_IMAGE_REF>` | `EXTERNAL` | - | - | The life agent is Python and lives in the **other repository**, which steering §6 forbids this session from modifying. Its image is additionally downstream of the three unapplied change specifications under `ops/nizamcore-patches/`, so this repository could not build a correct one even if it were permitted to try. |
| `<PROXY_IMAGE_REF>` | `EXTERNAL` | - | - | The proxy is an **upstream release**, configured entirely by the file `ops/docker-compose.yml` mounts read-only at its configuration path. There is nothing of this repository's inside it, so a wrapper recipe would add a build step, a supply-chain surface and a second place the version is pinned, in exchange for nothing. Its healthcheck must therefore resolve to a command that **upstream** provides - see the note below, which is the one obligation this state carries. |
| `<BUS_IMAGE_REF>` | `OWNED_BUILD_PENDING` | - | finding `O2` | The envelope schema, the validation, the consent gate and the signal store all live here, so the bus is this repository's. What does not exist is a bus **server process**: nothing listens on the endpoint the two agents dial, so there is no entry point for a recipe to name. |
| `<SCHEDULER_IMAGE_REF>` | `OWNED_BUILD_PENDING` | - | finding `O2` | Same shape as the bus, and for the same reason: tick delivery is this repository's to own, and no process performs it. The scheduler mounts no store, so its recipe is small - it is absent because its process is, not because it is hard. |
| `<BACKUP_IMAGE_REF>` | `OWNED_BUILD_PENDING` | - | `task 10.9` | `ops/backup/backup.sh` lives here and fixes the tool set exactly - the engine's snapshot statement, the public-key encryption, the shred, and the readiness probe the drill under `ops/restore/restore.sh` invokes. But the script's fourth step calls the `nizam-backup` uploader, and that uploader does not exist: the live storage adapter is gated on G5. An image whose entrypoint fails at step four after writing a plaintext snapshot is not a partial backup, it is a new failure mode. Task 10.9 owns the wiring and therefore owns the recipe. |

### The one obligation the `EXTERNAL` proxy row carries

`ops/docker-compose.yml` declares a healthcheck for every service, the proxy included, and R22 is
satisfied only if the command a healthcheck names exists inside the container it runs in. For a
`BUILT_HERE` image this repository guarantees that, and the audit checks it. For the proxy it cannot:
the command must be one the upstream release already ships. So `<PROXY_HEALTH_PROBE>` resolves to a
**subcommand of the proxy's own binary**, which is present in every published variant of it, and not
to a downloader or a shell utility that a minimal variant may well omit. Recorded here because it is
the kind of assumption that is discovered at first start, in the one place where nothing else is
working either.

## How a placeholder becomes a built tag

The property this section exists to establish is that **one value is resolved once**, and both the
build and the topology receive that same value - so they cannot disagree. Not "a documented
convention that they should match": there is nothing to match, because there is only one string.

1. **The operator resolves the reference in the deployment session**, outside this repository, in the
   untracked file that already holds every other particular. Its shape is
   `<IMAGE_NAMESPACE>/<IMAGE_NAME>:<IMAGE_TAG>` - a namespace the operator controls, the image's own
   name, and a tag. This repository never learns any of the three (R24, contract 12 §10.1).
2. **The tag is immutable.** `ops/runbook/ROLLBACK.md` reverts a service by naming its previous tag
   and relies on that tag still naming the same bytes it named while it was serving. A tag that moves
   turns a rollback into a coin flip. So the tag is derived from something that cannot be reused - the
   source revision the image was built from - and never from a word like *latest*, which is the exact
   shape of a moving tag.
3. **The build is run from the repository root**, with the recipe named explicitly and the resolved
   reference given as the tag:

   ```
   docker build --file ops/images/finance-agent/Dockerfile --tag <FINANCE_IMAGE_REF> .
   ```

   The context is the root because the recipe copies `package.json`, `package-lock.json` and `src`,
   and the root `.dockerignore` is what keeps the untracked secret material, the local environment
   files and the browser bundle out of that context. **Read that file before widening any `COPY`.**
4. **The digest is recorded in the operator's own build receipt**, not here. `docker image inspect`
   reports it; it is the immutable identity of the bytes, and it belongs beside every other
   particular in the untracked operator file. A digest written back into this repository would be a
   deployment particular, for the same reason a tag is.
5. **The same resolved value is substituted into `ops/docker-compose.yml`'s `image:` entry** for that
   service when the operator materializes the topology. One value, two consumers, no reconciliation
   step - which is the whole of the property. The audit holds the other half: the template's `image:`
   entries stay placeholders in the tree, so a resolved reference can never be committed back.

A reference in state `EXTERNAL` skips steps 3 and 4: the operator resolves it in step 1 to a release
the owning party published, and pulls it. A reference in state `OWNED_BUILD_PENDING` has no step at
all yet, which is precisely why it carries a blocking task.

## The port posture this build path assumes (F12, resolved)

**The certificate challenge is TLS-ALPN-01 on `<TLS_PORT>` alone. The cleartext challenge port is
neither opened in the firewall nor bound by the topology.** Requirement **R30** set out two
admissible resolutions and deliberately did not choose; the design delta **D5** said the same and
named this task as the one that decides. This is the decision, with its reasoning.

**Why this one.** The owner's ranking criterion is **speed**, and speed here is a question of how many
artifacts have to change and how many of them are the kind a mistake hides in.

- The alternative - publishing the cleartext port as a second port on the proxy service - costs four
  edits that all have to land together: a second `ports:` entry in the topology, the removal of the
  challenge-disabling directive from **both** sites in `ops/Caddyfile`, a widened firewall allowance,
  and a relaxation of the assertion in `src/server/ops/composeTemplate.ts` that exactly one host port
  is published. Each is small; together they widen the public surface of the deployment from one port
  to two, permanently, in exchange for a challenge that is not needed.
- This resolution costs **one** edit, to the certificate-challenge line inside G1 of
  `ops/GATE_REGISTER.md`, because every other artifact was already in this posture and nothing had
  noticed: the topology publishes exactly one host port, and `ops/Caddyfile` already disables the
  cleartext challenge on both sites and turns off the redirect hosts that would otherwise stand up on
  that port. The choice that requires no artifact to move is the fast one, and here it is also the
  narrower one, which is unusual enough to be worth stating rather than assuming.
- It settles the direction the existing files already leaned. Choosing the alternative would have
  meant undoing two correct, commented, asserted decisions in order to reopen a port.

**What it obliges, and where it is checked.** `ops/GATE_REGISTER.md`'s G1 now records the resolution
and states that no cleartext challenge port is required - which is the record R30 demands, and the one
edit R30 obliges, since the advice that section previously carried is wrong under this choice.
`src/server/ops/imageOwnership.ts` holds the cross-artifact assertion in both directions: it reads
which challenge the register names, and requires the ports the topology binds and the directive the
proxy configuration carries to match **that** choice. It is neutral about which resolution was picked,
so it would have held the other one just as tightly - what it refuses is a resolution recorded in one
artifact and contradicted by another. It also compares the firewall allowance the register records
against the host ports the topology publishes, excluding the administrative port, which is the literal
assertion R30 asks for.

It is recorded here as well as in the register because it is a property of what these images run: an
image built for the cleartext challenge would need that port published for it, and no recipe in this
directory asks for one.

**Phase 1 is unaffected either way.** It ships on long polling, publishes no host port and obtains no
certificate. The decision binds phase 2, which is why R30 requires it closed before phase 2 begins
rather than during it.

## The phase-1 posture is a property of the topology, not a habit

Phase 1 publishes **no host port at all**. That used to be an operator convention - remember not to
start the proxy - and a bare `docker compose up` broke it silently. It is now structural: the proxy
service, the only service with a published port, carries a `profiles:` entry, so it does not start
unless that profile is named explicitly. `src/server/ops/composeTemplate.ts` asserts both directions
of it - the port-publishing service is profile-gated, and every service phase 1 actually needs is
**not** - so the property cannot be removed by an edit that looks tidy.

## What this document never contains

No namespace, no image name, no tag, no digest, no registry, no address, no port literal, and no
credential. Every one of them is a deployment particular, and this file is tracked in a public
repository (steering §0b). What it contains is the shape of the command and the record of who owns
what, which is what a reader needs and what an attacker cannot use.
