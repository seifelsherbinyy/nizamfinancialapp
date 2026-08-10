/**
 * NIZAM - PFOS benchmark harness (M2): eval-set integrity + sanitization audit.
 * Owning contract: PFOS contract 09 (OpenRouter Phase 1 - Benchmark Calibration): the eval set must
 *   be SANITIZED, and every case must define expected structured output, hard safety constraints,
 *   allowable variation, and severity.
 * Build phase: PFOS Stage 6 (two-agent VPS tier), phase 6.1 - complete + verify the eval set.
 * Depends on: benchmark.types, dataset (amount rendering), src/lib/money (integer milliunits).
 *
 * OFFLINE ONLY. No network, no model, no key. This module mechanically enforces steering §0b for the
 * benchmark fixtures: the repository is PUBLIC, so a case may never carry a deployment particular
 * (URL, domain, IP, opaque Drive-style identifier, long numeric identifier such as a Telegram user id
 * or a full account number, an address handle, or an age public key) and may never be long enough to
 * be a journal excerpt. Forbidden tokens are assembled FROM FRAGMENTS so this file neither matches
 * itself nor trips the other repository scanners.
 */
import { assertMoney } from '@/lib/money/money';
import {
  type BenchmarkCase,
  type BenchmarkCategory,
  type ExpectedAnswer,
  CATEGORY_TIER,
  SEVERITIES,
} from './benchmark.types.ts';
import { egpAmountText } from './dataset.ts';

// ---- pinned limits (steering §0b proxies; changing one must break a test) ---------------------

/** A case is one event or one instruction. Anything longer is journal-length prose. */
export const MAX_CASE_INPUT_CHARS = 400;
/** A case input is at most a prompt plus an A/B pair (the dedup shape). */
export const MAX_CASE_INPUT_LINES = 3;
/** A run this long from the opaque-identifier alphabet is a Drive-style id, not prose. */
export const MIN_OPAQUE_ID_RUN = 28;
/** Longest legitimate digit run: a 4-digit masked tail, a year, a grouped amount triple. */
export const MAX_DIGIT_RUN = 6;

/** Categories where a fabricated field is an automatic failure, so severity must be P0. */
export const P0_CATEGORIES: BenchmarkCategory[] = [
  'sms_extraction',
  'multilingual',
  'purchase_decision',
  'adversarial',
];

/** The only `expected.kind` each category may carry. */
const ALLOWED_KINDS: Record<BenchmarkCategory, ExpectedAnswer['kind'][]> = {
  sms_extraction: ['extraction'],
  classification: ['label'],
  dedup: ['boolean'],
  safe_to_spend_explanation: ['explanation'],
  purchase_decision: ['explanation'],
  forecast: ['explanation'],
  tool_call: ['tool_call'],
  multilingual: ['extraction'],
  adversarial: ['refusal'],
};

// ---- forbidden-token scanners, assembled from fragments ---------------------------------------

const TLDS = ['co' + 'm', 'ne' + 't', 'or' + 'g', 'i' + 'o', 'de' + 'v', 'a' + 'i', 'e' + 'g'];

const FORBIDDEN: { gate: string; re: RegExp; why: string }[] = [
  {
    gate: 'no_url_scheme',
    re: new RegExp('h' + 't' + 'tps?' + ':' + '\\/\\/', 'i'),
    why: 'a request scheme is a deployment particular',
  },
  {
    gate: 'no_domain',
    re: new RegExp('[a-z0-9][a-z0-9-]*\\.(?:' + TLDS.join('|') + ')(?![a-z0-9])', 'i'),
    why: 'a bare domain is a deployment particular',
  },
  {
    gate: 'no_ip_address',
    re: /(?:^|[^\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/,
    why: 'a dotted-quad address is a deployment particular',
  },
  {
    gate: 'no_address_handle',
    re: new RegExp('[A-Za-z0-9._%+-]+' + '@' + '[A-Za-z0-9-]', 'i'),
    why: 'an address or bot handle is a deployment particular',
  },
  {
    gate: 'no_opaque_identifier',
    re: new RegExp('[A-Za-z0-9_-]{' + String(MIN_OPAQUE_ID_RUN) + ',}'),
    why: 'a long opaque token looks like a Drive file or folder identifier',
  },
  {
    gate: 'no_long_numeric_identifier',
    re: new RegExp('\\d{' + String(MAX_DIGIT_RUN + 1) + ',}'),
    why: 'a long digit run looks like a chat user id or a full account number',
  },
  {
    gate: 'no_public_key',
    re: new RegExp('\\b' + 'ag' + 'e' + '1' + '[0-9a-z]{16,}\\b', 'i'),
    why: 'a recipient public key is a deployment particular',
  },
];

/** One integrity failure on one case. */
export interface IntegrityProblem {
  caseId: string;
  gate: string;
  detail: string;
}

/** Every gate this module enforces, in evaluation order. */
export const INTEGRITY_GATES = [
  ...FORBIDDEN.map((f) => f.gate),
  'numeric_fields_are_integers',
  'input_within_length_limit',
  'input_within_line_limit',
  'has_safety_constraints',
  'has_allowable_variation',
  'valid_severity',
  'tier_matches_category',
  'expected_kind_matches_category',
  'p0_category_severity',
  'amount_is_integer_milliunits',
  'amount_text_matches_expected',
  'account_is_masked',
] as const;

function scanText(caseId: string, text: string): IntegrityProblem[] {
  const out: IntegrityProblem[] = [];
  for (const f of FORBIDDEN) {
    const m = f.re.exec(text);
    if (m) {
      out.push({ caseId, gate: f.gate, detail: `${f.why}: ${JSON.stringify(m[0].slice(0, 48))}` });
    }
  }
  return out;
}

/**
 * Walk a case and collect every string and every number it carries, at any depth. Strings are what
 * can smuggle a deployment particular, so they are scanned; numbers are separately constrained to
 * safe integers, because a milliunit amount is legitimately a long digit run and must not be
 * mistaken for an identifier.
 */
function collect(value: unknown, strings: string[], numbers: number[]): void {
  if (typeof value === 'string') {
    strings.push(value);
    return;
  }
  if (typeof value === 'number') {
    numbers.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collect(v, strings, numbers);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) collect(v, strings, numbers);
  }
}

/** Audit one case: sanitization, structural completeness, and money integrity. */
export function auditCase(c: BenchmarkCase): IntegrityProblem[] {
  const id = c.id;
  const problems: IntegrityProblem[] = [];

  // Sanitization scans EVERY string in the case, not just the input, so an expected value cannot
  // smuggle a particular past the gate.
  const strings: string[] = [];
  const numbers: number[] = [];
  collect(c, strings, numbers);
  for (const s of strings) problems.push(...scanText(id, s));
  for (const n of numbers) {
    if (!Number.isSafeInteger(n)) {
      problems.push({
        caseId: id,
        gate: 'numeric_fields_are_integers',
        detail: `numeric field ${n} is not a safe integer; a case may not carry a float`,
      });
    }
  }

  if (c.input.length > MAX_CASE_INPUT_CHARS) {
    problems.push({
      caseId: id,
      gate: 'input_within_length_limit',
      detail: `input is ${c.input.length} chars, over the ${MAX_CASE_INPUT_CHARS} limit (journal-length prose)`,
    });
  }
  const lines = c.input.split('\n').length;
  if (lines > MAX_CASE_INPUT_LINES) {
    problems.push({
      caseId: id,
      gate: 'input_within_line_limit',
      detail: `input has ${lines} lines, over the ${MAX_CASE_INPUT_LINES} limit`,
    });
  }

  // Contract 09: every case defines hard safety constraints, allowable variation, and severity.
  if (c.safetyConstraints.length === 0 || c.safetyConstraints.some((s) => s.trim() === '')) {
    problems.push({
      caseId: id,
      gate: 'has_safety_constraints',
      detail: 'case must declare at least one non-empty hard safety constraint',
    });
  }
  if (c.allowableVariation.trim() === '') {
    problems.push({
      caseId: id,
      gate: 'has_allowable_variation',
      detail: 'case must declare its allowable variation',
    });
  }
  if (!(SEVERITIES as readonly string[]).includes(c.severity)) {
    problems.push({ caseId: id, gate: 'valid_severity', detail: `unknown severity ${c.severity}` });
  }
  if (c.tier !== CATEGORY_TIER[c.category]) {
    problems.push({
      caseId: id,
      gate: 'tier_matches_category',
      detail: `tier ${c.tier} does not match ${c.category} tier ${CATEGORY_TIER[c.category]}`,
    });
  }
  const allowed = ALLOWED_KINDS[c.category];
  if (!allowed.includes(c.expected.kind)) {
    problems.push({
      caseId: id,
      gate: 'expected_kind_matches_category',
      detail: `${c.category} may not expect ${c.expected.kind} (allowed: ${allowed.join(', ')})`,
    });
  }
  if (P0_CATEGORIES.includes(c.category) && c.severity !== 'P0') {
    problems.push({
      caseId: id,
      gate: 'p0_category_severity',
      detail: `${c.category} is fabrication-critical and must be P0, got ${c.severity}`,
    });
  }

  if (c.expected.kind === 'extraction') {
    const amount = c.expected.amountMilli;
    let integral = true;
    try {
      assertMoney(amount, `${id} amountMilli`);
    } catch {
      integral = false;
    }
    if (!integral || amount <= 0 || amount % 10 !== 0) {
      problems.push({
        caseId: id,
        gate: 'amount_is_integer_milliunits',
        detail: `amountMilli ${amount} must be a positive integer count of milliunits, piastre-clean (multiple of 10)`,
      });
    } else if (!c.input.includes(egpAmountText(amount))) {
      // The figure in the case text must be derived from the case's own expected amount. A pasted
      // real message would disagree with its expected value here.
      problems.push({
        caseId: id,
        gate: 'amount_text_matches_expected',
        detail: `input does not contain the rendered expected amount ${egpAmountText(amount)}`,
      });
    }
    if (!/^\*{4}\d{4}$/.test(c.expected.account)) {
      problems.push({
        caseId: id,
        gate: 'account_is_masked',
        detail: `account ${c.expected.account} must be a masked four-digit tail`,
      });
    }
  }

  return problems;
}

/** Audit the whole eval set. Fails closed: any problem makes the set unusable. */
export function auditEvalSet(cases: BenchmarkCase[]): { ok: boolean; problems: IntegrityProblem[] } {
  const problems = cases.flatMap(auditCase);
  return { ok: problems.length === 0, problems };
}

/** Case counts by severity (reporting aid; contract 09 fixes no distribution). */
export function countBySeverity(cases: BenchmarkCase[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of SEVERITIES) out[s] = 0;
  for (const c of cases) out[c.severity] = (out[c.severity] ?? 0) + 1;
  return out;
}

/** Case counts by routing tier (reporting aid). */
export function countByTier(cases: BenchmarkCase[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cases) out[c.tier] = (out[c.tier] ?? 0) + 1;
  return out;
}
