// @vitest-environment node
/**
 * NIZAM · Tests for the LIFE agent's cross-repository environment-name audit
 * Implemented by: PFOS Contract 12 / Phase 7.3 (spec 06-two-agent-vps)
 * Owning requirements: R6, R11/R12, R23, R24 - as ./lifeConsumerNames
 * Depends on: ./lifeConsumerNames, ops/NIZAMCORE_VERIFIED_STATE.md §12, ops/env/life.env.example
 *
 * EVERY FINDING CODE IS OBSERVED FIRING. A checker that has only ever been seen passing is not
 * evidence that it checks, so each code below is produced by tampering with the REAL recorded
 * agreement and watching the audit react. Each negative test also asserts that its tamper actually
 * CHANGED the input, because a tamper that silently fails to apply reports a false pass.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  LIFE_CONSUMER_FINDING_CODES,
  LIFE_CONSUMER_TABLE_MARKER,
  LIFE_V1_CRITICAL_ENTRIES,
  auditLifeConsumerNameFiles,
  auditLifeConsumerNames,
  declaredEntryNames,
  parseLifeConsumerTable,
  renderLifeEnvTranslation,
  type LifeConsumerFindingCode,
} from './lifeConsumerNames.ts';

const VERIFIED_STATE_PATH = fileURLToPath(
  new URL('../../../ops/NIZAMCORE_VERIFIED_STATE.md', import.meta.url),
);
const LIFE_TEMPLATE_PATH = fileURLToPath(
  new URL('../../../ops/env/life.env.example', import.meta.url),
);

const MARKDOWN = readFileSync(VERIFIED_STATE_PATH, 'utf8');
const TEMPLATE = readFileSync(LIFE_TEMPLATE_PATH, 'utf8');
const TEMPLATE_ENTRIES = declaredEntryNames(TEMPLATE);

/** Rewrite one cell of the row whose first cell names `entry`. Returns the tampered markdown. */
function rewriteCell(markdown: string, entry: string, cellIndex: number, value: string): string {
  const lines = markdown.split(/\r?\n/);
  const rowIndex = lines.findIndex(
    (line) => line.trim().startsWith('|') && line.includes(`\`${entry}\``),
  );
  if (rowIndex < 0) throw new Error(`fixture drift: no table row for ${entry}`);
  const SENTINEL = '\uE001';
  const cells = (lines[rowIndex] ?? '')
    .trim()
    .split('\\|')
    .join(SENTINEL)
    .split('|')
    .slice(1, -1);
  cells[cellIndex] = ` ${value} `;
  lines[rowIndex] = `|${cells.join('|')}|`.split(SENTINEL).join('\\|');
  return lines.join('\n');
}

function deleteRow(markdown: string, entry: string): string {
  const lines = markdown.split(/\r?\n/);
  return lines
    .filter((line) => !(line.trim().startsWith('|') && line.includes(`\`${entry}\``)))
    .join('\n');
}

function codesFrom(markdown: string, entries: readonly string[] = TEMPLATE_ENTRIES): string[] {
  return auditLifeConsumerNames({ markdown, lifeTemplateEntries: entries }).map((f) => f.code);
}

describe('the recorded cross-repository agreement, as it stands today', () => {
  it('holds: the real files produce no findings', () => {
    expect(auditLifeConsumerNameFiles(VERIFIED_STATE_PATH, LIFE_TEMPLATE_PATH)).toEqual([]);
  });

  it('records the four v1.0-critical names the consuming process actually reads', () => {
    const rows = parseLifeConsumerTable(MARKDOWN);
    expect(rows).not.toBeNull();
    expect(renderLifeEnvTranslation(rows!)).toEqual([
      {
        contractEntry: 'BOT_A_TOKEN',
        consumerName: 'TELEGRAM_BOT_TOKEN',
        verifiedAt: '`poller.py` line 212',
      },
      {
        contractEntry: 'TELEGRAM_MODE',
        consumerName: 'RELAY_MODE',
        verifiedAt: '`poller.py` line 220',
      },
      {
        contractEntry: 'ALLOWED_USER_IDS',
        consumerName: 'NIZAM_TELEGRAM_ALLOWED_IDS',
        verifiedAt: '`auth.py` lines 23, 82; `poller.py` docstring line 33',
      },
      {
        contractEntry: 'LIFE_WEBHOOK_SECRET',
        consumerName: 'TELEGRAM_WEBHOOK_SECRET',
        verifiedAt: '`auth.py` lines 22, 51',
      },
    ]);
  });

  it('proves the names actually DIFFER, which is the whole reason this module exists', () => {
    const rows = parseLifeConsumerTable(MARKDOWN)!;
    for (const translation of renderLifeEnvTranslation(rows)) {
      expect(translation.consumerName).not.toBe(translation.contractEntry);
    }
  });

  it('parses the row containing an escaped pipe without mis-columning it', () => {
    const rows = parseLifeConsumerTable(MARKDOWN)!;
    const row = rows.find((candidate) => candidate.contractEntry === 'TELEGRAM_MODE');
    expect(row?.consumerNames).toEqual(['RELAY_MODE']);
    expect(row?.verifiedAt).toBe('`poller.py` line 220');
  });

  it('does not mistake a lower-case mode word or a bare default for an entry name', () => {
    const names = parseLifeConsumerTable(MARKDOWN)!.flatMap((row) => row.consumerNames);
    expect(names).not.toContain('standby');
    expect(names).not.toContain('live');
    expect(names).not.toContain('25');
  });

  it('treats a consumer-only row as having no entry on this side, and still reads its names', () => {
    const rows = parseLifeConsumerTable(MARKDOWN)!;
    expect(rows.filter((row) => row.contractEntry === null).length).toBeGreaterThan(0);
    const hostRow = rows.find((row) => row.consumerNames.includes('RELAY_HOST'));
    expect(hostRow?.contractEntry).toBeNull();
    expect(hostRow?.consumerNames).toEqual(['RELAY_HOST', 'RELAY_PORT']);
  });

  it('does not fire for a hard-coded, non-critical entry the consumer never reads', () => {
    const rows = parseLifeConsumerTable(MARKDOWN)!;
    const row = rows.find((candidate) => candidate.contractEntry === 'MSG_API_BASE');
    expect(row?.consumerNames).toEqual([]);
    expect(LIFE_V1_CRITICAL_ENTRIES).not.toContain('MSG_API_BASE');
    expect(codesFrom(MARKDOWN)).toEqual([]);
  });
});

describe('every finding code fires on a real tamper', () => {
  it('N1 the table heading is gone', () => {
    const tampered = MARKDOWN.replace(LIFE_CONSUMER_TABLE_MARKER, 'a heading that is not the one');
    expect(tampered).not.toBe(MARKDOWN);
    expect(codesFrom(tampered)).toContain('LIFE_CONSUMER_TABLE_MISSING');
  });

  it('N2 the heading survives but every row is gone', () => {
    let tampered = MARKDOWN;
    for (const entry of [...LIFE_V1_CRITICAL_ENTRIES, 'MSG_API_BASE']) {
      tampered = deleteRow(tampered, entry);
    }
    tampered = tampered
      .split(/\r?\n/)
      .filter((line) => !/^\|\s*no entry on this side/i.test(line.trim()))
      .filter((line) => !/^\|[\s|:-]*\|$/.test(line.trim()) || !line.includes('---'))
      .join('\n');
    expect(tampered).not.toBe(MARKDOWN);
    expect(codesFrom(tampered)).toContain('LIFE_CONSUMER_TABLE_EMPTY');
  });

  it('N3 a v1.0-critical row is deleted outright', () => {
    const tampered = deleteRow(MARKDOWN, 'ALLOWED_USER_IDS');
    expect(tampered).not.toBe(MARKDOWN);
    expect(codesFrom(tampered)).toContain('LIFE_CRITICAL_ENTRY_ABSENT_FROM_TABLE');
  });

  it('N4 a v1.0-critical row keeps its heading but loses the name the consumer reads', () => {
    const tampered = rewriteCell(MARKDOWN, 'BOT_A_TOKEN', 2, 'none recorded');
    expect(tampered).not.toBe(MARKDOWN);
    expect(tampered).not.toContain('`TELEGRAM_BOT_TOKEN`');
    expect(codesFrom(tampered)).toContain('LIFE_CRITICAL_ENTRY_CONSUMER_UNRECORDED');
  });

  it('N5 a v1.0-critical mapping loses its citation', () => {
    const tampered = rewriteCell(MARKDOWN, 'LIFE_WEBHOOK_SECRET', 3, '');
    expect(tampered).not.toBe(MARKDOWN);
    expect(codesFrom(tampered)).toContain('LIFE_CRITICAL_ENTRY_CITATION_MISSING');
  });

  it('N6 the template stops declaring a v1.0-critical entry', () => {
    const entries = TEMPLATE_ENTRIES.filter((name) => name !== 'BOT_A_TOKEN');
    expect(entries.length).toBe(TEMPLATE_ENTRIES.length - 1);
    expect(codesFrom(MARKDOWN, entries)).toContain('LIFE_CRITICAL_ENTRY_NOT_IN_TEMPLATE');
  });

  it('N7 a row gains a cell', () => {
    const tampered = MARKDOWN.split(/\r?\n/)
      .map((line) =>
        line.trim().startsWith('|') && line.includes('`BOT_A_TOKEN`')
          ? `${line.trimEnd()} an extra cell |`
          : line,
      )
      .join('\n');
    expect(tampered).not.toBe(MARKDOWN);
    expect(codesFrom(tampered)).toContain('LIFE_CONSUMER_ROW_MALFORMED');
  });

  it('N8 the recorded agreement cannot be read at all', () => {
    const codes = auditLifeConsumerNameFiles(
      `${VERIFIED_STATE_PATH}.absent`,
      LIFE_TEMPLATE_PATH,
    ).map((f) => f.code);
    expect(codes).toEqual(['LIFE_CONSUMER_SOURCE_UNREADABLE']);

    const templateCodes = auditLifeConsumerNameFiles(
      VERIFIED_STATE_PATH,
      `${LIFE_TEMPLATE_PATH}.absent`,
    ).map((f) => f.code);
    expect(templateCodes).toEqual(['LIFE_CONSUMER_SOURCE_UNREADABLE']);
  });

  it('leaves no finding code unexercised', () => {
    const exercised = new Set<LifeConsumerFindingCode>();
    const add = (codes: string[]): void => {
      for (const code of codes) exercised.add(code as LifeConsumerFindingCode);
    };
    add(codesFrom(MARKDOWN.replace(LIFE_CONSUMER_TABLE_MARKER, 'x')));
    add(codesFrom(deleteRow(MARKDOWN, 'ALLOWED_USER_IDS')));
    add(codesFrom(rewriteCell(MARKDOWN, 'BOT_A_TOKEN', 2, 'none recorded')));
    add(codesFrom(rewriteCell(MARKDOWN, 'LIFE_WEBHOOK_SECRET', 3, '')));
    add(codesFrom(MARKDOWN, TEMPLATE_ENTRIES.filter((n) => n !== 'BOT_A_TOKEN')));
    add(
      codesFrom(
        MARKDOWN.split(/\r?\n/)
          .map((line) =>
            line.trim().startsWith('|') && line.includes('`BOT_A_TOKEN`')
              ? `${line.trimEnd()} extra |`
              : line,
          )
          .join('\n'),
      ),
    );
    add(auditLifeConsumerNameFiles(`${VERIFIED_STATE_PATH}.absent`, LIFE_TEMPLATE_PATH).map((f) => f.code));
    let emptied = MARKDOWN;
    for (const entry of [...LIFE_V1_CRITICAL_ENTRIES, 'MSG_API_BASE']) emptied = deleteRow(emptied, entry);
    emptied = emptied
      .split(/\r?\n/)
      .filter((line) => !/^\|\s*no entry on this side/i.test(line.trim()))
      .join('\n');
    add(codesFrom(emptied));

    expect([...exercised].sort()).toEqual([...LIFE_CONSUMER_FINDING_CODES].sort());
  });
});

describe('it holds no value, only names', () => {
  it('renders no secret and no deployment particular', () => {
    const rows = parseLifeConsumerTable(MARKDOWN)!;
    const rendered = JSON.stringify(renderLifeEnvTranslation(rows));
    expect(rendered).not.toMatch(/\b\d{8,}\b/);
    expect(rendered).not.toMatch(/https?:\/\//);
    expect(rendered).not.toMatch(/[A-Za-z0-9_-]{30,}/);
  });
});
