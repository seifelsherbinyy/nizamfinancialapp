// @vitest-environment node
/**
 * NIZAM · The backup and restore templates say what the contract requires, and the checker fires
 * Implemented by: PFOS Contract 12 / Phase 7.4 (spec 06-two-agent-vps)
 * Owning requirements: R20 (a consistent snapshot, encrypted to a recipient whose private half is
 *   absent from the host, with the plaintext shredded, the upload verified, and retention bounded),
 *   R21 (a restored store passes an integrity check before it is trusted), R6 (the cross-store view
 *   is read-only), R24 (no deployment particular)
 * Depends on: ./backupScripts, ./composeTemplate, and the three files ops/backup/backup.sh,
 *   ops/restore/restore.sh and ops/docker-compose.yml, all read from disk as text
 *
 * Two halves, and the second is the one that matters.
 *
 * POSITIVE. The templates on disk produce no finding, and the properties that carry the weight are
 * asserted separately as well, so a reader can see each requirement and its evidence together: the
 * backup path has no way to read what it wrote, the snapshot is the engine's statement rather than a
 * copy, the three store paths are the topology's read-only mount targets, and the restore path
 * verifies before it trusts.
 *
 * NEGATIVE. Every finding code has a row in NEGATIVE_CASES that takes the real file, breaks one
 * property, and observes that code fire. A checker that has only ever been observed passing is not
 * evidence that it checks. The coverage test at the end fails if a code is added without a row.
 *
 * NOTHING HERE EXECUTES A TEMPLATE. No shell is invoked, no snapshot is taken, no encryption tool is
 * called, and no store is opened. Both files are read as text and parsed in process (steering §2:
 * writing them is permitted, running them is not).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  BACKUP_ENTRY_NAMES,
  BACKUP_SCRIPT_FINDING_CODES,
  BACKUP_SCRIPT_PATH,
  BACKUP_SEQUENCE,
  HALT_ENTRIES,
  RESTORE_ENTRIES,
  RESTORE_SCRIPT_PATH,
  RESTORE_SEQUENCE,
  SECRET_ENTRY_NAMES,
  STORE_MOUNT_TARGETS,
  auditBackupScriptFiles,
  auditBackupScripts,
  backupServiceMounts,
  mapParticularFindings,
  parseShellScript,
  type BackupScriptFindingCode,
} from './backupScripts';
import { BACKUP_SERVICE } from './composeTemplate';

const OPS_DIR = fileURLToPath(new URL('../../../ops/', import.meta.url));
const BACKUP_PATH = fileURLToPath(new URL('../../../ops/backup/backup.sh', import.meta.url));
const RESTORE_PATH = fileURLToPath(new URL('../../../ops/restore/restore.sh', import.meta.url));
const COMPOSE_PATH = fileURLToPath(new URL('../../../ops/docker-compose.yml', import.meta.url));

/** Line endings are normalized so the mutation anchors below do not depend on the checkout's
 *  setting. The file entry point is exercised separately against the bytes on disk. */
const read = (path: string): string => readFileSync(path, 'utf8').split('\r\n').join('\n');
const BACKUP = read(BACKUP_PATH);
const RESTORE = read(RESTORE_PATH);
const COMPOSE = read(COMPOSE_PATH);

function codesFor(backupSource: string, restoreSource: string, composeSource = COMPOSE): readonly BackupScriptFindingCode[] {
  return auditBackupScripts({ backupSource, restoreSource, composeSource }).map((f) => f.code);
}

/** A mutation that must actually change the text, so a rotted anchor fails loudly. */
function swap(from: string, to: string): (t: string) => string {
  return (t) => {
    if (!t.includes(from)) throw new Error(`negative-test anchor no longer present: ${JSON.stringify(from.slice(0, 70))}`);
    const next = t.replace(from, () => to);
    if (next === t) throw new Error('the mutation left the text unchanged, so the case would prove nothing');
    return next;
  };
}

/** The same, for a token that appears more than once and must be gone from all of them. */
function swapAll(from: string, to: string): (t: string) => string {
  return (t) => {
    if (!t.includes(from)) throw new Error(`negative-test anchor no longer present: ${JSON.stringify(from.slice(0, 70))}`);
    const next = t.split(from).join(to);
    if (next === t) throw new Error('the mutation left the text unchanged, so the case would prove nothing');
    return next;
  };
}

// Shapes assembled from fragments, so this file never holds a contiguous copy of what the scan
// forbids and never trips the other scanners in the harness.
const URL_SHAPED = 'ht' + 'tp' + '://' + 'internal-probe';
const ADDRESS_SHAPED = ['198', '51', '100', '7'].join('.');
const HOSTNAME_SHAPED = 'backup.' + 'exam' + 'ple' + '.' + 'inva' + 'lid';
const LONG_DIGIT_RUN = '12345' + '678';
const CURRENCY_SHAPED = 'US' + 'D' + ' 5.00';

// Anchors. Each is quoted from the real file, so a rewrite that moves one fails the case rather than
// silently making it vacuous.
const STRICT_MODE = 'set -euo pipefail';
const PARAM_REFUSAL = '[ "$#" -ne 0 ]';
const OWNERSHIP = 'contract 12, phase 7:';
const SIGNAL_MOUNT = "readonly STORE_DIR_SIGNAL='/stores/signal'";
const SNAPSHOT_CALL = `sqlite3 "file:\${STORE_FILE}?mode=ro" "VACUUM INTO '\${SNAPSHOT_PATH}'"`;
const RECIPIENT = '--recipient "${AGE_PUBLIC_KEY}"';
const SHRED_NOW = '--iterations=1 "${SNAPSHOT_PATH}"; then';
const TRAP_LINE = 'trap shred_plaintext_on_exit EXIT';
const RETAIN_CALL = '--retain "${BACKUP_RETAIN_COUNT}"';
const BACKUP_MAIN_TAIL = '  prune_retention\n}';
const HALT_FIRST = '  assert_not_halted\n  assert_environment_present';
const SHRED_THEN_UPLOAD = '    shred_plaintext_now\n    upload_and_verify';
const RESTORE_IDENTITY = '--identity "${AGE_IDENTITY_FILE}"';
const RESTORE_INTEGRITY = "'PRAGMA integrity_check'";
const RESTORE_FRESH = 'if [ -e "${RESTORE_TARGET_DIR}" ]; then';
const RESTORE_VERIFY_THEN_DECRYPT = '  verify_artifact_integrity\n  decrypt_artifact';
const RESTORE_BOOT = '  boot_throwaway_instance\n}';

interface NegativeCase {
  readonly code: BackupScriptFindingCode;
  readonly why: string;
  readonly backup?: (t: string) => string;
  readonly restore?: (t: string) => string;
  readonly compose?: (t: string) => string;
}

const NEGATIVE_CASES: readonly NegativeCase[] = [
  {
    code: 'SCRIPT_OUTSIDE_SUBSET',
    why: 'a file with no interpreter line runs under whatever shell happens to invoke it',
    backup: (t) => t.split('\n').slice(1).join('\n'),
  },
  {
    code: 'HEADER_OWNERSHIP_MISSING',
    why: 'a template nobody can trace to a contract section is a template nobody reviews against one',
    backup: swap(OWNERSHIP, 'operations:'),
  },
  {
    code: 'STRICT_MODE_MISSING',
    why: 'without it a step that did not happen looks exactly like a step that did',
    backup: swap(STRICT_MODE, 'set -eu'),
  },
  {
    code: 'PARAMETER_REFUSAL_MISSING',
    why: '§7.1.2 - the refusal is what makes "no parameter can carry key material" structural',
    backup: swap(PARAM_REFUSAL, '[ -n "${MESSAGE}" ]'),
  },
  {
    code: 'POSITIONAL_PARAMETER_USED',
    why: 'a positional parameter is a value that entered without review, and an identity file is a value',
    backup: swap(STRICT_MODE, `${STRICT_MODE}\nreadonly FIRST="\${1}"`),
  },
  {
    code: 'PASSPHRASE_ADMITTED',
    why: 'a passphrase is key material, and no template in this repository handles one',
    backup: swap(RECIPIENT, `${RECIPIENT} --passphrase`),
  },
  {
    code: 'KEY_MATERIAL_PRESENT',
    why: 'the restore drill may reference the private half as a path, but never inline it - even there',
    restore: swap(RESTORE_IDENTITY, `--identity "${'AGE-SEC' + 'RET-KEY-1QQQQQQQ'}"`),
  },
  {
    code: 'KEY_MATERIAL_PRESENT',
    why: 'a recipient literal in a tracked file is a deployment particular as well as a stored value',
    backup: swap(RECIPIENT, `--recipient "${'ag' + 'e1qqqqqqqqq'}"`),
  },
  {
    code: 'BACKUP_NAMES_PRIVATE_HALF',
    why: '§7.1.2 - the host creates an archive it cannot read, so this path names no identity at all',
    backup: swap(RECIPIENT, `${RECIPIENT} --identity`),
  },
  {
    code: 'BACKUP_NAMES_PRIVATE_HALF',
    why: 'a decryption step on this path would hand the host back the ability the design removed',
    backup: swap('encrypt_one_snapshot', 'decrypt_one_snapshot'),
  },
  {
    code: 'SECRET_ENTRY_NAMED',
    why: "§7.1's closing rule - no key, token, or environment file is ever part of a payload",
    backup: swap(RETAIN_CALL, `${RETAIN_CALL} --token "\${DRIVE_REFRESH_TOKEN}"`),
  },
  {
    code: 'VARIABLE_READ_UNDECLARED',
    why: 'a value from nowhere is a value nobody reviewed, and no gate supplies it',
    backup: swap(RETAIN_CALL, '--retain "${BACKUP_MYSTERY}"'),
  },
  {
    code: 'DECLARED_ENTRY_ASSIGNED_LOCALLY',
    why: 'assigning a declared entry here gives it a default the environment template does not describe',
    backup: swap(STRICT_MODE, `${STRICT_MODE}\nBACKUP_RETAIN_COUNT=7`),
  },
  {
    code: 'MAIN_SEQUENCE_UNEXPECTED',
    why: '§7.1 orders the three properties, and uploading before the shred leaves plaintext alive longer',
    backup: swap(SHRED_THEN_UPLOAD, '    upload_and_verify\n    shred_plaintext_now'),
  },
  {
    code: 'STEP_UNDEFINED',
    why: 'a step called but never defined is a sequence that ends in a failure nobody planned',
    backup: swap(BACKUP_MAIN_TAIL, '  prune_retention\n  report_success\n}'),
  },
  {
    code: 'HALT_CHECK_MISSING',
    why: '§8 requires both forms of the halt, and neither substitutes for the other',
    backup: swapAll('NIZAM_KILL_ALL', 'COARSE_HALT'),
  },
  {
    code: 'HALT_CHECK_NOT_FIRST',
    why: '§8 - the halt is checked before a run begins, not after a snapshot already exists on disk',
    backup: swap(HALT_FIRST, '  assert_environment_present\n  assert_not_halted'),
  },
  {
    code: 'SNAPSHOT_STATEMENT_MISSING',
    why: "§7.1.1 - only the engine's statement observes one committed instant of a write-ahead-logged store",
    backup: swap('"VACUUM INTO ', '".backup '),
  },
  {
    code: 'SNAPSHOT_SOURCE_NOT_READ_ONLY',
    why: '§3.2.2 - the snapshot step must not be able to alter a store even by accident',
    backup: swap('?mode=ro', ''),
  },
  {
    code: 'SNAPSHOT_BY_FILE_COPY',
    why: '§7.1.1 - a copy of a live store is a fragment that may restore, may fail, or may restore wrongly',
    backup: swap(SNAPSHOT_CALL, 'cp "${STORE_FILE}" "${SNAPSHOT_PATH}"'),
  },
  {
    code: 'STORE_TARGET_MISSING',
    why: 'a backup that silently omits a store is not a backup',
    backup: swapAll(SIGNAL_MOUNT, "readonly STORE_DIR_SIGNAL='/stores/finance'"),
  },
  {
    code: 'STORE_TARGET_UNEXPECTED',
    why: 'a fourth store path is either a typo or a store nobody reviewed',
    backup: swapAll(SIGNAL_MOUNT, "readonly STORE_DIR_SIGNAL='/stores/journal'"),
  },
  {
    code: 'STORE_TARGET_NOT_READ_ONLY_IN_TOPOLOGY',
    why: '§3.2.2 permits a cross-store view only read-only, without exception',
    compose: swap('"signal-data:/stores/signal:ro"', '"signal-data:/stores/signal"'),
  },
  {
    code: 'STORE_TARGET_WRITTEN',
    why: 'the view is read-only, so nothing on this path writes through it',
    backup: swap(SIGNAL_MOUNT, `${SIGNAL_MOUNT}\ntouch /stores/signal/probe`),
  },
  {
    code: 'RECIPIENT_NOT_FROM_ENVIRONMENT',
    why: 'steering §0b keeps even the public recipient out of a tracked file',
    backup: swapAll(RECIPIENT, '--recipient "${STORE_LABEL}"'),
  },
  {
    code: 'SHRED_STEP_MISSING',
    why: '§7.1.3 - a plaintext snapshot that outlives its encryption is the largest exposure this system creates',
    backup: swapAll('shred', 'unlink'),
  },
  {
    code: 'SHRED_FAILURE_SWALLOWED',
    why: '§7.1.3 - a shred that could not complete must escalate; the plaintext is still there either way',
    backup: swap(SHRED_NOW, '--iterations=1 "${SNAPSHOT_PATH}" || true; then'),
  },
  {
    code: 'SHRED_NOT_ON_FAILURE_PATH',
    why: '§7.1.3 requires the plaintext gone on the failure path too, not only in the happy sequence',
    backup: swap(TRAP_LINE, 'trap shred_plaintext_on_exit INT'),
  },
  {
    code: 'UPLOAD_NOT_VERIFIED',
    why: '§7.1 - an upload that is not verified is not a backup',
    backup: swap('--expect-digest', '--digest'),
  },
  {
    code: 'RETENTION_UNBOUNDED',
    why: '§7.1 - retention is bounded, and the bound is configuration rather than a constant in a script',
    backup: swap(RETAIN_CALL, '--retain all'),
  },
  {
    code: 'IDENTITY_NOT_FROM_ENVIRONMENT',
    why: '§7.2.2 - the private half is a path on the operator machine, never material in this repository',
    restore: swap(RESTORE_IDENTITY, '--identity "${RESTORE_ARTIFACT}"'),
  },
  {
    code: 'INTEGRITY_CHECK_MISSING',
    why: 'R21 makes that check the gate that precedes trust; a restore without it is an assumption',
    restore: swap(RESTORE_INTEGRITY, "'PRAGMA quick_check'"),
  },
  {
    code: 'VERIFY_NOT_BEFORE_WRITE',
    why: '§7.2 - size and digest are checked before the identity is spent on the artifact',
    restore: swap(RESTORE_VERIFY_THEN_DECRYPT, '  decrypt_artifact\n  verify_artifact_integrity'),
  },
  {
    code: 'VERIFY_NOT_BEFORE_WRITE',
    why: 'R21 - nothing boots against the restored store until the integrity check answers',
    restore: swap('  check_store_integrity\n', ''),
  },
  {
    code: 'TARGET_FRESHNESS_UNCHECKED',
    why: '§7.2 - a restore that overwrites a good store in place turns an outage into permanent loss',
    restore: swap(RESTORE_FRESH, 'if [ -d "${RESTORE_TARGET_DIR}" ]; then'),
  },
  {
    code: 'REPAIR_PATH_PRESENT',
    why: '§7.2 discards and escalates; "better than nothing" is how a subtly wrong ledger becomes the ledger',
    restore: swap(RESTORE_BOOT, '  boot_throwaway_instance\n}\nsqlite3 "${RESTORED_STORE}" \'.recover\''),
  },
  {
    code: 'FAILURE_NOT_ESCALATED',
    why: 'a failing control that reports success is worse than no control',
    restore: swapAll('ESCALATE', 'NOTE'),
  },
  {
    code: 'PARTICULAR_URL_SCHEME',
    why: 'R24 - every endpoint is injected at run time, never written down',
    backup: swap(STRICT_MODE, `# ${URL_SHAPED}\n${STRICT_MODE}`),
  },
  {
    code: 'PARTICULAR_ADDRESS_LITERAL',
    why: 'R24 - no address of the host, in any notation',
    backup: swap(STRICT_MODE, `# ${ADDRESS_SHAPED}\n${STRICT_MODE}`),
  },
  {
    code: 'PARTICULAR_HOSTNAME',
    why: 'R24 - write a placeholder, never a name',
    backup: swap(STRICT_MODE, `# ${HOSTNAME_SHAPED}\n${STRICT_MODE}`),
  },
  {
    code: 'PARTICULAR_LONG_DIGIT_RUN',
    why: 'R24 - a long digit run is the shape of a messaging user identifier',
    backup: swap(STRICT_MODE, `# ${LONG_DIGIT_RUN}\n${STRICT_MODE}`),
  },
  {
    code: 'PARTICULAR_CURRENCY_FIGURE',
    why: 'R24 - no real monetary figure, including in a comment',
    backup: swap(STRICT_MODE, `# ${CURRENCY_SHAPED}\n${STRICT_MODE}`),
  },
  {
    code: 'PLACEHOLDER_MALFORMED',
    why: 'a placeholder that is not upper snake case is recognized by neither the operator nor task 9.0',
    backup: swap(STRICT_MODE, `# <workDir>\n${STRICT_MODE}`),
  },
];

describe('the templates on disk are the shape contract 12 §7.1 and §7.2 require', () => {
  it('both parse as the supported subset, each with a main whose steps are all defined', () => {
    for (const [name, source, expected] of [
      ['backup', BACKUP, BACKUP_SEQUENCE],
      ['restore', RESTORE, RESTORE_SEQUENCE],
    ] as const) {
      const script = parseShellScript(source);
      expect(script.mainSequence, `${name} sequence`).toEqual([...expected]);
      for (const step of script.mainSequence) {
        expect(script.functions, `${name} defines ${step}`).toContain(step);
      }
    }
  });

  it('produces no finding at all', () => {
    const findings = auditBackupScripts({ backupSource: BACKUP, restoreSource: RESTORE, composeSource: COMPOSE });
    expect(findings.map((f) => `${f.code}: ${f.detail}`)).toEqual([]);
  });

  it('the host cannot read what it wrote: the backup path names no private half and takes no parameter (§7.1.2)', () => {
    // Assembled from fragments, so this assertion never holds a contiguous copy of what it forbids.
    const forbidden: readonly RegExp[] = [
      /--identity\b/,
      /--decrypt\b/,
      /--pass(?:phrase|word)\b/,
      new RegExp('AGE-SEC' + 'RET-KEY', 'i'),
      new RegExp('BEG' + 'IN [A-Z ]*PRIV' + 'ATE KEY'),
      /\$\{?[1-9]/,
      /\$[@*]/,
    ];
    for (const pattern of forbidden) {
      expect(pattern.test(BACKUP), `the backup template must not match ${String(pattern)}`).toBe(false);
    }
    // Key material itself is forbidden in BOTH templates. The restore drill legitimately references
    // the off-host private half, but only ever as a path resolved from its environment.
    for (const pattern of [new RegExp('AGE-SEC' + 'RET-KEY', 'i'), new RegExp('BEG' + 'IN [A-Z ]*PRIV' + 'ATE KEY'), new RegExp('\\bag' + 'e1[a-z0-9]{8}')]) {
      expect(pattern.test(RESTORE), `the restore template must not match ${String(pattern)}`).toBe(false);
    }
    expect(RESTORE).toContain(RESTORE_IDENTITY);
    expect(BACKUP).toContain(PARAM_REFUSAL);
    // And the recipient it does name is the PUBLIC half, resolved from the host at run time.
    expect(BACKUP).toContain(RECIPIENT);
  });

  it('takes a snapshot with the engine statement and never with a copy (§7.1.1)', () => {
    expect(BACKUP).toMatch(/VACUUM\s+INTO\s+'/);
    expect(BACKUP).toContain('?mode=ro');
    const body = BACKUP.split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    for (const tool of ['cp', 'dd', 'tar', 'rsync', 'cat', 'install']) {
      expect(new RegExp(`(?:^|\\s)${tool}\\s`, 'm').test(body), `no ${tool} on the snapshot path`).toBe(false);
    }
  });

  it('names exactly the three store paths the topology mounts read-only, and writes through none of them (§3.2.2)', () => {
    const mounts = backupServiceMounts(COMPOSE);
    expect(mounts, `${BACKUP_SERVICE} declares mounts`).not.toBeNull();
    const named = new Set<string>();
    for (const match of BACKUP.matchAll(/\/stores\/[A-Za-z0-9_-]+/g)) named.add(match[0]);
    expect([...named].sort()).toEqual([...STORE_MOUNT_TARGETS].sort());
    for (const target of STORE_MOUNT_TARGETS) {
      expect((mounts ?? []).some((mount) => mount.endsWith(`:${target}:ro`)), `${target} is mounted read-only`).toBe(true);
    }
    // The only writable path the service has is its scratch directory, and that is the only place a
    // snapshot is ever written.
    expect((mounts ?? []).some((mount) => mount === 'backup-work:/work')).toBe(true);
  });

  it('shreds the plaintext, loudly, and on the failure path as well (§7.1.3)', () => {
    expect(BACKUP).toContain(TRAP_LINE);
    const shredLines = BACKUP.split('\n').filter((line) => !line.trim().startsWith('#') && /\bshred\b/.test(line));
    expect(shredLines.length).toBeGreaterThan(0);
    for (const line of shredLines) {
      expect(/\|\|\s*(?:true|:)/.test(line), `a shred must not be allowed to fail quietly: ${line.trim()}`).toBe(false);
      expect(/2>\s*\/dev\/null/.test(line), `a shred must not discard its error stream: ${line.trim()}`).toBe(false);
    }
  });

  it('consults both forms of the halt, first, before anything is written (§8)', () => {
    for (const entry of HALT_ENTRIES) {
      expect(new RegExp(`\\$\\{!?${entry}\\b`).test(BACKUP), `${entry} is consulted`).toBe(true);
    }
    expect(parseShellScript(BACKUP).mainSequence[0]).toBe('assert_not_halted');
  });

  it('verifies before it trusts, and verifies before it writes (§7.2, R21)', () => {
    const sequence = parseShellScript(RESTORE).mainSequence;
    const at = (step: string): number => sequence.indexOf(step);
    expect(at('assert_target_is_fresh')).toBeLessThan(at('decrypt_artifact'));
    expect(at('verify_artifact_integrity')).toBeLessThan(at('decrypt_artifact'));
    expect(at('check_store_integrity')).toBeLessThan(at('boot_throwaway_instance'));
    expect(RESTORE).toContain(RESTORE_INTEGRITY);
    expect(RESTORE).toContain("'PRAGMA foreign_key_check'");
    // There is no promotion step at all: promotion is a separate, deliberate operator action, so
    // nothing this drill can do reaches a live store.
    expect(sequence).not.toContain('promote');
    for (const target of STORE_MOUNT_TARGETS) {
      expect(RESTORE.includes(target), `the drill never names the live mount ${target}`).toBe(false);
    }
  });

  it('carries no credential, in either template, so no payload can contain one (§7.1 closing rule)', () => {
    expect(SECRET_ENTRY_NAMES.length).toBeGreaterThan(0);
    for (const entry of SECRET_ENTRY_NAMES) {
      expect(BACKUP.includes(entry), `the backup template must not name ${entry}`).toBe(false);
      expect(RESTORE.includes(entry), `the restore template must not name ${entry}`).toBe(false);
    }
  });

  it('reads only entry names its own environment declares, and assigns none of them', () => {
    for (const [source, declared] of [
      [BACKUP, BACKUP_ENTRY_NAMES],
      [RESTORE, RESTORE_ENTRIES],
    ] as const) {
      const script = parseShellScript(source);
      for (const name of script.variableReads) {
        expect(declared.includes(name) || script.localNames.includes(name), `${name} is declared or local`).toBe(true);
      }
      for (const local of script.localNames) {
        expect(declared.includes(local), `${local} must not be assigned in the script`).toBe(false);
      }
    }
  });
});

describe('every check fires - the negative half', () => {
  it.each(NEGATIVE_CASES.map((c, index) => [`${c.code} #${index}`, c.why, c] as const))('%s fires when %s', (_label, _why, testCase) => {
    const backup = testCase.backup === undefined ? BACKUP : testCase.backup(BACKUP);
    const restore = testCase.restore === undefined ? RESTORE : testCase.restore(RESTORE);
    const compose = testCase.compose === undefined ? COMPOSE : testCase.compose(COMPOSE);
    expect(`${backup}${restore}${compose}`).not.toBe(`${BACKUP}${RESTORE}${COMPOSE}`);
    expect(codesFor(backup, restore, compose)).toContain(testCase.code);
  });

  it('an unreadable template is a finding, never a skip', () => {
    const findings = auditBackupScriptFiles(`${OPS_DIR}does-not-exist/`, COMPOSE_PATH);
    expect(findings.map((f) => f.code)).toContain('SCRIPT_UNREADABLE');
    expect(findings.filter((f) => f.code === 'SCRIPT_UNREADABLE')).toHaveLength(2);
  });

  it('an unreadable topology companion is a finding too, because the read-only mounts go unchecked', () => {
    expect(codesFor(BACKUP, RESTORE, '')).toContain('COMPOSE_COMPANION_UNREADABLE');
    expect(auditBackupScriptFiles(OPS_DIR, `${COMPOSE_PATH}.does-not-exist`).map((f) => f.code)).toContain(
      'COMPOSE_COMPANION_UNREADABLE',
    );
  });

  it('a finding from the shared scan that this checker has no code for is reported, never dropped', () => {
    const mapped = mapParticularFindings([{ code: 'BUS_PUBLISHES_PORT', detail: 'a code from the topology checker' }], 'backup');
    expect(mapped.map((f) => f.code)).toEqual(['PARTICULAR_SCAN_UNMAPPED']);
    expect(mapped[0]?.detail).toContain('BUS_PUBLISHES_PORT');
  });

  it('the file entry point agrees with the text entry point on the real templates', () => {
    expect(auditBackupScriptFiles(OPS_DIR, COMPOSE_PATH)).toEqual([]);
    expect(BACKUP_SCRIPT_PATH).toMatch(/backup/);
    expect(RESTORE_SCRIPT_PATH).toMatch(/restore/);
  });

  it('every finding code has a negative case, so the negative half cannot fall behind', () => {
    const covered = new Set<string>([
      ...NEGATIVE_CASES.map((c) => c.code),
      'SCRIPT_UNREADABLE',
      'COMPOSE_COMPANION_UNREADABLE',
      'PARTICULAR_SCAN_UNMAPPED',
    ]);
    const uncovered = BACKUP_SCRIPT_FINDING_CODES.filter((c) => !covered.has(c));
    expect(uncovered).toEqual([]);
  });
});
