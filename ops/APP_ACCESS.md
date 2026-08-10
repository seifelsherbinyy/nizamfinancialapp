# Owner-only web access to the application, and the threat model behind it

Owning contract: PFOS 12 - Two-Agent VPS Deployment & Operations. Spec `.kiro/specs/06-two-agent-vps/`,
task 10.18. Owning requirement **R33**. Related: **R9** (nothing binds where the host can be reached
from outside), **R24** (this file names no domain, address, port or credential), **R22** (readiness).

## The decision, in one paragraph

The built single-page application is served **on the loopback interface only**, by an on-demand
**mode of the finance agent's own process** (`--serve-app`), and it is reached over the administrative
tunnel the operator already holds. No host port is published. No password is added. No compose
service is added, no image is added, no environment entry is added. The access control is
**reachability**: to reach the listener at all you must already be inside an authenticated session on
the host.

## Why a mode rather than a seventh service

A seventh service is not one change, it is six: a compose service, a seventh environment template, a
seventh row in `SERVICE_ENTRY_NAMES`, a seventh row in the deployment value ledger and the owner
fill-in sheet, a seventh image row with a recipe, and a seventh healthcheck. That is a real cost, and
it buys nothing here - but the decisive argument is not cost, it is that **a compose service could not
do the job at all**:

1. **A container's loopback is not the host's loopback.** The tunnel terminates on the host's loopback
   interface. A service inside a container binding its own loopback is unreachable from that tunnel,
   and the only way to bridge the two is a `ports:` key - which is exactly what phase 1 forbids and
   what `caddy` is profile-gated to prevent. So a compose service would have to **publish a port** to
   be reachable at all, and then loopback-only would rest on the operator writing the address half of
   a port mapping correctly, every time, rather than on the process refusing anything else.
2. **The built output is deliberately not in the image.** The root `.dockerignore` keeps the browser
   bundle out of the build context, on purpose - the finance-agent image runs a server, and shipping
   the bundle into it would widen the context for no reason. So an in-container app service would need
   either a new image or a new bind mount, both of which are new deployment surface.
3. **On demand beats always on.** The mode exists only while the operator's own session is running it.
   An always-on service is a listener that exists at three in the morning when nobody is watching it,
   for a reader who is asleep.

So the app server is a mode, invoked by the operator on the host, inside the session they have already
authenticated. **`ops/docker-compose.yml` is unchanged by this task**, and that is the point.

## How the operator reaches it

Three steps, and the first two are already part of how the host is administered:

1. Open the administrative tunnel to the host, forwarding a local port to the host's loopback at the
   port chosen in step 2. The tunnel is the authentication; nothing here adds another.
2. On the host, from the repository checkout, build the application and run the mode, naming a port:
   ```
   npm run build
   npm start -- --serve-app --app-port <APP_PORT> --app-root <BUILT_OUTPUT_DIR>
   ```
   **The port is required and has no default.** A default would be a port the operator did not choose
   and did not open in their own tunnel, and a port literal in a tracked file is a deployment
   particular (R24). `--app-root` defaults to the build output directory and can name another, but it
   is resolved through the one containment guard - a root that does not exist serves nothing rather
   than falling back to somewhere wider.
3. Open the forwarded local port in a browser. Readiness can be checked first with
   `npm start -- --serve-app --health`, which answers **0 ready / 1 not ready** and reads a liveness
   record rather than dialling anything.

## What makes loopback-only structural rather than careful

| Property | How it is made true | Where it is asserted |
|---|---|---|
| The bind address is not configurable | No environment entry, and **no flag in the invocation grammar**. The process passes a constant. | A test parses an invocation carrying a bind-shaped token and observes the parsed result hold only a port and a root |
| A caller inside the tree cannot widen it | The listener host applies the refusal to whatever it is handed, so the constant passes and nothing else does | Nine refusal cases, each shown throwing, and each shown naming the rule rather than the value |
| A wildcard is refused explicitly | The all-interfaces wildcard in either protocol, the shell-style one, and an **empty** host are separate refusals - an absent host is the platform's spelling of *every interface*, which is the widest bind there is, so it is refused rather than defaulted | The bind cases, with the empty case among them |
| A name is refused even when it resolves to loopback | Name resolution goes through configuration this process does not own, so a name is a lookup rather than a fact | The `localhost` case |
| No host port is published | This task adds no service and no `ports:` key. `caddy` remains the only service with one, and it is profile-gated | `src/server/ops/composeTemplate.ts`, on every test run |
| Exactly one port is bound | The process's own listener set holds one entry and there is no branch that appends a second, because readiness is a command rather than an endpoint | Asserted in both directions - the process's set and the injected host's bind record - and empty again after shutdown |

## Why no authentication, and why that is the stronger posture

A password would be **weaker** here, not stronger, and the reasoning is the same one contract 12
§2.2.6 gives for the bus:

- A password protects a **reachable** port. The attacker can still connect, still fingerprint, still
  attempt, and still exploit anything in front of the check. Loopback means the connection is refused
  before any of that.
- A password is a secret, and a secret has a lifecycle: it is stored somewhere, typed somewhere,
  possibly reused, and it can leak. This repository is public (steering §0b) and its whole posture is
  that no particular exists in it to leak. Adding a credential would add the first one.
- The owner is **already authenticated** to the host by key before a request can exist. A second
  factor that is weaker than the first adds a place to be wrong, not a layer of defence.

There is therefore nothing to rotate, nothing to store, and nothing to put in the fill-in sheet.

## The alternatives, and why phase 1 took none of them

| Alternative | Why not, for phase 1 |
|---|---|
| **A public port plus basic authentication** | It requires the one thing phase 1 refuses - a published host port - and pays for it with a credential that can leak, be reused or be brute-forced, protecting a port that is reachable the whole time it is being attacked. It also needs a certificate to avoid sending that credential in the clear, and phase 1 has no domain and no certificate, so the honest version of this option is *a password in cleartext over the public internet*. |
| **An identity-aware proxy** | The correct answer eventually, and it presupposes everything phase 1 does not have: a domain (gate **G2**, blocked - the account holds zero zones), a certificate, a running `caddy` (phase 2, profile-gated), and an identity provider that is a third party with a view of when the owner reads their own finances. It is more moving parts than the whole of phase 1, to serve one reader who is already on the host. |
| **A private overlay network** | Sound, and redundant: it re-creates "only the owner's own machine can reach it" using a second network, a second key distribution, and a third-party coordination service, when the operator's existing tunnel already provides exactly that property with nothing new to run or to trust. It also adds a daemon on the host whose own reachability then has to be reasoned about. |
| **A seventh compose service on loopback** | Cannot work without a `ports:` key - see the three reasons above. |

## Threat model

**Assume the attacker knows the architecture exactly** - the repository is public and this document is
in it (steering §0b). What they must not be able to do is reach or impersonate the deployment.

| Threat | Outcome | Why |
|---|---|---|
| Scan the host's public addresses for the application | Nothing answers | The listener binds loopback. There is no port on any routable address, and no service publishes one. |
| Reach it through the reverse proxy | No route exists | The proxy is phase 2 and profile-gated, and it is configured by a file that names two sites, neither of them this. |
| Reach it from another container | No route exists | The mode runs on the host, not on a container network. It is on no network any container is attached to. |
| Guess or steal a password | There is none to steal | Reachability is the control. |
| Read a file outside the published output | Refused | Every request path resolves through the one containment guard: a traversal segment, an absolute override and a symlink out of the root all fail the same single containment test, and an escape answers with the same status as an absent file so the answer confirms nothing. |
| Change data through it | No route accepts a write | Two read methods, and the request body is drained and never read. There is no store connection in the module at all - not a closed one, not one. |
| Learn a figure from a health answer | Not possible | The readiness answer carries a status, a mode, a version and coarse per-check verdicts, and no field a value could occupy (§7.3). |
| Widen the bind with a configuration change | Refused | There is no entry and no flag. The bind path itself refuses anything that is not the loopback interface. |

**What this does not defend against, stated rather than implied.** Anyone who can open an
authenticated session on the host can read the application, because that is precisely the control
being used. Compromise of the operator's own key or workstation is therefore compromise of this access
too. That is the same exposure the host already has for everything else on it - the stores, the
environment files, the sentinel - so this adds no new trust, and it is the reason the tunnel is worth
treating as the security boundary rather than as a convenience.

## What phase 2 changes

Phase 2 has a domain, a certificate and a running proxy, and at that point publishing the application
becomes possible. It does not become automatic:

1. **Nothing publishes it without an explicit owner decision, recorded before it is taken** (R33).
   There is no default, no flag and no entry that opens it, and the refusal above stays in force - so
   phase 2 must add a route deliberately rather than remove a restriction accidentally.
2. If it is published, it is published **behind the proxy** on its own hostname, with the certificate
   and the secret path segment the two agents already use, and with an authentication decision made at
   that time - which is the point at which the identity-aware option becomes cheap, because the proxy
   and the certificate already exist.
3. **Loopback remains available and remains the default.** A phase-2 deployment that publishes the
   application still keeps this mode, because a reader who is already on the host has no reason to go
   out to the internet and back to look at their own figures.

## What this document never contains

No domain, no host address, no port literal, no path on the host, no credential and no figure. The
port and the served root are named by the operator in their own session (R24, steering §0b). The
implementation is `src/server/process/appServer.ts`, wired to the platform in `main.ts`, and the
readiness answer uses the `storeless` mode of `healthProbe.ts` because this mode has no store.
