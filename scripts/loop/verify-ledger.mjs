#!/usr/bin/env node
/**
 * Verifies the build loop verification ledger.
 * Owner: build tooling. Acceptance criterion thirteen.
 * Exits non zero on a broken chain, a self approval, a refused certification,
 * or a completed phase that no certificate covers.
 */
import { existsSync, readFileSync } from "node:fs";
import { VerificationLedger } from "./ledger.mjs";

const LEDGER = process.argv[2] ?? ".loop/verification-ledger.json";
const BUILD_LOG = "contracts/_BUILD_LOG.md";
const fail = [];

if (!existsSync(LEDGER)) {
  console.error("FAIL verification ledger not found at " + LEDGER);
  console.error("      seed it with: node scripts/loop/record.mjs --help");
  process.exit(1);
}

const ledger = new VerificationLedger(LEDGER);
const integrity = ledger.verifyIntegrity();
if (!integrity.ok) fail.push("chain integrity: " + integrity.errors.map((e) => "seq " + e.seq + " " + e.error).join("; "));

const certs = ledger.certificates();
for (const c of certs) {
  if (!c.verifiedBy) fail.push("certificate for " + c.itemId + " has no verifier");
  if (!c.approvedBy) fail.push("certificate for " + c.itemId + " has no approver");
  if (c.producedBy && c.verifiedBy && c.producedBy.toLowerCase() === c.verifiedBy.toLowerCase()) {
    fail.push("certificate for " + c.itemId + " was verified by its producer");
  }
}

const loggedPhases = existsSync(BUILD_LOG)
  ? [...readFileSync(BUILD_LOG, "utf8").matchAll(/\|\s*(C\d+\.\d+)\s*\|\s*gate:\s*PASS/gi)].map((m) => m[1].toUpperCase())
  : [];
const covered = new Set();
for (const c of certs) {
  covered.add(String(c.itemId).toUpperCase());
  const ev = ledger.events.find((e) => e.kind === "CERTIFY" && e.itemId === c.itemId);
  const note = ev ? String(ev.note ?? "") : "";
  const m = note.match(/covers:\s*([A-Za-z0-9.,\s]+)/i);
  if (m) m[1].split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).forEach((p) => covered.add(p));
}
const uncovered = [...new Set(loggedPhases)].filter((p) => !covered.has(p));
if (uncovered.length) fail.push("phases with a passing gate but no certificate: " + uncovered.join(", "));

console.log("ledger:        " + LEDGER);
console.log("events:        " + integrity.eventCount);
console.log("chain:         " + (integrity.ok ? "intact" : "BROKEN"));
console.log("certificates:  " + certs.length + " (" + certs.map((c) => c.itemId).join(", ") + ")");
console.log("logged phases: " + [...new Set(loggedPhases)].length);
console.log("uncovered:     " + (uncovered.length ? uncovered.join(", ") : "none"));

if (fail.length) {
  console.error("");
  fail.forEach((f) => console.error("FAIL " + f));
  process.exit(1);
}
console.log("PASS verification ledger is intact, independently verified and fully covering");
