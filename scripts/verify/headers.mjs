#!/usr/bin/env node
/** Acceptance criterion ten: every source file names the contract and phase that owns it. Owner: build tooling. */
import { walk, read, verdict } from "./_util.mjs";
const files = walk("src", [".ts", ".tsx"]).concat(walk("tests", [".ts", ".tsx"]));
const findings = [];
for (const f of files) {
  const head = read(f).split("\n").slice(0, 20).join("\n");
  const hasContract = /contract\s*\d/i.test(head);
  const hasPhase = /phase\s*\d/i.test(head);
  if (!hasContract || !hasPhase) {
    findings.push(f + " header is missing " + (!hasContract ? "a contract reference" : "") + (!hasContract && !hasPhase ? " and " : "") + (!hasPhase ? "a phase reference" : ""));
  }
}
verdict("every source file declares its owning contract and phase", findings, ["scanned " + files.length + " files"]);
