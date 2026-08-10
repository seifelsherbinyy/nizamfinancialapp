/**
 * NIZAM · The internal endpoint rule — ONE spelling of "reachable only from the internal network"
 * Implemented by: PFOS Contract 12 / Phase 10.20 (spec 06-two-agent-vps)
 * Owning requirements: R9 (a service internal to the deployment is addressed by an internal name on
 *   an internal network, and is never reachable from the host), R24 (a refusal names the RULE it
 *   broke, never the configured value), R27 (an unusable entry refuses the boot rather than being
 *   coerced into something that would work)
 * Depends on: nothing. No filesystem, no network, no clock, no environment read, no error class —
 *   a caller turns a refusal into its own typed error, so this module holds no service identity.
 *
 * ## Why it is shared rather than written twice
 *
 * Task 10.19 wrote this rule for `BUS_INTERNAL_ENDPOINT`: the accepted shape is an internal service
 * name and a port, and a scheme, a path, an address literal, a wildcard, a name that resolves to the
 * container itself and an out-of-range port are each refused rather than repaired. Task 10.20 needed
 * exactly the same rule for the scheduler's two tick endpoints, which are the same kind of value —
 * an internal name the container network resolves — read by a different process.
 *
 * A second copy would eventually differ, and the direction it would differ in is the dangerous one:
 * each refused shape is a way a service ends up **reachable from the host**, or unreachable by the
 * only containers meant to reach it. So the rule lives here once, as a pure classification, and each
 * caller supplies only its own typed refusal and its own entry name — which is all that legitimately
 * differs between them.
 *
 * ## What this rule is NOT
 *
 * It is not the isolation. The network layer does that: `ops/docker-compose.yml` marks the internal
 * networks `internal: true` and gives the internal services no `ports:` key at all. What a process
 * can contribute is a refusal to be REPOINTED at somewhere it must not talk to or listen on, which is
 * what this is, and it is small on purpose.
 */

/**
 * Why an endpoint was refused. A refusal names the rule, never the configured value, so it is safe
 * on an error stream and in a log (R24).
 */
export const INTERNAL_ENDPOINT_REFUSALS = [
  'endpoint_empty',
  'endpoint_carries_a_scheme',
  'endpoint_carries_a_path',
  'endpoint_host_absent',
  'endpoint_host_not_an_internal_name',
  'endpoint_host_reserved',
  'endpoint_port_absent',
  'endpoint_port_not_in_range',
] as const;
export type InternalEndpointRefusal = (typeof INTERNAL_ENDPOINT_REFUSALS)[number];

/** An endpoint on an internal network: one name the container network resolves, and one port. */
export interface InternalEndpoint {
  /** A single internal name — a service name. Never an address, and never a host outside the network. */
  readonly host: string;
  readonly port: number;
}

/** One internal name: a DNS label. An address literal has dots, so it is not one of these. */
const INTERNAL_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

/**
 * Names that resolve to the container itself. Refused, because a process dialling one of these would
 * reach ITSELF, and a process listening on one would be unreachable by the containers that must reach
 * it — in both cases while everything looked configured.
 */
export const RESERVED_ENDPOINT_HOSTS: readonly string[] = ['localhost'];

/** Highest port number. Not a deployment particular: the protocol's own bound. */
export const MAX_ENDPOINT_PORT = 65_535;

export type InternalEndpointOutcome =
  | { readonly ok: true; readonly endpoint: InternalEndpoint }
  | { readonly ok: false; readonly refusal: InternalEndpointRefusal };

/**
 * Classify `raw` as an internal endpoint, or say which rule it broke.
 *
 * The accepted shape is `<name>:<port>` and nothing else. Every other shape is refused rather than
 * coerced, and each refusal is a way the deployment ends up wrong while looking right:
 *
 *  - **a scheme** implies a route through something that speaks one, and no internal service in this
 *    topology has a proxy route of any kind;
 *  - **a path** is the same mistake with a different spelling — a route on a shared host;
 *  - **an address literal or a wildcard** (a dotted quad, `0.0.0.0`, `::`) is not a name an internal
 *    network resolves, and a wildcard in particular is the first half of the exposure R9 forbids;
 *  - **a reserved name** is a service each client would find inside itself;
 *  - **a port outside the protocol's range** is not a port.
 *
 * There is no default and no repair, because the only available default would be "somewhere nobody
 * said".
 */
export function classifyInternalEndpoint(raw: string): InternalEndpointOutcome {
  const value = raw.trim();
  const no = (refusal: InternalEndpointRefusal): InternalEndpointOutcome => ({ ok: false, refusal });

  if (value.length === 0) return no('endpoint_empty');
  if (value.includes('://')) return no('endpoint_carries_a_scheme');
  if (value.includes('/')) return no('endpoint_carries_a_path');

  const separator = value.lastIndexOf(':');
  if (separator < 0) return no('endpoint_port_absent');
  const host = value.slice(0, separator);
  const port = value.slice(separator + 1);

  if (host.length === 0) return no('endpoint_host_absent');
  if (!INTERNAL_NAME.test(host)) return no('endpoint_host_not_an_internal_name');
  if (RESERVED_ENDPOINT_HOSTS.includes(host.toLowerCase())) return no('endpoint_host_reserved');
  if (!/^[0-9]+$/.test(port)) return no('endpoint_port_absent');

  const parsed = Number.parseInt(port, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_ENDPOINT_PORT) {
    return no('endpoint_port_not_in_range');
  }
  return { ok: true, endpoint: { host, port: parsed } };
}
