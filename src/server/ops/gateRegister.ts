/**
 * NIZAM · Structural audit of the human gate register (ops/GATE_REGISTER.md)
 * Implemented by: PFOS Contract 12 / Phase 9.3 (spec 06-two-agent-vps)
 * Owning requirements: R23 (a human gate is recorded with its reason, its steps and its
 *   verification, and is never attempted or claimed done), R24 (no deployment particular, and in
 *   particular no verification line that prints a value), steering §2 (the BUILD/GATE split),
 *   steering §7 (gate discipline)
 * Depends on: node:fs and node:path for the file entry point only; ./envTemplates (`ENTRY_SPECS`
 *   and `parseEnvTemplate` - the ONE environment vocabulary, read rather than restated). The audit
 *   itself is a pure function over text, with the on-disk existence probe injected.
 *
 * WHY THIS EXISTS. The register is read today by `./runbookTemplate` for its gate list and scanned
 * by `./deploymentParticulars` for a deployment particular, and neither of those holds it to the
 * standard the document is written to meet: a competent human, holding only this file, can stand
 * the deployment up. Nothing checked that the gates were all still there, that each still carried
 * the four things a gate needs, that no gate had drifted into the past tense, or that the paths and
 * environment entries it names still exist. All four rot silently, and all four rot in the
 * direction of a register that reads complete and is not.
 *
 * WHAT IT CROSS-READS RATHER THAN RESTATES. Two things, because a copy is what goes stale:
 *   - `ops/env/**` is parsed for its real entries, and each entry a template attributes to a gate
 *     must be named by a step of THAT gate. This is the check that would have caught the nine
 *     entries the first half of task 9.3 found unnamed - an operator following the register would
 *     have discovered them at first start, on an unset entry with no default.
 *   - every repository path the register quotes is probed on disk. This is the check that would
 *     have caught the unit-file directory reference at authoring time rather than at review.
 *
 * IT FAILS CLOSED. An unreadable register, a register outside the supported markdown subset, an
 * unreadable or unparseable environment template, a quoted path that does not exist, and a cross
 * read that examined nothing are all FINDINGS, never skips. The report carries the number of items
 * each cross-read actually examined, and the caller asserts both are non-zero - a check that passes
 * by not running is the failure mode this module exists to prevent.
 *
 * NOTHING HERE IS EXECUTED, NOTHING HERE IS ATTEMPTED. No command in the register is run, no gate
 * is performed or simulated, and no `Status:` is written. This module only reads.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { ENTRY_SPECS, TRACKED_SUFFIX, parseEnvTemplate } from './envTemplates';

// ---------------------------------------------------------------------------------------------
// The parsed shape
// ---------------------------------------------------------------------------------------------

/** A `### ` subsection of a gate, with the lines under it up to the next heading of any level. */
export interface RegisterSubsection {
  readonly title: string;
  readonly lines: readonly string[];
  readonly prose: string;
  readonly flow: string;
}

/** A `## ` section, with its `### ` subsections. */
export interface RegisterSection {
  readonly title: string;
  readonly lines: readonly string[];
  readonly prose: string;
  readonly flow: string;
  readonly subsections: readonly RegisterSubsection[];
  /** Every `**Status: ...**` value declared anywhere in the section, in document order. */
  readonly statuses: readonly string[];
}

export interface RegisterDoc {
  readonly lines: readonly string[];
  readonly prose: string;
  readonly flow: string;
  readonly sections: readonly RegisterSection[];
  /** Table rows outside a fenced block, as cell arrays. */
  readonly tableRows: readonly (readonly string[])[];
  /** Inline `code` spans outside a fenced block. Where the register quotes a path. */
  readonly inlineCode: readonly string[];
}

/**
 * Thrown for anything outside the supported markdown subset. The subset is narrow on purpose: a
 * register whose structure a reader cannot predict is one nobody follows under pressure, and this
 * document is read exactly once, by one person, on the day it matters.
 */
export class RegisterSubsetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegisterSubsetError';
  }
}

const STATUS_LINE = /\*\*Status:\s*([^*]+?)\s*\*\*/g;

/** Emphasis, code ticks, strikethrough and blockquote markers carry no meaning for these checks. */
export function deEmphasize(text: string): string {
  return text.replace(/[*`~]/g, '').replace(/^>\s?/gm, '');
}

/**
 * One flowing line. Markdown wraps a sentence wherever the column runs out, so a sentence-level
 * check over the raw text is a check on where somebody's editor happened to break the line - it
 * passes today and fails on the next reflow. Collapsing whitespace makes the assertion about the
 * sentence instead.
 */
export function flowOf(text: string): string {
  return deEmphasize(text).replace(/\s+/g, ' ');
}

export function parseGateRegister(source: string): RegisterDoc {
  const lines = source.split(/\r?\n/);
  if (!(lines[0] ?? '').startsWith('# ')) {
    throw new RegisterSubsetError('the first line is not a level-one heading, so the document has no title a reader can identify it by');
  }
  if (source.includes('\t')) {
    throw new RegisterSubsetError('the document contains a tab; indentation that renders differently in two viewers is indentation nobody can review');
  }

  const sections: RegisterSection[] = [];
  const tableRows: (readonly string[])[] = [];
  const inlineCode: string[] = [];
  let section: { title: string; lines: string[]; subsections: RegisterSubsection[] } | null = null;
  let subsection: { title: string; lines: string[] } | null = null;
  let inFence = false;

  const closeSubsection = (): void => {
    if (section === null || subsection === null) return;
    const body = subsection.lines.join('\n');
    section.subsections.push({ ...subsection, prose: deEmphasize(body), flow: flowOf(body) });
    subsection = null;
  };
  const closeSection = (): void => {
    closeSubsection();
    if (section === null) return;
    const body = section.lines.join('\n');
    const statuses: string[] = [];
    STATUS_LINE.lastIndex = 0;
    for (const match of body.matchAll(STATUS_LINE)) statuses.push((match[1] ?? '').trim());
    sections.push({ ...section, prose: deEmphasize(body), flow: flowOf(body), statuses });
    section = null;
  };

  for (const raw of lines) {
    if (raw.trimStart().startsWith('```')) {
      inFence = !inFence;
      section?.lines.push(raw);
      subsection?.lines.push(raw);
      continue;
    }
    if (!inFence) {
      if (raw.startsWith('## ')) {
        closeSection();
        section = { title: raw.slice(3).trim(), lines: [], subsections: [] };
        continue;
      }
      if (raw.startsWith('### ') || raw.startsWith('#### ')) {
        closeSubsection();
        const at = raw.indexOf(' ');
        subsection = { title: raw.slice(at + 1).trim(), lines: [] };
        section?.lines.push(raw);
        continue;
      }
      const trimmed = raw.trim();
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        const cells = trimmed.slice(1, -1).split('|').map((cell) => cell.trim());
        if (!cells.every((cell) => /^:?-{2,}:?$/.test(cell) || cell === '')) tableRows.push(cells);
      }
      for (const match of raw.matchAll(/`([^`\n]+)`/g)) inlineCode.push(match[1] ?? '');
    }
    section?.lines.push(raw);
    subsection?.lines.push(raw);
  }
  if (inFence) throw new RegisterSubsetError('a fenced block is never closed, so where it ends is a guess');
  closeSection();

  return { lines, prose: deEmphasize(source), flow: flowOf(source), sections, tableRows, inlineCode };
}

// ---------------------------------------------------------------------------------------------
// What the register is required to contain
// ---------------------------------------------------------------------------------------------

/** Every gate the register must carry, including the one it records as closed (contract 12 §9). */
export const ALL_GATES: readonly string[] = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8'];

/** The gates that are still gates. G7 is closed as WONT-DO by owner decision (steering §0b). */
export const OPEN_GATES: readonly string[] = ALL_GATES.filter((gate) => gate !== 'G7');

/** The one gate that is the single next human action, because it is the trust root. */
export const FIRST_GATE = 'G1';

/** The only `Status:` an agent may ever write for an open gate (the register's own rule). */
export const BLOCKED_STATUS = 'BLOCKED - awaiting human';

/** The status G7 carries instead, and the only permitted exception to the line above. */
export const CLOSED_STATUS_PREFIX = 'CLOSED - WONT-DO';

/**
 * The four things every open gate must carry, matched by heading rather than restated. Order is not
 * asserted: what matters is that a reader holding only this file finds all four for every gate.
 */
export const REQUIRED_GATE_SUBSECTIONS: readonly { readonly key: string; readonly title: RegExp }[] = [
  { key: 'why a human is required', title: /^Why a human is required\b/i },
  { key: 'the steps', title: /^Steps\b/i },
  { key: 'a VERIFICATION block', title: /^VERIFICATION\b/ },
  { key: 'what it unblocks', title: /^Unblocks\b/i },
];

/** The section that must name the single next human action. */
export const NEXT_ACTION_SECTION = /^SINGLE NEXT HUMAN ACTION\b/i;

/** The sections that state the dependency ordering. At least one must exist and name every gate. */
export const ORDERING_SECTION = /^Ordering\b/i;

/**
 * A phrase that asserts a gate was performed. The register's own gate discipline rule 5 calls
 * marking a gated item complete "the single most damaging thing possible here", because it converts
 * a known gap into an invisible one - so the claim is refused in prose, not only in a `Status:`.
 */
const PERFORMED_CLAIM = /\b(G[1-8])\s+(?:has been|have been|was|were|is|are)\s+(?:done|complete|completed|satisfied|cleared|performed|provisioned|registered|minted|granted|generated)\b/gi;

/**
 * Words that turn such a phrase into a condition rather than a claim. "Until G8 is done, the backup
 * script may be written" is the register stating what is still blocked; refusing it would be
 * refusing the sentence that does the gating.
 */
const CONDITIONAL_LEAD = /\b(?:until|before|after|once|when|unless|if|whether)\b[^.]{0,40}$/i;

/**
 * Command shapes that print a value rather than a count or an observation (the register's own rule).
 * Each is anchored to start-of-line or whitespace rather than to a non-word character, because a
 * file name like a backup environment template ends in a segment that would otherwise read as the
 * environment-dump command and turn a correct verification line into a finding.
 */
const VALUE_PRINTING_SHAPES: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'a whole-file print', pattern: /(?:^|\s)(?:cat|less|more|head|tail)\s/ },
  { label: 'an environment dump', pattern: /(?:^|\s)(?:printenv|env)\s*(?:\||$)/ },
  { label: 'an expansion of a value', pattern: /(?:^|\s)echo\s+["']?\$/ },
];

/**
 * An entry name as a NAME rather than as part of a placeholder. `<DOMAIN>` is the operator's value
 * to resolve; `DOMAIN=` is the entry being set. Without this distinction an entry whose name is also
 * its placeholder would satisfy the check merely by the gate mentioning the value it needs.
 */
export function namesEntry(text: string, entry: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_<])${entry}(?![A-Za-z0-9_>])`).test(text);
}

/** A quoted token this repository is expected to contain, by its first path segment. */
const REPOSITORY_ROOTS: readonly string[] = ['ops', 'src', 'docs', 'contracts', 'scripts', 'tests', 'data', '.kiro'];

// ---------------------------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------------------------

export const GATE_REGISTER_FINDING_CODES = [
  // fail-closed
  'REGISTER_UNREADABLE',
  'REGISTER_OUTSIDE_SUBSET',
  'ENV_COMPANION_UNREADABLE',
  'CROSS_READ_EMPTY',
  // the gate set
  'GATE_MISSING',
  'GATE_UNEXPECTED',
  'GATE_SECTION_MISSING',
  'GATE_PREREQUISITE_UNRECORDED',
  'G7_NOT_CLOSED',
  // the status, and the failure mode the register calls the most damaging
  'GATE_STATUS_UNEXPECTED',
  'GATE_DESCRIBED_AS_PERFORMED',
  // the steps and their verification
  'STEP_WITHOUT_VERIFICATION',
  'ENTRY_STEP_MISSING',
  'ENTRY_STEP_NOT_VERIFIED',
  'VERIFICATION_PRINTS_A_VALUE',
  // what the register quotes
  'QUOTED_PATH_MISSING',
  // the reading order
  'ORDERING_NOT_STATED',
  'NEXT_ACTION_NOT_FIRST_GATE',
  // the two places an outcome is recorded back
  'WAL_DETERMINATION_RECORD_MISSING',
  'PROVISIONAL_REGISTRY_RECORD_MISSING',
] as const;

export type GateRegisterFindingCode = (typeof GATE_REGISTER_FINDING_CODES)[number];

export interface GateRegisterFinding {
  readonly code: GateRegisterFindingCode;
  readonly detail: string;
}

/** What the caller reports, so a check cannot pass by having examined nothing. */
export interface GateRegisterReport {
  readonly findings: readonly GateRegisterFinding[];
  /** Entries an `ops/env/**` template attributes to a gate, and which were therefore cross-read. */
  readonly gateAttributedEntriesExamined: number;
  /** Repository paths the register quotes, and which were therefore probed on disk. */
  readonly quotedPathsExamined: number;
}

// ---------------------------------------------------------------------------------------------
// The environment cross-read
// ---------------------------------------------------------------------------------------------

/** One entry an environment template attributes to a gate. */
export interface GateAttributedEntry {
  readonly entry: string;
  readonly gate: string;
  readonly template: string;
}

/**
 * Every entry the supplied templates declare that `ENTRY_SPECS` attributes to a gate. Read from the
 * templates rather than from the specification alone, so an entry that exists on disk and is
 * attributed to a gate cannot escape the check by being absent from one of the two.
 */
export function gateAttributedEntries(templates: Readonly<Record<string, string>>): {
  readonly entries: readonly GateAttributedEntry[];
  readonly unparseable: readonly string[];
} {
  const entries: GateAttributedEntry[] = [];
  const unparseable: string[] = [];
  const seen = new Set<string>();
  for (const template of Object.keys(templates).sort()) {
    let parsed;
    try {
      parsed = parseEnvTemplate(templates[template] ?? '');
    } catch (e) {
      unparseable.push(`${template}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    for (const entry of parsed.entries) {
      const spec = ENTRY_SPECS[entry.name];
      if (spec === undefined) continue;
      if (!/^G[1-8]$/.test(spec.gate)) continue;
      const key = `${spec.gate}:${entry.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ entry: entry.name, gate: spec.gate, template });
    }
  }
  return { entries, unparseable };
}

// ---------------------------------------------------------------------------------------------
// The quoted-path cross-read
// ---------------------------------------------------------------------------------------------

/**
 * Every repository path the register quotes in an inline code span, normalized to something a
 * probe can answer. A trailing `**` or an all-dots segment is an elision rather than a segment, so
 * it is dropped and the containing directory is what gets probed; a `*` in the last segment stays,
 * and the probe answers it by looking for a match in the directory.
 */
export function quotedPaths(doc: RegisterDoc): readonly string[] {
  const found = new Set<string>();
  for (const span of doc.inlineCode) {
    const token = span.trim();
    if (token.includes(' ') || token.includes('<') || !token.includes('/')) continue;
    const segments = token.split('/').filter((segment) => segment !== '');
    if (segments.length === 0) continue;
    if (!REPOSITORY_ROOTS.includes(segments[0] ?? '')) continue;
    while (segments.length > 1) {
      const last = segments[segments.length - 1] ?? '';
      if (last === '**' || /^\.+$/.test(last)) segments.pop();
      else break;
    }
    if (!segments.every((segment) => /^[A-Za-z0-9_.*-]+$/.test(segment))) continue;
    found.add(segments.join('/'));
  }
  return [...found].sort();
}

/** Answers whether a quoted path is on disk. Injected so the audit stays a pure function. */
export type PathProbe = (path: string) => boolean;

/** The probe used against a real checkout. A `*` in the final segment is matched in its directory. */
export function makePathProbe(repoRoot: string): PathProbe {
  return (path: string): boolean => {
    const at = path.lastIndexOf('/');
    const last = at === -1 ? path : path.slice(at + 1);
    if (!last.includes('*')) return existsSync(join(repoRoot, path));
    const dir = at === -1 ? repoRoot : join(repoRoot, path.slice(0, at));
    if (!existsSync(dir)) return false;
    const shape = new RegExp(`^${last.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    try {
      return readdirSync(dir).some((name) => shape.test(name));
    } catch {
      return false;
    }
  };
}

// ---------------------------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------------------------

export interface GateRegisterAuditInput {
  /** The register's text, or null when it could not be read - a finding, never a skip. */
  readonly source: string | null;
  /** Why it could not be read, when the caller already knows. */
  readonly unreadable?: string;
  /** logical template name (`finance.env`) -> its text. */
  readonly envTemplates: Readonly<Record<string, string>>;
  readonly probe: PathProbe;
}

/**
 * Audit the register. An empty finding list means a reader holding only that file finds every gate,
 * every reason, every step, every verification line, every prerequisite and the order to work in -
 * and finds nothing claiming a gate was performed. Any finding is a failure; there is no severity
 * ladder, because none of these rules is advisory.
 */
export function auditGateRegister(input: GateRegisterAuditInput): GateRegisterReport {
  const findings: GateRegisterFinding[] = [];
  const note = (code: GateRegisterFindingCode, detail: string): void => {
    findings.push({ code, detail });
  };

  const attributed = gateAttributedEntries(input.envTemplates);
  for (const reason of attributed.unparseable) {
    note(
      'ENV_COMPANION_UNREADABLE',
      `${reason}; without the environment templates the check that every gate names its own entries would pass by not running`,
    );
  }
  if (Object.keys(input.envTemplates).length === 0) {
    note('ENV_COMPANION_UNREADABLE', 'no environment template was supplied, so no entry could be attributed to a gate');
  }

  if (input.source === null) {
    note('REGISTER_UNREADABLE', input.unreadable ?? 'no source was supplied, so nothing about the register was checked');
    return { findings, gateAttributedEntriesExamined: attributed.entries.length, quotedPathsExamined: 0 };
  }

  let doc: RegisterDoc;
  try {
    doc = parseGateRegister(input.source);
  } catch (e) {
    note('REGISTER_OUTSIDE_SUBSET', e instanceof Error ? e.message : String(e));
    return { findings, gateAttributedEntriesExamined: attributed.entries.length, quotedPathsExamined: 0 };
  }

  const gateSections = new Map<string, RegisterSection>();
  for (const section of doc.sections) {
    const named = /^~?~?(G\d+)/.exec(section.title);
    if (named === null) continue;
    const gate = named[1] ?? '';
    if (!ALL_GATES.includes(gate)) {
      note(
        'GATE_UNEXPECTED',
        `the register carries a section for "${gate}", which is not one of ${ALL_GATES.join(', ')}; a gate nobody numbered is a gate nobody sequenced`,
      );
      continue;
    }
    if (!gateSections.has(gate)) gateSections.set(gate, section);
  }
  for (const gate of ALL_GATES) {
    if (!gateSections.has(gate)) {
      note(
        'GATE_MISSING',
        `the register has no section for ${gate}; a gate that is absent is not a gate that was cleared, it is one a reader will conclude was lost`,
      );
    }
  }

  auditPrerequisites(doc, note);
  auditG7(gateSections.get('G7'), note);
  auditReadingOrder(doc, note);
  auditRecordBacks(doc, gateSections.get('G8'), note);

  for (const gate of OPEN_GATES) {
    const section = gateSections.get(gate);
    if (section === undefined) continue;
    auditOpenGate(gate, section, attributed.entries, note);
  }

  // Every claim of a performed gate, wherever in the document it sits.
  auditPerformedClaims(doc, note);

  // --- every repository path the register quotes is on disk -----------------------------------
  const paths = quotedPaths(doc);
  for (const path of paths) {
    if (!input.probe(path)) {
      note(
        'QUOTED_PATH_MISSING',
        `the register quotes "${path}", which is not on disk; a register that points a human at a file that does not exist is one they stop trusting at the first step`,
      );
    }
  }

  if (attributed.entries.length === 0 || paths.length === 0) {
    note(
      'CROSS_READ_EMPTY',
      `the cross-reads examined ${attributed.entries.length} gate-attributed environment entries and ${paths.length} quoted paths; a check that examined nothing must never report success`,
    );
  }

  return { findings, gateAttributedEntriesExamined: attributed.entries.length, quotedPathsExamined: paths.length };
}

// ---------------------------------------------------------------------------------------------
// One open gate
// ---------------------------------------------------------------------------------------------

function subsectionOf(section: RegisterSection, title: RegExp): RegisterSubsection | undefined {
  return section.subsections.find((sub) => title.test(sub.title));
}

function auditOpenGate(
  gate: string,
  section: RegisterSection,
  attributed: readonly GateAttributedEntry[],
  note: (code: GateRegisterFindingCode, detail: string) => void,
): void {
  // --- the four things a gate is ------------------------------------------------------------
  for (const required of REQUIRED_GATE_SUBSECTIONS) {
    if (subsectionOf(section, required.title) === undefined) {
      note(
        'GATE_SECTION_MISSING',
        `${gate} does not carry ${required.key}; the standard this register is written to is that a competent human holding only this file can stand the deployment up, and all four are load-bearing for that`,
      );
    }
  }

  // --- the status, which is the one thing an agent may write ---------------------------------
  const first = section.statuses[0];
  if (first === undefined) {
    note('GATE_STATUS_UNEXPECTED', `${gate} declares no Status at all, so whether it is blocked is left to the reader`);
  } else if (!first.startsWith(BLOCKED_STATUS)) {
    note(
      'GATE_STATUS_UNEXPECTED',
      `${gate} declares Status "${first}"; "${BLOCKED_STATUS}" is the only status an agent may ever write, and gate discipline rule 5 makes claiming a gated item done the most damaging thing possible here`,
    );
  }
  for (const status of section.statuses.slice(1)) {
    if (!status.startsWith(BLOCKED_STATUS)) {
      note(
        'GATE_STATUS_UNEXPECTED',
        `${gate} carries a further Status "${status}"; every status under an open gate is blocked, including the ones on a determination recorded inside it`,
      );
    }
  }

  // --- the steps, and the verification that answers them ------------------------------------
  const steps = subsectionOf(section, /^Steps\b/i);
  const verification = subsectionOf(section, /^VERIFICATION\b/);
  const stepCount = steps === undefined ? 0 : steps.lines.filter((line) => /^\d+\.\s/.test(line)).length;

  if (steps !== undefined && verification === undefined) {
    note(
      'STEP_WITHOUT_VERIFICATION',
      `${gate} declares steps and carries no VERIFICATION block; a step whose outcome is not checked is a step assumed to have worked`,
    );
  } else if (steps !== undefined && verification !== undefined) {
    const hasLine = verification.lines.some((line) => line.trim() !== '' && !line.trimStart().startsWith('```'));
    if (stepCount === 0) {
      note('STEP_WITHOUT_VERIFICATION', `${gate} carries a Steps block with no numbered step in it, so there is nothing for an operator to follow or to verify`);
    }
    if (!hasLine) {
      note('STEP_WITHOUT_VERIFICATION', `${gate} carries an empty VERIFICATION block, which is the same as none at all`);
    }
  }

  // --- every entry the templates attribute to this gate is named by a step, then verified ----
  const stepText = steps?.prose ?? '';
  const verifyText = verification?.prose ?? '';
  for (const owned of attributed.filter((candidate) => candidate.gate === gate)) {
    if (!namesEntry(stepText, owned.entry)) {
      note(
        'ENTRY_STEP_MISSING',
        `ops/env/${owned.template}${TRACKED_SUFFIX} attributes ${owned.entry} to ${gate}, and no step of ${gate} tells the operator to set it; there is no default for anything in these templates, so a deployment that follows this register fails at first start on an unset entry`,
      );
      continue;
    }
    if (!namesEntry(verifyText, owned.entry)) {
      note(
        'ENTRY_STEP_NOT_VERIFIED',
        `${gate} tells the operator to set ${owned.entry} and its VERIFICATION block never mentions it; an entry placed but not checked is an entry discovered missing at the worst moment`,
      );
    }
  }

  // --- no verification line prints a value ---------------------------------------------------
  if (verification !== undefined) auditVerificationLines(gate, verification, note);
}

/**
 * The register's own rule: "record the observation, never the value". `grep -c` counts a matching
 * assignment and prints nothing; the same grep without it prints the assignment, which for a secret
 * entry is the value itself.
 */
function auditVerificationLines(
  gate: string,
  verification: RegisterSubsection,
  note: (code: GateRegisterFindingCode, detail: string) => void,
): void {
  const entryNames = Object.keys(ENTRY_SPECS);
  for (const raw of verification.lines) {
    const line = deEmphasize(raw);
    for (const shape of VALUE_PRINTING_SHAPES) {
      if (shape.pattern.test(line)) {
        note(
          'VERIFICATION_PRINTS_A_VALUE',
          `${gate} has a verification line containing ${shape.label}: "${line.trim()}". The rule is to record the observation, never the value (R24)`,
        );
      }
    }
    if (!/(?:^|\s)(?:sudo\s+)?grep\b/.test(line)) continue;
    const named = entryNames.filter((name) => namesEntry(line, name));
    if (named.length === 0) continue;
    if (/(?<![A-Za-z0-9_-])-[A-Za-z]*[cl][A-Za-z]*\b/.test(line)) continue;
    note(
      'VERIFICATION_PRINTS_A_VALUE',
      `${gate} greps for ${named.join(', ')} without a counting or name-only flag: "${line.trim()}". Such a line prints the assignment, and for a secret entry the assignment is the value`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Document-level properties
// ---------------------------------------------------------------------------------------------

function auditPrerequisites(doc: RegisterDoc, note: (code: GateRegisterFindingCode, detail: string) => void): void {
  const stated = new Map<string, string>();
  for (const row of doc.tableRows) {
    const head = deEmphasize(row[0] ?? '');
    const named = /^(G[1-8])\b/.exec(head.trim());
    if (named === null) continue;
    if (row.length < 3) continue;
    const dependsOn = deEmphasize(row[2] ?? '').trim();
    if (dependsOn === '') continue;
    stated.set(named[1] ?? '', dependsOn);
  }
  for (const gate of ALL_GATES) {
    if (!stated.has(gate)) {
      note(
        'GATE_PREREQUISITE_UNRECORDED',
        `the summary table records no prerequisite for ${gate}; an operator working top to bottom needs to know what must precede each gate, and "nothing" is an answer that has to be written down`,
      );
    }
  }
}

function auditG7(section: RegisterSection | undefined, note: (code: GateRegisterFindingCode, detail: string) => void): void {
  if (section === undefined) {
    note('G7_NOT_CLOSED', 'the register has no G7 section; it is recorded precisely so a reader who finds the others does not conclude it was lost or silently dropped');
    return;
  }
  const status = section.statuses[0];
  if (status === undefined || !status.startsWith(CLOSED_STATUS_PREFIX)) {
    note(
      'G7_NOT_CLOSED',
      `G7 declares Status "${status ?? 'none'}"; it is closed as WONT-DO by owner decision (steering §0b), and it must be neither reopened nor described as an open gate`,
    );
  }
  if (!/not to be raised again/i.test(section.flow)) {
    note('G7_NOT_CLOSED', 'the G7 section does not state that it is not to be raised again; without that line a later reader reads a closed decision as an open one');
  }
}

function auditReadingOrder(doc: RegisterDoc, note: (code: GateRegisterFindingCode, detail: string) => void): void {
  const next = doc.sections.find((section) => NEXT_ACTION_SECTION.test(section.title));
  if (next === undefined) {
    note('NEXT_ACTION_NOT_FIRST_GATE', 'the register names no single next human action; a register that lists eight gates and no starting point is a list rather than a plan');
  } else if (!new RegExp(`start at ${FIRST_GATE}\\b`, 'i').test(next.flow)) {
    note(
      'NEXT_ACTION_NOT_FIRST_GATE',
      `the single-next-action section does not name ${FIRST_GATE}; ${FIRST_GATE} is the trust root and four other gates end by writing a secret into a directory only it creates, so anything else first produces secrets with nowhere to live`,
    );
  }

  const ordering = doc.sections
    .flatMap((section) => section.subsections)
    .filter((sub) => ORDERING_SECTION.test(sub.title));
  if (ordering.length === 0) {
    note('ORDERING_NOT_STATED', 'the register states no dependency ordering; the sequence is what makes the list workable, and an unstated order is one each reader invents');
    return;
  }
  const combined = ordering.map((sub) => sub.prose).join('\n');
  const absent = OPEN_GATES.filter((gate) => !new RegExp(`\\b${gate}\\b`).test(combined));
  if (absent.length > 0) {
    note(
      'ORDERING_NOT_STATED',
      `the ordering sections never place ${absent.join(', ')}; a gate outside the stated order is one an operator sequences by guessing`,
    );
  }
}

function auditRecordBacks(
  doc: RegisterDoc,
  g8: RegisterSection | undefined,
  note: (code: GateRegisterFindingCode, detail: string) => void,
): void {
  const determination = g8?.subsections.find((sub) => /write-ahead-log sidecar determination/i.test(sub.title));
  if (determination === undefined) {
    note(
      'WAL_DETERMINATION_RECORD_MISSING',
      'G8 carries no write-ahead-log sidecar determination; it is one decision, made once, before the first real backup, and every rollback across a migration is blocked until it is recorded',
    );
  } else if (!/record here when decided/i.test(determination.flow)) {
    note(
      'WAL_DETERMINATION_RECORD_MISSING',
      'the sidecar determination names no place to record the outcome; a decision with nowhere to land is one that gets made twice, differently',
    );
  }

  const provisional = doc.sections
    .flatMap((section) => section.subsections)
    .find((sub) => /registry is PROVISIONAL/i.test(sub.title));
  if (provisional === undefined || !/provisional/i.test(provisional.flow)) {
    note(
      'PROVISIONAL_REGISTRY_RECORD_MISSING',
      'the register records no provisional-registry determination; task 6.3 must land its outcome here, and an unrecorded provisional registry is one a later reader reads as measured',
    );
  }
}

function auditPerformedClaims(doc: RegisterDoc, note: (code: GateRegisterFindingCode, detail: string) => void): void {
  PERFORMED_CLAIM.lastIndex = 0;
  for (const match of doc.flow.matchAll(PERFORMED_CLAIM)) {
    const before = doc.flow.slice(Math.max(0, (match.index ?? 0) - 60), match.index ?? 0);
    if (CONDITIONAL_LEAD.test(before)) continue;
    note(
      'GATE_DESCRIBED_AS_PERFORMED',
      `the register states "${match[0]}", which describes a gate in the past tense as performed; no gate G1-G8 has been attempted, and gate discipline rule 5 makes this claim the most damaging failure mode of this document`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// The file entry point
// ---------------------------------------------------------------------------------------------

/** One spelling of the register's file name, shared by the entry point and the tests. */
export const GATE_REGISTER_FILE = 'GATE_REGISTER.md';
/** The environment template directory, relative to `ops/`. */
export const ENV_SUBDIR = 'env';

/** Read the tracked environment templates, keyed by their logical name. */
export function readEnvTemplates(envDir: string): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  let names: readonly string[];
  try {
    names = readdirSync(envDir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith(TRACKED_SUFFIX)) continue;
    try {
      out[name.slice(0, -TRACKED_SUFFIX.length)] = readFileSync(join(envDir, name), 'utf8');
    } catch {
      // An unreadable template leaves a gap the audit reports through CROSS_READ_EMPTY or
      // ENV_COMPANION_UNREADABLE. It is never silently treated as absent-by-design.
    }
  }
  return out;
}

/**
 * Audit the register on disk against the environment templates beside it and the paths it quotes.
 * An unreadable file is a finding, never a skip: a checker that quietly stops checking is worse
 * than no checker, because the harness still reports green.
 */
export function auditGateRegisterFiles(opsDir: string, repoRoot: string): GateRegisterReport {
  const path = join(opsDir, GATE_REGISTER_FILE);
  let source: string | null = null;
  let unreadable: string | undefined;
  try {
    source = readFileSync(path, 'utf8');
  } catch (e) {
    unreadable = `${path} could not be read: ${e instanceof Error ? e.message : String(e)}`;
  }
  return auditGateRegister({
    source,
    unreadable,
    envTemplates: readEnvTemplates(join(opsDir, ENV_SUBDIR)),
    probe: makePathProbe(repoRoot),
  });
}
