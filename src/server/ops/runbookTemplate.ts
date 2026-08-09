/**
 * NIZAM · Structural audit of the operations runbooks (ops/runbook/)
 * Implemented by: PFOS Contract 12 / Phase 7.6 (spec 06-two-agent-vps)
 * Owning requirements: R20/R21 (a rollback across a migration goes through the restore drill, and
 *   the integrity check precedes trust), R22 (readiness, not liveness, is what a rollback confirms),
 *   R13/R14/R15 (the degraded long-poll mode keeps every transport guard), R23 (a human gate is
 *   named, never attempted), R24 (no deployment particular)
 * Depends on: node:fs (file entry points only), ./composeTemplate (`scanForParticulars` - the ONE
 *   no-deployment-particular scan), ./backupScripts (`RESTORE_SEQUENCE` and the shell subset parser,
 *   so the drill's order is read from the template rather than restated), ./envTemplates
 *   (`ENTRY_SPECS` - the ONE environment vocabulary), ./healthProbe (`EXPECTED_SCHEMA_VERSION` and
 *   the probe invocation grammar), ../ports/telegram (`TELEGRAM_TRANSPORT_MODES`)
 *
 * WHY THIS EXISTS. Contract 12 §7.4 and §7.5 are procedures, and a procedure is only as good as the
 * document an operator opens on the worst day. The documents are never executed - steering §2
 * permits writing them and forbids running them - so the only way to know they still say what the
 * contract requires is to READ them. This module reads them. Each must produce an empty finding list.
 *
 * A runbook rots differently from code. It rots by staying true about a system that changed: a new
 * migration lands and the recorded schema version is stale; the restore template's step order is
 * revised and the runbook still quotes the old one; a service is renamed and the image reference an
 * operator is told to change no longer exists. Every one of those is silent, and every one of them
 * surfaces at the moment there is no time to notice it. So the checks below prefer CROSS-READING a
 * real artifact over asserting a copy:
 *
 *   - the drill sequence quoted in ROLLBACK.md is compared against `ops/restore/` itself;
 *   - the recorded latest migration version is compared against the migration series;
 *   - every image reference named is compared against the topology's declarations;
 *   - every `${ENTRY}` and `<PLACEHOLDER>` is checked against a vocabulary assembled from
 *     `ops/env/**`, the topology, the gate register, and the two shell templates - so a name from
 *     nowhere is a name nobody reviewed;
 *   - every gate named is checked against `ops/GATE_REGISTER.md`;
 *   - the health-probe invocation is parsed by the probe's OWN parser.
 *
 * IT FAILS CLOSED. An unreadable document, an unreadable companion, a document outside the supported
 * markdown subset, a section that is missing, a section nobody declared, a step with no verification
 * line, and an out-of-order procedure are findings, not skips. Every code below has a negative test
 * in runbookTemplate.test.ts that mutates the real file and observes the code fire.
 *
 * NOTHING HERE DIALS ANYTHING, and the rate-limit posture in particular is a TEXT check: the
 * provider's documented limits are documentation, and a limit is not discovered by exceeding it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BACKUP_SCRIPT_PATH, RESTORE_ENTRIES, RESTORE_SCRIPT_PATH, RESTORE_SEQUENCE, parseShellScript } from './backupScripts';
import { scanForParticulars, type ComposeFinding } from './composeTemplate';
import { ENTRY_SPECS } from './envTemplates';
import { EXPECTED_SCHEMA_VERSION, PROBE_COMMAND_NAME, parseProbeInvocation } from './healthProbe';
import { TELEGRAM_TRANSPORT_MODES } from '../ports/telegram';

// ---------------------------------------------------------------------------------------------
// The parsed shape
// ---------------------------------------------------------------------------------------------

/** A `## ` section, with the lines under it up to the next `## `. */
export interface RunbookSection {
  readonly title: string;
  readonly lines: readonly string[];
  /** The section body with markdown emphasis and code ticks removed, for bullet-anchored matching. */
  readonly prose: string;
  /** The same, with every run of whitespace collapsed, for SENTENCE matching. See {@link flowOf}. */
  readonly flow: string;
}

/** A `### Step N - title` or `### Limit N - title` block. */
export interface RunbookBlock {
  readonly kind: 'Step' | 'Limit';
  readonly number: number;
  readonly title: string;
  readonly lines: readonly string[];
  readonly prose: string;
  readonly flow: string;
}

export interface RunbookDoc {
  /** The first twenty lines, de-emphasized and collapsed, where ownership is declared. */
  readonly head: string;
  readonly lines: readonly string[];
  /** The whole document with markdown emphasis and code ticks removed. */
  readonly prose: string;
  /** The whole document as one flowing line. Every sentence check below uses this. */
  readonly flow: string;
  readonly sections: readonly RunbookSection[];
  readonly blocks: readonly RunbookBlock[];
  /** Every line inside a fenced code block, fences excluded. */
  readonly fenced: readonly string[];
}

/**
 * Thrown for anything outside the supported markdown subset. The subset is narrow on purpose: a
 * runbook whose structure a reader cannot predict is one nobody follows under pressure.
 */
export class RunbookSubsetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunbookSubsetError';
  }
}

const BLOCK_HEADING = /^###\s+(Step|Limit)\s+(\d+)\s+-\s+(.+)$/;
const VERIFY_LINE = /^\*\*VERIFY:\*\*/;

/** Emphasis, code ticks and blockquote markers carry no meaning for these checks. */
export function deEmphasize(text: string): string {
  return text.replace(/[*`]/g, '').replace(/^>\s?/gm, '');
}

/**
 * One flowing line. Markdown wraps a sentence wherever the column runs out, so a sentence-level check
 * over the raw text is a check on where somebody's editor happened to break the line - it passes today
 * and fails on the next reflow, which is the worst kind of check: one that looks strict and is
 * accidental. Collapsing whitespace first makes the assertion about the sentence.
 */
export function flowOf(text: string): string {
  return deEmphasize(text).replace(/\s+/g, ' ');
}

export function parseRunbook(source: string): RunbookDoc {
  const lines = source.split(/\r?\n/);
  if (!(lines[0] ?? '').startsWith('# ')) {
    throw new RunbookSubsetError('the first line is not a level-one heading, so the document has no title a reader can identify it by');
  }
  if (source.includes('\t')) {
    throw new RunbookSubsetError('the document contains a tab; indentation that renders differently in two viewers is indentation nobody can review');
  }

  const sections: RunbookSection[] = [];
  const blocks: RunbookBlock[] = [];
  const fenced: string[] = [];
  let currentSection: { title: string; lines: string[] } | null = null;
  let currentBlock: { kind: 'Step' | 'Limit'; number: number; title: string; lines: string[] } | null = null;
  let inFence = false;

  const closeBlock = (): void => {
    if (currentBlock === null) return;
    const body = currentBlock.lines.join('\n');
    blocks.push({ ...currentBlock, prose: deEmphasize(body), flow: flowOf(body) });
    currentBlock = null;
  };
  const closeSection = (): void => {
    if (currentSection === null) return;
    const body = currentSection.lines.join('\n');
    sections.push({ ...currentSection, prose: deEmphasize(body), flow: flowOf(body) });
    currentSection = null;
  };

  for (const raw of lines) {
    if (raw.startsWith('```')) {
      inFence = !inFence;
      currentSection?.lines.push(raw);
      currentBlock?.lines.push(raw);
      continue;
    }
    if (inFence) {
      fenced.push(raw);
      currentSection?.lines.push(raw);
      currentBlock?.lines.push(raw);
      continue;
    }
    if (raw.startsWith('## ')) {
      closeBlock();
      closeSection();
      currentSection = { title: raw.slice(3).trim(), lines: [] };
      continue;
    }
    const heading = BLOCK_HEADING.exec(raw);
    if (heading !== null) {
      closeBlock();
      currentBlock = {
        kind: (heading[1] ?? 'Step') as 'Step' | 'Limit',
        number: Number(heading[2] ?? '0'),
        title: (heading[3] ?? '').trim(),
        lines: [],
      };
      currentSection?.lines.push(raw);
      continue;
    }
    if (raw.startsWith('### ')) {
      throw new RunbookSubsetError(`"${raw.trim()}" is a level-three heading that is neither a numbered Step nor a numbered Limit, so it is a block the audit cannot place`);
    }
    currentSection?.lines.push(raw);
    currentBlock?.lines.push(raw);
  }
  if (inFence) throw new RunbookSubsetError('a fenced block is never closed, so where it ends is a guess');
  closeBlock();
  closeSection();

  return {
    head: flowOf(lines.slice(0, 20).join('\n')),
    lines,
    prose: deEmphasize(source),
    flow: flowOf(source),
    sections,
    blocks,
    fenced,
  };
}

/**
 * The labelled bullets of a block - `- **Label:** text` - with continuation lines folded in, so a
 * bullet that wrapped is still one bullet. Unlabelled bullets are ignored: a block may carry ordinary
 * prose bullets alongside the ones this audit reads.
 */
export function bulletsOf(prose: string): Readonly<Record<string, string>> {
  const found: Record<string, string> = {};
  let label: string | null = null;
  for (const raw of prose.split('\n')) {
    const started = /^-\s+([A-Za-z][A-Za-z -]*):\s*(.*)$/.exec(raw);
    if (started !== null) {
      label = (started[1] ?? '').trim();
      found[label] = (started[2] ?? '').trim();
      continue;
    }
    if (label === null) continue;
    if (raw.trim() === '' || /^[-#]/.test(raw.trim())) {
      label = null;
      continue;
    }
    found[label] = `${found[label] ?? ''} ${raw.trim()}`.trim();
  }
  return found;
}

/** The verification line of a block, or null when it has none. */
export function verificationOf(block: RunbookBlock): string | null {
  for (const line of block.lines) {
    if (VERIFY_LINE.test(line)) return deEmphasize(line).trim();
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The three documents, and the structure each must have
// ---------------------------------------------------------------------------------------------

export const ROLLBACK_DOC = 'ROLLBACK';
export const DISASTER_RECOVERY_DOC = 'DISASTER_RECOVERY';
export const RATE_LIMIT_DOC = 'RATE_LIMIT_POSTURE';

export const RUNBOOK_DOCS: readonly string[] = [ROLLBACK_DOC, DISASTER_RECOVERY_DOC, RATE_LIMIT_DOC];

/** Relative to `ops/runbook/`. Named here so the file entry point and the tests agree on one spelling. */
export const RUNBOOK_FILES: Readonly<Record<string, string>> = {
  [ROLLBACK_DOC]: 'ROLLBACK.md',
  [DISASTER_RECOVERY_DOC]: 'DISASTER_RECOVERY.md',
  [RATE_LIMIT_DOC]: 'RATE_LIMIT_POSTURE.md',
};

/**
 * The `## ` sections each document must carry, in this order. Order is part of the requirement: an
 * operator reads a runbook top to bottom under pressure, so "what this is" precedes the procedure and
 * "what this never does" closes it.
 */
export const REQUIRED_SECTIONS: Readonly<Record<string, readonly string[]>> = {
  [ROLLBACK_DOC]: [
    'What this document is',
    'When to roll back, and when not to',
    'Rollback without a migration',
    'Rollback across a migration',
    'The write-ahead-log sidecar determination',
    'Deployment order for a change that includes a migration',
    'Recording the rollback',
    'What this document never does',
  ],
  [DISASTER_RECOVERY_DOC]: [
    'What this document is',
    'Blast radius',
    'Recovery objective',
    'The rebuild path',
    'Degraded operation while the endpoint is unavailable',
    'What is unrecoverable',
    'The drill is the prerequisite, not the recovery',
    'What this document never does',
  ],
  [RATE_LIMIT_DOC]: [
    'What this document is',
    'Provenance of every number below',
    'The documented limits, and the posture for each',
    'Refusal handling, in one place',
    'Degraded mode: long polling',
    'What this document never does',
  ],
};

/** The two documents that are procedures, and therefore must carry a numbered, verified step sequence. */
export const PROCEDURE_DOCS: readonly string[] = [ROLLBACK_DOC, DISASTER_RECOVERY_DOC];

/** Every long-running notice a template of this tier carries (steering §2). */
const EXECUTION_NOTICE = 'NOTHING HERE IS EXECUTED BY AN AGENT';

// ---------------------------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------------------------

export const RUNBOOK_FINDING_CODES = [
  // fail-closed, shared
  'DOC_UNREADABLE',
  'DOC_OUTSIDE_SUBSET',
  'COMPANION_UNREADABLE',
  'HEADER_OWNERSHIP_MISSING',
  'EXECUTION_NOTICE_MISSING',
  'SECTION_MISSING',
  'SECTION_UNEXPECTED',
  'SECTION_ORDER_UNEXPECTED',
  'PROCEDURE_HAS_NO_STEPS',
  'BLOCK_NUMBERING_UNEXPECTED',
  'STEP_WITHOUT_VERIFICATION',
  'VOCABULARY_UNDECLARED',
  'SECRET_VALUE_ASSIGNED',
  'GATE_REFERENCE_UNKNOWN',
  // §7.4 rollback
  'ROLLBACK_NOT_BY_IMAGE_TAG',
  'IMAGE_REFERENCE_MISSING',
  'MIGRATION_REVERSAL_NOT_REFUSED',
  'DEPLOY_ORDER_UNEXPECTED',
  'RESTORE_DRILL_SEQUENCE_MISQUOTED',
  'INTEGRITY_CHECK_NOT_BEFORE_TRUST',
  'PROMOTION_NOT_SEPARATE',
  'MIGRATION_VERSION_STALE',
  'ROLLBACK_NOT_RECORDED',
  'WAL_DETERMINATION_MISSING',
  'WAL_OUTCOMES_INCOMPLETE',
  'WAL_DEFAULT_OUTCOME_NOT_RANKED',
  'WAL_COPY_FALLBACK_NOT_REFUSED',
  'PROBE_INVOCATION_MALFORMED',
  // §7.5 disaster recovery
  'BLAST_RADIUS_MITIGATIONS_INCOMPLETE',
  'REBUILD_STEP_MISSING',
  'REBUILD_ORDER_UNEXPECTED',
  'STORE_COVERAGE_INCOMPLETE',
  'SECRETS_TREATED_AS_RESTORABLE',
  'RECOVERY_OBJECTIVE_NOT_CADENCE_BOUND',
  'DRILL_NOT_PREREQUISITE',
  'DEGRADED_MODE_GUARDS_NOT_INTACT',
  // §5.5 / §2.3 rate-limit posture
  'DOCUMENTED_LIMIT_MISSING',
  'LIMIT_DOCUMENTED_LINE_MISSING',
  'LIMIT_QUANTITY_MISSING',
  'LIMIT_PROVENANCE_MISSING',
  'LIMIT_POSTURE_MISSING',
  'REFUSAL_NOT_A_QUEUE_FAILURE',
  'RETRY_AFTER_NOT_HONOURED',
  'CONNECTION_CEILING_NOT_LOW',
  'TRANSPORT_MODE_UNDECLARED',
  'LIVE_PROBE_PRESENT',
  // R24, re-reported from the ONE shared scan
  'PARTICULAR_URL_SCHEME',
  'PARTICULAR_ADDRESS_LITERAL',
  'PARTICULAR_HOSTNAME',
  'PARTICULAR_LONG_DIGIT_RUN',
  'PARTICULAR_CURRENCY_FIGURE',
  'PLACEHOLDER_MALFORMED',
  'PARTICULAR_SCAN_UNMAPPED',
] as const;

export type RunbookFindingCode = (typeof RUNBOOK_FINDING_CODES)[number];

export interface RunbookFinding {
  readonly code: RunbookFindingCode;
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
 * Re-report the shared scan's findings under this checker's code set. R24 has ONE implementation, in
 * `./composeTemplate`, so a later widening of it moves every template at once. A code this checker
 * has no equivalent for becomes `PARTICULAR_SCAN_UNMAPPED` rather than being dropped: silently
 * discarding a finding from a scan whose whole job is to fail closed would turn a widened rule into a
 * narrowed one.
 */
export function mapParticularFindings(input: readonly ComposeFinding[], where: string): readonly RunbookFinding[] {
  const out: RunbookFinding[] = [];
  for (const finding of input) {
    if (SHARED_PARTICULAR_CODES.includes(finding.code)) {
      out.push({ code: finding.code as RunbookFindingCode, detail: `${where}: ${finding.detail}` });
    } else {
      out.push({
        code: 'PARTICULAR_SCAN_UNMAPPED',
        detail: `${where}: the shared no-deployment-particular scan reported ${finding.code}, which this checker has no code for: ${finding.detail}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The vocabulary, assembled from artifacts rather than declared here
// ---------------------------------------------------------------------------------------------

const ANGLE_PLACEHOLDER = /<([A-Z][A-Z0-9_]*)>/g;
const ENV_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Every `<UPPER_SNAKE>` placeholder some other tracked artifact already declares. */
export function placeholdersIn(source: string): readonly string[] {
  const seen = new Set<string>();
  for (const match of source.matchAll(ANGLE_PLACEHOLDER)) seen.add(match[1] ?? '');
  return [...seen];
}

/** The image references the topology declares, one per service. */
export function imageReferencesIn(composeSource: string): readonly string[] {
  return placeholdersIn(composeSource).filter((name) => name.endsWith('_IMAGE_REF'));
}

/** The gates the register carries, including the one it records as closed. */
export function gatesIn(gateRegisterSource: string): readonly string[] {
  const seen = new Set<string>();
  for (const match of gateRegisterSource.matchAll(/\bG([1-9])\b/g)) seen.add(`G${match[1] ?? ''}`);
  return [...seen];
}

/** Entry names annotated secret anywhere in `ops/env/**`. A runbook may name one; it may never assign one. */
export const SECRET_ENTRY_NAMES: readonly string[] = Object.entries(ENTRY_SPECS)
  .filter(([, spec]) => spec.secret)
  .map(([name]) => name);

/** The three store files the environment templates declare, in template order. */
export const STORE_FILE_ENTRIES: readonly string[] = Object.keys(ENTRY_SPECS).filter((name) => name.endsWith('_STORE_FILE'));

/** Names the two shell templates bind themselves. A runbook may quote one when it quotes the template. */
function shellLocals(source: string): readonly string[] {
  try {
    return parseShellScript(source).localNames;
  } catch {
    return [];
  }
}

export interface RunbookCompanions {
  readonly composeSource: string;
  readonly gateRegisterSource: string;
  readonly backupSource: string;
  readonly restoreSource: string;
}

/**
 * Every name a runbook may reference. Assembled from `ops/env/**`, the topology, the gate register and
 * the two shell templates, so a name that appears in a runbook and nowhere else is a name nobody
 * reviewed - which is exactly how an operator ends up looking for a value that does not exist.
 */
export function assembleVocabulary(companions: RunbookCompanions): readonly string[] {
  const seen = new Set<string>([
    ...Object.keys(ENTRY_SPECS),
    ...RESTORE_ENTRIES,
    ...placeholdersIn(companions.composeSource),
    ...placeholdersIn(companions.gateRegisterSource),
    ...shellLocals(companions.backupSource),
    ...shellLocals(companions.restoreSource),
  ]);
  return [...seen];
}

// ---------------------------------------------------------------------------------------------
// What §7.5's rebuild path is, in order
// ---------------------------------------------------------------------------------------------

/** §7.5's rebuild path. The order is the contract's; the titles are matched, not restated. */
export const REBUILD_STEPS: readonly { readonly key: string; readonly title: RegExp }[] = [
  { key: 'provision a fresh host', title: /provision a fresh host/i },
  { key: 'restore through the drill', title: /restore the encrypted artifacts/i },
  { key: 're-provision the secrets', title: /re-provision every secret/i },
  { key: 'bring the services up', title: /bring the services up from the templates/i },
  { key: 're-register the webhooks', title: /re-register both webhooks/i },
];

// ---------------------------------------------------------------------------------------------
// What the rate-limit posture must cover
// ---------------------------------------------------------------------------------------------

/**
 * The provider-documented limits an outbound path can meet, each with the posture that answers it
 * (§5.5.5). `quantity` marks the rows that state a documented number rather than a documented
 * behaviour - the port set and the refusal signal have no number to state, and requiring one would
 * invite an invented figure.
 */
export const REQUIRED_LIMITS: readonly { readonly key: string; readonly title: RegExp; readonly quantity: boolean }[] = [
  { key: 'per-chat send rate', title: /per-chat send rate/i, quantity: true },
  { key: 'global send rate', title: /global send rate/i, quantity: true },
  { key: 'per-group send rate', title: /per-group send rate/i, quantity: true },
  { key: 'the refusal signal', title: /the refusal signal/i, quantity: false },
  { key: 'webhook connection ceiling', title: /webhook connection ceiling/i, quantity: true },
  { key: 'long-poll request duration', title: /long-poll request duration/i, quantity: false },
  { key: 'acceptable webhook ports', title: /acceptable webhook ports/i, quantity: false },
];

/** Spelled quantities count. A documented limit stated in words is still stated. */
const QUANTITY_WORDS: readonly string[] = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'ten',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'hundred',
];

/** Command shapes that would make this a measurement rather than a reading of documentation. */
const PROBE_SHAPES: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'a transfer client invocation', pattern: /\bcurl\b|\bwget\b|\bhttpie\b/i },
  { label: 'a request-issuing helper', pattern: /\bfetch\s*\(/ },
  { label: 'a load-generating tool', pattern: /\bab\b\s+-n|\bhey\b\s+-n|\bsiege\b/i },
];

// ---------------------------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------------------------

export interface RunbookAuditInput extends RunbookCompanions {
  readonly sources: Readonly<Record<string, string>>;
  /**
   * Why a document is absent, keyed by document, when the caller already knows. The file entry point
   * fills this in so the single `DOC_UNREADABLE` finding carries the path, rather than the path being
   * reported here and the absence reported again below.
   */
  readonly unreadable?: Readonly<Record<string, string>>;
}

/**
 * Audit all three runbooks. An empty array means every structural property §7.4, §7.5, §2.3 and §5.5
 * require is present. Any finding is a failure; there is no severity ladder, because none of these
 * rules is advisory.
 */
export function auditRunbooks(input: RunbookAuditInput): readonly RunbookFinding[] {
  const findings: RunbookFinding[] = [];
  const note = (code: RunbookFindingCode, detail: string): void => {
    findings.push({ code, detail });
  };

  const vocabulary = assembleVocabulary(input);
  const gates = gatesIn(input.gateRegisterSource);
  const images = imageReferencesIn(input.composeSource);
  if (gates.length === 0 || images.length === 0 || vocabulary.length === 0) {
    note(
      'COMPANION_UNREADABLE',
      `the companions did not yield a vocabulary (${vocabulary.length} names), a gate list (${gates.length}) and the topology's image references (${images.length}); without all three the cross-reads below would silently pass`,
    );
  }

  let restoreOrder: readonly string[] = RESTORE_SEQUENCE;
  try {
    const order = parseShellScript(input.restoreSource).mainSequence;
    if (order.length === 0) throw new RunbookSubsetError('empty');
    restoreOrder = order;
  } catch {
    note(
      'COMPANION_UNREADABLE',
      'ops/restore/ could not be parsed for its step order, so the sequence ROLLBACK.md quotes cannot be compared against the template it claims to quote',
    );
  }

  const parsed = new Map<string, RunbookDoc>();
  for (const name of RUNBOOK_DOCS) {
    const source = input.sources[name];
    if (source === undefined) {
      note('DOC_UNREADABLE', `${name}: ${input.unreadable?.[name] ?? 'no source was supplied, so nothing about it was checked'}`);
      continue;
    }
    findings.push(...mapParticularFindings(scanForParticulars(source), name));
    let doc: RunbookDoc;
    try {
      doc = parseRunbook(source);
    } catch (e) {
      note('DOC_OUTSIDE_SUBSET', `${name}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    parsed.set(name, doc);
    auditShared(name, doc, vocabulary, gates, note);
  }

  const rollback = parsed.get(ROLLBACK_DOC);
  if (rollback !== undefined) auditRollback(rollback, images, restoreOrder, note);
  const recovery = parsed.get(DISASTER_RECOVERY_DOC);
  if (recovery !== undefined) auditRecovery(recovery, note);
  const posture = parsed.get(RATE_LIMIT_DOC);
  if (posture !== undefined) auditPosture(posture, note);

  return findings;
}

// ---------------------------------------------------------------------------------------------
// Properties every runbook must have
// ---------------------------------------------------------------------------------------------

function auditShared(
  name: string,
  doc: RunbookDoc,
  vocabulary: readonly string[],
  gates: readonly string[],
  note: (code: RunbookFindingCode, detail: string) => void,
): void {
  if (!/contract\s*12/i.test(doc.head) || !/phase[^0-9]{0,16}7/i.test(doc.head)) {
    note('HEADER_OWNERSHIP_MISSING', `${name} does not declare its owning contract and phase in its first twenty lines`);
  }
  if (!doc.head.includes(EXECUTION_NOTICE)) {
    note(
      'EXECUTION_NOTICE_MISSING',
      `${name} does not state up front that nothing in it is executed by an agent; steering §2 permits writing these files and forbids running them, and the notice is where a reader learns which of the two this is`,
    );
  }

  // --- the sections, all of them, in order ---------------------------------------------------
  const required = REQUIRED_SECTIONS[name] ?? [];
  const present = doc.sections.map((section) => section.title);
  for (const title of required) {
    if (!present.includes(title)) note('SECTION_MISSING', `${name} has no "${title}" section`);
  }
  for (const title of present) {
    if (!required.includes(title)) {
      note(
        'SECTION_UNEXPECTED',
        `${name} carries a "${title}" section that this audit does not know about; an unrecognized section is a failure rather than a skip, because a runbook nobody checked is a runbook nobody can rely on`,
      );
    }
  }
  const ordered = present.filter((title) => required.includes(title));
  if (ordered.join(' | ') !== required.filter((title) => present.includes(title)).join(' | ')) {
    note(
      'SECTION_ORDER_UNEXPECTED',
      `${name} orders its sections ${ordered.join(' -> ')}; the required order is ${required.join(' -> ')}, and an operator reads a runbook top to bottom under pressure`,
    );
  }

  // --- the numbered blocks -------------------------------------------------------------------
  const steps = doc.blocks.filter((block) => block.kind === 'Step');
  if (PROCEDURE_DOCS.includes(name) && steps.length === 0) {
    note('PROCEDURE_HAS_NO_STEPS', `${name} is a procedure and declares no numbered step at all, so there is nothing for an operator to follow`);
  }
  for (const kind of ['Step', 'Limit'] as const) {
    const numbers = doc.blocks.filter((block) => block.kind === kind).map((block) => block.number);
    const expected = numbers.map((_value, index) => index + 1);
    if (numbers.join(',') !== expected.join(',')) {
      note(
        'BLOCK_NUMBERING_UNEXPECTED',
        `${name} numbers its ${kind} blocks ${numbers.join(',')}; they must run 1..n in document order, because a runbook that skips or repeats a number is one an operator loses their place in`,
      );
    }
  }
  for (const step of steps) {
    if (verificationOf(step) === null) {
      note(
        'STEP_WITHOUT_VERIFICATION',
        `${name} Step ${step.number} ("${step.title}") has no verification line; a step whose outcome is not checked is a step that is assumed to have worked`,
      );
    }
  }

  // --- every name traces to an artifact -----------------------------------------------------
  const named = new Set<string>();
  for (const match of doc.prose.matchAll(ANGLE_PLACEHOLDER)) named.add(match[1] ?? '');
  for (const match of doc.prose.matchAll(ENV_REFERENCE)) named.add(match[1] ?? '');
  for (const entry of named) {
    if (!vocabulary.includes(entry)) {
      note(
        'VOCABULARY_UNDECLARED',
        `${name} references ${entry}, which no environment template, the topology, the gate register, or either shell template declares; a value from nowhere is one the operator cannot resolve`,
      );
    }
  }

  // --- a secret is referenced, never assigned ------------------------------------------------
  for (const entry of SECRET_ENTRY_NAMES) {
    if (new RegExp(`\\b${entry}\\s*=`).test(doc.flow)) {
      note(
        'SECRET_VALUE_ASSIGNED',
        `${name} writes ${entry} as an assignment; a runbook may reference a secret entry so the operator knows which one, but writing it as an assignment is how a value ends up in a document (steering §0b)`,
      );
    }
  }

  // --- every gate named exists ---------------------------------------------------------------
  for (const match of doc.prose.matchAll(/\bG([1-9])\b/g)) {
    const gate = `G${match[1] ?? ''}`;
    if (!gates.includes(gate)) {
      note(
        'GATE_REFERENCE_UNKNOWN',
        `${name} names gate ${gate}, which ops/GATE_REGISTER.md does not carry; a step attributed to a gate that does not exist is a step nobody can clear (R23)`,
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// ops/runbook/ROLLBACK.md - §7.4
// ---------------------------------------------------------------------------------------------

function sectionOf(doc: RunbookDoc, title: string): RunbookSection | undefined {
  return doc.sections.find((section) => section.title === title);
}

function auditRollback(
  doc: RunbookDoc,
  images: readonly string[],
  restoreOrder: readonly string[],
  note: (code: RunbookFindingCode, detail: string) => void,
): void {
  // --- a rollback is a re-deployment of an immutable tag (§7.4, first rule) -------------------
  if (!/re-deployment of a previously known-good, immutably tagged image/i.test(doc.flow) || !/tags are immutable/i.test(doc.flow)) {
    note(
      'ROLLBACK_NOT_BY_IMAGE_TAG',
      'ROLLBACK.md does not state that a rollback is the re-deployment of a previously known-good, immutably tagged image whose tags are immutable; without that, "roll back" means whatever the operator improvises at the worst moment',
    );
  }
  for (const image of images) {
    if (!doc.prose.includes(image)) {
      note(
        'IMAGE_REFERENCE_MISSING',
        `ROLLBACK.md never names ${image}, which ops/docker-compose.yml declares; an operator reverting that service would have to guess which reference to change`,
      );
    }
  }

  // --- a migration is never reversed (§7.4, contract 06 §5) ----------------------------------
  if (!/a schema migration is not rolled back by reversing it/i.test(doc.flow) || !/do not write a down migration/i.test(doc.flow)) {
    note(
      'MIGRATION_REVERSAL_NOT_REFUSED',
      'ROLLBACK.md does not refuse the reversal outright; migrations are append-only and forward-only, so a document that leaves the reversal merely undiscussed invites one to be written on the day it is needed',
    );
  }
  if (!/snapshot, migrate, deploy/i.test(doc.flow) || !/never deploy code that assumes a migration that has not yet been applied/i.test(doc.flow)) {
    note(
      'DEPLOY_ORDER_UNEXPECTED',
      'ROLLBACK.md does not state the deployment order for a change that includes a migration as snapshot, migrate, deploy, with the prohibition that follows from it; that order is the only thing that guarantees the snapshot a rollback across a migration needs',
    );
  }

  // --- the drill's order is quoted from the drill, not from memory ---------------------------
  const quoted = quotedDrillSequence(doc);
  if (quoted === null) {
    note('RESTORE_DRILL_SEQUENCE_MISQUOTED', 'ROLLBACK.md carries no "Drill sequence:" line, so the order an operator follows is whatever they remember');
  } else if (quoted.join(' -> ') !== restoreOrder.join(' -> ')) {
    note(
      'RESTORE_DRILL_SEQUENCE_MISQUOTED',
      `ROLLBACK.md quotes the drill as ${quoted.join(' -> ')}; ops/restore/ runs ${restoreOrder.join(' -> ')}, and the two disagreeing is how an operator skips a gate that precedes trust`,
    );
  }
  if (!/the integrity check precedes trust/i.test(doc.flow) || !/discarded\s+and\s+escalated/i.test(doc.flow)) {
    note(
      'INTEGRITY_CHECK_NOT_BEFORE_TRUST',
      'ROLLBACK.md does not state that the integrity check precedes trust and that a failing artifact is discarded and escalated (§7.2.3, R21); "better than nothing" is how a subtly wrong ledger becomes the ledger',
    );
  }
  if (!/never overwrites a live store in place/i.test(doc.flow) || !/separate step/i.test(doc.flow)) {
    note(
      'PROMOTION_NOT_SEPARATE',
      'ROLLBACK.md does not state that a restore never overwrites a live store in place and that promotion is a separate step (§7.2); a drill that can reach a live store is not a drill',
    );
  }

  // --- the recorded schema version agrees with the migration series -------------------------
  const recorded = /latest applied migration version:\s*0*(\d+)/i.exec(doc.flow);
  if (recorded === null) {
    note(
      'MIGRATION_VERSION_STALE',
      'ROLLBACK.md records no latest applied migration version, so nothing in it can be compared against src/server/db/migrations.ts and the document can rot silently',
    );
  } else if (Number(recorded[1] ?? '-1') !== EXPECTED_SCHEMA_VERSION) {
    note(
      'MIGRATION_VERSION_STALE',
      `ROLLBACK.md records version ${recorded[1] ?? '(none)'} as the latest applied migration; the migration series is at ${EXPECTED_SCHEMA_VERSION}, and a rollback that targets the wrong version targets the wrong store`,
    );
  }

  if (!/a rollback is recorded with what was reverted and why/i.test(doc.flow)) {
    note('ROLLBACK_NOT_RECORDED', 'ROLLBACK.md does not require the rollback to be recorded with what was reverted and why (§7.4, last rule)');
  }

  // --- the write-ahead-log sidecar determination, carried forward from task 7.4 -------------
  const determination = sectionOf(doc, 'The write-ahead-log sidecar determination');
  if (determination === undefined || !/operator determination/i.test(determination.flow)) {
    note(
      'WAL_DETERMINATION_MISSING',
      "ROLLBACK.md does not carry the write-ahead-log sidecar constraint as an explicit operator determination; the engine requires a reader of such a store to write its shared-memory sidecar, §3.2.2 requires the mount to be read-only, and an unrecorded conflict is one somebody resolves with a copy",
    );
  } else {
    if (
      !/exactly two acceptable outcomes/i.test(determination.flow) ||
      !/write access to the sidecar/i.test(determination.flow) ||
      !/from inside the owning service/i.test(determination.flow)
    ) {
      note(
        'WAL_OUTCOMES_INCOMPLETE',
        'the sidecar determination does not name both acceptable outcomes - granting write access to the sidecar and nothing else, or issuing the snapshot from inside the owning service that already holds it as the single writer - so an operator meeting the constraint has no bounded choice to make',
      );
    }
    // Naming two acceptable outcomes bounds the choice; RANKING them is what stops the operator
    // making it under pressure, at the first-backup step, with no stated preference to fall back
    // on. The owner ranked them: outcome B - snapshot from inside the owning service - is the
    // documented default, because it needs no write grant and therefore resolves the constraint
    // WITHOUT widening a mount; outcome A - a sidecar-only write grant - stays documented as the
    // fallback. Both halves are asserted, because a document that named a default without saying
    // which outcome it is would be no more use than one that named none.
    if (
      !/outcome B is the documented default/i.test(determination.flow) ||
      !/outcome A is the fallback/i.test(determination.flow)
    ) {
      note(
        'WAL_DEFAULT_OUTCOME_NOT_RANKED',
        'the sidecar determination names two acceptable outcomes without ranking them: it must state that outcome B - issuing the snapshot from inside the owning service, which needs no write grant and so resolves the constraint without widening a mount - is the documented DEFAULT, and that outcome A - a sidecar-only write grant - is the FALLBACK. Two equal options at the first-backup step is a decision an operator makes under pressure with nothing to prefer',
      );
    }
    if (!/not acceptable, under any circumstance, is falling back to a file copy/i.test(determination.flow)) {
      note(
        'WAL_COPY_FALLBACK_NOT_REFUSED',
        'the sidecar determination does not refuse the copy fallback in the same breath; a copy of a write-ahead-logged store that is being written may restore wrongly and look fine, which is the failure this whole constraint exists to avoid',
      );
    }
  }

  // --- the probe invocation parses under the probe's own parser -----------------------------
  const invocations = doc.fenced.filter((line) => line.includes(PROBE_COMMAND_NAME));
  if (invocations.length === 0) {
    note(
      'PROBE_INVOCATION_MALFORMED',
      `ROLLBACK.md never invokes ${PROBE_COMMAND_NAME}; §7.3 requires a rollback to confirm actual readiness rather than a running process, and the probe is how that is answered`,
    );
  }
  for (const line of invocations) {
    const tokens = line.trim().split(/\s+/);
    const at = tokens.indexOf(PROBE_COMMAND_NAME);
    const outcome = parseProbeInvocation(tokens.slice(at + 1));
    if (!outcome.parsed) {
      note(
        'PROBE_INVOCATION_MALFORMED',
        `the invocation "${line.trim()}" is refused by the probe's own parser (${outcome.refusal} at ${outcome.at}); a runbook that hands an operator a command the tool rejects wastes the one thing a rollback does not have`,
      );
    }
  }
}

/** The arrow-joined step names ROLLBACK.md quotes from the drill, or null when it quotes none. */
export function quotedDrillSequence(doc: RunbookDoc): readonly string[] | null {
  const at = doc.lines.findIndex((line) => /^\*\*Drill sequence:\*\*/.test(line));
  if (at === -1) return null;
  const collected: string[] = [];
  for (let i = at; i < doc.lines.length; i += 1) {
    const line = doc.lines[i] ?? '';
    if (i > at && line.trim() === '') break;
    for (const match of line.matchAll(/`([a-z_]+)`/g)) collected.push(match[1] ?? '');
  }
  return collected.length === 0 ? null : collected;
}

// ---------------------------------------------------------------------------------------------
// ops/runbook/DISASTER_RECOVERY.md - §7.5
// ---------------------------------------------------------------------------------------------

function auditRecovery(doc: RunbookDoc, note: (code: RunbookFindingCode, detail: string) => void): void {
  // --- blast radius, with all four mitigations (§7.5) ---------------------------------------
  const radius = sectionOf(doc, 'Blast radius');
  const mitigations: readonly { readonly label: string; readonly pattern: RegExp }[] = [
    { label: 'bounded per-service resources', pattern: /bounded per-service resources/i },
    { label: 'the internal-only bus', pattern: /internal-only bus/i },
    { label: 'off-host backup keys', pattern: /off-host backup keys/i },
    { label: 'a rebuild path independent of the failed host', pattern: /rebuild path that does not depend on the failed host/i },
  ];
  if (radius === undefined || !/one host is one failure domain/i.test(radius.flow)) {
    note(
      'BLAST_RADIUS_MITIGATIONS_INCOMPLETE',
      'DISASTER_RECOVERY.md does not state that one host is one failure domain; §7.5 accepts that and then names what mitigates it, and an unstated blast radius is one nobody sized',
    );
  } else {
    for (const mitigation of mitigations) {
      if (!mitigation.pattern.test(radius.flow)) {
        note('BLAST_RADIUS_MITIGATIONS_INCOMPLETE', `the blast-radius section does not name ${mitigation.label}, which §7.5 lists as one of the four mitigations`);
      }
    }
  }

  // --- the rebuild path, all of it, in the contract's order ---------------------------------
  const steps = doc.blocks.filter((block) => block.kind === 'Step');
  const at: number[] = [];
  for (const step of REBUILD_STEPS) {
    const found = steps.findIndex((block) => step.title.test(block.title));
    if (found === -1) {
      note('REBUILD_STEP_MISSING', `DISASTER_RECOVERY.md has no rebuild step for "${step.key}"; §7.5's path is all five or it is not the path`);
    } else {
      at.push(found);
    }
  }
  if (at.length === REBUILD_STEPS.length && at.some((value, index) => index > 0 && value <= (at[index - 1] ?? -1))) {
    note(
      'REBUILD_ORDER_UNEXPECTED',
      `DISASTER_RECOVERY.md orders the rebuild steps ${at.join(',')} by position; §7.5's order is ${REBUILD_STEPS.map((step) => step.key).join(' -> ')}, and re-registering a webhook before the host is hardened publishes a host that is not ready`,
    );
  }
  for (const entry of STORE_FILE_ENTRIES) {
    if (!doc.prose.includes(entry)) {
      note(
        'STORE_COVERAGE_INCOMPLETE',
        `DISASTER_RECOVERY.md never names ${entry}; a rebuild that silently omits a store leaves the deployment running with one of its three stores empty`,
      );
    }
  }

  if (!/secrets are re-issued, never restored/i.test(doc.flow)) {
    note(
      'SECRETS_TREATED_AS_RESTORABLE',
      'DISASTER_RECOVERY.md does not state that secrets are re-issued and never restored; no key, token, or environment file was ever part of a backup payload (§7.1), so a document that implies otherwise sends an operator looking for something that does not exist',
    );
  }

  // --- the objective is stated over the configured cadence (§7.5) ---------------------------
  const objective = sectionOf(doc, 'Recovery objective');
  if (
    objective === undefined ||
    !objective.prose.includes('${BACKUP_SCHEDULE}') ||
    !/cadence is a configuration value/i.test(objective.flow) ||
    !/what is unrecoverable is what was never backed up/i.test(doc.flow)
  ) {
    note(
      'RECOVERY_OBJECTIVE_NOT_CADENCE_BOUND',
      'DISASTER_RECOVERY.md does not express the recovery objective in terms of the configured backup cadence; §7.5 requires exactly that, because an objective stated as a target the cadence cannot support is a hope with a number on it',
    );
  }

  if (
    !/recovery must not be the moment a guard is first tested/i.test(doc.flow) ||
    !/a backup is not a backup until a restore has been exercised/i.test(doc.flow)
  ) {
    note(
      'DRILL_NOT_PREREQUISITE',
      'DISASTER_RECOVERY.md does not state that the drill is the prerequisite - that recovery must not be the moment a guard is first tested, and that an untested backup is an assumption (§7.2, §7.5)',
    );
  }

  // --- the degraded mode keeps every guard (§2.3) -------------------------------------------
  const degraded = sectionOf(doc, 'Degraded operation while the endpoint is unavailable');
  if (degraded === undefined || !degraded.prose.includes('${TELEGRAM_MODE}') || !/every guard in §5 stays intact/i.test(degraded.flow)) {
    note(
      'DEGRADED_MODE_GUARDS_NOT_INTACT',
      'DISASTER_RECOVERY.md does not present the degraded mode as a configuration-selected mode with every §5 guard intact; §2.3 makes it a mode rather than a second code path precisely so that failing over cannot disable a check',
    );
  }
}

// ---------------------------------------------------------------------------------------------
// ops/runbook/RATE_LIMIT_POSTURE.md - §5.5, §2.3
// ---------------------------------------------------------------------------------------------

function auditPosture(doc: RunbookDoc, note: (code: RunbookFindingCode, detail: string) => void): void {
  const limits = doc.blocks.filter((block) => block.kind === 'Limit');
  for (const required of REQUIRED_LIMITS) {
    const block = limits.find((limit) => required.title.test(limit.title));
    if (block === undefined) {
      note('DOCUMENTED_LIMIT_MISSING', `RATE_LIMIT_POSTURE.md carries no limit for "${required.key}"; a limit nobody wrote down is a limit nobody has a posture for`);
      continue;
    }
    const bullets = bulletsOf(block.prose);
    const documented = bullets['Documented'];
    if (documented === undefined || documented === '') {
      note('LIMIT_DOCUMENTED_LINE_MISSING', `the "${required.key}" limit states no Documented line, so what the provider actually publishes is left to the reader`);
    } else if (required.quantity) {
      const hasDigit = /\d/.test(documented);
      const hasWord = QUANTITY_WORDS.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(documented));
      if (!hasDigit && !hasWord) {
        note(
          'LIMIT_QUANTITY_MISSING',
          `the "${required.key}" limit is a numeric ceiling but its Documented line states no quantity; task 7.6 requires the documented numbers to be stated, not gestured at`,
        );
      }
    }
    if ((bullets['Provenance'] ?? '') === '') {
      note(
        'LIMIT_PROVENANCE_MISSING',
        `the "${required.key}" limit carries no Provenance line; every number here is read from the provider's published documentation rather than measured, and the line is where that is claimed explicitly`,
      );
    }
    if ((bullets['Posture'] ?? '') === '') {
      note(
        'LIMIT_POSTURE_MISSING',
        `the "${required.key}" limit states no Posture; a documented limit with no answer beside it is a fact rather than a decision, and §5.5.5 requires the decision`,
      );
    }
  }

  if (!/queue failure, never a transport failure/i.test(doc.flow)) {
    note(
      'REFUSAL_NOT_A_QUEUE_FAILURE',
      'RATE_LIMIT_POSTURE.md does not state that a downstream refusal is a queue failure and never a transport failure (§5.5.4); letting it become a transport failure makes the provider redeliver, which turns one refused send into two',
    );
  }
  if (!doc.prose.includes('retry_after') || !/honoured, not estimated/i.test(doc.flow)) {
    note(
      'RETRY_AFTER_NOT_HONOURED',
      "RATE_LIMIT_POSTURE.md does not state that the provider's advertised retry interval is honoured rather than estimated; guessing a shorter interval than the one advertised is how a refusal becomes a ban",
    );
  }
  if (!doc.prose.includes('<MAX_CONNECTIONS>') || !/set low/i.test(doc.flow)) {
    note(
      'CONNECTION_CEILING_NOT_LOW',
      'RATE_LIMIT_POSTURE.md does not record that the webhook connection ceiling is set low (§5.5.5); a single-operator system needs almost none, and a high ceiling only buys concurrency the agent then has to bound anyway',
    );
  }

  // --- the modes are the port's, not this document's -----------------------------------------
  const degraded = sectionOf(doc, 'Degraded mode: long polling');
  if (degraded === undefined || !degraded.lines.join('\n').includes('${TELEGRAM_MODE}')) {
    note('TRANSPORT_MODE_UNDECLARED', "RATE_LIMIT_POSTURE.md does not name the mode selector, so the fallback reads as a code path rather than as §2.3's configuration choice");
  } else {
    const quoted = new Set<string>();
    for (const match of degraded.lines.join('\n').matchAll(/`([a-z][A-Za-z]+)`/g)) quoted.add(match[1] ?? '');
    const expected = [...TELEGRAM_TRANSPORT_MODES].sort().join(',');
    if ([...quoted].sort().join(',') !== expected) {
      note(
        'TRANSPORT_MODE_UNDECLARED',
        `the degraded-mode section names modes {${[...quoted].sort().join(', ')}}; the transport port declares {${expected.split(',').join(', ')}}, and a mode named here that the port does not have is a mode nobody can select`,
      );
    }
  }

  // --- it is a reading of documentation, not a measurement ----------------------------------
  if (!/no live api probe was made, and none is needed/i.test(doc.flow)) {
    note(
      'LIVE_PROBE_PRESENT',
      'RATE_LIMIT_POSTURE.md does not state that no live probe was made; steering §2 gates every outbound call from a server process, and a rate limit is not discovered by exceeding it',
    );
  }
  for (const shape of PROBE_SHAPES) {
    if (shape.pattern.test(doc.flow)) {
      note('LIVE_PROBE_PRESENT', `RATE_LIMIT_POSTURE.md contains ${shape.label}; this document is a posture, and a posture that ships a probe invites somebody to run it`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The file entry point
// ---------------------------------------------------------------------------------------------

/** `ops/runbook/`, relative to `ops/`. One spelling, shared by the entry point and the tests. */
export const RUNBOOK_SUBDIR = 'runbook';
/** The two companions this checker cross-reads that are not shell templates. */
export const COMPOSE_FILE = 'docker-compose.yml';
export const GATE_REGISTER_FILE = 'GATE_REGISTER.md';

/**
 * Audit the three documents on disk together with the four companions they are cross-read against. An
 * unreadable file is a finding, never a skip: a checker that quietly stops checking is worse than no
 * checker, because the harness still reports green.
 */
export function auditRunbookFiles(runbookDir: string, opsDir: string): readonly RunbookFinding[] {
  const findings: RunbookFinding[] = [];
  const sources: Record<string, string> = {};
  const unreadable: Record<string, string> = {};
  for (const name of RUNBOOK_DOCS) {
    const path = join(runbookDir, RUNBOOK_FILES[name] ?? `${name}.md`);
    try {
      sources[name] = readFileSync(path, 'utf8');
    } catch (e) {
      unreadable[name] = `${path} could not be read: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const companion = (relative: string): string => {
    try {
      return readFileSync(join(opsDir, relative), 'utf8');
    } catch (e) {
      findings.push({ code: 'COMPANION_UNREADABLE', detail: `${relative} could not be read: ${e instanceof Error ? e.message : String(e)}` });
      return '';
    }
  };

  findings.push(
    ...auditRunbooks({
      sources,
      unreadable,
      composeSource: companion(COMPOSE_FILE),
      gateRegisterSource: companion(GATE_REGISTER_FILE),
      backupSource: companion(BACKUP_SCRIPT_PATH),
      restoreSource: companion(RESTORE_SCRIPT_PATH),
    }),
  );
  return findings;
}
