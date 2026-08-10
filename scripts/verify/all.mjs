#!/usr/bin/env node
/**
 * Acceptance criterion seventeen: one command runs every check in order and
 * fails loudly on the first failure.
 * Owner: build tooling. Pass --all to run every check and report a full table.
 */
import { spawnSync } from "node:child_process";

const CONTINUE = process.argv.includes("--all");
const node = process.execPath;
const CHECKS = [
  { id: "AC16", label: "toolchain pin and lockfile", cmd: [node, ["scripts/verify/toolchain-pin.mjs"]] },
  { id: "AC10", label: "source files declare their contract and phase", cmd: [node, ["scripts/verify/headers.mjs"]] },
  { id: "AC01", label: "no placeholders remain in src", cmd: [node, ["scripts/verify/placeholders.mjs"]] },
  { id: "AC07", label: "money stays integral", cmd: [node, ["scripts/verify/money-invariant.mjs"]] },
  { id: "AC08", label: "drive scope is per file only", cmd: [node, ["scripts/verify/drive-scope.mjs"]] },
  { id: "AC08b", label: "ingestion tooling and server tier stay isolated", cmd: [node, ["scripts/verify/ingest-isolation.mjs"]] },
  { id: "AC09", label: "no secrets or real ledgers tracked", cmd: [node, ["scripts/verify/secret-scan.mjs"]] },
  { id: "AC11", label: "no organization specific terms", cmd: [node, ["scripts/verify/generic-only.mjs"]] },
  { id: "AC18", label: "no deployment particular in ops or any fixture", cmd: [node, ["scripts/verify/no-deployment-particular.mjs"]] },
  { id: "AC02", label: "typescript reports zero errors", cmd: ["npm", ["run", "typecheck"]] },
  { id: "AC03", label: "linter is clean at zero warnings", cmd: ["npm", ["run", "lint"]] },
  { id: "AC04", label: "test suite passes and meets its size floor", cmd: [node, ["scripts/verify/testcount.mjs", "--min", "1982"]] },
  { id: "AC13", label: "verification ledger is intact and covering", cmd: [node, ["scripts/loop/verify-ledger.mjs"]] },
  { id: "LOOP", label: "loop refusal paths hold", cmd: [node, ["--test", "scripts/loop/ledger.test.mjs"]] },
  { id: "AC05", label: "production build emits a static application", cmd: ["npm", ["run", "build"]] },
  { id: "AC05b", label: "built output shape is valid", cmd: [node, ["scripts/verify/dist.mjs"]] },
  { id: "AC06", label: "built output has no remote asset reference", cmd: [node, ["scripts/verify/no-remote-refs.mjs", "dist"]] },
  { id: "AC12", label: "contract index and build log agree", cmd: [node, ["scripts/verify/contract-ledger.mjs"]] },
  { id: "AC14", label: "working tree is clean", cmd: [node, ["scripts/verify/clean-tree.mjs"]] },
  { id: "AC15", label: "repository is push ready and unpushed", cmd: [node, ["scripts/verify/push-ready.mjs"]] },
];

const results = [];
let firstFailure = null;
for (const c of CHECKS) {
  const [bin, args] = c.cmd;
  const r = spawnSync(bin, args, { encoding: "utf8", shell: bin === "npm", stdio: ["ignore", "pipe", "pipe"] });
  const ok = r.status === 0;
  const tail = ((r.stdout ?? "") + "\n" + (r.stderr ?? "")).split("\n").filter((l) => l.trim()).slice(-6).join("\n      ");
  results.push({ ...c, ok, status: r.status, tail });
  console.log((ok ? "PASS " : "FAIL ") + c.id.padEnd(6) + c.label);
  if (!ok) {
    console.log("      " + tail);
    if (!firstFailure) firstFailure = c;
    if (!CONTINUE) break;
  }
}

const passed = results.filter((r) => r.ok).length;
console.log("");
console.log("verification harness: " + passed + " of " + results.length + " executed checks passed" + (CONTINUE ? "" : ", stop on first failure mode"));
if (firstFailure) {
  console.error("");
  console.error("HARNESS FAILED at " + firstFailure.id + ": " + firstFailure.label);
  console.error("Re run that single check for detail, or pass --all to see every failure at once.");
  process.exit(1);
}
console.log("HARNESS PASSED: every acceptance check is green.");
