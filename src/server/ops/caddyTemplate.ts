/**
 * NIZAM · Structural audit of the public entry point template (ops/Caddyfile)
 * Implemented by: PFOS Contract 12 / Phase 7.2 (spec 06-two-agent-vps)
 * Owning requirements: R9 (the consent channel is never reachable), R11 (the secret path segment is
 *   one of two independent layers), R22 (health is polled internally, not published), R24 (no
 *   deployment particular in a tracked file)
 * Binding requirement: ops/BUS_NETWORK_BINDING.md, "What Phase 7 must NOT do (7.2)" - its three
 *   prohibitions, plus check 5 of the same document, wired here as a text match that fails closed
 * Depends on: node:fs (file entry point only), ./composeTemplate (the topology's own names and the
 *   shared no-deployment-particular scan)
 *
 * WHY THIS EXISTS. The proxy template is never executed here (steering §2: writing it is allowed,
 * running it is not), so the only way to know it still says what the contract requires is to READ
 * it. This module reads it. It parses the restricted directive subset the template is written in
 * and returns a list of findings. `ops/Caddyfile` must produce an empty list.
 *
 * It is deliberately a text audit and not a proxy-tooling call. A tooling call would validate
 * syntax and resolve the file - it would not assert that no route names the consent channel, that
 * there is no third hostname, and that no upstream is a catch-all, and it could not run at all
 * without the binary the wall forbids invoking.
 *
 * TWO PROPERTIES THAT NEED THE COMPANION FILE. The upstream names here must be services
 * `ops/docker-compose.yml` actually declares, because a route to a service the topology does not
 * define is a deployment that cannot start; and the names this template must never contain are
 * that file's own names for the consent channel. Both are read from `./composeTemplate` rather
 * than restated, so a rename in the topology surfaces as a finding instead of as a check that
 * quietly stops applying.
 *
 * IT FAILS CLOSED. An unreadable template, an unreadable companion, a directive outside the
 * supported subset, a missing site block, an unrecognized directive, and an unrecognized
 * placeholder shape are all findings - not skips. A checker that has only ever been observed
 * passing is not evidence that it checks, so every code below has a negative test in
 * caddyTemplate.test.ts that mutates the real template and observes the code fire.
 */

import { readFileSync } from 'node:fs';

import {
  BUS_NETWORK,
  BUS_SERVICE,
  BUS_VOLUME,
  FINANCE_SERVICE,
  LIFE_SERVICE,
  parseComposeSubset,
  scanForParticulars,
  type ComposeFinding,
} from './composeTemplate';

// ---------------------------------------------------------------------------------------------
// The parsed shape
// ---------------------------------------------------------------------------------------------

/**
 * One directive. `body === null` is a leaf; otherwise the directive opened a block. The global
 * options block is the one node whose `name` is empty, because it is written with no address.
 */
export interface CaddyNode {
  readonly name: string;
  readonly args: readonly string[];
  readonly body: readonly CaddyNode[] | null;
  readonly line: number;
}

/** Thrown for anything outside the supported subset. The subset is narrow on purpose: a proxy
 *  configuration that needs environment substitution, heredocs, or imports to say what it routes is
 *  one nobody can audit by eye either. */
export class CaddySubsetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaddySubsetError';
  }
}

interface MutableNode {
  readonly name: string;
  readonly args: readonly string[];
  readonly body: MutableNode[] | null;
  readonly line: number;
}

/** Drop a full-line comment, then a trailing `# ...` comment that follows whitespace. */
function withoutComment(line: string): string {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return '';
  const at = trimmed.search(/\s#/);
  return at === -1 ? trimmed : trimmed.slice(0, at).trimEnd();
}

function tokensOf(text: string, lineNumber: number): readonly string[] {
  if (/["'`]/.test(text)) {
    throw new CaddySubsetError(`line ${lineNumber} contains a quoted token; the subset is bare tokens only`);
  }
  return text
    .split(/\s+/)
    .map((t) => (t.endsWith(',') ? t.slice(0, -1) : t))
    .filter((t) => t !== '');
}

/** Parse the supported subset, or throw `CaddySubsetError`. */
export function parseCaddySubset(source: string): readonly CaddyNode[] {
  const top: MutableNode[] = [];
  const stack: MutableNode[] = [];
  const lines = source.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const lineNumber = i + 1;
    const text = withoutComment(lines[i] ?? '');
    if (text === '') continue;

    if (text === '}') {
      if (stack.pop() === undefined) {
        throw new CaddySubsetError(`line ${lineNumber} closes a block that was never opened`);
      }
      continue;
    }
    if (text.includes('}')) {
      throw new CaddySubsetError(`line ${lineNumber} closes a block on a line with other content, which the subset does not support`);
    }

    const opensBlock = text.endsWith('{');
    if (text.includes('{') && !opensBlock) {
      throw new CaddySubsetError(`line ${lineNumber} opens a block mid-line, which the subset does not support`);
    }

    const head = opensBlock ? text.slice(0, -1).trimEnd() : text;
    const tokens = tokensOf(head, lineNumber);
    const parent = stack[stack.length - 1];

    if (!opensBlock) {
      if (parent === undefined) {
        throw new CaddySubsetError(`line ${lineNumber} is a bare directive at the left margin; every top-level entry opens a block`);
      }
      if (tokens.length === 0) throw new CaddySubsetError(`line ${lineNumber} has no directive name`);
      const leaf: MutableNode = { name: tokens[0] ?? '', args: tokens.slice(1), body: null, line: lineNumber };
      (parent.body ?? []).push(leaf);
      continue;
    }

    if (tokens.length === 0 && parent !== undefined) {
      throw new CaddySubsetError(`line ${lineNumber} opens a nameless block inside another block; only the global options block is nameless`);
    }
    const opened: MutableNode = { name: tokens[0] ?? '', args: tokens.slice(1), body: [], line: lineNumber };
    if (parent === undefined) top.push(opened);
    else (parent.body ?? []).push(opened);
    stack.push(opened);
  }

  const unclosed = stack[stack.length - 1];
  if (unclosed !== undefined) {
    throw new CaddySubsetError(`the block opened on line ${unclosed.line} is never closed`);
  }
  if (top.length === 0) throw new CaddySubsetError('the template is empty');
  return top;
}

// ---------------------------------------------------------------------------------------------
// What the contract says the proxy is. Named constants, so a rename surfaces as a finding.
// ---------------------------------------------------------------------------------------------

/** R24: the domain is never written down, so every site address is derived from the placeholder. */
export const DOMAIN_PLACEHOLDER = '<DOMAIN>';

export const LIFE_SITE = `life.${DOMAIN_PLACEHOLDER}`;
export const MONEY_SITE = `money.${DOMAIN_PLACEHOLDER}`;

/** Contract 12 §2.2.3: two hostnames, one per agent. Exactly these, and no third. */
export const EXPECTED_SITES: readonly string[] = [LIFE_SITE, MONEY_SITE];

/** Which agent each hostname belongs to. The service names are the topology's own (§2.1). */
export const SITE_UPSTREAM: Readonly<Record<string, string>> = {
  [LIFE_SITE]: LIFE_SERVICE,
  [MONEY_SITE]: FINANCE_SERVICE,
};

/** The path prefix the webhook lives under. The segment after it is the secret and is a
 *  placeholder; §2.2.4 keeps it independent of the bot token. */
export const WEBHOOK_PATH_PREFIX = '/tg/';

/** The only method the provider uses for a webhook delivery. Narrowing means a read of the secret
 *  path is answered exactly like an unknown path. */
export const WEBHOOK_METHOD = 'POST';

/** Directives permitted in the global options block. Anything else is a finding, because a proxy
 *  option nobody reviewed is how a route or a listener arrives unnoticed. */
export const ALLOWED_GLOBAL_DIRECTIVES: readonly string[] = ['admin', 'email', 'auto_https'];

/** Directives permitted directly inside a site block, besides a named matcher (`@name`). */
export const ALLOWED_SITE_DIRECTIVES: readonly string[] = ['tls', 'handle'];

/**
 * The names `ops/docker-compose.yml` gives the consent channel. BUS_NETWORK_BINDING check 5 - "the
 * proxy configuration names the bus nowhere at all" - is a case-insensitive match for these over
 * the whole text, comments included. Imported rather than restated so the two files cannot drift.
 */
export const FORBIDDEN_UPSTREAM_NAMES: readonly string[] = [BUS_SERVICE, BUS_NETWORK, BUS_VOLUME];

/** A placeholder is upper snake case inside angle brackets, and nothing else (R24). */
const PLACEHOLDER = /^<[A-Z][A-Z0-9_]*>$/;

// ---------------------------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------------------------

export const CADDY_FINDING_CODES = [
  'TEMPLATE_UNREADABLE',
  'TEMPLATE_OUTSIDE_SUBSET',
  'COMPOSE_COMPANION_UNREADABLE',
  'GLOBAL_OPTIONS_MISSING',
  'GLOBAL_DIRECTIVE_UNEXPECTED',
  'ADMIN_API_NOT_DISABLED',
  'AUTO_HTTPS_REDIRECTS_NOT_DISABLED',
  'ACME_CONTACT_NOT_PLACEHOLDER',
  'SITE_BLOCK_COUNT_UNEXPECTED',
  'SITE_SET_UNEXPECTED',
  'SITE_ADDRESS_LIST_UNEXPECTED',
  'SITE_ADDRESS_WILDCARD',
  'SITE_DIRECTIVE_UNEXPECTED',
  'ACCESS_LOG_DECLARED',
  'TLS_BLOCK_MISSING',
  'TLS_HTTP_CHALLENGE_NOT_DISABLED',
  'WEBHOOK_MATCHER_MISSING',
  'WEBHOOK_MATCHER_NOT_METHOD_NARROWED',
  'WEBHOOK_MATCHER_PATH_MISSING',
  'WEBHOOK_PATH_NOT_PLACEHOLDER',
  'WEBHOOK_PATH_WILDCARD',
  'WEBHOOK_MATCHER_UNUSED',
  'REVERSE_PROXY_COUNT_UNEXPECTED',
  'REVERSE_PROXY_NOT_GUARDED_BY_MATCHER',
  'REVERSE_PROXY_MATCHER_UNDEFINED',
  'UPSTREAM_MALFORMED',
  'UPSTREAM_SERVICE_UNEXPECTED',
  'UPSTREAM_NOT_A_COMPOSE_SERVICE',
  'UPSTREAM_PORT_NOT_PLACEHOLDER',
  'FALLBACK_HANDLE_MISSING',
  'FALLBACK_HANDLE_NOT_TERMINAL',
  'BUS_NAMED_IN_PROXY_CONFIG',
  'PARTICULAR_URL_SCHEME',
  'PARTICULAR_ADDRESS_LITERAL',
  'PARTICULAR_HOSTNAME',
  'PARTICULAR_LONG_DIGIT_RUN',
  'PARTICULAR_CURRENCY_FIGURE',
  'PLACEHOLDER_MALFORMED',
  'PARTICULAR_SCAN_UNMAPPED',
] as const;

export type CaddyFindingCode = (typeof CADDY_FINDING_CODES)[number];

export interface CaddyFinding {
  readonly code: CaddyFindingCode;
  readonly detail: string;
}

/** The codes the shared no-deployment-particular scan is allowed to produce here. */
const SHARED_PARTICULAR_CODES: readonly string[] = [
  'PARTICULAR_URL_SCHEME',
  'PARTICULAR_ADDRESS_LITERAL',
  'PARTICULAR_HOSTNAME',
  'PARTICULAR_LONG_DIGIT_RUN',
  'PARTICULAR_CURRENCY_FIGURE',
  'PLACEHOLDER_MALFORMED',
];

/**
 * Re-report the shared scan's findings under this checker's code set. The R24 rule has one
 * implementation, in `./composeTemplate`, so a later change to it moves both templates at once.
 *
 * A code this checker does not know how to report becomes `PARTICULAR_SCAN_UNMAPPED` rather than
 * being dropped: silently discarding a finding from a scan whose whole job is to fail closed would
 * turn a widened rule into a narrowed one.
 */
export function mapParticularFindings(input: readonly ComposeFinding[]): readonly CaddyFinding[] {
  const out: CaddyFinding[] = [];
  for (const finding of input) {
    if (SHARED_PARTICULAR_CODES.includes(finding.code)) {
      out.push({ code: finding.code as CaddyFindingCode, detail: finding.detail });
    } else {
      out.push({
        code: 'PARTICULAR_SCAN_UNMAPPED',
        detail: `the shared no-deployment-particular scan reported ${finding.code}, which this checker has no code for: ${finding.detail}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function leafArgs(body: readonly CaddyNode[], name: string): readonly string[] | null {
  for (const node of body) {
    if (node.name === name && node.body === null) return node.args;
  }
  return null;
}

function blocksNamed(body: readonly CaddyNode[], name: string): readonly CaddyNode[] {
  return body.filter((node) => node.name === name && node.body !== null);
}

function hasLeaf(body: readonly CaddyNode[], name: string): boolean {
  return body.some((node) => node.name === name && node.body === null);
}

/** The service names `ops/docker-compose.yml` declares, or null if it cannot be read as expected. */
function composeServiceNames(composeSource: string): ReadonlySet<string> | null {
  let services: unknown;
  try {
    services = parseComposeSubset(composeSource).services;
  } catch {
    return null;
  }
  if (services === undefined || typeof services !== 'object' || services === null || Array.isArray(services)) {
    return null;
  }
  const names = Object.keys(services);
  return names.length === 0 ? null : new Set(names);
}

// ---------------------------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------------------------

/**
 * Audit the proxy template text against the topology template text. An empty array means every
 * structural property the contract requires is present. Any finding is a failure; there is no
 * severity ladder, because none of these rules is advisory.
 */
export function auditCaddyTemplate(source: string, composeSource: string): readonly CaddyFinding[] {
  const findings: CaddyFinding[] = [];
  const note = (code: CaddyFindingCode, detail: string): void => {
    findings.push({ code, detail });
  };

  // --- BUS_NETWORK_BINDING check 5, over the raw text so a comment counts too -----------------
  // Prohibition 1 is "no route, under any hostname, any path, any port - not commented out",
  // and a commented-out route is a route someone uncomments. So the match is over the whole file.
  const lowered = source.toLowerCase();
  for (const forbidden of FORBIDDEN_UPSTREAM_NAMES) {
    if (lowered.includes(forbidden.toLowerCase())) {
      note(
        'BUS_NAMED_IN_PROXY_CONFIG',
        `the proxy template contains "${forbidden}", one of the topology's names for the consent channel; BUS_NETWORK_BINDING check 5 requires the proxy configuration to name it nowhere at all, in a directive or in a comment`,
      );
    }
  }

  findings.push(...mapParticularFindings(scanForParticulars(source)));

  let document: readonly CaddyNode[];
  try {
    document = parseCaddySubset(source);
  } catch (e) {
    note('TEMPLATE_OUTSIDE_SUBSET', e instanceof Error ? e.message : String(e));
    return findings;
  }

  const composeServices = composeServiceNames(composeSource);
  if (composeServices === null) {
    note(
      'COMPOSE_COMPANION_UNREADABLE',
      'ops/docker-compose.yml could not be read as a service topology, so the upstream names here cannot be checked against the services that exist',
    );
  }

  // --- global options -----------------------------------------------------------------------
  const globals = document.filter((node) => node.name === '');
  const globalBody = globals[0]?.body ?? null;
  if (globals.length !== 1 || globalBody === null) {
    note('GLOBAL_OPTIONS_MISSING', `the template declares ${globals.length} nameless global options block; contract 12 §2.2.1 and §2.2.2 are configured there`);
  } else {
    for (const node of globalBody) {
      if (!ALLOWED_GLOBAL_DIRECTIVES.includes(node.name)) {
        note('GLOBAL_DIRECTIVE_UNEXPECTED', `global option "${node.name}" on line ${node.line} is not one of ${ALLOWED_GLOBAL_DIRECTIVES.join(', ')}; an unreviewed proxy option is how a listener arrives unnoticed`);
      }
    }
    const admin = leafArgs(globalBody, 'admin');
    if (admin === null || admin.join(' ') !== 'off') {
      note('ADMIN_API_NOT_DISABLED', `the global options declare admin ${admin === null ? '(absent)' : admin.join(' ')}; the administration endpoint is a control plane that can replace this configuration at run time, so it is absent rather than firewalled`);
    }
    const autoHttps = leafArgs(globalBody, 'auto_https');
    if (autoHttps === null || !autoHttps.includes('disable_redirects')) {
      note('AUTO_HTTPS_REDIRECTS_NOT_DISABLED', 'the global options do not disable the automatic redirect hosts; §2.2.1 permits one published port, so the cleartext port is unreachable and its redirect hosts would be dead configuration');
    }
    const email = leafArgs(globalBody, 'email');
    if (email === null || email.length !== 1 || !PLACEHOLDER.test(email[0] ?? '')) {
      note('ACME_CONTACT_NOT_PLACEHOLDER', `the certificate-authority contact is ${email === null ? '(absent)' : email.join(' ')}; it must be exactly one <ANGLE_BRACKET> placeholder (R24, §2.2.2)`);
    }
  }

  // --- the site set is exactly the two hostnames of §2.2.3 ----------------------------------
  const sites = document.filter((node) => node.name !== '');
  if (sites.length !== 2) {
    note('SITE_BLOCK_COUNT_UNEXPECTED', `the template declares ${sites.length} site blocks; contract 12 §2.2.3 names exactly two, one per agent, and BUS_NETWORK_BINDING prohibition 2 forbids a third`);
  }
  const declaredSites = sites.flatMap((site) => [site.name, ...site.args]).sort();
  const expectedSites = [...EXPECTED_SITES].sort();
  if (declaredSites.join(',') !== expectedSites.join(',')) {
    note('SITE_SET_UNEXPECTED', `site addresses are [${declaredSites.join(', ')}]; contract 12 §2.2.3 names [${expectedSites.join(', ')}]`);
  }

  for (const site of sites) {
    auditSite(site, composeServices, note);
  }

  return findings;
}

function auditSite(
  site: CaddyNode,
  composeServices: ReadonlySet<string> | null,
  note: (code: CaddyFindingCode, detail: string) => void,
): void {
  const body = site.body ?? [];
  const label = site.name;

  if (site.args.length > 0) {
    note('SITE_ADDRESS_LIST_UNEXPECTED', `site block on line ${site.line} serves ${site.args.length + 1} addresses; one hostname per agent, so one address per block (§2.2.3)`);
  }
  for (const address of [site.name, ...site.args]) {
    if (address.includes('*') || address.startsWith(':')) {
      note('SITE_ADDRESS_WILDCARD', `site address "${address}" is a wildcard or a bare port, which would serve hostnames nobody enumerated; BUS_NETWORK_BINDING prohibition 3 forbids a catch-all`);
    }
  }

  // --- directives: exactly the reviewed set, and no access log ------------------------------
  for (const node of body) {
    if (node.name.startsWith('@')) continue;
    if (ALLOWED_SITE_DIRECTIVES.includes(node.name)) continue;
    if (node.name === 'log') {
      note('ACCESS_LOG_DECLARED', `site "${label}" declares a log directive on line ${node.line}; the request URI carries the secret path segment, and §2.2.4 keeps that class of value out of proxy logs`);
      continue;
    }
    if (node.name === 'reverse_proxy') {
      note('REVERSE_PROXY_NOT_GUARDED_BY_MATCHER', `site "${label}" has a reverse_proxy directive at the site level on line ${node.line}, so it is reached by hostname alone; §2.2.3 requires hostname AND secret path segment`);
    }
    note('SITE_DIRECTIVE_UNEXPECTED', `site "${label}" declares "${node.name}" on line ${node.line}, which is not one of ${ALLOWED_SITE_DIRECTIVES.join(', ')} or a named matcher`);
  }

  // --- TLS: automatic, and issuance does not depend on an unpublished port ------------------
  const tlsBlocks = blocksNamed(body, 'tls');
  const tls = tlsBlocks[0];
  if (tls === undefined) {
    note('TLS_BLOCK_MISSING', `site "${label}" declares no tls block, so the issuance path is whatever the default happens to be (§2.2.2)`);
  } else {
    const issuers = blocksNamed(tls.body ?? [], 'issuer');
    const disabled = issuers.some((issuer) => hasLeaf(issuer.body ?? [], 'disable_http_challenge'));
    if (!disabled) {
      note('TLS_HTTP_CHALLENGE_NOT_DISABLED', `site "${label}" does not disable the challenge that needs the cleartext port; §2.2.1 publishes the TLS port and no other, so that challenge can never complete`);
    }
  }

  // --- named matchers: hostname AND an exact, placeholder-valued secret path ----------------
  const matchers = new Map<string, CaddyNode>();
  for (const node of body) {
    if (node.name.startsWith('@') && node.body !== null) matchers.set(node.name, node);
  }
  if (matchers.size === 0) {
    note('WEBHOOK_MATCHER_MISSING', `site "${label}" defines no named matcher, so nothing constrains a request beyond its hostname (§2.2.3)`);
  }
  for (const [name, matcher] of matchers) {
    const method = leafArgs(matcher.body ?? [], 'method');
    if (method === null || method.join(' ') !== WEBHOOK_METHOD) {
      note('WEBHOOK_MATCHER_NOT_METHOD_NARROWED', `matcher ${name} in "${label}" is not narrowed to ${WEBHOOK_METHOD}, so a read of the secret path would be answered differently from an unknown path`);
    }
    const path = leafArgs(matcher.body ?? [], 'path');
    if (path === null || path.length !== 1) {
      note('WEBHOOK_MATCHER_PATH_MISSING', `matcher ${name} in "${label}" does not declare exactly one path; §2.2.3 requires routing by a secret path segment, not by hostname alone`);
      continue;
    }
    const value = path[0] ?? '';
    if (value.endsWith('*')) {
      note('WEBHOOK_PATH_WILDCARD', `matcher ${name} in "${label}" ends its path in a wildcard, so everything beginning with the secret segment is routed, not the one registered address`);
    }
    if (!value.startsWith(WEBHOOK_PATH_PREFIX) || !PLACEHOLDER.test(value.slice(WEBHOOK_PATH_PREFIX.length))) {
      note('WEBHOOK_PATH_NOT_PLACEHOLDER', `matcher ${name} in "${label}" routes "${value}"; the segment after ${WEBHOOK_PATH_PREFIX} is a secret generated at deploy time and must be an <ANGLE_BRACKET> placeholder here (R24, steering §0b)`);
    }
  }

  // --- handle blocks: one guarded route, one terminal fallback ------------------------------
  const handles = blocksNamed(body, 'handle');
  const referenced = new Set<string>();
  const fallbacks: CaddyNode[] = [];
  let upstreamCount = 0;

  for (const handle of handles) {
    const matcherName = handle.args[0];
    const guarded = handle.args.length === 1 && matcherName !== undefined && matcherName.startsWith('@');
    if (guarded && matcherName !== undefined) {
      referenced.add(matcherName);
      if (!matchers.has(matcherName)) {
        note('REVERSE_PROXY_MATCHER_UNDEFINED', `handle in "${label}" on line ${handle.line} references ${matcherName}, which this site does not define; an undefined matcher is not a narrower route, it is an unreviewed one`);
      }
    } else if (handle.args.length === 0) {
      fallbacks.push(handle);
    } else {
      note('SITE_DIRECTIVE_UNEXPECTED', `handle in "${label}" on line ${handle.line} carries an inline matcher [${handle.args.join(' ')}]; the subset routes through named matchers only, so the constraint is reviewable in one place`);
    }

    for (const node of handle.body ?? []) {
      if (node.name !== 'reverse_proxy') continue;
      upstreamCount += 1;
      if (!guarded) {
        note('REVERSE_PROXY_NOT_GUARDED_BY_MATCHER', `the reverse_proxy on line ${node.line} in "${label}" sits in a handle with no named matcher, so it is reached by hostname alone (§2.2.3)`);
      }
      auditUpstream(node, label, composeServices, note);
    }
  }

  if (upstreamCount !== 1) {
    note('REVERSE_PROXY_COUNT_UNEXPECTED', `site "${label}" declares ${upstreamCount} reverse_proxy directives; one hostname routes to one agent (§2.2.3)`);
  }
  for (const name of matchers.keys()) {
    if (!referenced.has(name)) {
      note('WEBHOOK_MATCHER_UNUSED', `matcher ${name} in "${label}" is defined but no handle uses it, so the constraint a reader sees is not the constraint that applies`);
    }
  }
  if (fallbacks.length === 0) {
    note('FALLBACK_HANDLE_MISSING', `site "${label}" has no matcher-less handle, so a request to an unknown path on a known hostname is answered by whatever the default happens to be rather than by an explicit refusal`);
  }
  for (const fallback of fallbacks) {
    const contents = fallback.body ?? [];
    const terminal = contents.length === 1 && contents[0]?.name === 'abort' && (contents[0]?.args.length ?? 1) === 0;
    if (!terminal) {
      note('FALLBACK_HANDLE_NOT_TERMINAL', `the fallback handle in "${label}" on line ${fallback.line} contains [${contents.map((n) => n.name).join(', ')}] rather than abort alone; an unknown path must close the connection with no response, so it says no more than an unknown hostname does`);
    }
  }
}

function auditUpstream(
  node: CaddyNode,
  label: string,
  composeServices: ReadonlySet<string> | null,
  note: (code: CaddyFindingCode, detail: string) => void,
): void {
  if (node.args.length !== 1) {
    note('UPSTREAM_MALFORMED', `the reverse_proxy on line ${node.line} in "${label}" declares [${node.args.join(' ')}]; exactly one service:port upstream is supported`);
    return;
  }
  const raw = node.args[0] ?? '';
  const cut = raw.lastIndexOf(':');
  if (cut <= 0 || cut === raw.length - 1) {
    note('UPSTREAM_MALFORMED', `upstream "${raw}" in "${label}" is not service:port`);
    return;
  }
  const host = raw.slice(0, cut);
  const port = raw.slice(cut + 1);

  const expected = SITE_UPSTREAM[label];
  if (expected !== undefined && host !== expected) {
    note('UPSTREAM_SERVICE_UNEXPECTED', `site "${label}" proxies to "${host}"; contract 12 §2.1 routes that hostname to ${expected}, and routing a hostname to the other agent crosses the isolation boundary R6 exists to hold`);
  }
  if (composeServices !== null && !composeServices.has(host)) {
    note('UPSTREAM_NOT_A_COMPOSE_SERVICE', `upstream "${host}" in "${label}" is not a service ops/docker-compose.yml declares; a route to a service the topology does not define is a deployment that cannot start`);
  }
  if (!PLACEHOLDER.test(port)) {
    note('UPSTREAM_PORT_NOT_PLACEHOLDER', `upstream port "${port}" in "${label}" is not an <ANGLE_BRACKET> placeholder (R24)`);
  }
}

/**
 * Audit the template at `path` against the companion topology at `composePath`. An unreadable file
 * is a finding, never a skip: the whole value of this check is that it cannot pass by not running.
 */
export function auditCaddyTemplateFile(path: string, composePath: string): readonly CaddyFinding[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return [{ code: 'TEMPLATE_UNREADABLE', detail: `${path} could not be read: ${e instanceof Error ? e.message : String(e)}` }];
  }
  // An unreadable companion becomes the empty string, which `composeServiceNames` cannot read as a
  // topology, so it surfaces as COMPOSE_COMPANION_UNREADABLE rather than as a skipped check.
  let compose = '';
  try {
    compose = readFileSync(composePath, 'utf8');
  } catch {
    compose = '';
  }
  return auditCaddyTemplate(text, compose);
}
