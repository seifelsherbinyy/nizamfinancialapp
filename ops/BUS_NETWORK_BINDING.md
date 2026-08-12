# Signal bus network binding - internal only, and never published

> **Owning contract:** PFOS 12 - Two-Agent VPS Deployment & Operations, §2.2.5, §2.2.6, §4.1, §12 (T5, T6).
> **Spec:** `.kiro/specs/06-two-agent-vps/` - requirement **R9**, constrained by **R24** (public repo).
> **Steering:** `.kiro/steering/two-agent-vps.md` §4.2 ("the bus is the only channel").
> **Phase:** 3.3 authored this requirement. **Phase 7 must honour it** - tasks 7.1 (`ops/docker-compose.yml`)
> and 7.2 (`ops/Caddyfile`) are the artifacts bound by it.

## THIS FILE IS A REQUIREMENT, NOT AN ARTIFACT. NOTHING HERE IS EXECUTED BY AN AGENT.

It carries `<ANGLE_BRACKET>` placeholders only. No host, no address, no port, no path segment, no
service name that resolves to anything real. Phase 3.3 does not author the compose file or the proxy
configuration; it states the constraint those files are checked against, so that 7.1 and 7.2 cannot be
authored in a way that quietly violates R9 and pass review anyway.

## The requirement, in one paragraph

The signal bus service is attached to an **internal** container network with no route to the reverse
proxy and no route out. It listens on that internal network only. **No proxy rule reaches it, and adding
one is a contract violation** (§2.2.5). Reaching the bus from outside the internal network must fail as
a **connection refusal at the network layer** - not as an authentication check that denies a reachable
port (§2.2.6). An authenticated-but-reachable bus is a weaker guarantee and does not satisfy R9 on its
own.

Why the distinction is the whole point: an authentication check is code, and code can be misordered,
disabled under load, or forgotten on a new route. A service that is not on any network the public can
address has nothing to check, because there is no connection to check. This is the same argument as
consent-by-absence in §4.3, applied one layer down: the safest gate is the one that does not exist
because the path does not exist.

## What Phase 7 must do (7.1 - `ops/docker-compose.yml`)

1. Declare a network marked **internal**, e.g. `<BUS_NETWORK_NAME>` with the internal flag set. An
   internal network has no external connectivity; that flag is the mechanism, not a label.
2. Attach the bus service to `<BUS_NETWORK_NAME>` **and to nothing else**. In particular it is not
   attached to whatever network the proxy is on.
3. Publish **no port** for the bus. No `ports:` entry, not even bound to a loopback address. A published
   port is reachable from the host, and the host is what the proxy runs on.
4. Attach each agent to `<BUS_NETWORK_NAME>` in addition to its own proxy-facing network, because the
   agents are the only legitimate clients (§4).
5. Mount the bus volume `<BUS_VOLUME_NAME>` into the bus service only. `signals.db` is owned by the bus
   service and lives on its own volume (§4.1); no agent mounts it, read-only or otherwise.
6. Give the bus its own CPU and memory limit and reservation, like every other service (§2.2.8).

## What Phase 7 must NOT do (7.2 - `ops/Caddyfile`)

1. **No site block, route, handle, or reverse-proxy directive that names the bus**, under any hostname,
   any path, any port. Not commented out. Not "for local debugging". A commented-out route is a route
   someone uncomments.
2. No third hostname. The proxy serves exactly `<LIFE_HOSTNAME>` and `<MONEY_HOSTNAME>` (§2.2.3).
3. No wildcard or catch-all upstream that could resolve the bus service name by accident.

The gate register already carries the matching negative for DNS: G2 step 3 forbids creating any record
for the bus, and its verification line asserts the name stays unresolvable.

## How this is verified

| # | Check | The failure it must produce | Requirement |
|---|---|---|---|
| T5 | The bus is reachable only from the internal network | a connection from outside is **refused at the network layer**, not authenticated and denied | **R9** |
| T6 | No proxy rule routes to the bus | a template that adds such a route fails review and the check | R9 |

Operator verification, after G1 and Phase 7 are both done (every value read from the environment,
never typed inline):

```
# 1. the bus publishes nothing - the list must not contain the bus service
<CONTAINER_CLI> compose ps --format '{{.Service}} {{.Ports}}'   # -> bus service shows NO published port

# 2. the bus network is internal, so it has no gateway to the outside
<CONTAINER_CLI> network inspect <BUS_NETWORK_NAME>              # -> internal: true

# 3. an agent CAN reach the bus (the positive control, so 4 below is not vacuous)
<CONTAINER_CLI> compose exec <FINANCE_SERVICE> <PROBE_CMD> <BUS_SERVICE>:<BUS_PORT>   # -> connects

# 4. from the host, and from off the host, the same address is REFUSED
<PROBE_CMD> <HOST_ADDRESS>:<BUS_PORT>                          # -> connection refused
# and via the proxy, on both hostnames, every path:
<PROBE_CMD> https://<MONEY_HOSTNAME>/<ANY_PATH>                 # -> the proxy has no route to the bus

# 5. the proxy configuration names the bus nowhere at all
grep -ci '<BUS_SERVICE>' ops/Caddyfile                         # -> 0
```

Record the **observation** ("bus publishes no port; internal network confirmed; off-host connection
refused at the network layer"), never a value (R24).

Check 5 is the one an automated harness can run without a host, and spec task 9.0 - the
no-deployment-particular scanner - is the natural place for it: a string match asserting the proxy
template names no bus upstream. It fails closed, which is the only useful direction for this rule.

## Where the code half of R9 lives

The store itself is `src/server/signals/signalStore.ts` (Phase 3.3): append-only at the engine, with an
audit mirror, validated on write and again on read. It names no host, no port, and no socket path -
`SignalBusPortConfig.internalEndpointRef` is injected and resolved from the host environment at run time
(`src/server/ports/signalBus.ts`, Phase 2.1). That is deliberate: the code cannot publish a bus it has
no way to address, and the repository cannot leak an address it never held.

**The process is `src/server/process/busServer.ts` (task 10.19).** When this file was written there was
no process at all, which is why it addressed only phases 7.1 and 7.2; the process's own half of R9 is
now three properties, each asserted rather than described:

1. **It binds exactly one port - the one the internal endpoint entry names - and there is no second
   listener of any kind.** The listening boundary it is given takes a PORT and nothing else: no host
   argument, no publish flag. Readiness is an exec check computed against local files, so there is no
   health route to add either. The absence is asserted against the process's own listener set and the
   injected host's own bind record, in both directions, rather than by probing a socket - a socket
   probe that finds nothing is also what a crashed listener, a wrong port and a firewall look like.
2. **It refuses an endpoint that would be reachable anywhere else.** A scheme, a path, an address
   literal, a wildcard, a reserved name that resolves to the container itself, and an out-of-range
   port are each refused at boot rather than coerced. The accepted shape is an internal service name
   and a port - the same shape the verification block above uses - so a deployment cannot be repointed
   at an address the host can reach without the boot failing first.
3. **It authenticates nothing, on purpose.** §2.2.6 is explicit that the correct failure is refusal at
   the network layer rather than an authentication check on a reachable port, and this service holds no
   credential of any kind. So the subscriber a read declares and the producer a publish declares are
   asserted by the client, and the compensating control is item 4 above: exactly two containers can
   address the port at all. That is consistent with the envelope schema, where `producer` has always
   been a field rather than a proof (§4.2); it is written down here so a later reader does not mistake
   the absence for an oversight and "fix" it by adding a credential to the one service where holding
   one would be worst.

Network binding is the second of the four defence layers in §4.6. It survives a misconfigured proxy
rule that exposes an agent. It does **not** substitute for layer 4 - the envelope having no field for a
figure or a narrative - and layer 4 does not substitute for it.
