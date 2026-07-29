#!/usr/bin/env node
/**
 * Acceptance criterion four: the suite has grown to cover the new modules.
 * Owner: build tooling. Runs the pinned local test runner and reads its machine report.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { arg } from "./_util.mjs";
const min = Number(arg("min", "110"));
const outFile = ".loop/tmp/test-results.json";
mkdirSync(".loop/tmp", { recursive: true });
const entry = ["node_modules/vitest/vitest.mjs", "node_modules/vitest/dist/cli.js"].find((p) => existsSync(p));
if (!entry) {
  console.error("FAIL the pinned test runner was not found under node_modules. Run npm ci.");
  process.exit(1);
}
const r = spawnSync(process.execPath, [entry, "run", "--reporter=json", "--outputFile=" + outFile], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
if (!existsSync(outFile)) {
  console.error("FAIL the test runner produced no machine report");
  console.error((r.stderr ?? "").split("\n").slice(-12).join("\n"));
  process.exit(1);
}
const j = JSON.parse(readFileSync(outFile, "utf8"));
const total = j.numTotalTests ?? 0;
const passed = j.numPassedTests ?? 0;
const failed = j.numFailedTests ?? 0;
console.log("test files: " + (j.numTotalTestSuites ?? "unknown"));
console.log("tests:      " + total + " total, " + passed + " passed, " + failed + " failed");
console.log("minimum:    " + min);
if (failed > 0) {
  console.error("FAIL " + failed + " test(s) are failing");
  process.exit(1);
}
if (passed < min) {
  console.error("FAIL the suite has " + passed + " passing tests, below the minimum of " + min);
  process.exit(1);
}
console.log("PASS suite size and health are within contract");
