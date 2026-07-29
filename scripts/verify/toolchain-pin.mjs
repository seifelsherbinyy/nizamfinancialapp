#!/usr/bin/env node
/** Acceptance criterion sixteen: a fresh clone reproduces the toolchain. Owner: build tooling. */
import { existsSync } from "node:fs";
import { read, verdict } from "./_util.mjs";
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
verdict("toolchain pin and lockfile make a fresh clone reproducible", findings);
