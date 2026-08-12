#!/usr/bin/env node
/**
 * Parses the acceptance harness output into a structured reading.
 * Owner: build tooling. Contract: PFOS build loop. Phase: build loop.
 *
 * It lives in its own module for one reason: it must be testable against a captured fixture.
 * The first version of this parser trimmed each line before matching, which destroyed the only
 * signal separating a check verdict from a check's own nested output. scripts/verify/all.mjs
 * prints verdicts at column zero and indents every nested tail line by six spaces, so the
 * anchor IS the indentation. Trimming turned "FAIL repository release state ..." from a
 * check's detail line into a phantom failing check named "repository", and the failing set
 * then reported four entries for two real failures.
 */

/** A verdict line: PASS or FAIL at column zero, then the check id, then the label. */
const VERDICT = /^(PASS|FAIL) (\S+)\s+(\S.*)$/;
const TALLY = /verification harness:\s*(\d+)\s+of\s+(\d+)/;

/**
 * @param {string} text combined stdout and stderr of `npm run verify:all -- --all`
 * @returns {{passed:number,total:number,failing:string[],passing:string[],measured:boolean}}
 */
export function parseHarnessOutput(text) {
  const passing = [];
  const failing = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/\r$/, "");
    if (/^\s/.test(line)) continue;            // indented: a check's own detail, never a verdict
    const m = VERDICT.exec(line);
    if (!m) continue;
    (m[1] === "FAIL" ? failing : passing).push(m[2]);
  }
  const t = TALLY.exec(String(text ?? ""));
  const uniq = (a) => [...new Set(a)].sort();
  return {
    passed: t ? Number(t[1]) : passing.length,
    total: t ? Number(t[2]) : passing.length + failing.length,
    failing: uniq(failing),
    passing: uniq(passing),
    measured: Boolean(t),
  };
}
