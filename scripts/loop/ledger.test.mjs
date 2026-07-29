/**
 * Refusal path tests for the verification ledger.
 * Owner: build tooling. Run with: npm run test:loop
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VerificationLedger, SelfApprovalError, SupersededHashError, DispositionRefusedError,
  MalformedEventError, MissingProduceError, routeDisposition, canEnterL3, sha256,
  GENESIS_HASH, eventHash, canonical, MAX_L2_RETRIES,
} from "./ledger.mjs";

const H1 = sha256("artifact one");
const H2 = sha256("artifact two");
function freshLedger() {
  const dir = mkdtempSync(join(tmpdir(), "loop-"));
  return new VerificationLedger(join(dir, "verification-ledger.json"));
}
function seeded() {
  const l = freshLedger();
  l.append({ kind: "PRODUCE", itemId: "C4.2", actor: "builder", artifactHash: H1, note: "app shell" });
  return l;
}

test("refusal one: the producer cannot verify, approve or certify its own artifact", () => {
  for (const kind of ["VERIFY", "APPROVE", "CERTIFY"]) {
    const l = seeded();
    assert.throws(
      () => l.append({ kind, itemId: "C4.2", actor: "Builder", artifactHash: H1, disposition: "RESOLVED" }),
      SelfApprovalError,
      "case variation must not smuggle a self approval for " + kind,
    );
  }
});

test("refusal two: an artifact hash superseded by a later produce is refused", () => {
  const l = seeded();
  l.append({ kind: "PRODUCE", itemId: "C4.2", actor: "builder", artifactHash: H2, note: "revised app shell" });
  assert.throws(
    () => l.append({ kind: "VERIFY", itemId: "C4.2", actor: "gate-runner", artifactHash: H1 }),
    SupersededHashError,
  );
  const ok = l.append({ kind: "VERIFY", itemId: "C4.2", actor: "gate-runner", artifactHash: H2 });
  assert.equal(ok.kind, "VERIFY");
});

test("refusal three: certification is refused for ask human and for blocked", () => {
  for (const bad of ["ASK_HUMAN", "BLOCKED", "RETRY_ONCE", "ESCALATE"]) {
    const l = seeded();
    l.append({ kind: "VERIFY", itemId: "C4.2", actor: "gate-runner", artifactHash: H1 });
    l.append({ kind: "APPROVE", itemId: "C4.2", actor: "reviewer", artifactHash: H1 });
    assert.throws(
      () => l.append({ kind: "CERTIFY", itemId: "C4.2", actor: "reviewer", artifactHash: H1, disposition: bad }),
      DispositionRefusedError,
      "certify must refuse disposition " + bad,
    );
  }
});

test("refusal four: certification requires a prior verify and a prior approve", () => {
  const l = seeded();
  assert.throws(
    () => l.append({ kind: "CERTIFY", itemId: "C4.2", actor: "reviewer", artifactHash: H1, disposition: "RESOLVED" }),
    MissingProduceError,
  );
  l.append({ kind: "VERIFY", itemId: "C4.2", actor: "gate-runner", artifactHash: H1 });
  assert.throws(
    () => l.append({ kind: "CERTIFY", itemId: "C4.2", actor: "reviewer", artifactHash: H1, disposition: "RESOLVED" }),
    MissingProduceError,
  );
  l.append({ kind: "APPROVE", itemId: "C4.2", actor: "reviewer", artifactHash: H1 });
  const c = l.append({ kind: "CERTIFY", itemId: "C4.2", actor: "reviewer", artifactHash: H1, disposition: "RESOLVED", confidence: "VERIFIED" });
  assert.equal(c.kind, "CERTIFY");
});

test("verify or approve without any produce is refused", () => {
  const l = freshLedger();
  assert.throws(() => l.append({ kind: "VERIFY", itemId: "C9.9", actor: "gate-runner", artifactHash: H1 }), MissingProduceError);
});

test("malformed events are refused: unknown kind, blank actor, bad hash, unknown disposition", () => {
  const l = freshLedger();
  assert.throws(() => l.append({ kind: "PUBLISH", itemId: "x", actor: "a", artifactHash: H1 }), MalformedEventError);
  assert.throws(() => l.append({ kind: "PRODUCE", itemId: "x", actor: "   ", artifactHash: H1 }), MalformedEventError);
  assert.throws(() => l.append({ kind: "PRODUCE", itemId: "x", actor: "a", artifactHash: "nothex" }), MalformedEventError);
  assert.throws(() => l.append({ kind: "PRODUCE", itemId: "", actor: "a", artifactHash: H1 }), MalformedEventError);
  assert.throws(() => l.append({ kind: "PRODUCE", itemId: "x", actor: "a", artifactHash: H1, disposition: "MAYBE" }), MalformedEventError);
  assert.throws(() => l.append({ kind: "PRODUCE", itemId: "x", actor: "a", artifactHash: H1, confidence: "SURE" }), MalformedEventError);
});

test("the chain detects a tampered event body and a broken link", () => {
  const l = seeded();
  l.append({ kind: "VERIFY", itemId: "C4.2", actor: "gate-runner", artifactHash: H1 });
  assert.equal(l.verifyIntegrity().ok, true);
  l.save();
  const raw = JSON.parse(readFileSync(l.path, "utf8"));
  raw.events[1].note = "silently rewritten";
  writeFileSync(l.path, JSON.stringify(raw, null, 2), "utf8");
  const reloaded = new VerificationLedger(l.path);
  const res = reloaded.verifyIntegrity();
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.error.includes("content hash")));
});

test("a hand appended forged event cannot pass the integrity check", () => {
  const l = seeded();
  l.save();
  const raw = JSON.parse(readFileSync(l.path, "utf8"));
  raw.events.push({ seq: 2, kind: "CERTIFY", itemId: "C4.2", actor: "builder", artifactHash: H1, disposition: "RESOLVED", confidence: "VERIFIED", note: "", prevHash: raw.events[0].contentHash, contentHash: "f".repeat(64), recordedAt: new Date().toISOString() });
  writeFileSync(l.path, JSON.stringify(raw, null, 2), "utf8");
  const res = new VerificationLedger(l.path).verifyIntegrity();
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.error.includes("self approval")));
});

test("the chain is deterministic: identical event sequences produce identical hashes", () => {
  const build = () => {
    const l = freshLedger();
    l.append({ kind: "PRODUCE", itemId: "C4.3", actor: "builder", artifactHash: H1, note: "budget view" });
    l.append({ kind: "VERIFY", itemId: "C4.3", actor: "gate-runner", artifactHash: H1, note: "gates green" });
    l.append({ kind: "APPROVE", itemId: "C4.3", actor: "reviewer", artifactHash: H1 });
    l.append({ kind: "CERTIFY", itemId: "C4.3", actor: "reviewer", artifactHash: H1, disposition: "RESOLVED", confidence: "VERIFIED" });
    return l.events.map((e) => e.contentHash);
  };
  assert.deepEqual(build(), build());
});

test("wall clock time is excluded from the chained content", () => {
  const l = seeded();
  const e = l.events[0];
  const recomputed = eventHash({ ...e, recordedAt: "1999-01-01T00:00:00.000Z" });
  assert.equal(recomputed, e.contentHash);
});

test("canonical form is key order independent", () => {
  assert.equal(canonical({ a: 1, b: [2, { d: 4, c: 3 }] }), canonical({ b: [2, { c: 3, d: 4 }], a: 1 }));
});

test("the first event links to the genesis anchor", () => {
  assert.equal(seeded().events[0].prevHash, GENESIS_HASH);
});

test("certificates rebuild deterministically from the ledger alone", () => {
  const l = seeded();
  l.append({ kind: "VERIFY", itemId: "C4.2", actor: "gate-runner", artifactHash: H1 });
  l.append({ kind: "APPROVE", itemId: "C4.2", actor: "reviewer", artifactHash: H1 });
  l.append({ kind: "CERTIFY", itemId: "C4.2", actor: "reviewer", artifactHash: H1, disposition: "RESOLVED", confidence: "VERIFIED" });
  l.save();
  const a = l.certificateFor("C4.2");
  const b = new VerificationLedger(l.path).certificateFor("C4.2");
  assert.deepEqual(a, b);
  assert.equal(a.producedBy, "builder");
  assert.notEqual(a.producedBy, a.certifiedBy);
  assert.equal(l.certificateFor("C9.9"), null);
});

test("the escalation ladder routes deterministically and the override cannot open the level three gate", () => {
  assert.equal(routeDisposition({ priorSealedResult: true }).level, "L0");
  assert.equal(routeDisposition({ deterministicAvailable: true }).level, "L1");
  assert.equal(routeDisposition({ attempt: MAX_L2_RETRIES }).disposition, "RETRY_ONCE");
  const open = { attempt: 2, contractPresent: true, escalationTrigger: "gate red twice", budgetRemaining: 3, inScope: true };
  assert.equal(routeDisposition(open).level, "L3");
  assert.equal(routeDisposition({ ...open, budgetRemaining: 0 }).level, "L4");
  assert.equal(routeDisposition({ ...open, inScope: false }).level, "L4");
  assert.equal(routeDisposition({ ...open, contractPresent: false }).level, "L4");
  assert.equal(routeDisposition({ ...open, escalationTrigger: "   " }).level, "L4");
  assert.equal(routeDisposition({ attempt: 2, override: true, forceL3: true, contractPresent: false, escalationTrigger: "", budgetRemaining: 99, inScope: true }).level, "L4");
  assert.equal(canEnterL3({ contractPresent: true, escalationTrigger: "t", budgetRemaining: 1, inScope: true }), true);
  assert.equal(canEnterL3({ contractPresent: true, escalationTrigger: "t", budgetRemaining: 1, inScope: false }), false);
});

test("F01 regression: verifyIntegrity rejects a forged ledger that certifies without a verify and approve", () => {
  const l = seeded();
  l.save();
  const raw = JSON.parse(readFileSync(l.path, "utf8"));
  // hand craft a CERTIFY with correct chain hashes but no prior VERIFY or APPROVE
  const forged = { seq: 2, kind: "CERTIFY", itemId: "C4.2", actor: "reviewer", artifactHash: H1, disposition: "RESOLVED", confidence: "VERIFIED", note: "", prevHash: raw.events[0].contentHash };
  forged.contentHash = eventHash(forged);
  forged.recordedAt = new Date().toISOString();
  raw.events.push(forged);
  writeFileSync(l.path, JSON.stringify(raw, null, 2), "utf8");
  const res = new VerificationLedger(l.path).verifyIntegrity();
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.error.includes("no matching VERIFY")));
  assert.ok(res.errors.some((e) => e.error.includes("no matching APPROVE")));
});

test("F04 regression: the retry gate is one indexed and refuses a non positive attempt", () => {
  assert.throws(() => routeDisposition({ attempt: 0 }), MalformedEventError);
  assert.equal(routeDisposition({ attempt: 1 }).disposition, "RETRY_ONCE");
  const open = { attempt: 2, contractPresent: true, escalationTrigger: "gate red", budgetRemaining: 3, inScope: true };
  assert.equal(routeDisposition(open).level, "L3");
});
