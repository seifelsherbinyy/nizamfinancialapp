#!/usr/bin/env node
/** Acceptance criterion twelve: contract status and the build log agree with each other. Owner: build tooling. */
import { existsSync } from "node:fs";
import { read, verdict } from "./_util.mjs";
const INDEX = "contracts/_CONTRACT_INDEX.md";
const LOG = "contracts/_BUILD_LOG.md";
const findings = [];
if (!existsSync(INDEX)) findings.push(INDEX + " is missing");
if (!existsSync(LOG)) findings.push(LOG + " is missing");
let done = [], notDone = [], phases = [];
if (existsSync(INDEX)) {
  const rows = [...read(INDEX).matchAll(/^\|\s*(\d)\s*\|([^|]+)\|[^|]*\|\s*(\[[ x]\][^|]*)\|/gim)];
  if (rows.length !== 5) findings.push("expected five contract rows in the index, found " + rows.length);
  for (const r of rows) {
    const n = "C" + r[1];
    const marked = /\[x\]/i.test(r[3]);
    (marked ? done : notDone).push(n);
  }
}
if (existsSync(LOG)) {
  phases = [...new Set([...read(LOG).matchAll(/\|\s*(C\d+\.\d+)\s*\|\s*gate:\s*PASS/gi)].map((m) => m[1].toUpperCase()))];
}
for (const c of done) {
  if (!phases.some((p) => p.startsWith(c + "."))) findings.push(c + " is marked done but has no passing phase line in the build log");
}
for (const p of phases) {
  const c = p.split(".")[0];
  if (!done.includes(c) && !notDone.includes(c)) findings.push(p + " is logged but its contract is absent from the index");
}
console.log("contracts marked done: " + (done.join(", ") || "none"));
console.log("contracts outstanding: " + (notDone.join(", ") || "none"));
console.log("phases logged pass:    " + phases.length + " (" + phases.join(", ") + ")");
if (notDone.length) findings.push("contracts still outstanding: " + notDone.join(", "));
verdict("contract index and build log are consistent and complete", findings);
