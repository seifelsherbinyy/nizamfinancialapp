#!/usr/bin/env node
/**
 * Acceptance criterion sixteen: a fresh clone reproduces the toolchain, AND the runtime it pins can
 * actually start what the images run. Owner: build tooling.
 *
 * The second half arrived with finding **F20** (spec 06 task 10.23). This check already owned the
 * claim "this repository runs on the runtime it pins" - it reads `.nvmrc`, compares it with the
 * runtime executing it, and fails if they disagree. F20 was that claim's missing half: the pin was
 * correct, the tests were green, and bare `node` still could not start a single entrypoint, because
 * every relative import was extensionless and Node performs no extension search. So the launch
 * assertion lives here rather than as a twenty-first check, and `launch-path.mjs` holds it - see that
 * file's header for what it asserts and how it proves it is not vacuous.
 */
import { existsSync } from "node:fs";
import { read, verdict } from "./_util.mjs";
import { launchPathFindings } from "./launch-path.mjs";
const SUPPORTED = ["22", "24", "26"];
const findings = [];
if (!existsSync(".nvmrc")) findings.push(".nvmrc is missing, so a clone has no runtime pin");
else {
  const pin = read(".nvmrc").trim().replace(/^v/, "").split(".")[0];
  const running = process.version.replace(/^v/, "").split(".")[0];
  console.log("pinned runtime:  " + pin);
  console.log("running runtime: " + running);
  if (!SUPPORTED.includes(pin)) findings.push("the pinned runtime major " + pin + " is not a currently supported long term support line, supported values are " + SUPPORTED.join(", "));
  if (pin !== running) findings.push("the pin says " + pin + " but this run used " + running + ", so the gates were not verified on the pinned runtime");
}
if (!existsSync("package-lock.json")) findings.push("package-lock.json is missing, so installs are not reproducible");
else {
  const lock = JSON.parse(read("package-lock.json"));
  console.log("lockfile version: " + lock.lockfileVersion);
  if (Number(lock.lockfileVersion) < 3) findings.push("lockfile version " + lock.lockfileVersion + " is older than version three");
}
const pkg = JSON.parse(read("package.json"));
const floating = Object.entries({ ...(pkg.dependencies ?? {}) }).filter(([, v]) => /^[\^~]/.test(String(v)));
if (floating.length) findings.push("runtime dependencies use a floating range: " + floating.map(([k, v]) => k + " " + v).join(", "));

// The launch path: the pinned runtime starts every entrypoint the three owned images invoke.
const launch = launchPathFindings();
launch.notes.forEach((n) => console.log(n));
findings.push(...launch.findings);

verdict("toolchain pin and lockfile make a fresh clone reproducible, and the pinned runtime starts every entrypoint", findings);
