/**
 * NIZAM · Structural audit of the backup and restore templates (ops/backup/, ops/restore/)
 * Implemented by: PFOS Contract 12 / Phase 7.4 (spec 06-two-agent-vps)
 * Owning requirements: R20 (consistent snapshot, public-key encryption whose private half is absent
 *   from the host, shred the plaintext, verified upload, bounded retention), R21 (a restored store
 *   passes an integrity check before it is trusted), R6 (read-only cross-store view), R23 (every
 *   value traces to a human gate), R24 (no deployment particular)
 * Depends on: node:fs (file entry points only), ./composeTemplate (the topology parser, the backup
 *   service name, and the shared no-deployment-particular scan), ./envTemplates (the entry names and
 *   secrecy annotations the backup service's environment template declares)
 *
 * WHY THIS EXISTS. The two templates are never executed here - steering §2 permits writing them and
 * forbids running them - so the only way to know they still say what §7.1 and §7.2 require is to
 * READ them. This module reads them. Each must produce an empty finding list.
 *
 * It is a text audit on purpose. Running the scripts would need three live stores, a public
 * recipient, a storage grant, and an off-host identity: every one of those is behind a human gate,
 * and the properties that matter are properties of the TEXT anyway. "This script has no parameter
 * through which an identity could arrive" is not a runtime behaviour; it is an absence, and an
 * absence can only be checked by reading.
 *
 * THE PROPERTY EVERYTHING HERE PROTECTS. §7.1.2's guarantee is that the host can create a backup it
 * cannot read. That is only true while the private half is absent, so the audit treats it as
 * structural rather than aspirational: the backup template may not name an identity, a secret key, a
 * passphrase, or a decryption step, and it may not take a parameter through which one could be
 * introduced. The restore template may reference the off-host identity, because it runs off the
 * host - but only as a path resolved from its environment, never as key material and never through a
 * passphrase parameter.
 *
 * TWO COMPANIONS, READ RATHER THAN RESTATED.
 *  1. `ops/docker-compose.yml` declares the backup service's mounts. Which paths the scripts may
 *     treat as stores, and that every one of them is read-only, is read from that topology - not
 *     asserted a second time here where the two could drift.
 *  2. `ops/env/backup.env.example`, through `./envTemplates`, declares the entry names and which of
 *     them are secret. Every variable the backup template reads must be one of those names or a
 *     variable the script itself assigns, and no template may name a secret entry at all.
 *
 * IT FAILS CLOSED. An unreadable script, an unreadable companion, a missing `main`, an unrecognized
 * step, and an unexpected step order are findings, not skips. Every code below has a negative test
 * in backupScripts.test.ts that mutates the real file and observes the code fire.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BACKUP_SERVICE, parseComposeSubset, scanForParticulars, type ComposeFinding } from './composeTemplate.ts';
import { BACKUP_TEMPLATE, ENTRY_SPECS } from './envTemplates.ts';

// ---------------------------------------------------------------------------------------------
// The parsed shape
// ---------------------------------------------------------------------------------------------

export interface ShellScript {
  /** The first twenty lines, where ownership is declared. */
  readonly head: string;
  readonly lines: readonly string[];
  /** Functions declared as `name() {`. */
  readonly functions: readonly string[];
  /** The bare, argument-less calls inside `main`, in order, duplicates preserved. */
  readonly mainSequence: readonly string[];
  /** Every `${NAME}` / `${!NAME` / `${NAME+set}` read, deduplicated. */
  readonly variableReads: readonly string[];
  /** Every name the script itself binds: an assignment, a `readonly`, or a loop variable. */
  readonly localNames: readonly string[];
}

/**
 * Thrown for anything outside the supported subset. The subset is narrow on purpose: a template a
 * reader cannot follow by eye is one nobody reviews, and these two scripts are the ones a human runs
 * on the worst day the deployment ever has.
 */
export class ShellSubsetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShellSubsetError';
  }
}

const FUNCTION_DECLARATION = /^([a-z_][a-z0-9_]*)\(\)\s*\{$/;
const BARE_CALL = /^[a-z_][a-z0-9_]*$/;
/** Words that close or continue a construct rather than invoke a step. Not part of the sequence. */
const NOT_A_STEP: readonly string[] = ['do', 'done', 'then', 'else', 'elif', 'fi', 'esac', 'continue', 'break', 'return', 'true', 'false'];

export function parseShellScript(source: string): ShellScript {
  const lines = source.split(/\r?\n/);
  if (!(lines[0] ?? '').startsWith('#!')) {
    throw new ShellSubsetError('the first line is not an interpreter line, so which interpreter runs this is left to whoever invokes it');
  }

  const functions: string[] = [];
  const localNames = new Set<string>();
  let mainSequence: string[] | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    if (raw.includes('\t')) {
      throw new ShellSubsetError(`line ${i + 1} contains a tab; indentation that renders differently in two editors is indentation nobody can review`);
    }
    const trimmed = raw.trim();

    const declared = FUNCTION_DECLARATION.exec(trimmed);
    if (declared !== null) {
      const name = declared[1] ?? '';
      functions.push(name);
      if (name === 'main') {
        mainSequence = readMainSequence(lines, i + 1);
      }
      continue;
    }

    const bound = /^(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)=/.exec(trimmed);
    if (bound !== null) localNames.add(bound[1] ?? '');
    const loop = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b/.exec(trimmed);
    if (loop !== null) localNames.add(loop[1] ?? '');
  }

  if (mainSequence === null) {
    throw new ShellSubsetError('there is no `main` function, so the order of the steps is whatever the reader infers from the file');
  }

  const reads = new Set<string>();
  for (const match of source.matchAll(/\$\{!?([A-Za-z_][A-Za-z0-9_]*)/g)) reads.add(match[1] ?? '');

  return {
    head: lines.slice(0, 20).join('\n'),
    lines,
    functions,
    mainSequence,
    variableReads: [...reads],
    localNames: [...localNames],
  };
}

/** Read the argument-less calls in `main`'s body, in order, stopping at the closing brace. */
function readMainSequence(lines: readonly string[], from: number): string[] {
  const sequence: string[] = [];
  for (let i = from; i < lines.length; i += 1) {
    const trimmed = (lines[i] ?? '').trim();
    if (trimmed === '}') return sequence;
    if (BARE_CALL.test(trimmed) && !NOT_A_STEP.includes(trimmed)) sequence.push(trimmed);
  }
  throw new ShellSubsetError('`main` is not closed, so where its body ends is a guess');
}

// ---------------------------------------------------------------------------------------------
// What the contract says the two templates are
// ---------------------------------------------------------------------------------------------

export const BACKUP_SCRIPT = 'backup';
export const RESTORE_SCRIPT = 'restore';

/** The three read-only store mounts (§3.2.2). Checked against the topology, never assumed. */
export const STORE_MOUNT_TARGETS: readonly string[] = ['/stores/life', '/stores/finance', '/stores/signal'];

/** §7.1, in order. Retention is last: a prune ahead of a failed upload could drop the newest good copy. */
export const BACKUP_SEQUENCE: readonly string[] = [
  'assert_not_halted',
  'assert_environment_present',
  'prepare_work_dir',
  'snapshot_one_store',
  'encrypt_one_snapshot',
  'shred_plaintext_now',
  'upload_and_verify',
  'prune_retention',
];

/** §7.2, in order. Every gate precedes the step that would otherwise trust its result. */
export const RESTORE_SEQUENCE: readonly string[] = [
  'assert_environment_present',
  'assert_target_is_fresh',
  'verify_artifact_integrity',
  'decrypt_artifact',
  'check_store_integrity',
  'check_referential_integrity',
  'boot_throwaway_instance',
];

/**
 * The drill's own entries. They are deliberately NOT an `ops/env/` template: §3.2.7 gives each
 * SERVICE one environment file, and the restore drill is not a service - no container runs it, and
 * it runs off the host entirely.
 */
export const RESTORE_ENTRIES: readonly string[] = [
  'RESTORE_ARTIFACT',
  'RESTORE_TARGET_DIR',
  'EXPECTED_ARTIFACT_SIZE',
  'EXPECTED_ARTIFACT_DIGEST',
  'AGE_IDENTITY_FILE',
  'BACKUP_ENCRYPTION_SCHEME',
];

/** The halt, both forms (§8). Both are consulted before a run begins, and neither is cached. */
export const HALT_ENTRIES: readonly string[] = ['NIZAM_KILL_ALL', 'KILL_SENTINEL_PATH'];

/** The entry the public recipient is read from (gate G8). Never key material. */
export const RECIPIENT_ENTRY = 'AGE_PUBLIC_KEY';
/** The entry the off-host private half is referenced through, as a PATH, in the restore drill only. */
export const IDENTITY_ENTRY = 'AGE_IDENTITY_FILE';
/** Bounded retention (§7.1). */
export const RETENTION_ENTRY = 'BACKUP_RETAIN_COUNT';

/**
 * Tools that copy, stream, or archive bytes. None of them has a role in a snapshot path: §7.1.1
 * requires the engine's own snapshot statement, and a copy of a write-ahead-logged store that is
 * being written is a fragment that may restore wrongly (see the template's own header).
 */
const COPY_TOOLS: readonly string[] = ['cp', 'dd', 'tar', 'rsync', 'cat', 'install', 'zip', 'gzip'];

/** Commands that write. A line naming a store mount target and one of these is not a read-only view. */
const WRITE_TOOLS: readonly string[] = [...COPY_TOOLS, 'mv', 'rm', 'touch', 'mkdir', 'chmod', 'chown', 'shred', 'tee', 'truncate'];

/** Repair, salvage, and partial-import shapes. §7.2 discards and escalates instead (R21). */
const REPAIR_SHAPES: readonly string[] = ['.recover', '.dump', 'reindex', '--repair', '--force-restore', 'salvage'];

/**
 * Key material itself, forbidden in BOTH templates. The restore drill may reference the off-host
 * private half - it is the one place that legitimately decrypts - but only as a PATH resolved from
 * its environment. Material inlined into a tracked file is a committed secret whichever file it is
 * in. Every shape is assembled from fragments so this module never holds a contiguous copy of what it
 * forbids and never trips the neighbouring scanners in the harness.
 */
const KEY_MATERIAL_SHAPES: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'a private key block header', pattern: new RegExp('BEG' + 'IN [A-Z ]*PRIV' + 'ATE KEY') },
  { label: 'a secret-key literal prefix', pattern: new RegExp('AGE-SEC' + 'RET-KEY', 'i') },
  { label: 'a secret-key reference', pattern: new RegExp('\\bSEC' + 'RET_KEY\\b') },
  { label: 'an inlined recipient literal', pattern: new RegExp('\\bag' + 'e1[a-z0-9]{8}') },
];

/**
 * The spellings through which a private half could enter the BACKUP path specifically. Unlike the
 * material shapes above, these are legitimate in the restore drill, which runs off the host.
 */
const PRIVATE_HALF_SHAPES: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'an identity flag', pattern: /--identity\b/ },
  { label: 'an identity file reference', pattern: /\bIDENTITY_FILE\b/ },
  { label: 'a decryption step', pattern: /--decrypt\b|\bdecrypt_/ },
];

/** A passphrase is the other way key material arrives. Neither template admits one. */
const PASSPHRASE_SHAPES: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'a passphrase flag', pattern: /--pass(?:phrase|word)\b/ },
  { label: 'a passphrase file flag', pattern: /--pass(?:phrase|word)-file\b/ },
  { label: 'a passphrase entry', pattern: new RegExp('\\bPASS' + '(?:PHRASE|WORD)\\b') },
  { label: 'an interactive read of a hidden value', pattern: /\bread\s+-s\b/ },
];

/** A parameter is how a value nobody reviewed reaches a script. Neither template takes one. */
const POSITIONAL_SHAPES: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'a positional parameter', pattern: /\$\{?[1-9]/ },
  { label: 'the whole parameter list', pattern: /\$[@*]/ },
  { label: 'a parameter shift', pattern: /^\s*shift\b/m },
  { label: 'an option parser', pattern: /\bgetopts?\b/ },
];

// ---------------------------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------------------------

export const BACKUP_SCRIPT_FINDING_CODES = [
  'SCRIPT_UNREADABLE',
  'SCRIPT_OUTSIDE_SUBSET',
  'COMPOSE_COMPANION_UNREADABLE',
  'HEADER_OWNERSHIP_MISSING',
  'STRICT_MODE_MISSING',
  'PARAMETER_REFUSAL_MISSING',
  'POSITIONAL_PARAMETER_USED',
  'PASSPHRASE_ADMITTED',
  'KEY_MATERIAL_PRESENT',
  'BACKUP_NAMES_PRIVATE_HALF',
  'SECRET_ENTRY_NAMED',
  'VARIABLE_READ_UNDECLARED',
  'DECLARED_ENTRY_ASSIGNED_LOCALLY',
  'MAIN_SEQUENCE_UNEXPECTED',
  'STEP_UNDEFINED',
  'HALT_CHECK_MISSING',
  'HALT_CHECK_NOT_FIRST',
  'SNAPSHOT_STATEMENT_MISSING',
  'SNAPSHOT_SOURCE_NOT_READ_ONLY',
  'SNAPSHOT_BY_FILE_COPY',
  'STORE_TARGET_MISSING',
  'STORE_TARGET_UNEXPECTED',
  'STORE_TARGET_NOT_READ_ONLY_IN_TOPOLOGY',
  'STORE_TARGET_WRITTEN',
  'RECIPIENT_NOT_FROM_ENVIRONMENT',
  'SHRED_STEP_MISSING',
  'SHRED_FAILURE_SWALLOWED',
  'SHRED_NOT_ON_FAILURE_PATH',
  'UPLOAD_NOT_VERIFIED',
  'RETENTION_UNBOUNDED',
  'IDENTITY_NOT_FROM_ENVIRONMENT',
  'INTEGRITY_CHECK_MISSING',
  'VERIFY_NOT_BEFORE_WRITE',
  'TARGET_FRESHNESS_UNCHECKED',
  'REPAIR_PATH_PRESENT',
  'FAILURE_NOT_ESCALATED',
  'PARTICULAR_URL_SCHEME',
  'PARTICULAR_ADDRESS_LITERAL',
  'PARTICULAR_HOSTNAME',
  'PARTICULAR_LONG_DIGIT_RUN',
  'PARTICULAR_CURRENCY_FIGURE',
  'PLACEHOLDER_MALFORMED',
  'PARTICULAR_SCAN_UNMAPPED',
] as const;

export type BackupScriptFindingCode = (typeof BACKUP_SCRIPT_FINDING_CODES)[number];

export interface BackupScriptFinding {
  readonly code: BackupScriptFindingCode;
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
 * `./composeTemplate`, so a later change to it moves every template at once. A code this checker has
 * no equivalent for becomes `PARTICULAR_SCAN_UNMAPPED` rather than being dropped: silently
 * discarding a finding from a scan whose whole job is to fail closed would turn a widened rule into
 * a narrowed one.
 */
export function mapParticularFindings(input: readonly ComposeFinding[], where: string): readonly BackupScriptFinding[] {
  const out: BackupScriptFinding[] = [];
  for (const finding of input) {
    if (SHARED_PARTICULAR_CODES.includes(finding.code)) {
      out.push({ code: finding.code as BackupScriptFindingCode, detail: `${where}: ${finding.detail}` });
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
// Reading the companion topology
// ---------------------------------------------------------------------------------------------

/**
 * The backup service's declared mounts, as written. `null` when the topology cannot be read, which
 * is a finding rather than a reason to skip the read-only check.
 */
export function backupServiceMounts(composeSource: string): readonly string[] | null {
  let services: unknown;
  try {
    services = parseComposeSubset(composeSource).services;
  } catch {
    return null;
  }
  if (services === null || typeof services !== 'object' || Array.isArray(services)) return null;
  const service = (services as Record<string, unknown>)[BACKUP_SERVICE];
  if (service === null || typeof service !== 'object' || Array.isArray(service)) return null;
  const declared = (service as Record<string, unknown>).volumes;
  if (!Array.isArray(declared)) return null;
  const mounts: string[] = [];
  for (const item of declared) if (typeof item === 'string') mounts.push(item.replace(/^["']|["']$/g, ''));
  return mounts.length === 0 ? null : mounts;
}

// ---------------------------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------------------------

export interface BackupScriptAuditInput {
  readonly backupSource: string;
  readonly restoreSource: string;
  readonly composeSource: string;
}

/** Entry names annotated secret anywhere in `ops/env/**`. Neither template may name one of these. */
export const SECRET_ENTRY_NAMES: readonly string[] = Object.entries(ENTRY_SPECS)
  .filter(([, spec]) => spec.secret)
  .map(([name]) => name);

/** Entry names the backup service's own environment template declares. */
export const BACKUP_ENTRY_NAMES: readonly string[] = Object.entries(ENTRY_SPECS)
  .filter(([, spec]) => spec.owners.includes(BACKUP_TEMPLATE))
  .map(([name]) => name);

/**
 * Audit both templates. An empty array means every structural property §7.1 and §7.2 require is
 * present. Any finding is a failure; there is no severity ladder, because none of these rules is
 * advisory.
 */
export function auditBackupScripts(input: BackupScriptAuditInput): readonly BackupScriptFinding[] {
  const findings: BackupScriptFinding[] = [];
  const note = (code: BackupScriptFindingCode, detail: string): void => {
    findings.push({ code, detail });
  };

  const mounts = backupServiceMounts(input.composeSource);
  if (mounts === null) {
    note(
      'COMPOSE_COMPANION_UNREADABLE',
      `ops/docker-compose.yml could not be read as a topology declaring mounts for the "${BACKUP_SERVICE}" service, so which paths are stores and whether each is read-only cannot be decided here`,
    );
  }

  const parsed = new Map<string, ShellScript>();
  for (const [name, source] of [
    [BACKUP_SCRIPT, input.backupSource],
    [RESTORE_SCRIPT, input.restoreSource],
  ] as const) {
    findings.push(...mapParticularFindings(scanForParticulars(source), name));
    let script: ShellScript;
    try {
      script = parseShellScript(source);
    } catch (e) {
      note('SCRIPT_OUTSIDE_SUBSET', `${name}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    parsed.set(name, script);
    auditShared(name, source, script, note);
  }

  const backup = parsed.get(BACKUP_SCRIPT);
  if (backup !== undefined) auditBackup(input.backupSource, backup, mounts, note);
  const restore = parsed.get(RESTORE_SCRIPT);
  if (restore !== undefined) auditRestore(input.restoreSource, restore, note);

  return findings;
}

// ---------------------------------------------------------------------------------------------
// Properties both templates must have
// ---------------------------------------------------------------------------------------------

function auditShared(
  name: string,
  source: string,
  script: ShellScript,
  note: (code: BackupScriptFindingCode, detail: string) => void,
): void {
  if (!/contract\s*12/i.test(script.head) || !/phase\s*7/i.test(script.head)) {
    note('HEADER_OWNERSHIP_MISSING', `${name} does not declare its owning contract and phase in its first twenty lines`);
  }

  if (!/^set -euo pipefail$/m.test(source)) {
    note(
      'STRICT_MODE_MISSING',
      `${name} does not fail on an unset variable, an unchecked command, or a broken pipe; without that, a step that did not happen looks exactly like a step that did`,
    );
  }

  if (!/\[ "\$#" -ne 0 \]/.test(source)) {
    note(
      'PARAMETER_REFUSAL_MISSING',
      `${name} does not refuse arguments outright; the refusal is what makes "there is no parameter through which key material could arrive" structural rather than merely intended (§7.1.2)`,
    );
  }

  for (const shape of POSITIONAL_SHAPES) {
    if (shape.pattern.test(source)) {
      note(
        'POSITIONAL_PARAMETER_USED',
        `${name} uses ${shape.label}; every function here reads named variables instead, so no value can enter through an argument nobody reviewed`,
      );
    }
  }

  for (const shape of PASSPHRASE_SHAPES) {
    if (shape.pattern.test(source)) {
      note('PASSPHRASE_ADMITTED', `${name} contains ${shape.label}; a passphrase is key material, and no template in this repository handles one`);
    }
  }

  for (const shape of KEY_MATERIAL_SHAPES) {
    if (shape.pattern.test(source)) {
      note(
        'KEY_MATERIAL_PRESENT',
        `${name} contains ${shape.label}; the restore drill may reference the off-host private half as a PATH, but material inlined into a tracked file is a committed secret whichever file it is in (steering §0b, gate G8)`,
      );
    }
  }

  for (const entry of SECRET_ENTRY_NAMES) {
    if (new RegExp(`\\b${entry}\\b`).test(source)) {
      note(
        'SECRET_ENTRY_NAMED',
        `${name} names ${entry}, which ops/env/ annotates secret; §7.1's closing rule is that no key, token, or environment file is part of a payload, and a script that never handles a credential cannot put one in an archive`,
      );
    }
  }

  const declared = name === BACKUP_SCRIPT ? BACKUP_ENTRY_NAMES : RESTORE_ENTRIES;
  for (const read of script.variableReads) {
    if (declared.includes(read)) continue;
    if (script.localNames.includes(read)) continue;
    note(
      'VARIABLE_READ_UNDECLARED',
      `${name} reads ${read}, which is neither an entry its environment declares nor a variable it binds itself; a value from nowhere is a value nobody reviewed`,
    );
  }
  for (const local of script.localNames) {
    if (declared.includes(local)) {
      note(
        'DECLARED_ENTRY_ASSIGNED_LOCALLY',
        `${name} assigns ${local}, which is a declared environment entry; assigning it here gives it a default that the environment template does not describe`,
      );
    }
  }

  const expected = name === BACKUP_SCRIPT ? BACKUP_SEQUENCE : RESTORE_SEQUENCE;
  if (script.mainSequence.join(' -> ') !== expected.join(' -> ')) {
    note(
      'MAIN_SEQUENCE_UNEXPECTED',
      `${name} runs ${script.mainSequence.join(' -> ')}; the contract's order is ${expected.join(' -> ')}, and the order is the requirement rather than a detail of it`,
    );
  }
  for (const step of script.mainSequence) {
    if (!script.functions.includes(step)) {
      note('STEP_UNDEFINED', `${name} calls ${step} from main, but no function of that name is defined in the file`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// ops/backup/ - §7.1
// ---------------------------------------------------------------------------------------------

function auditBackup(
  source: string,
  script: ShellScript,
  mounts: readonly string[] | null,
  note: (code: BackupScriptFindingCode, detail: string) => void,
): void {
  // --- the host cannot read what it wrote ---------------------------------------------------
  for (const shape of PRIVATE_HALF_SHAPES) {
    if (shape.pattern.test(source)) {
      note(
        'BACKUP_NAMES_PRIVATE_HALF',
        `the backup template contains ${shape.label}; §7.1.2's guarantee is that a host compromise yields ciphertext only, and it holds only while nothing on this path can read an archive`,
      );
    }
  }

  // --- the halt, both forms, first --------------------------------------------------------
  for (const entry of HALT_ENTRIES) {
    if (!new RegExp(`\\$\\{!?${entry}\\b`).test(source)) {
      note(
        'HALT_CHECK_MISSING',
        `the backup template does not consult ${entry}; §8 requires both forms of the halt, and neither substitutes for the other`,
      );
    }
  }
  if ((script.mainSequence[0] ?? '') !== BACKUP_SEQUENCE[0]) {
    note(
      'HALT_CHECK_NOT_FIRST',
      `the backup template runs ${script.mainSequence[0] ?? '(nothing)'} first; the halt is checked before a run begins, not after a snapshot already exists on disk`,
    );
  }

  // --- a consistent snapshot, not a copy (§7.1.1) -------------------------------------------
  if (!/VACUUM\s+INTO\s+'/i.test(source)) {
    note(
      'SNAPSHOT_STATEMENT_MISSING',
      "the backup template does not issue the engine's snapshot statement; a write-ahead-logged store's committed state is the main file plus the log, so only the statement observes one consistent instant",
    );
  }
  if (!/mode=ro/.test(source)) {
    note(
      'SNAPSHOT_SOURCE_NOT_READ_ONLY',
      'the backup template does not open the source read-only; §3.2.2 gives this service a read-only view of every store, and the snapshot step must not be able to alter one even by accident',
    );
  }
  for (const tool of COPY_TOOLS) {
    if (new RegExp(`(?:^|[|&;(]\\s*|\\s)${tool}\\s`, 'm').test(stripComments(source))) {
      note(
        'SNAPSHOT_BY_FILE_COPY',
        `the backup template invokes ${tool}; a copy, stream, or archive of a live store is a fragment that may restore, may fail, or may restore wrongly, which is why §7.1.1 forbids it outright`,
      );
    }
  }

  // --- the three store mounts, and every one of them read-only ------------------------------
  const named = new Set<string>();
  for (const match of source.matchAll(/\/stores\/[A-Za-z0-9_-]+/g)) named.add(match[0]);
  for (const target of STORE_MOUNT_TARGETS) {
    if (!named.has(target)) {
      note('STORE_TARGET_MISSING', `the backup template never names ${target}; a backup that silently omits a store is not a backup`);
    }
  }
  for (const target of named) {
    if (!STORE_MOUNT_TARGETS.includes(target)) {
      note(
        'STORE_TARGET_UNEXPECTED',
        `the backup template names ${target}, which is not one of the three mounts the topology declares; a fourth store path is either a typo or a store nobody reviewed`,
      );
      continue;
    }
    if (mounts !== null && !mounts.some((mount) => mount.endsWith(`:${target}:ro`))) {
      note(
        'STORE_TARGET_NOT_READ_ONLY_IN_TOPOLOGY',
        `ops/docker-compose.yml does not mount ${target} read-only into the "${BACKUP_SERVICE}" service; §3.2.2 permits a cross-store view only read-only, without exception`,
      );
    }
  }
  for (let i = 0; i < script.lines.length; i += 1) {
    const line = script.lines[i] ?? '';
    if (line.trim().startsWith('#')) continue;
    if (!/\/stores\//.test(line)) continue;
    const writes = WRITE_TOOLS.filter((tool) => new RegExp(`(?:^|[|&;(]\\s*|\\s)${tool}\\s`).test(line));
    if (writes.length > 0 || /(?<![0-9])>/.test(line)) {
      note(
        'STORE_TARGET_WRITTEN',
        `line ${i + 1} of the backup template names a store mount and ${writes.length > 0 ? `invokes ${writes.join(', ')}` : 'redirects output'}; the view is read-only, so nothing here writes through it`,
      );
    }
  }

  // --- the recipient comes from the environment, never from this file ------------------------
  if (!new RegExp(`--recipient "\\$\\{${RECIPIENT_ENTRY}\\}"`).test(source)) {
    note(
      'RECIPIENT_NOT_FROM_ENVIRONMENT',
      `the backup template does not encrypt to \${${RECIPIENT_ENTRY}}; steering §0b keeps even the public recipient out of a tracked file, so it is resolved from the host at run time`,
    );
  }

  // --- shred, and a failure that is not swallowed (§7.1.3) ---------------------------------
  const shredLines = script.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => !line.trim().startsWith('#') && /\bshred\b/.test(line));
  if (shredLines.length === 0) {
    note(
      'SHRED_STEP_MISSING',
      'the backup template never shreds the intermediate snapshot; a plaintext snapshot that outlives its encryption is the largest unencrypted concentration of financial data this system creates',
    );
  }
  for (const { line, index } of shredLines) {
    if (/\|\|\s*(?:true|:)/.test(line) || /2>\s*\/dev\/null/.test(line)) {
      note(
        'SHRED_FAILURE_SWALLOWED',
        `line ${index + 1} of the backup template lets the shred fail quietly; a shred that could not complete must escalate, because the plaintext is still there either way`,
      );
    }
  }
  const trap = /^trap\s+([a-z_][a-z0-9_]*)\s+EXIT$/m.exec(source);
  if (trap === null || !/shred/.test(trap[1] ?? '')) {
    note(
      'SHRED_NOT_ON_FAILURE_PATH',
      '§7.1.3 requires the plaintext to be removed on the failure path too, which means a shredding handler registered on exit rather than one step in the happy sequence',
    );
  }

  // --- verified upload, and bounded retention (§7.1) ----------------------------------------
  if (!/--expect-size\b/.test(source) || !/--expect-digest\b/.test(source) || !/!=\s*'verified'/.test(source)) {
    note(
      'UPLOAD_NOT_VERIFIED',
      'the backup template does not require the remote copy to match both the local size and the local digest; §7.1 states that an upload that is not verified is not a backup',
    );
  }
  if (!new RegExp(`\\$\\{${RETENTION_ENTRY}\\}`).test(source)) {
    note(
      'RETENTION_UNBOUNDED',
      `the backup template does not read \${${RETENTION_ENTRY}}; retention is bounded, and the bound is configuration rather than a constant in a script`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// ops/restore/ - §7.2, R21
// ---------------------------------------------------------------------------------------------

function auditRestore(
  source: string,
  script: ShellScript,
  note: (code: BackupScriptFindingCode, detail: string) => void,
): void {
  if (!new RegExp(`--identity "\\$\\{${IDENTITY_ENTRY}\\}"`).test(source)) {
    note(
      'IDENTITY_NOT_FROM_ENVIRONMENT',
      `the restore template does not reference the off-host private half as \${${IDENTITY_ENTRY}}; it is a PATH resolved on the operator machine, and key material never appears in this repository`,
    );
  }

  if (!/PRAGMA integrity_check/.test(source)) {
    note(
      'INTEGRITY_CHECK_MISSING',
      "the restore template does not run the engine's integrity check; R21 makes that check the gate that precedes trust, and a restore without it is an assumption",
    );
  }

  const at = (step: string): number => script.mainSequence.indexOf(step);
  const ordered: readonly (readonly [string, string, string])[] = [
    ['assert_target_is_fresh', 'decrypt_artifact', 'a restore never writes where something already lives (§7.2)'],
    ['verify_artifact_integrity', 'decrypt_artifact', 'size and digest are checked before the identity is spent on the artifact'],
    ['check_store_integrity', 'check_referential_integrity', 'a structurally broken store is refused before its relationships are read'],
    ['check_store_integrity', 'boot_throwaway_instance', 'R21 - nothing trusts the restored store until the integrity check answers'],
  ];
  for (const [earlier, later, why] of ordered) {
    const first = at(earlier);
    const second = at(later);
    if (first === -1 || second === -1 || first > second) {
      note('VERIFY_NOT_BEFORE_WRITE', `the restore template does not run ${earlier} before ${later}: ${why}`);
    }
  }

  if (!/if \[ -e "\$\{RESTORE_TARGET_DIR\}" \]/.test(source)) {
    note(
      'TARGET_FRESHNESS_UNCHECKED',
      'the restore template does not refuse a target that already exists; a restore that overwrites a good store in place turns a recoverable outage into permanent loss',
    );
  }

  const body = stripComments(source).toLowerCase();
  for (const shape of REPAIR_SHAPES) {
    if (body.includes(shape)) {
      note(
        'REPAIR_PATH_PRESENT',
        `the restore template contains ${shape}; §7.2 discards a failing artifact and escalates, because "better than nothing" is how a subtly wrong ledger becomes the ledger`,
      );
    }
  }

  const escalate = /discard_and_escalate\(\)\s*\{([\s\S]*?)\n\}/.exec(source);
  if (escalate === null || !/ESCALATE/.test(escalate[1] ?? '') || !/\bexit 1\b/.test(escalate[1] ?? '')) {
    note(
      'FAILURE_NOT_ESCALATED',
      'the restore template has no handler that both tells a human and exits non-zero; a failing control that reports success is worse than no control',
    );
  }
}

/** Drop `#` comment lines, so prose describing a tool is not read as an invocation of it. */
function stripComments(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

// ---------------------------------------------------------------------------------------------
// File entry point
// ---------------------------------------------------------------------------------------------

export const BACKUP_SCRIPT_PATH = join('backup', 'backup.sh');
export const RESTORE_SCRIPT_PATH = join('restore', 'restore.sh');

/**
 * Audit the two templates under `opsDir` against the topology at `composePath`. An unreadable file is
 * a finding, never a skip: the whole value of this check is that it cannot pass by not running.
 */
export function auditBackupScriptFiles(opsDir: string, composePath: string): readonly BackupScriptFinding[] {
  const findings: BackupScriptFinding[] = [];
  const text: Record<string, string> = {};

  for (const relative of [BACKUP_SCRIPT_PATH, RESTORE_SCRIPT_PATH]) {
    const path = join(opsDir, relative);
    try {
      text[relative] = readFileSync(path, 'utf8').split('\r\n').join('\n');
    } catch (e) {
      findings.push({
        code: 'SCRIPT_UNREADABLE',
        detail: `${path} could not be read: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  let composeSource = '';
  try {
    composeSource = readFileSync(composePath, 'utf8');
  } catch {
    composeSource = '';
  }

  findings.push(
    ...auditBackupScripts({
      backupSource: text[BACKUP_SCRIPT_PATH] ?? '',
      restoreSource: text[RESTORE_SCRIPT_PATH] ?? '',
      composeSource,
    }),
  );
  return findings;
}
