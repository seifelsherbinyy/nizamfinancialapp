/**
 * NIZAM · Structural audit of the LIFE agent's environment-name agreement across repositories
 * Implemented by: PFOS Contract 12 / Phase 7.3 (spec 06-two-agent-vps)
 * Owning requirements: R6 (one environment file per service, and it must be loadable by the process
 *   that reads it), R11/R12 (the transport guards are configured, never defaulted - a guard whose
 *   entry name the consumer never reads is not configured), R23 (every value traces to a human
 *   gate), R24 (no deployment particular, and no secret VALUE anywhere in this module)
 * Depends on: node:fs (file entry point only) and ops/NIZAMCORE_VERIFIED_STATE.md §12, which is the
 *   recorded, citation-bearing result of a direct read of the other repository's relay
 *
 * WHY THIS EXISTS. `envTemplates.ts` binds every entry of `ops/env/life.env.example` to a field in
 * THIS repository's TypeScript ports, and it is right to: that is how the agreement is expressed
 * here. But the life agent is Python and lives in the OTHER repository (steering §1), so that file
 * is loaded by a process which reads its configuration under DIFFERENT names
 * (`ops/NIZAMCORE_VERIFIED_STATE.md` §12, verified against `poller.py` and `auth.py` with line
 * citations). The existing audit therefore passes while the deployment it describes cannot start:
 * the relay would find no bot token, would not know whether it is live, and would refuse all
 * traffic for want of an operator allowlist. That is a gate that has only ever been observed
 * passing on a surface it does not cover, which is not evidence of anything.
 *
 * THE MAPPING IS READ, NEVER RESTATED. Copying the four name pairs into TypeScript would put a
 * value in two places, and a value in two places is a value that can disagree with itself - the
 * reason `ops/env/bus.env.example` gives for having no retention entry, and the reason
 * `envTemplates.ts` reads its three companions instead of asserting them twice. So this module
 * parses §12's table out of the document that recorded it. If that section is edited, renamed or
 * deleted, this module fails closed rather than quietly agreeing with whatever is left.
 *
 * IT HOLDS NO VALUE. Only entry NAMES appear here, on both sides. A name is not a deployment
 * particular; it is already in a tracked template and in a tracked document. No token, no key, no
 * host, no identifier, and no example of any of their shapes.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not fire on every life-only template entry whose
 * consumer name is unrecorded. §12 records that the webhook-runner names are not on the v1.0 path,
 * and a check that reports nine findings the contract calls out-of-scope is noise an owner switches
 * off, not a gate. It audits exactly the four names §12 says decide whether the relay starts, and
 * it audits them in both directions.
 */

import { readFileSync } from 'node:fs';

/**
 * The four entries §12 names as the ones that matter for v1.0: without them the long-poll runner
 * does not start, does not know its mode, or refuses every message. Order is §12's row order.
 */
export const LIFE_V1_CRITICAL_ENTRIES: readonly string[] = [
  'BOT_A_TOKEN',
  'TELEGRAM_MODE',
  'ALLOWED_USER_IDS',
  'LIFE_WEBHOOK_SECRET',
];

/** The heading text that identifies §12's table. Read, so a rename of the section is a finding. */
export const LIFE_CONSUMER_TABLE_MARKER = "This repository's contract entry";

/** Sentinel used by §12 for a consumer-side name that has no counterpart in this repository. */
const NO_ENTRY_THIS_SIDE = /no entry on this side/i;

/** An environment entry name: upper-case, starts with a letter. Excludes `25`, `standby`, `live`. */
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/** A markdown inline-code span. */
const CODE_SPAN = /`([^`]+)`/g;

/**
 * Placeholder for an escaped table pipe. §12 row 3 contains ``(`standby`\|`live`)``, so splitting a
 * row on `|` without this would produce five cells and mis-column the entry that matters most.
 */
const ESCAPED_PIPE = '\uE000';

export interface LifeConsumerRow {
  /** This repository's template entry, or `null` for a consumer-only row. */
  readonly contractEntry: string | null;
  /** Every environment name the other repository's process actually reads for this row. */
  readonly consumerNames: readonly string[];
  /** The citation §12 recorded for this row. */
  readonly verifiedAt: string;
}

export const LIFE_CONSUMER_FINDING_CODES = [
  'LIFE_CONSUMER_SOURCE_UNREADABLE',
  'LIFE_CONSUMER_TABLE_MISSING',
  'LIFE_CONSUMER_TABLE_EMPTY',
  'LIFE_CONSUMER_ROW_MALFORMED',
  'LIFE_CRITICAL_ENTRY_ABSENT_FROM_TABLE',
  'LIFE_CRITICAL_ENTRY_CONSUMER_UNRECORDED',
  'LIFE_CRITICAL_ENTRY_CITATION_MISSING',
  'LIFE_CRITICAL_ENTRY_NOT_IN_TEMPLATE',
] as const;

export type LifeConsumerFindingCode = (typeof LIFE_CONSUMER_FINDING_CODES)[number];

export interface LifeConsumerFinding {
  readonly code: LifeConsumerFindingCode;
  readonly detail: string;
}

/**
 * Parse §12's table. Returns `null` when the marker is absent, which callers treat as a finding
 * rather than as an empty mapping - an absent agreement is not an agreement with nothing in it.
 */
export function parseLifeConsumerTable(markdown: string): readonly LifeConsumerRow[] | null {
  const lines = markdown.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.includes(LIFE_CONSUMER_TABLE_MARKER));
  if (headerIndex < 0) return null;

  const rows: LifeConsumerRow[] = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const raw = (lines[i] ?? '').trim();
    if (!raw.startsWith('|')) break;
    if (/^\|[\s|:-]*\|$/.test(raw)) continue;

    const cells = raw
      .replace(/\\\|/g, ESCAPED_PIPE)
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.split(ESCAPED_PIPE).join('|').trim());
    if (cells.length !== 4) {
      rows.push({ contractEntry: `MALFORMED:${cells.length}`, consumerNames: [], verifiedAt: '' });
      continue;
    }

    const [contractCell = '', , consumerCell = '', citationCell = ''] = cells;
    rows.push({
      contractEntry: NO_ENTRY_THIS_SIDE.test(contractCell) ? null : firstEnvName(contractCell),
      consumerNames: allEnvNames(consumerCell),
      verifiedAt: citationCell,
    });
  }
  return rows;
}

function codeSpans(cell: string): readonly string[] {
  return Array.from(cell.matchAll(CODE_SPAN), (match) => match[1] ?? '').filter(
    (span) => span !== '',
  );
}

function firstEnvName(cell: string): string | null {
  return codeSpans(cell).find((span) => ENV_NAME.test(span)) ?? null;
}

function allEnvNames(cell: string): readonly string[] {
  return codeSpans(cell).filter((span) => ENV_NAME.test(span));
}

/**
 * A translation pair the operator needs when writing the life agent's environment file on the host:
 * the name this repository's contract uses, and the name the consuming process actually reads.
 * Names only - this function never sees, renders or returns a value.
 */
export interface LifeEnvTranslation {
  readonly contractEntry: string;
  readonly consumerName: string;
  readonly verifiedAt: string;
}

/** The v1.0-critical translations, in §12's order, for the operator runbook. */
export function renderLifeEnvTranslation(
  rows: readonly LifeConsumerRow[],
): readonly LifeEnvTranslation[] {
  const translations: LifeEnvTranslation[] = [];
  for (const entry of LIFE_V1_CRITICAL_ENTRIES) {
    const row = rows.find((candidate) => candidate.contractEntry === entry);
    const consumerName = row?.consumerNames[0];
    if (!row || consumerName === undefined) continue;
    translations.push({ contractEntry: entry, consumerName, verifiedAt: row.verifiedAt });
  }
  return translations;
}

export interface LifeConsumerAuditInput {
  /** The text of the document that records §12. */
  readonly markdown: string;
  /** Entry names declared by `ops/env/life.env.example`. */
  readonly lifeTemplateEntries: readonly string[];
}

/**
 * Audit the cross-repository name agreement for the four entries that decide whether the life
 * relay starts. Fails closed: an unreadable source, a missing table, a malformed row, a critical
 * entry with no recorded consumer name, and a critical entry the template no longer declares are
 * all findings rather than skips.
 */
export function auditLifeConsumerNames(
  input: LifeConsumerAuditInput,
): readonly LifeConsumerFinding[] {
  const findings: LifeConsumerFinding[] = [];
  const rows = parseLifeConsumerTable(input.markdown);

  if (rows === null) {
    return [
      {
        code: 'LIFE_CONSUMER_TABLE_MISSING',
        detail: `no table headed "${LIFE_CONSUMER_TABLE_MARKER}" was found; the cross-repository name agreement cannot be read, so it cannot be relied on`,
      },
    ];
  }
  if (rows.length === 0) {
    return [
      {
        code: 'LIFE_CONSUMER_TABLE_EMPTY',
        detail: 'the cross-repository name table has a heading but no rows',
      },
    ];
  }

  for (const row of rows) {
    if (row.contractEntry !== null && row.contractEntry.startsWith('MALFORMED:')) {
      findings.push({
        code: 'LIFE_CONSUMER_ROW_MALFORMED',
        detail: `a table row has ${row.contractEntry.slice('MALFORMED:'.length)} cells, not the 4 the agreement requires`,
      });
    }
  }

  for (const entry of LIFE_V1_CRITICAL_ENTRIES) {
    if (!input.lifeTemplateEntries.includes(entry)) {
      findings.push({
        code: 'LIFE_CRITICAL_ENTRY_NOT_IN_TEMPLATE',
        detail: `${entry} is recorded as v1.0-critical but ops/env/life.env.example no longer declares it, so the mapping is stale`,
      });
    }

    const row = rows.find((candidate) => candidate.contractEntry === entry);
    if (!row) {
      findings.push({
        code: 'LIFE_CRITICAL_ENTRY_ABSENT_FROM_TABLE',
        detail: `${entry} is v1.0-critical but has no row in the cross-repository name table; the consuming process would not find it`,
      });
      continue;
    }
    if (row.consumerNames.length === 0) {
      findings.push({
        code: 'LIFE_CRITICAL_ENTRY_CONSUMER_UNRECORDED',
        detail: `${entry} has a row but records no name the consuming process actually reads; filling the template as written would leave the relay unconfigured`,
      });
    }
    if (row.verifiedAt.trim() === '') {
      findings.push({
        code: 'LIFE_CRITICAL_ENTRY_CITATION_MISSING',
        detail: `${entry} records a consumer name with no citation; an unverified mapping is a claim, not a measurement`,
      });
    }
  }

  return findings;
}

/** File entry point. An unreadable source is a finding, never a skip. */
export function auditLifeConsumerNameFiles(
  verifiedStatePath: string,
  lifeTemplatePath: string,
): readonly LifeConsumerFinding[] {
  let markdown: string;
  let template: string;
  try {
    markdown = readFileSync(verifiedStatePath, 'utf8');
  } catch {
    return [
      {
        code: 'LIFE_CONSUMER_SOURCE_UNREADABLE',
        detail: `could not read the recorded cross-repository agreement at ${verifiedStatePath}`,
      },
    ];
  }
  try {
    template = readFileSync(lifeTemplatePath, 'utf8');
  } catch {
    return [
      {
        code: 'LIFE_CONSUMER_SOURCE_UNREADABLE',
        detail: `could not read the life environment template at ${lifeTemplatePath}`,
      },
    ];
  }
  return auditLifeConsumerNames({
    markdown,
    lifeTemplateEntries: declaredEntryNames(template),
  });
}

/** Entry names declared by an environment template: `NAME=<PLACEHOLDER>` at the start of a line. */
export function declaredEntryNames(template: string): readonly string[] {
  return template
    .split(/\r?\n/)
    .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1] ?? '')
    .filter((name) => name !== '');
}
