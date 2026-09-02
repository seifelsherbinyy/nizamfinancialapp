#!/usr/bin/env node
/**
 * Acceptance criterion seventeen: one command runs every check in order and
 * fails loudly on the first failure.
 * Owner: build tooling. Pass --all to run every check and report a full table.
 *
 * ORDER IS A DEPENDENCY, NOT A PREFERENCE. Three checks read the built output, and the build is
 * itself a check. A dist reader placed before the build does not report a weaker verdict, it reports
 * a CONFUSING one: `ingest-isolation` fails closed on a missing dist by design, so a fresh checkout
 * that had never been built failed its bundle-isolation check with a message about dist rather than
 * about isolation. Rather than leave that to comment discipline, every check may declare what it
 * `produces` and what it `needs`, and the preflight below refuses to run at all unless every need is
 * met by an EARLIER check. It also refuses a `produces` nobody needs, so the declarations cannot rot
 * into decoration. This changes no check's own semantics and relaxes nothing: `ingest-isolation`
 * still fails closed on a missing dist, and now it is never asked to run without one.
 */
import { spawnSync } from "node:child_process";

const CONTINUE = process.argv.includes("--all");
const node = process.execPath;
const CHECKS = [
  { id: "AC16", label: "toolchain pin, lockfile and launch path", cmd: [node, ["scripts/verify/toolchain-pin.mjs"]] },
  { id: "AC10", label: "source files declare their contract and phase", cmd: [node, ["scripts/verify/headers.mjs"]] },
  { id: "AC01", label: "no placeholders remain in src", cmd: [node, ["scripts/verify/placeholders.mjs"]] },
  { id: "AC07", label: "money stays integral", cmd: [node, ["scripts/verify/money-invariant.mjs"]] },
  { id: "AC19", label: "protected repository invariants are fail closed", cmd: [node, ["scripts/verify/protected-invariants.mjs"]] },
  { id: "AC08", label: "drive scope is per file only", cmd: [node, ["scripts/verify/drive-scope.mjs"]] },
  { id: "AC09", label: "no secrets or real ledgers tracked", cmd: [node, ["scripts/verify/secret-scan.mjs"]] },
  { id: "AC11", label: "no organization specific terms", cmd: [node, ["scripts/verify/generic-only.mjs"]] },
  { id: "AC18", label: "no deployment particular in ops or any fixture", cmd: [node, ["scripts/verify/no-deployment-particular.mjs"]] },
  { id: "AC02", label: "typescript reports zero errors", cmd: ["npm", ["run", "typecheck"]] },
  { id: "AC03", label: "linter is clean at zero warnings", cmd: ["npm", ["run", "lint"]] },
  { id: "AC04", label: "test suite passes and meets its size floor", cmd: [node, ["scripts/verify/testcount.mjs", "--min", "2301"]] },
  { id: "AC13", label: "verification ledger is intact and covering", cmd: [node, ["scripts/loop/verify-ledger.mjs"]] },
  { id: "LOOP", label: "loop refusal paths hold", cmd: [node, ["--test", "scripts/loop/ledger.test.mjs"]] },
  { id: "AC05", label: "production build emits a static application", cmd: ["npm", ["run", "build"]], produces: ["dist"] },
  { id: "AC05b", label: "built output shape is valid", cmd: [node, ["scripts/verify/dist.mjs"]], needs: ["dist"] },
  { id: "AC06", label: "built output has no remote asset reference", cmd: [node, ["scripts/verify/no-remote-refs.mjs", "dist"]], needs: ["dist"] },
  { id: "AC08b", label: "ingestion tooling and server tier stay isolated", cmd: [node, ["scripts/verify/ingest-isolation.mjs"]], needs: ["dist"] },
  { id: "AC12", label: "contract index and build log agree", cmd: [node, ["scripts/verify/contract-ledger.mjs"]] },
  { id: "AC14", label: "working tree is clean", cmd: [node, ["scripts/verify/clean-tree.mjs"]] },
  { id: "AC15", label: "repository is push ready and unpushed", cmd: [node, ["scripts/verify/push-ready.mjs"]] },
];

/**
 * Preflight: the declared dependencies are consistent with the declared order. This runs before any
 * check is spawned, because a harness that discovers its own ordering bug halfway through has
 * already reported a misleading failure.
 */
const ordering = [];
const produced = new Set();
for (const c of CHECKS) {
  for (const need of c.needs ?? []) {
    if (!produced.has(need)) {
      ordering.push(c.id + ' needs "' + need + '" but no earlier check produces it; move it after the check that does');
    }
  }
  for (const artifact of c.produces ?? []) produced.add(artifact);
}
const needed = new Set(CHECKS.flatMap((c) => c.needs ?? []));
for (const c of CHECKS) {
  for (const artifact of c.produces ?? []) {
    if (!needed.has(artifact)) {
      ordering.push(c.id + ' declares it produces "' + artifact + '" but no check needs it; a declaration nobody reads is decoration');
    }
  }
}
if (ordering.length) {
  console.error("HARNESS ORDER INVALID: the check list contradicts its own declared dependencies.");
  for (const finding of ordering) console.error("  - " + finding);
  process.exit(1);
}

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
