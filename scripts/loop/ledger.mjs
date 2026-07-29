/**
 * Verification ledger for the build loop: append only, hash chained.
 * Owner: build tooling that gates Contract 4 and Contract 5 phases.
 * Runtime: Node 24 LTS. Zero dependencies, standard library only.
 *
 * Model: PRODUCE then VERIFY then APPROVE then CERTIFY.
 * Every event stores the hash of the previous event, so any edit to history is detectable.
 * Wall clock time is stored outside the chained content, so the chain is reproducible.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const GENESIS_HASH = "0".repeat(64);
export const EVENT_KINDS = ["PRODUCE", "VERIFY", "APPROVE", "CERTIFY"];
export const DISPOSITIONS = ["RESOLVED", "RETRY_ONCE", "ESCALATE", "ASK_HUMAN", "BLOCKED"];
export const CONFIDENCE_STATES = ["VERIFIED", "HIGH", "MEDIUM", "LOW", "BLOCKED"];
export const CERTIFIABLE_DISPOSITIONS = new Set(["RESOLVED"]);
export const MAX_L2_RETRIES = 1;
const HEX64 = /^[0-9a-f]{64}$/;

export class LedgerError extends Error {}
export class SelfApprovalError extends LedgerError {}
export class SupersededHashError extends LedgerError {}
export class DispositionRefusedError extends LedgerError {}
export class ChainIntegrityError extends LedgerError {}
export class MalformedEventError extends LedgerError {}
export class MissingProduceError extends LedgerError {}

/** Stable JSON: keys sorted at every depth, so the hash never depends on key order. */
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}

export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashString(text) {
  return sha256(text);
}

export function hashFile(path) {
  return sha256(readFileSync(path, "utf8"));
}

/** The part of an event that participates in the chain. recordedAt is deliberately excluded. */
export function chainedContent(event) {
  return {
    seq: event.seq,
    kind: event.kind,
    itemId: event.itemId,
    actor: event.actor,
    artifactHash: event.artifactHash,
    disposition: event.disposition ?? null,
    confidence: event.confidence ?? null,
    note: event.note ?? "",
    prevHash: event.prevHash,
  };
}

export function eventHash(event) {
  return sha256(canonical(chainedContent(event)));
}

const fold = (s) => String(s ?? "").trim().toLowerCase();

export class VerificationLedger {
  constructor(path) {
    this.path = path;
    this.events = [];
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      this.events = Array.isArray(parsed.events) ? parsed.events : [];
    }
  }

  get lastHash() {
    return this.events.length ? this.events[this.events.length - 1].contentHash : GENESIS_HASH;
  }

  /** Latest PRODUCE hash for an item. Later produce supersedes earlier ones. */
  latestProduceHash(itemId) {
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const e = this.events[i];
      if (e.kind === "PRODUCE" && fold(e.itemId) === fold(itemId)) return e.artifactHash;
    }
    return null;
  }

  producerOf(itemId, artifactHash) {
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const e = this.events[i];
      if (e.kind === "PRODUCE" && fold(e.itemId) === fold(itemId) && e.artifactHash === artifactHash) return e.actor;
    }
    return null;
  }

  hasKind(kind, itemId, artifactHash) {
    return this.events.some(
      (e) => e.kind === kind && fold(e.itemId) === fold(itemId) && e.artifactHash === artifactHash,
    );
  }

  append({ kind, itemId, actor, artifactHash, disposition = null, confidence = null, note = "" }) {
    if (!EVENT_KINDS.includes(kind)) throw new MalformedEventError("unknown event kind " + kind);
    if (!fold(itemId)) throw new MalformedEventError("itemId is required");
    if (!fold(actor)) throw new MalformedEventError("actor is required");
    if (!HEX64.test(String(artifactHash ?? ""))) throw new MalformedEventError("artifactHash must be 64 hex characters");
    if (disposition !== null && !DISPOSITIONS.includes(disposition)) {
      throw new MalformedEventError("unknown disposition " + disposition);
    }
    if (confidence !== null && !CONFIDENCE_STATES.includes(confidence)) {
      throw new MalformedEventError("unknown confidence state " + confidence);
    }

    if (kind !== "PRODUCE") {
      const latest = this.latestProduceHash(itemId);
      if (!latest) throw new MissingProduceError("no PRODUCE event exists for item " + itemId);
      if (latest !== artifactHash) {
        throw new SupersededHashError(
          "artifact hash is superseded for item " + itemId + ". Latest produce is " + latest,
        );
      }
      const producer = this.producerOf(itemId, artifactHash);
      if (producer && fold(producer) === fold(actor)) {
        throw new SelfApprovalError(
          "actor " + actor + " produced this artifact and therefore cannot " + kind.toLowerCase() + " it",
        );
      }
    }

    if (kind === "CERTIFY") {
      if (!CERTIFIABLE_DISPOSITIONS.has(String(disposition))) {
        throw new DispositionRefusedError("certification refused for disposition " + disposition);
      }
      if (!this.hasKind("VERIFY", itemId, artifactHash)) {
        throw new MissingProduceError("certification requires a prior VERIFY for item " + itemId);
      }
      if (!this.hasKind("APPROVE", itemId, artifactHash)) {
        throw new MissingProduceError("certification requires a prior APPROVE for item " + itemId);
      }
    }

    const event = {
      seq: this.events.length + 1,
      kind,
      itemId,
      actor,
      artifactHash,
      disposition,
      confidence,
      note,
      prevHash: this.lastHash,
    };
    event.contentHash = eventHash(event);
    event.recordedAt = new Date().toISOString();
    this.events.push(event);
    return event;
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(
      this.path,
      JSON.stringify({ genesisHash: GENESIS_HASH, eventCount: this.events.length, events: this.events }, null, 2) + "\n",
      "utf8",
    );
    return this.path;
  }

  /** Recompute the whole chain plus the invariants, without trusting the file. */
  verifyIntegrity() {
    const errors = [];
    let prev = GENESIS_HASH;
    this.events.forEach((e, i) => {
      if (e.seq !== i + 1) errors.push({ seq: e.seq, error: "sequence out of order at index " + i });
      if (e.prevHash !== prev) errors.push({ seq: e.seq, error: "previous hash does not match the chain" });
      const recomputed = eventHash(e);
      if (recomputed !== e.contentHash) errors.push({ seq: e.seq, error: "content hash does not match the event body" });
      prev = e.contentHash;
      if (e.kind !== "PRODUCE") {
        const producer = this.producerOf(e.itemId, e.artifactHash);
        if (producer && fold(producer) === fold(e.actor)) {
          errors.push({ seq: e.seq, error: "self approval recorded for item " + e.itemId });
        }
      }
      if (e.kind === "CERTIFY" && !CERTIFIABLE_DISPOSITIONS.has(String(e.disposition))) {
        errors.push({ seq: e.seq, error: "certification recorded with a refused disposition" });
      }
    });
    return { ok: errors.length === 0, eventCount: this.events.length, errors };
  }

  /** Deterministic certificate rebuilt from the ledger alone. */
  certificateFor(itemId) {
    const hash = this.latestProduceHash(itemId);
    if (!hash) return null;
    const certify = this.events.find(
      (e) => e.kind === "CERTIFY" && fold(e.itemId) === fold(itemId) && e.artifactHash === hash,
    );
    if (!certify) return null;
    const verify = this.events.find(
      (e) => e.kind === "VERIFY" && fold(e.itemId) === fold(itemId) && e.artifactHash === hash,
    );
    const approve = this.events.find(
      (e) => e.kind === "APPROVE" && fold(e.itemId) === fold(itemId) && e.artifactHash === hash,
    );
    return {
      certificateId: sha256(fold(itemId) + ":" + hash + ":" + certify.contentHash),
      itemId,
      artifactHash: hash,
      producedBy: this.producerOf(itemId, hash),
      verifiedBy: verify ? verify.actor : null,
      approvedBy: approve ? approve.actor : null,
      certifiedBy: certify.actor,
      confidence: certify.confidence,
      disposition: certify.disposition,
      chainAnchor: certify.contentHash,
    };
  }

  certificates() {
    const items = [...new Set(this.events.map((e) => e.itemId))];
    return items.map((i) => this.certificateFor(i)).filter(Boolean);
  }
}

/**
 * Escalation ladder. Pure function, no side effects.
 * L0 reuse a sealed result, L1 deterministic, L2 exactly one retry,
 * L3 bounded reasoning for an in scope capability, L4 human.
 * An override flag is accepted and deliberately ignored, so it cannot open the L3 gate.
 */
export function canEnterL3({ contractPresent, escalationTrigger, budgetRemaining, inScope }) {
  return Boolean(contractPresent) && Boolean(String(escalationTrigger ?? "").trim()) && Number(budgetRemaining) > 0 && Boolean(inScope);
}

export function routeDisposition(input) {
  const {
    priorSealedResult = false,
    deterministicAvailable = false,
    attempt = 1,
    contractPresent = false,
    escalationTrigger = "",
    budgetRemaining = 0,
    inScope = false,
  } = input ?? {};
  if (priorSealedResult) return { level: "L0", disposition: "RESOLVED", reason: "reused a sealed prior result" };
  if (deterministicAvailable) return { level: "L1", disposition: "RESOLVED", reason: "deterministic command available" };
  if (attempt <= MAX_L2_RETRIES) return { level: "L2", disposition: "RETRY_ONCE", reason: "one bounded retry permitted" };
  if (canEnterL3({ contractPresent, escalationTrigger, budgetRemaining, inScope })) {
    return { level: "L3", disposition: "ESCALATE", reason: "contract, trigger, budget and scope all satisfied" };
  }
  return { level: "L4", disposition: "ASK_HUMAN", reason: "the L3 gate is not satisfied, a human decision is required" };
}
