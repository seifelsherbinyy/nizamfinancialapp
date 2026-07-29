#!/usr/bin/env node
/**
 * Acceptance criterion seven: no floating point money.
 * Owner: build tooling.
 * Rule one: parseFloat and toFixed are banned outside the money core.
 * Rule two: a decimal literal may not be assigned to a money bearing field.
 */
import { walk, read, verdict } from "./_util.mjs";
const MONEY_CORE = "src/lib/money/";
const BANNED = [/\bparseFloat\s*\(/, /\bNumber\.parseFloat\s*\(/, /\.toFixed\s*\(/];
const MONEY_FIELDS = /\b(amount|outflow|inflow|assigned|available|balance|carryIn|activity|target|limit|milliunits)\b\s*[:=]\s*-?\d+\.\d+/;
// A line explicitly marked as an intentional invalid fixture is a negative test that
// PROVES the validator rejects a float. Such a line is exempt.
const FAIL_FIXTURE = /(must fail|must be integer|float\b|invalid|rejects?|should throw)/i;
const findings = [];
const files = walk("src", [".ts", ".tsx"]);
for (const f of files) {
  const inCore = f.includes(MONEY_CORE);
  const isTest = /\.test\.tsx?$/.test(f);
  const lines = read(f).split("\n");
  lines.forEach((line, i) => {
    const at = f + ":" + (i + 1);
    if (line.trim().startsWith("*") || line.trim().startsWith("//")) return;
    if (!inCore) for (const b of BANNED) if (b.test(line)) findings.push(at + " uses a floating point conversion outside the money core");
    if (MONEY_FIELDS.test(line) && !(isTest && FAIL_FIXTURE.test(line))) findings.push(at + " assigns a decimal literal to a money bearing field" + (isTest ? ", including test fixtures" : ""));
  });
}
verdict("money stays integral outside the money core", findings, ["scanned " + files.length + " source files, money core exempt for its own parsing boundary"]);
