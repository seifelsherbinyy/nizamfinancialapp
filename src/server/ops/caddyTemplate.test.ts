// @vitest-environment node
/**
 * NIZAM · The public entry point template says what the contract requires, and the checker fires
 * Implemented by: PFOS Contract 12 / Phase 7.2 (spec 06-two-agent-vps)
 * Owning requirements: R9 (the consent channel is never reachable), R11 (two independent layers),
 *   R22 (health is polled internally, not published), R24 (no deployment particular)
 * Binding requirement: ops/BUS_NETWORK_BINDING.md, "What Phase 7 must NOT do (7.2)" - prohibitions
 *   1, 2 and 3 - plus check 5 of the same document
 * Depends on: ./caddyTemplate, ./composeTemplate, ops/Caddyfile and ops/docker-compose.yml (both
 *   read from disk as text)
 *
 * Two halves, and the second is the one that matters.
 *
 * POSITIVE. The template on disk produces no finding, and each of the three prohibitions is
 * asserted separately off the parse tree, so a reader can see the requirement and its evidence in
 * the same place. Check 5 gets its own assertion over the raw text.
 *
 * NEGATIVE. Every finding code has a row in NEGATIVE_CASES that takes the real template, breaks
 * one property, and observes that code fire. A checker that has only ever been observed passing is
 * not evidence that it checks. The coverage test at the end fails if a code is added without a row,
 * so the negative half cannot fall behind the positive half.
 *
 * Nothing here executes the template. It is read as text and parsed in process (steering §2).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CADDY_FINDING_CODES,
  DOMAIN_PLACEHOLDER,
  EXPECTED_SITES,
  FORBIDDEN_UPSTREAM_NAMES,
  LIFE_SITE,
  MONEY_SITE,
  SITE_UPSTREAM,
  WEBHOOK_METHOD,
  WEBHOOK_PATH_PREFIX,
  auditCaddyTemplate,
  auditCaddyTemplateFile,
  mapParticularFindings,
  parseCaddySubset,
  type CaddyFindingCode,
  type CaddyNode,
} from './caddyTemplate.ts';
import { BUS_SERVICE, FINANCE_SERVICE, LIFE_SERVICE } from './composeTemplate.ts';

const TEMPLATE_PATH = fileURLToPath(new URL('../../../ops/Caddyfile', import.meta.url));
const COMPOSE_PATH = fileURLToPath(new URL('../../../ops/docker-compose.yml', import.meta.url));

/** Line endings are normalized so the mutation anchors below do not depend on the checkout's
 *  setting. The file entry point is exercised separately against the bytes on disk. */
const TEMPLATE = readFileSync(TEMPLATE_PATH, 'utf8').split('\r\n').join('\n');
const COMPOSE = readFileSync(COMPOSE_PATH, 'utf8').split('\r\n').join('\n');

function codesFor(source: string): readonly CaddyFindingCode[] {
  return auditCaddyTemplate(source, COMPOSE).map((f) => f.code);
}

/** A mutation that must actually change the template, so a rotted anchor fails loudly. */
function swap(from: string, to: string): (t: string) => string {
  return (t) => {
    if (!t.includes(from)) throw new Error(`negative-test anchor no longer present: ${JSON.stringify(from.slice(0, 70))}`);
    const next = t.replace(from, () => to);
    if (next === t) throw new Error('the mutation left the template unchanged, so the case would prove nothing');
    return next;
  };
}

// Shapes assembled from fragments, so this file never holds a contiguous copy of what the scan
// forbids and never trips the other scanners in the harness.
const URL_SHAPED = 'ht' + 'tp' + '://' + 'internal-probe';
const ADDRESS_SHAPED = ['198', '51', '100', '7'].join('.');
const HOSTNAME_SHAPED = 'money.' + 'exam' + 'ple' + '.' + 'inva' + 'lid';
const LONG_DIGIT_RUN = '12345' + '678';
const CURRENCY_SHAPED = 'US' + 'D' + ' 5.00';

// Anchors in the money site block, which is the terser of the two, so a mutation there is
// unambiguous. The life block carries the explanatory comments.
const MONEY_MATCHER = `\t@money_webhook {\n\t\tmethod POST\n\t\tpath ${WEBHOOK_PATH_PREFIX}<MONEY_WEBHOOK_PATH>\n\t}\n`;
const MONEY_UPSTREAM = `reverse_proxy ${FINANCE_SERVICE}:<FINANCE_CONTAINER_PORT>`;
const MONEY_ROUTE = `\thandle @money_webhook {\n\t\t${MONEY_UPSTREAM}\n\t}\n`;
const MONEY_TLS = '\ttls {\n\t\tissuer acme {\n\t\t\tdisable_http_challenge\n\t\t}\n\t}\n';
const FALLBACK = '\thandle {\n\t\tabort\n\t}\n';

interface NegativeCase {
  readonly code: CaddyFindingCode;
  readonly why: string;
  readonly apply: (template: string) => string;
}

const NEGATIVE_CASES: readonly NegativeCase[] = [
  {
    code: 'TEMPLATE_OUTSIDE_SUBSET',
    why: 'a bare directive at the left margin is the single-site shorthand, in which a route has no hostname',
    apply: (t) => `${t}\nabort\n`,
  },
  {
    code: 'GLOBAL_OPTIONS_MISSING',
    why: 'giving the global options block an address turns proxy-wide policy into one more site',
    apply: swap('\n{\n', `\nstatus.${DOMAIN_PLACEHOLDER} {\n`),
  },
  {
    code: 'GLOBAL_DIRECTIVE_UNEXPECTED',
    why: 'an unreviewed proxy option is how a listener or a route arrives unnoticed',
    apply: swap('\tadmin off\n', '\tadmin off\n\tgrace_period 5s\n'),
  },
  {
    code: 'ADMIN_API_NOT_DISABLED',
    why: 'the administration endpoint can replace this whole configuration at run time',
    apply: swap('\tadmin off\n', ''),
  },
  {
    code: 'AUTO_HTTPS_REDIRECTS_NOT_DISABLED',
    why: '§2.2.1 publishes one port, so redirect hosts on the cleartext port are dead configuration',
    apply: swap('\tauto_https disable_redirects\n', ''),
  },
  {
    code: 'ACME_CONTACT_NOT_PLACEHOLDER',
    why: 'R24 - the certificate-authority contact is resolved at deploy time, never written down',
    apply: swap('<ACME_CONTACT>', 'ops-contact'),
  },
  {
    code: 'SITE_BLOCK_COUNT_UNEXPECTED',
    why: 'BUS_NETWORK_BINDING prohibition 2 - no third hostname',
    apply: (t) => `${t}\nstatus.${DOMAIN_PLACEHOLDER} {\n${FALLBACK}}\n`,
  },
  {
    code: 'SITE_SET_UNEXPECTED',
    why: '§2.2.3 names the two hostnames; a renamed one is a hostname nobody registered',
    apply: swap(`\n${MONEY_SITE} {\n`, `\nledger.${DOMAIN_PLACEHOLDER} {\n`),
  },
  {
    code: 'SITE_ADDRESS_LIST_UNEXPECTED',
    why: 'collapsing both hostnames into one block loses the per-hostname route to a single agent',
    apply: swap(`\n${MONEY_SITE} {\n`, `\n${MONEY_SITE}, admin.${DOMAIN_PLACEHOLDER} {\n`),
  },
  {
    code: 'SITE_ADDRESS_WILDCARD',
    why: 'prohibition 3 - a wildcard address serves hostnames nobody enumerated',
    apply: swap(`\n${MONEY_SITE} {\n`, `\n*.${DOMAIN_PLACEHOLDER} {\n`),
  },
  {
    code: 'SITE_DIRECTIVE_UNEXPECTED',
    why: 'any directive outside the reviewed set could add a route, so an unknown one fails closed',
    apply: swap(MONEY_MATCHER, `\tencode gzip\n${MONEY_MATCHER}`),
  },
  {
    code: 'ACCESS_LOG_DECLARED',
    why: '§2.2.4 - the request URI carries the secret path segment, so no per-request log records it',
    apply: swap(MONEY_MATCHER, `\tlog {\n\t\toutput stderr\n\t}\n${MONEY_MATCHER}`),
  },
  {
    code: 'TLS_BLOCK_MISSING',
    why: '§2.2.2 - issuance is configured here, not left to whatever the default happens to be',
    apply: swap(MONEY_TLS, ''),
  },
  {
    code: 'TLS_HTTP_CHALLENGE_NOT_DISABLED',
    why: 'the cleartext port is not published, so the challenge that needs it can never complete',
    apply: swap(MONEY_TLS, '\ttls {\n\t\tissuer acme {\n\t\t\tkey_type p256\n\t\t}\n\t}\n'),
  },
  {
    code: 'WEBHOOK_MATCHER_MISSING',
    why: '§2.2.3 - without a matcher nothing constrains a request beyond its hostname',
    apply: swap(`${MONEY_MATCHER}\n`, ''),
  },
  {
    code: 'WEBHOOK_MATCHER_NOT_METHOD_NARROWED',
    why: 'a read of the secret path must be answered exactly like an unknown path',
    apply: swap(`\t\tmethod ${WEBHOOK_METHOD}\n\t\tpath ${WEBHOOK_PATH_PREFIX}<MONEY_WEBHOOK_PATH>`, `\t\tpath ${WEBHOOK_PATH_PREFIX}<MONEY_WEBHOOK_PATH>`),
  },
  {
    code: 'WEBHOOK_MATCHER_PATH_MISSING',
    why: '§2.2.3 forbids routing by hostname alone, which is what a matcher with no path does',
    apply: swap(`\t\tpath ${WEBHOOK_PATH_PREFIX}<MONEY_WEBHOOK_PATH>\n`, ''),
  },
  {
    code: 'WEBHOOK_PATH_NOT_PLACEHOLDER',
    why: 'steering §0b - the secret path segment never appears in a tracked file, not even as an example',
    apply: swap(`path ${WEBHOOK_PATH_PREFIX}<MONEY_WEBHOOK_PATH>`, `path ${WEBHOOK_PATH_PREFIX}hook`),
  },
  {
    code: 'WEBHOOK_PATH_WILDCARD',
    why: 'a trailing wildcard routes everything beginning with the segment, not the one registered address',
    apply: swap(`path ${WEBHOOK_PATH_PREFIX}<MONEY_WEBHOOK_PATH>`, `path ${WEBHOOK_PATH_PREFIX}*`),
  },
  {
    code: 'WEBHOOK_MATCHER_UNUSED',
    why: 'a matcher no handle uses means the constraint a reader sees is not the one that applies',
    apply: swap('\thandle @money_webhook {\n', '\thandle {\n'),
  },
  {
    code: 'REVERSE_PROXY_COUNT_UNEXPECTED',
    why: '§2.2.3 - one hostname routes to one agent',
    apply: swap(`\t\t${MONEY_UPSTREAM}\n`, `\t\t${MONEY_UPSTREAM}\n\t\t${MONEY_UPSTREAM}\n`),
  },
  {
    code: 'REVERSE_PROXY_NOT_GUARDED_BY_MATCHER',
    why: '§2.2.3 - a site-level upstream is reached by hostname alone',
    apply: swap(MONEY_ROUTE, `\t${MONEY_UPSTREAM}\n`),
  },
  {
    code: 'REVERSE_PROXY_MATCHER_UNDEFINED',
    why: 'an undefined matcher is not a narrower route, it is an unreviewed one',
    apply: swap('\thandle @money_webhook {\n', '\thandle @money_hook {\n'),
  },
  {
    code: 'UPSTREAM_MALFORMED',
    why: 'an upstream without an explicit port resolves to whatever the default scheme picks',
    apply: swap(MONEY_UPSTREAM, `reverse_proxy ${FINANCE_SERVICE}`),
  },
  {
    code: 'UPSTREAM_SERVICE_UNEXPECTED',
    why: 'R6 - routing one agent\u2019s hostname to the other crosses the isolation boundary',
    apply: swap(MONEY_UPSTREAM, `reverse_proxy ${LIFE_SERVICE}:<FINANCE_CONTAINER_PORT>`),
  },
  {
    code: 'UPSTREAM_NOT_A_COMPOSE_SERVICE',
    why: 'a route to a service the topology does not declare is a deployment that cannot start',
    apply: swap(MONEY_UPSTREAM, 'reverse_proxy money-agent:<FINANCE_CONTAINER_PORT>'),
  },
  {
    code: 'UPSTREAM_PORT_NOT_PLACEHOLDER',
    why: 'R24 - a resolved port is a deployment particular',
    apply: swap(MONEY_UPSTREAM, `reverse_proxy ${FINANCE_SERVICE}:8000`),
  },
  {
    code: 'FALLBACK_HANDLE_MISSING',
    why: 'without an explicit fallback an unknown path is answered by whatever the default happens to be',
    apply: swap(`${MONEY_ROUTE}\n${FALLBACK}`, MONEY_ROUTE),
  },
  {
    code: 'FALLBACK_HANDLE_NOT_TERMINAL',
    why: 'a status response tells a prober that the hostname was right and only the path was wrong',
    apply: swap(FALLBACK, '\thandle {\n\t\trespond 404\n\t}\n'),
  },
  {
    code: 'BUS_NAMED_IN_PROXY_CONFIG',
    why: 'BUS_NETWORK_BINDING prohibition 1 and check 5 - the proxy names the consent channel nowhere',
    apply: swap(MONEY_UPSTREAM, `reverse_proxy ${BUS_SERVICE}:<FINANCE_CONTAINER_PORT>`),
  },
  {
    code: 'PARTICULAR_URL_SCHEME',
    why: 'R24 - every endpoint is injected at run time, never written down',
    apply: swap('<ACME_CONTACT>', URL_SHAPED),
  },
  {
    code: 'PARTICULAR_ADDRESS_LITERAL',
    why: 'R24 - no address of the host in any notation',
    apply: swap(MONEY_UPSTREAM, `reverse_proxy ${ADDRESS_SHAPED}:<FINANCE_CONTAINER_PORT>`),
  },
  {
    code: 'PARTICULAR_HOSTNAME',
    why: `R24 - write ${DOMAIN_PLACEHOLDER}, never a name`,
    apply: swap('<ACME_CONTACT>', HOSTNAME_SHAPED),
  },
  {
    code: 'PARTICULAR_LONG_DIGIT_RUN',
    why: 'R24 - a long digit run is the shape of a messaging user identifier',
    apply: swap('<ACME_CONTACT>', LONG_DIGIT_RUN),
  },
  {
    code: 'PARTICULAR_CURRENCY_FIGURE',
    why: 'R24 - no real monetary figure, including in a comment',
    apply: swap('\n{\n', `\n# weekly cap ${CURRENCY_SHAPED}\n{\n`),
  },
  {
    code: 'PLACEHOLDER_MALFORMED',
    why: 'a placeholder that is not upper snake case is not recognized by the operator or by task 9.0',
    apply: swap('<ACME_CONTACT>', '<acmeContact>'),
  },
];

describe('the template on disk is the shape contract 12 §2.2 requires', () => {
  it('parses as the supported subset: one global options block and two site blocks', () => {
    const document = parseCaddySubset(TEMPLATE);
    expect(document.filter((n) => n.name === '')).toHaveLength(1);
    expect(document.filter((n) => n.name !== '').map((n) => n.name).sort()).toEqual([...EXPECTED_SITES].sort());
  });

  it('produces no finding at all', () => {
    const findings = auditCaddyTemplate(TEMPLATE, COMPOSE);
    expect(findings.map((f) => `${f.code}: ${f.detail}`)).toEqual([]);
  });

  it('routes by hostname AND an exact, placeholder-valued secret path segment (§2.2.3)', () => {
    for (const site of parseCaddySubset(TEMPLATE).filter((n) => n.name !== '')) {
      const matchers = (site.body ?? []).filter((n) => n.name.startsWith('@'));
      expect(matchers, `${site.name} named matchers`).toHaveLength(1);
      const body = matchers[0]?.body ?? [];
      const method = body.find((n) => n.name === 'method');
      const path = body.find((n) => n.name === 'path');
      expect(method?.args).toEqual([WEBHOOK_METHOD]);
      const value = path?.args[0] ?? '';
      expect(value.startsWith(WEBHOOK_PATH_PREFIX), `${site.name} path prefix`).toBe(true);
      expect(value.endsWith('*'), `${site.name} must not end in a wildcard`).toBe(false);
      expect(value.slice(WEBHOOK_PATH_PREFIX.length)).toMatch(/^<[A-Z][A-Z0-9_]*>$/);
    }
  });

  it('sends each hostname to its own agent, and to a service the topology declares (§2.1)', () => {
    const upstreams = new Map<string, string>();
    for (const site of parseCaddySubset(TEMPLATE).filter((n) => n.name !== '')) {
      for (const handle of (site.body ?? []).filter((n) => n.name === 'handle')) {
        for (const node of handle.body ?? []) {
          if (node.name === 'reverse_proxy') upstreams.set(site.name, (node.args[0] ?? '').split(':')[0] ?? '');
        }
      }
    }
    expect(upstreams.get(LIFE_SITE)).toBe(SITE_UPSTREAM[LIFE_SITE]);
    expect(upstreams.get(MONEY_SITE)).toBe(SITE_UPSTREAM[MONEY_SITE]);
    expect(COMPOSE).toContain(`\n  ${SITE_UPSTREAM[LIFE_SITE] ?? ''}:\n`);
    expect(COMPOSE).toContain(`\n  ${SITE_UPSTREAM[MONEY_SITE] ?? ''}:\n`);
  });

  it('answers an unknown path the way an unknown hostname is answered: no HTTP response at all', () => {
    for (const site of parseCaddySubset(TEMPLATE).filter((n) => n.name !== '')) {
      const fallbacks = (site.body ?? []).filter((n) => n.name === 'handle' && n.args.length === 0);
      expect(fallbacks, `${site.name} fallback`).toHaveLength(1);
      expect((fallbacks[0]?.body ?? []).map((n) => `${n.name} ${n.args.join(' ')}`.trim())).toEqual(['abort']);
    }
  });

  it('publishes no health route, so nothing is reached by hostname alone (§7.3 polls internally)', () => {
    const paths: string[] = [];
    for (const site of parseCaddySubset(TEMPLATE).filter((n) => n.name !== '')) {
      for (const matcher of (site.body ?? []).filter((n) => n.name.startsWith('@'))) {
        for (const node of matcher.body ?? []) {
          if (node.name === 'path') paths.push(...node.args);
        }
      }
    }
    expect(paths.every((p) => p.startsWith(WEBHOOK_PATH_PREFIX))).toBe(true);
    expect(paths).toHaveLength(2);
  });
});

describe('ops/BUS_NETWORK_BINDING.md, the three prohibitions for task 7.2', () => {
  const document = parseCaddySubset(TEMPLATE);
  const sites = document.filter((n) => n.name !== '');

  function everyNode(nodes: readonly CaddyNode[]): readonly CaddyNode[] {
    return nodes.flatMap((n) => [n, ...everyNode(n.body ?? [])]);
  }

  it('1. no site block, route, handle, or reverse-proxy directive names the consent channel - and check 5 holds over the raw text, comments included', () => {
    for (const forbidden of FORBIDDEN_UPSTREAM_NAMES) {
      expect(TEMPLATE.toLowerCase(), `check 5 for "${forbidden}"`).not.toContain(forbidden.toLowerCase());
    }
    const upstreams = everyNode(document)
      .filter((n) => n.name === 'reverse_proxy')
      .flatMap((n) => n.args);
    expect(upstreams).toHaveLength(2);
    for (const upstream of upstreams) {
      expect([LIFE_SERVICE, FINANCE_SERVICE]).toContain(upstream.split(':')[0]);
    }
  });

  it('2. exactly two hostnames, and no wildcard or bare-port address among them', () => {
    expect(sites).toHaveLength(2);
    const addresses = sites.flatMap((s) => [s.name, ...s.args]);
    expect(addresses.sort()).toEqual([...EXPECTED_SITES].sort());
    for (const address of addresses) {
      expect(address.includes('*'), `${address} must not be a wildcard`).toBe(false);
      expect(address.startsWith(':'), `${address} must not be a bare port`).toBe(false);
      expect(address.endsWith(DOMAIN_PLACEHOLDER), `${address} must be derived from ${DOMAIN_PLACEHOLDER}`).toBe(true);
    }
  });

  it('3. no wildcard or catch-all upstream: every catch-all handle terminates instead of proxying', () => {
    for (const site of sites) {
      for (const handle of (site.body ?? []).filter((n) => n.name === 'handle')) {
        if (handle.args.length > 0) continue;
        expect(everyNode(handle.body ?? []).some((n) => n.name === 'reverse_proxy'), `${site.name} catch-all must carry no upstream`).toBe(false);
      }
    }
  });
});

describe('every check fires - the negative half', () => {
  it.each(NEGATIVE_CASES.map((c) => [c.code, c.why, c] as const))('%s fires when %s', (code, _why, testCase) => {
    const broken = testCase.apply(TEMPLATE);
    expect(broken).not.toBe(TEMPLATE);
    expect(codesFor(broken)).toContain(code);
  });

  it('an unreadable template is a finding, never a skip', () => {
    const findings = auditCaddyTemplateFile(`${TEMPLATE_PATH}.does-not-exist`, COMPOSE_PATH);
    expect(findings.map((f) => f.code)).toEqual(['TEMPLATE_UNREADABLE']);
  });

  it('an unreadable topology companion is a finding too, because the upstream names go unchecked', () => {
    expect(auditCaddyTemplate(TEMPLATE, '').map((f) => f.code)).toContain('COMPOSE_COMPANION_UNREADABLE');
    expect(auditCaddyTemplateFile(TEMPLATE_PATH, `${COMPOSE_PATH}.does-not-exist`).map((f) => f.code)).toContain(
      'COMPOSE_COMPANION_UNREADABLE',
    );
  });

  it('a finding from the shared scan that this checker has no code for is reported, never dropped', () => {
    const mapped = mapParticularFindings([{ code: 'BUS_PUBLISHES_PORT', detail: 'a code from the topology checker' }]);
    expect(mapped.map((f) => f.code)).toEqual(['PARTICULAR_SCAN_UNMAPPED']);
    expect(mapped[0]?.detail).toContain('BUS_PUBLISHES_PORT');
  });

  it('the file entry point agrees with the text entry point on the real template', () => {
    expect(auditCaddyTemplateFile(TEMPLATE_PATH, COMPOSE_PATH)).toEqual([]);
  });

  it('every finding code has a negative case, so the negative half cannot fall behind', () => {
    const covered = new Set<string>([
      ...NEGATIVE_CASES.map((c) => c.code),
      'TEMPLATE_UNREADABLE',
      'COMPOSE_COMPANION_UNREADABLE',
      'PARTICULAR_SCAN_UNMAPPED',
    ]);
    const uncovered = CADDY_FINDING_CODES.filter((c) => !covered.has(c));
    expect(uncovered).toEqual([]);
  });
});
