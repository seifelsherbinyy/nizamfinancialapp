/**
 * NIZAM · Structural audit of the cross-repo change series (ops/nizamcore-patches/)
 * Implemented by: PFOS Contract 12 / Phase 8.1-8.4 (spec 06-two-agent-vps)
 * Owning requirements: R23 (a step that needs a human is named and never attempted - applying these
 *   files is such a step, in a repository this session may not touch), R24 (no deployment particular
 *   in a tracked file), and, as the properties the series must still assert about the other
 *   repository: R11/R12 (the transport guards survive a transport swap), R13/R14 (dedup is keyed on
 *   the pair, because update identifiers collide across bots), R10 (the classification whose egress
 *   set is empty stays empty)
 * Depends on: node:fs (file entry points only), ./composeTemplate (`scanForParticulars` - the ONE
 *   no-deployment-particular scan, so a later widening of R24 moves every artifact at once)
 *
 * WHY THIS EXISTS. Steering section 6 forbids this repository's agent from cloning, fetching,
 * reading, modifying or pushing the life agent's repository. Three changes are nevertheless needed
 * there, so they are emitted HERE as reviewable text and applied LATER by a human in a session
 * opened on that repository. That arrangement has one characteristic failure mode, and it is not a
 * technical one: text that was written without a checkout can quietly start to read as though it had
 * one. An `index` line appears. A sentence says the series applies cleanly. A header stops saying
 * where its facts came from. Nothing breaks, and a reviewer downstream believes a verified change is
 * in front of them when what is in front of them is a careful guess.
 *
 * So this module reads the four artifacts and holds them to the honesty they claim:
 *
 *   - each specification DECLARES its form, its target repository and branch, that it was authored
 *     from documented interfaces rather than a checkout, and what a human must verify afterwards;
 *   - no artifact carries a fabricated `index` line or a blob-hash pair, because neither can be
 *     derived from a description - only computed from bytes;
 *   - no artifact CLAIMS to apply cleanly, compile, or pass, except inside a sentence that denies it;
 *   - the properties each change must preserve in the other repository are stated, in particular that
 *     the transport swap keeps all three guards and that the family tier's egress set stays EMPTY -
 *     and a shape that would widen that tier is a finding, not a comment;
 *   - the README's apply order matches the file numbering, every change has a stated test delta
 *     against the stated baseline, and the baseline is labelled as read rather than observed.
 *
 * IT FAILS CLOSED. A missing artifact, an unreadable one, a header field with no value, a section
 * nobody declared, an out-of-order section, and a dotted token this module has never heard of are
 * findings rather than skips. Every code below has a negative test in patchSeries.test.ts that
 * mutates the real file and observes the code fire.
 *
 * ON THE DOTTED-TOKEN VOCABULARY. R24's hostname heuristic in `./composeTemplate` reads any dotted
 * lowercase token as a possible hostname, which is right for a topology template and wrong for the
 * only tracked artifacts in this repository that quote another language's source: `os.replace` and
 * `webhook.py` are not hostnames. Rather than loosen that heuristic - which would loosen it
 * everywhere - this module masks an EXPLICIT, ENUMERATED list of tokens
 * ({@link DECLARED_DOTTED_TOKENS}) before running the shared scan, and reports any dotted token NOT
 * on that list as {@link PATCH_FINDING_CODES} member `DOTTED_TOKEN_UNDECLARED`. The result is
 * stricter than the heuristic, not weaker: a hostname is not on the list, so it is reported twice -
 * once by the shared scan and once as an undeclared token - and a new dotted token cannot enter these
 * artifacts without a reviewer adding it here.
 *
 * NOTHING HERE IS EXECUTED, NOTHING HERE IS APPLIED, AND NOTHING HERE READS THE OTHER REPOSITORY.
 * The module opens four local files with `readFileSync` and parses strings.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { scanForParticulars, type ComposeFinding } from './composeTemplate.ts';

// ---------------------------------------------------------------------------------------------
// The series, and what each artifact claims about itself
// ---------------------------------------------------------------------------------------------

/** The three changes, in apply order. The numbering IS the order (README section two). */
export const PATCH_IDS = ['001', '002', '003'] as const;
export type PatchId = (typeof PATCH_IDS)[number];

/** Relative to `ops/nizamcore-patches/`. One spelling, shared by the entry point and the tests. */
export const PATCH_FILES: Readonly<Record<PatchId, string>> = {
  '001': '001-fastapi-wrapper.patch',
  '002': '002-dedup-per-bot.patch',
  '003': '003-signalbus-egress-target.patch',
};

export const PATCH_SUBDIR = 'nizamcore-patches';
export const README_FILE = 'README.md';

/** The repository these changes target, and the branch. Named once; asserted in every header. */
export const TARGET_REPOSITORY = 'nizamcore';
export const TARGET_BRANCH = 'main';

/**
 * The test count the finance repository's architecture note RECORDS for the target repository. It is
 * a figure read from a document, never observed by any session here, and the artifacts must say so.
 */
export const STATED_BASELINE_TESTS = 55;

/** Every long-running notice a template of this tier carries (steering section 2). */
const EXECUTION_NOTICE = 'NOTHING HERE IS EXECUTED BY AN AGENT';

// ---------------------------------------------------------------------------------------------
// The parsed shape of a specification
// ---------------------------------------------------------------------------------------------

/** A `== N. TITLE ==` block, with the lines under it up to the next one. */
export interface SpecSection {
  readonly number: number;
  readonly title: string;
  readonly lines: readonly string[];
  /** The body as one flowing line, so a sentence check is about the sentence and not the wrap. */
  readonly flow: string;
}

export interface Specification {
  readonly lines: readonly string[];
  /** The whole document as one flowing line. */
  readonly flow: string;
  /** Header label to value, continuation lines folded in. */
  readonly header: Readonly<Record<string, string>>;
  readonly sections: readonly SpecSection[];
  /** Everything after the header, where a declared target file must actually be discussed. */
  readonly body: string;
}

/** Thrown for anything outside the supported plain-text subset. */
export class SpecSubsetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpecSubsetError';
  }
}

const SECTION_HEADING = /^==\s+(\d+)\.\s+(.+?)\s+==$/;

/** One flowing line. Wrapping is where somebody's editor ran out of columns, not meaning. */
export function flowOf(text: string): string {
  return text.replace(/[*`]/g, '').replace(/\s+/g, ' ');
}

/**
 * The header labels every specification must carry, with a value. Order is not asserted - a reader
 * scans a header - but presence and non-emptiness are, because a label with nothing after it reads
 * as answered and is not.
 */
export const REQUIRED_HEADER_FIELDS: readonly string[] = [
  'FORM',
  'TARGET REPOSITORY',
  'TARGET BRANCH',
  'TARGET FILES',
  'SUBJECT',
  'AUTHORED BY',
  'AUTHORED FROM',
  'NOT VERIFIED',
];

/**
 * The five sections every specification must carry, in this order. A reviewer reads one shape three
 * times rather than three shapes once, and the order is the argument: why this is not a diff, what
 * must not change, the change, what a human must check, what the suite should do.
 */
export const REQUIRED_SECTIONS: readonly string[] = [
  'WHY THIS IS A SPECIFICATION AND NOT A DIFF',
  'WHAT MUST NOT CHANGE',
  'THE CHANGE, IN FULL',
  'WHAT A HUMAN MUST VERIFY AFTER APPLYING',
  'EXPECTED TEST DELTA',
];

/** The README's own sections, in order. */
export const README_REQUIRED_SECTIONS: readonly string[] = [
  'What these files are, and what they are not',
  'Apply order, and why this order',
  'How to apply and verify each one',
  'Expected test deltas',
  'Where this is applied',
  'What must never happen',
];

export function parseSpecification(source: string): Specification {
  const lines = source.split(/\r?\n/);
  if (source.includes('\t')) {
    throw new SpecSubsetError('the document contains a tab; indentation that renders differently in two viewers is indentation nobody can review');
  }

  const header: Record<string, string> = {};
  const sections: SpecSection[] = [];
  let current: { number: number; title: string; lines: string[] } | null = null;
  let label: string | null = null;
  let seenAnyLabel = false;
  let headerClosed = false;
  const bodyLines: string[] = [];

  const close = (): void => {
    if (current === null) return;
    sections.push({ ...current, flow: flowOf(current.lines.join('\n')) });
    current = null;
  };

  for (const raw of lines) {
    const heading = SECTION_HEADING.exec(raw);
    if (heading !== null) {
      headerClosed = true;
      label = null;
      close();
      current = { number: Number(heading[1] ?? '0'), title: (heading[2] ?? '').trim(), lines: [] };
      bodyLines.push(raw);
      continue;
    }
    if (headerClosed) {
      current?.lines.push(raw);
      bodyLines.push(raw);
      continue;
    }
    if (/^=+$/.test(raw.trim()) || raw.trim() === '') {
      label = null;
      continue;
    }
    const started = REQUIRED_HEADER_FIELDS.slice()
      .sort((a, b) => b.length - a.length)
      .find((candidate) => raw.startsWith(`${candidate} `));
    if (started !== undefined) {
      label = started;
      seenAnyLabel = true;
      header[label] = raw.slice(started.length).trim();
      continue;
    }
    if (label !== null && /^\s/.test(raw)) {
      header[label] = `${header[label] ?? ''} ${raw.trim()}`.trim();
      continue;
    }
    // The title line, before any label. Anything else in the header block is a line a reviewer
    // would read as a field and this audit would not: that ambiguity is refused rather than absorbed.
    if (!seenAnyLabel) continue;
    throw new SpecSubsetError(`"${raw.trim().slice(0, 60)}" appears in the header block but is neither a declared label nor a continuation of one`);
  }
  close();
  if (sections.length === 0) {
    throw new SpecSubsetError('the document declares no numbered section, so there is nothing for a reviewer to read in order');
  }

  return { lines, flow: flowOf(source), header, sections, body: bodyLines.join('\n') };
}

/** A `## ` section of the README, with its body. `### ` subsections belong to their parent. */
export interface ReadmeSection {
  readonly title: string;
  readonly flow: string;
  readonly lines: readonly string[];
}

export function parseReadme(source: string): readonly ReadmeSection[] {
  const sections: ReadmeSection[] = [];
  let current: { title: string; lines: string[] } | null = null;
  const close = (): void => {
    if (current === null) return;
    sections.push({ ...current, flow: flowOf(current.lines.join('\n')) });
    current = null;
  };
  for (const raw of source.split(/\r?\n/)) {
    if (raw.startsWith('## ')) {
      close();
      current = { title: raw.slice(3).trim(), lines: [] };
      continue;
    }
    current?.lines.push(raw);
  }
  close();
  return sections;
}

// ---------------------------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------------------------

export const PATCH_FINDING_CODES = [
  // fail-closed, shared
  'ARTIFACT_UNREADABLE',
  'ARTIFACT_OUTSIDE_SUBSET',
  'SERIES_NUMBERING_UNEXPECTED',
  'HEADER_FIELD_MISSING',
  'EXECUTION_NOTICE_MISSING',
  'SECTION_MISSING',
  'SECTION_UNEXPECTED',
  'SECTION_ORDER_UNEXPECTED',
  'SECTION_NUMBERING_UNEXPECTED',
  'TARGET_FILE_NOT_IN_BODY',
  'ENV_ASSIGNMENT_WITH_VALUE',
  // the honesty set - the reason this checker exists
  'FORM_NOT_DECLARED',
  'TARGET_REPOSITORY_UNEXPECTED',
  'TARGET_BRANCH_UNEXPECTED',
  'AUTHORSHIP_CAVEAT_MISSING',
  'PROVENANCE_MISSING',
  'NON_APPLICABILITY_CAVEAT_MISSING',
  'FABRICATED_INDEX_LINE',
  'APPLICABILITY_CLAIMED',
  'HUMAN_VERIFICATION_THIN',
  'TEST_DELTA_BASELINE_MISSING',
  'TEST_DELTA_NAMES_MISSING',
  // 001, the transport wrapper
  'WRAPPER_HANDLER_REWRITTEN',
  'WRAPPER_GUARD_NOT_PRESERVED',
  'HEALTH_ENDPOINT_MISSING',
  'READINESS_NOT_LIVENESS_MISSING',
  'FALLBACK_REMOVED',
  // 002, dedup per bot
  'DEDUP_KEY_NOT_A_PAIR',
  'DEDUP_DURABILITY_LOST',
  'DEDUP_DUPLICATE_IS_AN_ERROR',
  'DEDUP_RING_NOT_BOUNDED_PER_BOT',
  'DEDUP_COLLISION_TEST_MISSING',
  // 003, the egress target
  'EGRESS_TARGET_MISSING',
  'EGRESS_TIER_SCOPE_WRONG',
  'FAMILY_TIER_EMPTINESS_NOT_STATED',
  'FAMILY_TIER_WIDENED',
  'ENVELOPE_SHAPE_UNREFERENCED',
  // the README
  'README_SECTION_MISSING',
  'README_SECTION_UNEXPECTED',
  'README_SECTION_ORDER_UNEXPECTED',
  'README_PATCH_UNLISTED',
  'README_ORDER_MISMATCH',
  'README_ORDER_RATIONALE_MISSING',
  'README_VERIFY_COMMAND_MISSING',
  'README_TEST_DELTA_MISSING',
  'README_BASELINE_MISSING',
  'README_SEPARATE_SESSION_MISSING',
  // R24, re-reported from the ONE shared scan
  'PARTICULAR_URL_SCHEME',
  'PARTICULAR_ADDRESS_LITERAL',
  'PARTICULAR_HOSTNAME',
  'PARTICULAR_LONG_DIGIT_RUN',
  'PARTICULAR_CURRENCY_FIGURE',
  'PLACEHOLDER_MALFORMED',
  'PARTICULAR_SCAN_UNMAPPED',
  'DOTTED_TOKEN_UNDECLARED',
] as const;

export type PatchFindingCode = (typeof PATCH_FINDING_CODES)[number];

export interface PatchFinding {
  readonly code: PatchFindingCode;
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
 * Re-report the shared scan's findings under this checker's code set. R24 has ONE implementation, so
 * a code this checker has no equivalent for becomes `PARTICULAR_SCAN_UNMAPPED` rather than being
 * dropped: silently discarding a finding from a fail-closed scan turns a widened rule into a
 * narrowed one.
 */
export function mapParticularFindings(input: readonly ComposeFinding[], where: string): readonly PatchFinding[] {
  const out: PatchFinding[] = [];
  for (const finding of input) {
    if (SHARED_PARTICULAR_CODES.includes(finding.code)) {
      out.push({ code: finding.code as PatchFindingCode, detail: `${where}: ${finding.detail}` });
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
// The dotted-token vocabulary (see the note at the top of this file)
// ---------------------------------------------------------------------------------------------

/** The same token shape `./composeTemplate` reads as a possible hostname. */
const DOTTED_TOKEN = /(?<![A-Za-z0-9<>_-])([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)(?![A-Za-z0-9>])/g;

/**
 * Every dotted token these four artifacts may contain: a file name they name, or an attribute access
 * in the source they quote. Enumerated exactly rather than matched by pattern, so a token that is
 * neither - a hostname, say - cannot slip in behind a rule that was written to admit `os.replace`.
 * Adding an entry here is a review decision.
 */
export const DECLARED_DOTTED_TOKENS: readonly string[] = [
  // artifacts of this series and of this repository
  '001-fastapi-wrapper.patch',
  '002-dedup-per-bot.patch',
  '003-signalbus-egress-target.patch',
  'cross-repo-001.diff',
  'two-agent-vps.md',
  'NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md',
  'nizam-signalbus.envelope.schema.json',
  'updateDedupRepo.ts',
  // files in the target repository
  'asgi_app.py',
  'test_asgi_app.py',
  'webhook.py',
  'poller.py',
  'dedup.py',
  'test_dedup.py',
  'classifier.py',
  'test_classifier.py',
  'PRIVACY_CLASSIFICATION.json',
  // attribute access in the quoted source
  'os.environ.get',
  'request.headers.get',
  'configured.startswith',
  'pytest.fixture',
  'os.path.exists',
  'os.path.dirname',
  'os.path.basename',
  'os.path.join',
  'os.access',
  'os.replace',
  'os.fsync',
  'os.W_OK',
  'os.R_OK',
  'json.loads',
  'json.load',
  'json.dump',
  'hmac.compare_digest',
  'fastapi.testclient',
  'importlib.reload',
  'pytest.raises',
  'asgi_app.app',
  'app.post',
  'app.get',
  'client.post',
  'client.get',
  'monkeypatch.setenv',
  'monkeypatch.delenv',
  'request.body',
  'request.headers',
  'response.status_code',
  'first.status_code',
  'second.status_code',
  'first.claim',
  'second.claim',
  'state.claim',
  'state.max_seen',
  'dedup.claim',
  'dedup.max_seen',
  'handle.flush',
  'handle.fileno',
  'window.append',
  'entries.items',
  'raw.get',
  'path.write_text',
];

/** Every dotted token in `source` whose last label carries a letter. A section number is not one. */
export function dottedTokensIn(source: string): readonly string[] {
  const seen = new Set<string>();
  for (const match of source.matchAll(DOTTED_TOKEN)) {
    const token = match[1] ?? '';
    const labels = token.split('.');
    const last = labels[labels.length - 1] ?? '';
    if (!/[A-Za-z]/.test(last)) continue;
    seen.add(token);
  }
  return [...seen];
}

/**
 * Replace every DECLARED dotted token with a dotless stand-in, longest first so a shorter token
 * cannot consume part of a longer one. What remains dotted is either a hostname - which the shared
 * scan then reports - or a token nobody declared, which is reported here.
 */
export function maskDeclaredTokens(source: string): string {
  let out = source;
  for (const token of [...DECLARED_DOTTED_TOKENS].sort((a, b) => b.length - a.length)) {
    out = out.split(token).join('DECLAREDTOKEN');
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The honesty checks, as data
// ---------------------------------------------------------------------------------------------

/** A required phrase in a header field, and the code that fires when it is absent. */
interface HeaderRule {
  readonly field: string;
  readonly code: PatchFindingCode;
  readonly anchors: readonly RegExp[];
  readonly why: string;
}

const HEADER_RULES: readonly HeaderRule[] = [
  {
    field: 'FORM',
    code: 'FORM_NOT_DECLARED',
    anchors: [/CHANGE SPECIFICATION/i, /NOT an applicable unified diff/i],
    why: 'a reader who thinks this is a diff will try to apply it, and the failure will look like a broken file rather than a mislabelled one',
  },
  {
    field: 'AUTHORED BY',
    code: 'AUTHORSHIP_CAVEAT_MISSING',
    anchors: [/never/i, /cloned/i, /read/i],
    why: 'the whole weight of this series rests on it having been written without a checkout, and that has to be stated where a reviewer reads it first',
  },
  {
    field: 'AUTHORED FROM',
    code: 'PROVENANCE_MISSING',
    anchors: [/NIZAM_TWO_AGENT_VPS_ARCHITECTURE\.md/],
    why: 'a statement about another repository is only as good as the document it came from, so the document is named rather than gestured at',
  },
  {
    field: 'NOT VERIFIED',
    code: 'NON_APPLICABILITY_CAVEAT_MISSING',
    anchors: [/no verified context lines/i, /blob hash/i, /none were invented/i],
    why: 'without it, absent context reads as an oversight instead of as the consequence of a boundary that was respected',
  },
];

/** A required phrase in the whole document, keyed by which specification must carry it. */
interface ContentRule {
  readonly code: PatchFindingCode;
  readonly anchors: readonly RegExp[];
  readonly why: string;
}

const CONTENT_RULES: Readonly<Record<PatchId, readonly ContentRule[]>> = {
  '001': [
    {
      code: 'WRAPPER_HANDLER_REWRITTEN',
      anchors: [/handle_update is not rewritten/i],
      why: 'the proven part of the relay is the part that decides, and a wrapper that reimplements it is not a wrapper',
    },
    {
      code: 'WRAPPER_GUARD_NOT_PRESERVED',
      anchors: [/constant-time/i, /allowlist/i, /dedup/i],
      why: 'a transport swap that reaches the handler with a guard skipped is a regression that presents as an open door',
    },
    {
      code: 'HEALTH_ENDPOINT_MISSING',
      anchors: [/\/healthz/],
      why: 'task 8.1 asks for the endpoint by name, and the orchestrator has nothing to probe without it',
    },
    {
      code: 'READINESS_NOT_LIVENESS_MISSING',
      anchors: [/readiness, not liveness/i],
      why: 'a liveness probe suppresses the one automatic remedy the deployment has, most confidently at the worst moment',
    },
    {
      code: 'FALLBACK_REMOVED',
      anchors: [/poller\.py stays/i],
      why: 'the long-poll path is the documented degraded mode, and deleting it removes the fallback exactly when it becomes the only way in',
    },
  ],
  '002': [
    {
      code: 'DEDUP_KEY_NOT_A_PAIR',
      anchors: [/\(bot_id, update_id\)/],
      why: 'the pair IS the change; stated any other way it reads as a refinement rather than the correctness fix it is',
    },
    {
      code: 'DEDUP_DURABILITY_LOST',
      anchors: [/atomic replace/i, /os\.replace/],
      why: 'the existing module survives a crash because the write is a rename; a rewrite that writes in place trades that away for nothing',
    },
    {
      code: 'DEDUP_DUPLICATE_IS_AN_ERROR',
      anchors: [/A DUPLICATE STAYS A SUCCESS, NOT AN ERROR/i],
      why: 'raising on a duplicate earns another retry of the update just declined, so the guard manufactures the load it exists to shed',
    },
    {
      code: 'DEDUP_RING_NOT_BOUNDED_PER_BOT',
      anchors: [/THE BOUND IS PER BOT/i],
      why: 'one shared bound lets a chatty bot evict the quiet bot\u2019s window, which re-opens the replay gap for the quiet one',
    },
    {
      code: 'DEDUP_COLLISION_TEST_MISSING',
      anchors: [/test_two_bots_emitting_the_same_identifier_are_both_processed/],
      why: 'the collision is latent until a second bot exists, so the only thing that keeps the fix honest is a test that fails without it',
    },
  ],
  '003': [
    {
      code: 'EGRESS_TARGET_MISSING',
      anchors: [/signalbus/],
      why: 'task 8.3 adds exactly one target, and a specification that never names it specifies nothing',
    },
    {
      code: 'EGRESS_TIER_SCOPE_WRONG',
      anchors: [/money_safe/, /life_safe/, /and for nothing else/i],
      why: 'the bus is eligible for the two narrow tiers only; content in an existing tier reaches it by being reduced first, never by permission',
    },
    {
      code: 'FAMILY_TIER_EMPTINESS_NOT_STATED',
      anchors: [/THE FAMILY CLASSIFICATION KEEPS AN EMPTY EGRESS SET/i, /== set\(\)/, /<FAMILY_CLASSIFICATION>/],
      why: 'this is the one invariant the change is most likely to break quietly, so it is stated as a requirement and asserted at import',
    },
    {
      code: 'ENVELOPE_SHAPE_UNREFERENCED',
      anchors: [/consent_scope/, /120 characters/],
      why: 'a reviewer approving a new egress target needs to see what can travel through it',
    },
  ],
};

/**
 * The placeholder 003 carries in place of the family classification's key. The key itself is NOT
 * written in any artifact of this tier - contract 12 section 4.4.3 holds that no source, template,
 * fixture, eval case or runbook here names, counts, summarizes or points at that content, and
 * `src/server/signals/exclusion.test.ts` enforces it across `src/server/**` and `ops/**`. So the
 * specification names a placeholder and the human substitutes it by reading the row, which is the
 * verification step section 4 asks for anyway.
 */
export const FAMILY_CLASSIFICATION_PLACEHOLDER = '<FAMILY_CLASSIFICATION>';

/**
 * Shapes that would widen the classification whose egress set must stay empty. Detected as CODE
 * shapes rather than as prose, because prose about the family tier is exactly what this
 * specification is full of, and a prose-level ban would fire on its own argument.
 */
const FAMILY_WIDENING_SHAPES: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'an assignment to the family row', pattern: /FAMILY_CLASSIFICATION>"\]\s*=\s*[^=]/ },
  { label: 'a target inside the family row of the policy document', pattern: /"<FAMILY_CLASSIFICATION>"\s*:\s*\{[^}]*signalbus/ },
  { label: 'a non-empty egress list beside the family tier', pattern: /<FAMILY_CLASSIFICATION>\s+egress:\s*\[\s*[^\]\s]/ },
];

/** Phrases that assert an applicability nobody here can assert. */
const APPLICABILITY_PHRASES: readonly RegExp[] = [
  /applies cleanly/i,
  /applied cleanly/i,
  /verified against the target/i,
  /tested against the target/i,
];

/** Tokens that make an applicability phrase a denial rather than a claim. */
const NEGATION_TOKENS: readonly RegExp[] = [/\bno claim\b/i, /\bnobody\b/i, /\bnot\b/i, /\bnever\b/i, /\bneither\b/i];

/** A fabricated content address, anchored or inline. Neither can be derived from a description. */
const INDEX_LINE = /(?:^|\s)index\s+[0-9a-f]{7,40}\.\.[0-9a-f]{7,40}/im;

/** An assignment that puts a value beside a name. A placeholder or an injected reference is fine. */
const ENV_ASSIGNMENT = /^\s*([A-Z][A-Z0-9_]{2,})=(.*)$/;
const ALLOWED_ASSIGNED_VALUE = /^(?:|""|''|<[A-Z][A-Z0-9_]*>|\$\{[A-Za-z_][A-Za-z0-9_]*\})$/;

// ---------------------------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------------------------

export interface PatchSeriesAuditInput {
  /** Source per patch id. A missing entry is a finding, not a skip. */
  readonly sources: Readonly<Record<string, string>>;
  readonly readme: string | undefined;
  /** Why an artifact is absent, keyed by id or by {@link README_FILE}, when the caller knows. */
  readonly unreadable?: Readonly<Record<string, string>>;
}

/**
 * Audit the whole series. An empty array means every structural and honesty property the series
 * claims is present. Any finding is a failure; there is no severity ladder, because none of these
 * rules is advisory.
 */
export function auditPatchSeries(input: PatchSeriesAuditInput): readonly PatchFinding[] {
  const findings: PatchFinding[] = [];
  const note = (code: PatchFindingCode, detail: string): void => {
    findings.push({ code, detail });
  };

  const supplied = Object.keys(input.sources).sort();
  if (supplied.join(',') !== [...PATCH_IDS].join(',')) {
    note(
      'SERIES_NUMBERING_UNEXPECTED',
      `the series carries ${supplied.length === 0 ? 'nothing' : supplied.join(', ')}; it must be exactly ${[...PATCH_IDS].join(', ')}, because the README states the numbering IS the apply order and a gap or an extra file makes that statement false`,
    );
  }

  for (const id of PATCH_IDS) {
    const source = input.sources[id];
    if (source === undefined) {
      note('ARTIFACT_UNREADABLE', `${id}: ${input.unreadable?.[id] ?? 'no source was supplied, so nothing about it was checked'}`);
      continue;
    }
    auditOneSpecification(id, source, note);
  }

  if (input.readme === undefined) {
    note('ARTIFACT_UNREADABLE', `${README_FILE}: ${input.unreadable?.[README_FILE] ?? 'no source was supplied, so nothing about it was checked'}`);
  } else {
    auditReadme(input.readme, note);
  }

  return findings;
}

function auditParticulars(where: string, source: string, note: (code: PatchFindingCode, detail: string) => void): void {
  for (const finding of mapParticularFindings(scanForParticulars(maskDeclaredTokens(source)), where)) {
    note(finding.code, finding.detail);
  }
  for (const token of dottedTokensIn(maskDeclaredTokens(source))) {
    note(
      'DOTTED_TOKEN_UNDECLARED',
      `${where} contains the dotted token "${token}", which DECLARED_DOTTED_TOKENS does not list; a dotted token is either a file name, an attribute access somebody reviewed, or a hostname, and the third is the reason this list is enumerated rather than matched`,
    );
  }
}

function auditAssignments(where: string, lines: readonly string[], note: (code: PatchFindingCode, detail: string) => void): void {
  for (const raw of lines) {
    const assignment = ENV_ASSIGNMENT.exec(raw);
    if (assignment === null) continue;
    const value = (assignment[2] ?? '').trim();
    if (ALLOWED_ASSIGNED_VALUE.test(value)) continue;
    note(
      'ENV_ASSIGNMENT_WITH_VALUE',
      `${where} assigns a value to ${assignment[1] ?? ''}; a specification may NAME an environment entry so the operator knows which one, but writing it as an assignment with a value is how a value ends up in a tracked file (steering section 0b)`,
    );
  }
}

function auditApplicabilityClaims(where: string, flow: string, note: (code: PatchFindingCode, detail: string) => void): void {
  for (const sentence of flow.split(/(?<=[.!?])\s+/)) {
    for (const phrase of APPLICABILITY_PHRASES) {
      if (!phrase.test(sentence)) continue;
      if (NEGATION_TOKENS.some((negation) => negation.test(sentence))) continue;
      note(
        'APPLICABILITY_CLAIMED',
        `${where} asserts "${sentence.trim().slice(0, 90)}"; nobody here has applied this or run the target suite against it, so an unqualified claim of applicability is the one thing these files must never say`,
      );
    }
  }
}

function auditOneSpecification(id: PatchId, source: string, note: (code: PatchFindingCode, detail: string) => void): void {
  auditParticulars(id, source, note);

  let spec: Specification;
  try {
    spec = parseSpecification(source);
  } catch (e) {
    note('ARTIFACT_OUTSIDE_SUBSET', `${id}: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  auditAssignments(id, spec.lines, note);
  auditApplicabilityClaims(id, spec.flow, note);

  // --- the header ----------------------------------------------------------------------------
  for (const field of REQUIRED_HEADER_FIELDS) {
    const value = spec.header[field];
    if (value === undefined || value.trim() === '') {
      note('HEADER_FIELD_MISSING', `${id} has no ${field} value; a label with nothing after it reads as answered and is not`);
    }
  }
  for (const rule of HEADER_RULES) {
    const value = spec.header[rule.field] ?? '';
    for (const anchor of rule.anchors) {
      if (!anchor.test(value)) {
        note(rule.code, `${id}: ${rule.field} does not satisfy ${String(anchor)} - ${rule.why}`);
      }
    }
  }
  if ((spec.header['TARGET REPOSITORY'] ?? '').trim() !== TARGET_REPOSITORY) {
    note(
      'TARGET_REPOSITORY_UNEXPECTED',
      `${id} names "${(spec.header['TARGET REPOSITORY'] ?? '').trim()}" as its target repository; the series targets ${TARGET_REPOSITORY}, and a file applied to the wrong repository is worse than one nobody applied`,
    );
  }
  if ((spec.header['TARGET BRANCH'] ?? '').trim() !== TARGET_BRANCH) {
    note(
      'TARGET_BRANCH_UNEXPECTED',
      `${id} names "${(spec.header['TARGET BRANCH'] ?? '').trim()}" as its target branch; the target repository's default branch is ${TARGET_BRANCH}, and the two repositories deliberately differ on this`,
    );
  }
  // --- every declared target file is actually discussed ---------------------------------------
  for (const path of (spec.header['TARGET FILES'] ?? '').split(/\s+/)) {
    if (!path.includes('/') || !path.includes('.')) continue;
    if (!spec.body.includes(path)) {
      note(
        'TARGET_FILE_NOT_IN_BODY',
        `${id} declares ${path} as a target file, and then never mentions it below the header; a declared target nobody explains is a file somebody edits by guessing`,
      );
    }
  }

  // --- the sections, all of them, in order, numbered 1..n -------------------------------------
  const present = spec.sections.map((section) => section.title);
  for (const title of REQUIRED_SECTIONS) {
    if (!present.includes(title)) note('SECTION_MISSING', `${id} has no "${title}" section`);
  }
  for (const title of present) {
    if (!REQUIRED_SECTIONS.includes(title)) {
      note(
        'SECTION_UNEXPECTED',
        `${id} carries a "${title}" section this audit does not know about; an unrecognized section is a failure rather than a skip, because a reviewer reads one shape three times and an extra one is a shape nobody checked`,
      );
    }
  }
  const ordered = present.filter((title) => REQUIRED_SECTIONS.includes(title));
  const expected = REQUIRED_SECTIONS.filter((title) => present.includes(title));
  if (ordered.join(' | ') !== expected.join(' | ')) {
    note(
      'SECTION_ORDER_UNEXPECTED',
      `${id} orders its sections ${ordered.join(' -> ')}; the required order is ${REQUIRED_SECTIONS.join(' -> ')}, and the order is the argument`,
    );
  }
  const numbers = spec.sections.map((section) => section.number);
  if (numbers.join(',') !== numbers.map((_value, index) => index + 1).join(',')) {
    note(
      'SECTION_NUMBERING_UNEXPECTED',
      `${id} numbers its sections ${numbers.join(',')}; they must run 1..n in document order, because the sections are cross-referenced by number from the README and from each other`,
    );
  }

  // --- no fabricated content address ----------------------------------------------------------
  if (INDEX_LINE.test(source)) {
    note(
      'FABRICATED_INDEX_LINE',
      `${id} carries an index line naming a pair of blob hashes; a blob hash is a content address that can only be computed from bytes this session never read, so its presence means it was invented`,
    );
  }

  // --- the two sections whose emptiness would be invisible ------------------------------------
  const verification = spec.sections.find((section) => section.title === REQUIRED_SECTIONS[3]);
  if (verification !== undefined) {
    const items = verification.lines.filter((line) => /^\s{2,}\d+\.\s/.test(line)).length;
    if (items < 3) {
      note(
        'HUMAN_VERIFICATION_THIN',
        `${id} lists ${items} numbered verification items; a specification written without a checkout has more than two things a human must check, and a short list reads as confidence nobody earned`,
      );
    }
  }
  const delta = spec.sections.find((section) => section.title === REQUIRED_SECTIONS[4]);
  if (delta !== undefined) {
    if (!new RegExp(`\\b${STATED_BASELINE_TESTS}\\b`).test(delta.flow) || !/read from|not observed|did not observe/i.test(delta.flow)) {
      note(
        'TEST_DELTA_BASELINE_MISSING',
        `${id} does not state the ${STATED_BASELINE_TESTS}-test baseline AND label it as read from a document rather than observed here; an unlabelled baseline is a number a reader will treat as measured`,
      );
    }
    const named = new Set(delta.flow.match(/\btest_[a-z0-9_]+/g) ?? []);
    if (named.size < 3) {
      note(
        'TEST_DELTA_NAMES_MISSING',
        `${id} names ${named.size} added tests; a delta stated as a count only cannot be checked against what was actually added`,
      );
    }
  }

  // --- what this particular change must preserve ----------------------------------------------
  for (const rule of CONTENT_RULES[id]) {
    for (const anchor of rule.anchors) {
      if (!anchor.test(spec.flow)) {
        note(rule.code, `${id} does not satisfy ${String(anchor)} - ${rule.why}`);
      }
    }
  }
  if (id === '003') {
    for (const shape of FAMILY_WIDENING_SHAPES) {
      if (shape.pattern.test(source)) {
        note(
          'FAMILY_TIER_WIDENED',
          `${id} contains ${shape.label}; the family classification's egress set is empty and stays empty - family data is excluded from the deployment rather than filtered on the way out, and a filter is code that has to be right every time whereas an empty set is a property no code path can widen`,
        );
      }
    }
  }
}

/** The apply order the README states, read from its ordering section rather than assumed. */
export function statedApplyOrder(readmeSource: string): readonly string[] {
  const section = parseReadme(readmeSource).find((candidate) => candidate.title === README_REQUIRED_SECTIONS[1]);
  if (section === undefined) return [];
  const order: string[] = [];
  for (const match of section.flow.matchAll(/\b(00\d)\b/g)) {
    const id = match[1] ?? '';
    if (!order.includes(id)) order.push(id);
  }
  return order;
}

function auditReadme(source: string, note: (code: PatchFindingCode, detail: string) => void): void {
  auditParticulars(README_FILE, source, note);
  auditAssignments(README_FILE, source.split(/\r?\n/), note);
  const flow = flowOf(source);
  auditApplicabilityClaims(README_FILE, flow, note);

  if (!flow.includes(EXECUTION_NOTICE)) {
    note(
      'EXECUTION_NOTICE_MISSING',
      `${README_FILE} does not state up front that nothing in the series is executed by an agent; steering section 2 permits writing these files and forbids running them, and the notice is where a reader learns which of the two this is`,
    );
  }
  if (INDEX_LINE.test(source)) {
    note('FABRICATED_INDEX_LINE', `${README_FILE} carries an index line naming a pair of blob hashes, which can only be computed from bytes nobody here read`);
  }

  const sections = parseReadme(source);
  const present = sections.map((section) => section.title);
  for (const title of README_REQUIRED_SECTIONS) {
    if (!present.includes(title)) note('README_SECTION_MISSING', `${README_FILE} has no "${title}" section`);
  }
  for (const title of present) {
    if (!README_REQUIRED_SECTIONS.includes(title)) {
      note('README_SECTION_UNEXPECTED', `${README_FILE} carries a "${title}" section this audit does not know about`);
    }
  }
  const ordered = present.filter((title) => README_REQUIRED_SECTIONS.includes(title));
  const expected = README_REQUIRED_SECTIONS.filter((title) => present.includes(title));
  if (ordered.join(' | ') !== expected.join(' | ')) {
    note(
      'README_SECTION_ORDER_UNEXPECTED',
      `${README_FILE} orders its sections ${ordered.join(' -> ')}; the required order is ${README_REQUIRED_SECTIONS.join(' -> ')} - what the files are precedes how to apply them, and what must never happen closes`,
    );
  }

  for (const id of PATCH_IDS) {
    const file = PATCH_FILES[id];
    if (!source.includes(file)) {
      note('README_PATCH_UNLISTED', `${README_FILE} never names ${file}; a series member the README does not list is one nobody applies`);
    }
  }

  const order = statedApplyOrder(source);
  if (order.join(',') !== [...PATCH_IDS].join(',')) {
    note(
      'README_ORDER_MISMATCH',
      `${README_FILE} states the apply order as ${order.length === 0 ? 'nothing' : order.join(' -> ')}; the file numbering is ${[...PATCH_IDS].join(' -> ')}, and the README's own claim is that the numbering IS the order`,
    );
  }

  const rationale = sections.find((section) => section.title === README_REQUIRED_SECTIONS[1]);
  for (const id of PATCH_IDS) {
    const sentences = (rationale?.flow ?? '').split(/(?<=[.!?])\s+/).filter((sentence) => sentence.includes(id));
    if (!sentences.some((sentence) => /because|reason/i.test(sentence))) {
      note(
        'README_ORDER_RATIONALE_MISSING',
        `${README_FILE} gives no reason for where ${id} sits in the order; an order with no argument behind it is one somebody reorders to get a green suite faster`,
      );
    }
  }

  const applying = sections.find((section) => section.title === README_REQUIRED_SECTIONS[2]);
  for (const id of PATCH_IDS) {
    if (!(applying?.flow ?? '').includes(id)) {
      note('README_VERIFY_COMMAND_MISSING', `${README_FILE} gives no apply-and-verify block for ${id}`);
    }
  }
  if ((applying?.lines ?? []).filter((line) => /\*\*Verify:\*\*/.test(line)).length < PATCH_IDS.length) {
    note(
      'README_VERIFY_COMMAND_MISSING',
      `${README_FILE} carries fewer verification lines than there are changes; a command with no stated verification is a command whose outcome is assumed`,
    );
  }

  const deltas = sections.find((section) => section.title === README_REQUIRED_SECTIONS[3]);
  for (const id of PATCH_IDS) {
    if (!(deltas?.flow ?? '').includes(id)) {
      note('README_TEST_DELTA_MISSING', `${README_FILE} states no expected test delta for ${id}`);
    }
  }
  if (
    !new RegExp(`\\b${STATED_BASELINE_TESTS}\\b`).test(deltas?.flow ?? '') ||
    !/did not observe|not observed|read from/i.test(deltas?.flow ?? '')
  ) {
    note(
      'README_BASELINE_MISSING',
      `${README_FILE} does not state the ${STATED_BASELINE_TESTS}-test baseline AND label it as read from a document rather than observed here; every delta in the table is measured against it, so an unlabelled baseline makes three predictions look like three results`,
    );
  }

  const where = sections.find((section) => section.title === README_REQUIRED_SECTIONS[4]);
  const whereFlow = where?.flow ?? '';
  if (!/separate\s+Kiro\s+session/i.test(whereFlow) || !/other repository/i.test(whereFlow) || !/not from here/i.test(whereFlow)) {
    note(
      'README_SEPARATE_SESSION_MISSING',
      `${README_FILE} does not state plainly that applying happens in a separate session opened on the other repository and never from here; that boundary is the reason this series is text instead of commits`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// The file entry point
// ---------------------------------------------------------------------------------------------

/**
 * Audit the series in `directory`. An unreadable artifact is a finding, never a skip: the whole value
 * of this check is that it cannot pass by not running.
 */
export function auditPatchSeriesFiles(directory: string): readonly PatchFinding[] {
  const sources: Record<string, string> = {};
  const unreadable: Record<string, string> = {};
  const read = (file: string): string | undefined => {
    try {
      return readFileSync(join(directory, file), 'utf8');
    } catch {
      return undefined;
    }
  };
  for (const id of PATCH_IDS) {
    const text = read(PATCH_FILES[id]);
    if (text === undefined) {
      unreadable[id] = `${join(directory, PATCH_FILES[id])} could not be read`;
      continue;
    }
    sources[id] = text;
  }
  const readme = read(README_FILE);
  if (readme === undefined) unreadable[README_FILE] = `${join(directory, README_FILE)} could not be read`;
  return auditPatchSeries({ sources, readme, unreadable });
}
