// @vitest-environment node
/**
 * NIZAM · The runbooks say what contract 12 §7.4, §7.5, §2.3 and §5.5 require, and the checker fires
 * Implemented by: PFOS Contract 12 / Phase 7.6 (spec 06-two-agent-vps)
 * Owning requirements: R20/R21 (a rollback across a migration routes through the restore drill and
 *   the integrity check precedes trust), R22 (a rollback confirms readiness, not liveness),
 *   R13/R14/R15 (the degraded long-poll mode keeps every transport guard), R23 (a gate is named,
 *   never attempted), R24 (no deployment particular)
 * Depends on: ./runbookTemplate and the seven files it cross-reads - the three documents under
 *   ops/runbook/ plus ops/docker-compose.yml, ops/GATE_REGISTER.md, ops/backup/ and ops/restore/ -
 *   all read from disk as text
 *
 * Two halves, and the second is the one that matters.
 *
 * POSITIVE. The three documents on disk produce no finding, and the properties that carry the weight
 * are asserted separately as well: the drill order quoted in the rollback runbook is the order the
 * restore template actually runs, the recorded migration version is the series' own, every step has a
 * verification line, and the posture document states a documented number, its provenance and a
 * posture for every limit it lists.
 *
 * NEGATIVE. Every finding code has a row in NEGATIVE_CASES that takes the real file, breaks one
 * property, and observes that code fire. A checker that has only ever been observed passing is not
 * evidence that it checks. The coverage test at the end fails if a code is added without a row.
 *
 * NOTHING HERE EXECUTES ANYTHING, AND NOTHING HERE DIALS ANYTHING. No shell is invoked, no container
 * is started, no store is opened, and no request is made to any provider (steering §2: writing these
 * files is permitted, running them is not).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DISASTER_RECOVERY_DOC,
  RATE_LIMIT_DOC,
  REBUILD_STEPS,
  REQUIRED_LIMITS,
  REQUIRED_SECTIONS,
  ROLLBACK_DOC,
  RUNBOOK_DOCS,
  RUNBOOK_FINDING_CODES,
  RUNBOOK_FILES,
  RUNBOOK_SUBDIR,
  SECRET_ENTRY_NAMES,
  STORE_FILE_ENTRIES,
  assembleVocabulary,
  auditRunbookFiles,
  auditRunbooks,
  gatesIn,
  imageReferencesIn,
  mapParticularFindings,
  parseRunbook,
  quotedDrillSequence,
  verificationOf,
  type RunbookFindingCode,
} from './runbookTemplate.ts';
import { RESTORE_SEQUENCE } from './backupScripts.ts';
import { EXPECTED_SCHEMA_VERSION } from './healthProbe.ts';
import { TELEGRAM_TRANSPORT_MODES } from '../ports/telegram.ts';

const OPS_DIR = fileURLToPath(new URL('../../../ops/', import.meta.url));
const RUNBOOK_DIR = fileURLToPath(new URL('../../../ops/runbook/', import.meta.url));

/** Line endings are normalized so the mutation anchors below do not depend on the checkout's
 *  setting. The file entry point is exercised separately against the bytes on disk. */
const read = (relative: string): string => readFileSync(OPS_DIR + relative, 'utf8').split('\r\n').join('\n');

const DOCS: Readonly<Record<string, string>> = {
  [ROLLBACK_DOC]: read(`${RUNBOOK_SUBDIR}/${RUNBOOK_FILES[ROLLBACK_DOC] ?? ''}`),
  [DISASTER_RECOVERY_DOC]: read(`${RUNBOOK_SUBDIR}/${RUNBOOK_FILES[DISASTER_RECOVERY_DOC] ?? ''}`),
  [RATE_LIMIT_DOC]: read(`${RUNBOOK_SUBDIR}/${RUNBOOK_FILES[RATE_LIMIT_DOC] ?? ''}`),
};
const COMPOSE = read('docker-compose.yml');
const GATE_REGISTER = read('GATE_REGISTER.md');
const BACKUP = read('backup/backup.sh');
const RESTORE = read('restore/restore.sh');

const COMPANIONS = { composeSource: COMPOSE, gateRegisterSource: GATE_REGISTER, backupSource: BACKUP, restoreSource: RESTORE };

interface Overrides {
  readonly [doc: string]: (text: string) => string;
}

function codesFor(overrides: Overrides = {}, companions = COMPANIONS): readonly RunbookFindingCode[] {
  const sources: Record<string, string> = {};
  let changed = false;
  for (const name of RUNBOOK_DOCS) {
    const original = DOCS[name] ?? '';
    const mutate = overrides[name];
    const next = mutate === undefined ? original : mutate(original);
    if (next !== original) changed = true;
    sources[name] = next;
  }
  if (Object.keys(overrides).length > 0 && !changed) {
    throw new Error('the mutation left every document unchanged, so the case would prove nothing');
  }
  return auditRunbooks({ sources, ...companions }).map((f) => f.code);
}

/** A mutation that must actually change the text, so a rotted anchor fails loudly. */
function swap(from: string, to: string): (t: string) => string {
  return (t) => {
    if (!t.includes(from)) throw new Error(`negative-test anchor no longer present: ${JSON.stringify(from.slice(0, 70))}`);
    return t.replace(from, () => to);
  };
}

/** The same, for a token that appears more than once and must be gone from all of them. */
function swapAll(from: string, to: string): (t: string) => string {
  return (t) => {
    if (!t.includes(from)) throw new Error(`negative-test anchor no longer present: ${JSON.stringify(from.slice(0, 70))}`);
    return t.split(from).join(to);
  };
}

/** Exchange two headings, so membership is unchanged and only the order moves. */
function reorder(first: string, second: string): (t: string) => string {
  return (t) => {
    for (const anchor of [first, second]) {
      if (!t.includes(anchor)) throw new Error(`negative-test anchor no longer present: ${JSON.stringify(anchor)}`);
    }
    const held = '\u0000HELD\u0000';
    return t.replace(first, () => held).replace(second, () => first).replace(held, () => second);
  };
}

// Shapes assembled from fragments, so this file never holds a contiguous copy of what the scan
// forbids and never trips the other scanners in the harness.
const URL_SHAPED = 'ht' + 'tp' + '://' + 'internal-probe';
const ADDRESS_SHAPED = ['198', '51', '100', '7'].join('.');
const HOSTNAME_SHAPED = 'runbook.' + 'exam' + 'ple' + '.' + 'inva' + 'lid';
const LONG_DIGIT_RUN = '12345' + '678';
const CURRENCY_SHAPED = 'US' + 'D' + ' 5.00';

/** Injected ahead of the rollback title so a line-level scan has somewhere to find it. The injected
 *  text begins with `# `, so the document still opens with a level-one heading and stays inside the
 *  supported subset - each of these cases breaks the one property it names and nothing else. */
const inject = (text: string): ((t: string) => string) => swap('# Rollback runbook', `${text}\n\n# Rollback runbook`);

interface NegativeCase {
  readonly code: RunbookFindingCode;
  readonly why: string;
  readonly overrides: Overrides;
}

// Anchors quoted from the real documents. Each one is a sentence the contract requires, so a rewrite
// that moves one fails its case loudly rather than making the case vacuous.
const NOTICE = 'NOTHING HERE IS EXECUTED BY AN AGENT';
const OWNERSHIP = 'Contract 12';
const RECORDING_HEADING = '## Recording the rollback';
const DEPLOY_ORDER_HEADING = '## Deployment order for a change that includes a migration';
const STEP_ONE_VERIFY = '**VERIFY:** the sentinel path is present';
const HALT_TOUCH = 'touch "${KILL_SENTINEL_PATH}"';
const TAG_SHAPE = 're-deployment of a previously known-good, immutably tagged image';
const BUS_IMAGE = '`<BUS_IMAGE_REF>`';
const REVERSAL_REFUSAL = 'A schema migration is not rolled back by reversing it';
const DEPLOY_PROHIBITION = 'Never deploy code that assumes a migration that has not yet been applied';
const DRILL_PAIR = '`verify_artifact_integrity` -> `decrypt_artifact`';
const INTEGRITY_FIRST = 'The integrity check precedes trust';
const PROMOTION = 'Restoring **never** overwrites a live store in place';
/** Quoted from the real document, but the NUMBER is read from the migration series rather than
 *  restated here. A literal rots the moment a migration is added - which is exactly what happened
 *  when migration 008 landed and left this anchor, and the document it anchors, at 007. */
const RECORDED_VERSION = `**Latest applied migration version:** 00${EXPECTED_SCHEMA_VERSION}`;
/** One version behind the head, so the stale case is stale by construction rather than by a literal
 *  that could one day coincide with the head. */
const RECORDED_VERSION_STALE = `**Latest applied migration version:** 00${EXPECTED_SCHEMA_VERSION - 1}`;
const RECORD_RULE = 'A rollback is recorded with **what was reverted and why**';
const WAL_DETERMINATION = 'This is an **operator determination**';
const WAL_OUTCOMES = 'exactly two acceptable outcomes';
const WAL_DEFAULT_RANKING = '**Outcome B is the documented default:';
const WAL_COPY_REFUSAL = '**What is not acceptable, under any circumstance, is falling back to a file copy.**';
const PROBE_CALL = 'nizam-health-probe --store "${FINANCE_STORE_FILE}"';
const RADIUS_FIRST_MITIGATION = '**Bounded per-service resources.**';
const REBUILD_FIRST_TITLE = 'Provision a fresh host and harden it (gate G1)';
const REBUILD_LAST_TITLE = 'Re-register both webhooks (gate G6)';
const SIGNALS_STORE = '`${SIGNALS_STORE_FILE}`';
const SECRETS_REISSUED = '**Secrets are re-issued, never restored.**';
const CADENCE = '${BACKUP_SCHEDULE}';
const DRILL_PREREQUISITE = '**Recovery must not be the moment a guard is first tested**';
const GUARDS_INTACT = '**Every guard in §5 stays intact:**';
const GROUP_LIMIT_HEADING = '### Limit 3 - Per-group send rate';
const GROUP_LIMIT_NUMBER = '### Limit 3 - ';
const GLOBAL_DOCUMENTED = 'roughly thirty messages per second in total, across all chats.';
const POLL_DOCUMENTED = '- **Documented:** the update-fetching method takes a timeout';
const FIRST_PROVENANCE = "- **Provenance:** the provider";
const FIRST_POSTURE = '- **Posture:** the outbound path serializes per chat';
/** Wrapped in the document, so the anchor carries the break the sentence checks collapse away. */
const REFUSAL_RULE = 'a queue failure, never\na transport failure';
const RETRY_AFTER_RULE = '**honoured, not estimated**';
const CEILING_LOW = 'set **low**';
const FALLBACK_MODE = '`longPoll` (the documented fallback)';
const NO_LIVE_PROBE = '**No live API probe was made, and none is needed.**';
const READ_NOT_MEASURED = 'Documentation is read, not measured.';

const NEGATIVE_CASES: readonly NegativeCase[] = [
  // --- fail-closed, shared ---------------------------------------------------------------------
  {
    code: 'DOC_OUTSIDE_SUBSET',
    why: 'a document whose first line is not its title is one a reader cannot identify under pressure',
    overrides: { [ROLLBACK_DOC]: (t) => t.split('\n').slice(1).join('\n') },
  },
  {
    code: 'DOC_OUTSIDE_SUBSET',
    why: 'a tab indents differently in two viewers, so it is indentation nobody can review',
    overrides: { [DISASTER_RECOVERY_DOC]: swap('## Blast radius', '## Blast radius\n\n\tone host, one domain') },
  },
  {
    code: 'HEADER_OWNERSHIP_MISSING',
    why: 'a runbook nobody can trace to a contract section is one nobody reviews against it',
    overrides: { [ROLLBACK_DOC]: swap(OWNERSHIP, 'Contract Twelve') },
  },
  {
    code: 'EXECUTION_NOTICE_MISSING',
    why: 'steering §2 permits writing this file and forbids running it, and the notice is where a reader learns which',
    overrides: { [ROLLBACK_DOC]: swap(NOTICE, 'nothing here is executed by an agent') },
  },
  {
    code: 'SECTION_MISSING',
    why: 'a required section demoted below the heading level the audit reads is a section that is gone',
    overrides: { [ROLLBACK_DOC]: swap(RECORDING_HEADING, `##${RECORDING_HEADING}`) },
  },
  {
    code: 'SECTION_UNEXPECTED',
    why: 'a section this audit does not know about is a section nobody checked',
    overrides: { [ROLLBACK_DOC]: swap(RECORDING_HEADING, `${RECORDING_HEADING}\n\n## Extra notes for the operator`) },
  },
  {
    code: 'SECTION_ORDER_UNEXPECTED',
    why: 'an operator reads a runbook top to bottom, so the order is part of the requirement rather than a preference',
    overrides: { [ROLLBACK_DOC]: reorder(RECORDING_HEADING, DEPLOY_ORDER_HEADING) },
  },
  {
    code: 'PROCEDURE_HAS_NO_STEPS',
    why: 'a procedure with no numbered step leaves an operator nothing to follow',
    overrides: { [DISASTER_RECOVERY_DOC]: swapAll('### Step ', '#### Step ') },
  },
  {
    code: 'BLOCK_NUMBERING_UNEXPECTED',
    why: 'a runbook that skips or repeats a number is one an operator loses their place in',
    overrides: { [RATE_LIMIT_DOC]: swap(GROUP_LIMIT_NUMBER, '### Limit 4 - ') },
  },
  {
    code: 'STEP_WITHOUT_VERIFICATION',
    why: 'a step whose outcome is not checked is a step that is assumed to have worked',
    overrides: { [ROLLBACK_DOC]: swap(STEP_ONE_VERIFY, 'Check that the sentinel path is present') },
  },
  {
    code: 'VOCABULARY_UNDECLARED',
    why: 'a value no template, the topology, the register or either shell script declares is one the operator cannot resolve',
    overrides: { [ROLLBACK_DOC]: swap(HALT_TOUCH, 'touch "${UNDECLARED_SENTINEL_PATH}"') },
  },
  {
    code: 'SECRET_VALUE_ASSIGNED',
    why: 'a runbook may name a secret entry so the operator knows which one; writing it as an assignment is how a value lands in a document',
    overrides: { [ROLLBACK_DOC]: inject(`# ${SECRET_ENTRY_NAMES[0] ?? ''}=the-operator-pasted-it-here`) },
  },
  {
    code: 'GATE_REFERENCE_UNKNOWN',
    why: 'R23 - a step attributed to a gate the register does not carry is a step nobody can clear',
    overrides: { [ROLLBACK_DOC]: inject('# A step attributed to gate G9') },
  },

  // --- §7.4 rollback --------------------------------------------------------------------------
  {
    code: 'ROLLBACK_NOT_BY_IMAGE_TAG',
    why: 'without the shape stated, "roll back" means whatever the operator improvises at the worst moment',
    overrides: { [ROLLBACK_DOC]: swap(TAG_SHAPE, 'redeployment of the last build that looked right') },
  },
  {
    code: 'IMAGE_REFERENCE_MISSING',
    why: 'an operator reverting a service the topology declares would otherwise guess which reference to change',
    overrides: { [ROLLBACK_DOC]: swap(BUS_IMAGE, '`<PROXY_IMAGE_REF>`') },
  },
  {
    code: 'MIGRATION_REVERSAL_NOT_REFUSED',
    why: 'a reversal left merely undiscussed is one somebody writes on the day it is needed',
    overrides: { [ROLLBACK_DOC]: swap(REVERSAL_REFUSAL, 'A schema migration is usually not reversed') },
  },
  {
    code: 'DEPLOY_ORDER_UNEXPECTED',
    why: 'the order is the only thing that guarantees the snapshot a rollback across a migration needs',
    overrides: { [ROLLBACK_DOC]: swap(DEPLOY_PROHIBITION, 'Deploy carefully around a migration') },
  },
  {
    code: 'RESTORE_DRILL_SEQUENCE_MISQUOTED',
    why: 'the quoted order disagreeing with ops/restore/ is how an operator skips a gate that precedes trust',
    overrides: { [ROLLBACK_DOC]: swap(DRILL_PAIR, '`decrypt_artifact` -> `verify_artifact_integrity`') },
  },
  {
    code: 'RESTORE_DRILL_SEQUENCE_MISQUOTED',
    why: 'with no quoted sequence at all, the order an operator follows is whatever they remember',
    overrides: { [ROLLBACK_DOC]: swap('**Drill sequence:**', 'The drill runs, in order:') },
  },
  {
    code: 'INTEGRITY_CHECK_NOT_BEFORE_TRUST',
    why: 'R21 - "better than nothing" is how a subtly wrong ledger becomes the ledger',
    overrides: { [ROLLBACK_DOC]: swap(INTEGRITY_FIRST, 'The integrity check matters here') },
  },
  {
    code: 'PROMOTION_NOT_SEPARATE',
    why: '§7.2 - a drill that can reach a live store is not a drill',
    overrides: { [ROLLBACK_DOC]: swap(PROMOTION, 'Restoring tries to avoid touching a live store') },
  },
  {
    code: 'MIGRATION_VERSION_STALE',
    why: 'a rollback that targets the wrong schema version targets the wrong store',
    overrides: { [ROLLBACK_DOC]: swap(RECORDED_VERSION, RECORDED_VERSION_STALE) },
  },
  {
    code: 'MIGRATION_VERSION_STALE',
    why: 'with no version recorded at all, nothing in the document can be compared against the migration series',
    overrides: { [ROLLBACK_DOC]: swap(RECORDED_VERSION, '**Latest applied migration:** the head of the series') },
  },
  {
    code: 'ROLLBACK_NOT_RECORDED',
    why: '§7.4\'s last rule - an unrecorded rollback is one nobody can reconstruct afterwards',
    overrides: { [ROLLBACK_DOC]: swap(RECORD_RULE, 'A rollback is worth a note afterwards') },
  },
  {
    code: 'WAL_DETERMINATION_MISSING',
    why: 'an unrecorded conflict between a read-only mount and the sidecar write is one somebody resolves with a copy',
    overrides: { [ROLLBACK_DOC]: swap(WAL_DETERMINATION, 'This is a **judgement call**') },
  },
  {
    code: 'WAL_OUTCOMES_INCOMPLETE',
    why: 'an operator meeting the constraint needs a bounded choice, not an open one',
    overrides: { [ROLLBACK_DOC]: swap(WAL_OUTCOMES, 'a few acceptable outcomes') },
  },
  {
    code: 'WAL_DEFAULT_OUTCOME_NOT_RANKED',
    // The mutation demotes the default back to a bare alternative and touches nothing else: the
    // phrase the outcome-completeness check reads ("from inside the owning service") survives, so
    // this case fails on the ranking alone rather than on membership.
    why: 'two equally-weighted outcomes leave the choice to be made at the first-backup step under pressure, with nothing stated to prefer',
    overrides: { [ROLLBACK_DOC]: swap(WAL_DEFAULT_RANKING, '**Another acceptable outcome:') },
  },
  {
    code: 'WAL_DEFAULT_OUTCOME_NOT_RANKED',
    why: 'a default named without saying which outcome it is tells an operator only that somebody had a preference',
    overrides: { [ROLLBACK_DOC]: swap('**Outcome A is the fallback:', '**The other acceptable outcome:') },
  },
  {
    code: 'WAL_COPY_FALLBACK_NOT_REFUSED',
    why: 'a copy of a store that is being written may restore wrongly and look fine, which is the failure the constraint exists to avoid',
    overrides: { [ROLLBACK_DOC]: swap(WAL_COPY_REFUSAL, '**A file copy is discouraged here.**') },
  },
  {
    code: 'PROBE_INVOCATION_MALFORMED',
    why: 'a command the tool rejects wastes the one thing a rollback does not have',
    overrides: { [ROLLBACK_DOC]: swap(PROBE_CALL, 'nizam-health-probe --store-file "${FINANCE_STORE_FILE}"') },
  },
  {
    code: 'PROBE_INVOCATION_MALFORMED',
    why: '§7.3 answers readiness through the probe, so a document that never invokes it confirms liveness instead',
    overrides: { [ROLLBACK_DOC]: swap(PROBE_CALL, '# ask the orchestrator whether the container is up') },
  },

  // --- §7.5 disaster recovery -----------------------------------------------------------------
  {
    code: 'BLAST_RADIUS_MITIGATIONS_INCOMPLETE',
    why: '§7.5 names four mitigations, and a missing one is a blast radius nobody sized',
    overrides: { [DISASTER_RECOVERY_DOC]: swap(RADIUS_FIRST_MITIGATION, '**Capped resources per service.**') },
  },
  {
    code: 'BLAST_RADIUS_MITIGATIONS_INCOMPLETE',
    why: 'an unstated failure domain is one nobody accepted deliberately',
    overrides: { [DISASTER_RECOVERY_DOC]: swap('**One host is one failure domain.**', '**The host is the deployment.**') },
  },
  {
    code: 'REBUILD_STEP_MISSING',
    why: "§7.5's path is all five steps or it is not the path",
    overrides: { [DISASTER_RECOVERY_DOC]: swap(REBUILD_LAST_TITLE, 'Publish the endpoint again (gate G6)') },
  },
  {
    code: 'REBUILD_ORDER_UNEXPECTED',
    why: 're-registering a webhook before the host is hardened publishes a host that is not ready',
    overrides: { [DISASTER_RECOVERY_DOC]: reorder(REBUILD_FIRST_TITLE, REBUILD_LAST_TITLE) },
  },
  {
    code: 'STORE_COVERAGE_INCOMPLETE',
    why: 'a rebuild that silently omits a store leaves the deployment running with one of its three empty',
    overrides: { [DISASTER_RECOVERY_DOC]: swap(SIGNALS_STORE, '`${FINANCE_STORE_FILE}`') },
  },
  {
    code: 'SECRETS_TREATED_AS_RESTORABLE',
    why: 'no key, token or environment file was ever in a payload, so implying otherwise sends an operator looking for nothing',
    overrides: { [DISASTER_RECOVERY_DOC]: swap(SECRETS_REISSUED, '**Secrets come back with the artifacts.**') },
  },
  {
    code: 'RECOVERY_OBJECTIVE_NOT_CADENCE_BOUND',
    why: 'an objective the cadence cannot support is a hope with a number on it',
    overrides: { [DISASTER_RECOVERY_DOC]: swap(CADENCE, '${BACKUP_RETAIN_COUNT}') },
  },
  {
    code: 'DRILL_NOT_PREREQUISITE',
    why: '§7.2 - an untested backup is an assumption, and recovery is not where to discover which kind it was',
    overrides: { [DISASTER_RECOVERY_DOC]: swap(DRILL_PREREQUISITE, '**A drill beforehand helps**') },
  },
  {
    code: 'DEGRADED_MODE_GUARDS_NOT_INTACT',
    why: '§2.3 makes the fallback a mode rather than a second code path so that failing over cannot disable a check',
    overrides: { [DISASTER_RECOVERY_DOC]: swap(GUARDS_INTACT, '**The §5 guards mostly continue to apply:**') },
  },

  // --- §5.5 / §2.3 rate-limit posture ---------------------------------------------------------
  {
    code: 'DOCUMENTED_LIMIT_MISSING',
    why: 'a limit nobody wrote down is a limit nobody has a posture for',
    overrides: { [RATE_LIMIT_DOC]: swap(GROUP_LIMIT_HEADING, '### Limit 3 - Per-channel send rate') },
  },
  {
    code: 'LIMIT_DOCUMENTED_LINE_MISSING',
    why: 'without the line, what the provider actually publishes is left to the reader',
    overrides: { [RATE_LIMIT_DOC]: swap(POLL_DOCUMENTED, '- **Published:** the update-fetching method takes a timeout') },
  },
  {
    code: 'LIMIT_QUANTITY_MISSING',
    why: 'task 7.6 requires the documented numbers to be stated rather than gestured at',
    overrides: { [RATE_LIMIT_DOC]: swap(GLOBAL_DOCUMENTED, 'a much larger aggregate ceiling across every chat.') },
  },
  {
    code: 'LIMIT_PROVENANCE_MISSING',
    why: 'every number here is read from published documentation, and the line is where that is claimed explicitly',
    overrides: { [RATE_LIMIT_DOC]: swap(FIRST_PROVENANCE, '- **Source:** the provider') },
  },
  {
    code: 'LIMIT_POSTURE_MISSING',
    why: '§5.5.5 requires the decision; a documented limit with no answer beside it is only a fact',
    overrides: { [RATE_LIMIT_DOC]: swap(FIRST_POSTURE, '- **Answer:** the outbound path serializes per chat') },
  },
  {
    code: 'REFUSAL_NOT_A_QUEUE_FAILURE',
    why: '§5.5.4 - letting a refusal become a transport failure makes the provider redeliver, turning one refused send into two',
    overrides: { [RATE_LIMIT_DOC]: swap(REFUSAL_RULE, 'a queue failure most of the\ntime') },
  },
  {
    code: 'RETRY_AFTER_NOT_HONOURED',
    why: 'guessing a shorter interval than the one advertised is how a refusal becomes a ban',
    overrides: { [RATE_LIMIT_DOC]: swap(RETRY_AFTER_RULE, '**estimated from the backoff curve**') },
  },
  {
    code: 'CONNECTION_CEILING_NOT_LOW',
    why: '§5.5.5 - a high ceiling only buys concurrency the agent then has to bound anyway',
    overrides: { [RATE_LIMIT_DOC]: swap(CEILING_LOW, 'set **to the provider default**') },
  },
  {
    code: 'TRANSPORT_MODE_UNDECLARED',
    why: 'a mode named here that the transport port does not declare is a mode nobody can select',
    overrides: { [RATE_LIMIT_DOC]: swap(FALLBACK_MODE, '`longPolling` (the documented fallback)') },
  },
  {
    code: 'TRANSPORT_MODE_UNDECLARED',
    why: '§2.3 - without the selector the fallback reads as a code path rather than a configuration choice',
    overrides: { [RATE_LIMIT_DOC]: swapAll('${TELEGRAM_MODE}', '${MAX_WORK_ITEMS}') },
  },
  {
    code: 'LIVE_PROBE_PRESENT',
    why: 'steering §2 gates every outbound call from a server process, and a rate limit is not discovered by exceeding it',
    overrides: { [RATE_LIMIT_DOC]: swap(NO_LIVE_PROBE, '**The numbers below were confirmed.**') },
  },
  {
    code: 'LIVE_PROBE_PRESENT',
    why: 'a posture that ships a transfer-client invocation invites somebody to run it',
    overrides: { [RATE_LIMIT_DOC]: swap(READ_NOT_MEASURED, 'Documentation is read, not measured, and nobody runs curl for a number.') },
  },

  // --- R24, re-reported from the ONE shared scan ----------------------------------------------
  {
    code: 'PARTICULAR_URL_SCHEME',
    why: 'R24 - every endpoint is injected at run time, never written down',
    overrides: { [ROLLBACK_DOC]: inject(`# ${URL_SHAPED}`) },
  },
  {
    code: 'PARTICULAR_ADDRESS_LITERAL',
    why: 'R24 - no address of the host, in any notation',
    overrides: { [ROLLBACK_DOC]: inject(`# ${ADDRESS_SHAPED}`) },
  },
  {
    code: 'PARTICULAR_HOSTNAME',
    why: 'R24 - write a placeholder, never a name',
    overrides: { [ROLLBACK_DOC]: inject(`# ${HOSTNAME_SHAPED}`) },
  },
  {
    code: 'PARTICULAR_LONG_DIGIT_RUN',
    why: 'R24 - a long digit run is the shape of a messaging user identifier',
    overrides: { [ROLLBACK_DOC]: inject(`# ${LONG_DIGIT_RUN}`) },
  },
  {
    code: 'PARTICULAR_CURRENCY_FIGURE',
    why: 'R24 - no real monetary figure, not even in an aside',
    overrides: { [ROLLBACK_DOC]: inject(`# ${CURRENCY_SHAPED}`) },
  },
  {
    code: 'PLACEHOLDER_MALFORMED',
    why: 'a placeholder that is not upper snake case is recognized by neither the operator nor the glossary',
    overrides: { [ROLLBACK_DOC]: inject('# <workDir>') },
  },
];

describe('the runbooks on disk are the shape contract 12 §7.4, §7.5, §2.3 and §5.5 require', () => {
  it('all three parse as the supported subset', () => {
    for (const name of RUNBOOK_DOCS) {
      const doc = parseRunbook(DOCS[name] ?? '');
      expect(doc.sections.map((s) => s.title), `${name} sections`).toEqual([...(REQUIRED_SECTIONS[name] ?? [])]);
    }
  });

  it('produces no finding at all', () => {
    const sources: Record<string, string> = { ...DOCS };
    const findings = auditRunbooks({ sources, ...COMPANIONS });
    expect(findings.map((f) => `${f.code}: ${f.detail}`)).toEqual([]);
  });

  it('the companions yield a vocabulary, a gate list and the topology image references', () => {
    expect(assembleVocabulary(COMPANIONS).length).toBeGreaterThan(0);
    expect(gatesIn(GATE_REGISTER)).toContain('G1');
    expect(imageReferencesIn(COMPOSE).length).toBeGreaterThan(0);
    expect(SECRET_ENTRY_NAMES.length).toBeGreaterThan(0);
    expect(STORE_FILE_ENTRIES.length).toBe(3);
    expect(REBUILD_STEPS.length).toBe(5);
    expect(REQUIRED_LIMITS.length).toBeGreaterThan(0);
    expect(TELEGRAM_TRANSPORT_MODES.length).toBe(2);
  });

  it('quotes the restore drill order the template actually runs', () => {
    expect(quotedDrillSequence(parseRunbook(DOCS[ROLLBACK_DOC] ?? ''))).toEqual([...RESTORE_SEQUENCE]);
  });

  it('records the migration version the series is at', () => {
    expect(DOCS[ROLLBACK_DOC] ?? '').toContain(`version:** 00${EXPECTED_SCHEMA_VERSION}`);
  });

  it('gives every step a verification line', () => {
    for (const name of [ROLLBACK_DOC, DISASTER_RECOVERY_DOC]) {
      const steps = parseRunbook(DOCS[name] ?? '').blocks.filter((b) => b.kind === 'Step');
      expect(steps.length, `${name} has steps`).toBeGreaterThan(0);
      for (const step of steps) expect(verificationOf(step), `${name} Step ${step.number}`).not.toBeNull();
    }
  });

  it('the file entry point agrees with the text entry point on the real documents', () => {
    expect(auditRunbookFiles(RUNBOOK_DIR, OPS_DIR)).toEqual([]);
  });
});

describe('every check fires - the negative half', () => {
  it.each(NEGATIVE_CASES.map((c, index) => [`${c.code} #${index}`, c.why, c] as const))('%s fires when %s', (_label, _why, testCase) => {
    expect(codesFor(testCase.overrides)).toContain(testCase.code);
  });

  it('an unreadable document is a finding, never a skip', () => {
    const findings = auditRunbookFiles(`${OPS_DIR}does-not-exist/`, OPS_DIR);
    expect(findings.filter((f) => f.code === 'DOC_UNREADABLE')).toHaveLength(RUNBOOK_DOCS.length);
  });

  it('an unreadable companion is a finding too, because every cross-read would silently pass', () => {
    expect(codesFor({}, { ...COMPANIONS, composeSource: '', gateRegisterSource: '' })).toContain('COMPANION_UNREADABLE');
    expect(codesFor({}, { ...COMPANIONS, restoreSource: '' })).toContain('COMPANION_UNREADABLE');
    expect(auditRunbookFiles(RUNBOOK_DIR, `${OPS_DIR}does-not-exist/`).map((f) => f.code)).toContain('COMPANION_UNREADABLE');
  });

  it('a finding from the shared scan that this checker has no code for is reported, never dropped', () => {
    const mapped = mapParticularFindings([{ code: 'BUS_PUBLISHES_PORT', detail: 'a code from the topology checker' }], ROLLBACK_DOC);
    expect(mapped.map((f) => f.code)).toEqual(['PARTICULAR_SCAN_UNMAPPED']);
    expect(mapped[0]?.detail).toContain('BUS_PUBLISHES_PORT');
  });

  it('every finding code has a negative case, so the negative half cannot fall behind', () => {
    const covered = new Set<string>([
      ...NEGATIVE_CASES.map((c) => c.code),
      'DOC_UNREADABLE',
      'COMPANION_UNREADABLE',
      'PARTICULAR_SCAN_UNMAPPED',
    ]);
    const uncovered = RUNBOOK_FINDING_CODES.filter((c) => !covered.has(c));
    expect(uncovered).toEqual([]);
  });
});

export { URL_SHAPED, ADDRESS_SHAPED, HOSTNAME_SHAPED, LONG_DIGIT_RUN, CURRENCY_SHAPED, inject, swap, swapAll, reorder, NEGATIVE_CASES };
