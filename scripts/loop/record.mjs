#!/usr/bin/env node
/**
 * Appends one event to the build loop verification ledger.
 * Owner: build tooling.
 *
 * Usage:
 *   node scripts/loop/record.mjs --kind PRODUCE --item C4.2 --actor builder --files a.ts,b.ts --note "app shell"
 *   node scripts/loop/record.mjs --kind VERIFY  --item C4.2 --actor gate-runner --hash <64 hex> --note "gates green"
 *   node scripts/loop/record.mjs --kind APPROVE --item C4.2 --actor reviewer --hash <64 hex>
 *   node scripts/loop/record.mjs --kind CERTIFY --item C4.2 --actor reviewer --hash <64 hex> --disposition RESOLVED --confidence VERIFIED
 *
 * The artifact hash is either given with --hash or derived from --files as the
 * hash of the ordered per file hashes, which makes it deterministic and order stable.
 */
import { existsSync } from "node:fs";
import { VerificationLedger, hashFile, sha256 } from "./ledger.mjs";

const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log(readUsage());
  process.exit(args.length ? 0 : 1);
}
function readUsage() {
  return [
    "record.mjs appends one event to the verification ledger",
    "  --kind PRODUCE|VERIFY|APPROVE|CERTIFY   required",
    "  --item <phase id, for example C4.2>     required",
    "  --actor <identity>                      required, and may not be the producer for VERIFY, APPROVE or CERTIFY",
    "  --files <comma separated paths>         derives the artifact hash deterministically",
    "  --hash <64 hex>                         use an existing artifact hash instead",
    "  --disposition RESOLVED|RETRY_ONCE|ESCALATE|ASK_HUMAN|BLOCKED",
    "  --confidence VERIFIED|HIGH|MEDIUM|LOW|BLOCKED",
    "  --note <text>                           free text, use covers: C1.1,C1.2 to attach phase coverage",
    "  --ledger <path>                         default .loop/verification-ledger.json",
  ].join("\n");
}
function opt(name, dflt = null) {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}

const ledgerPath = opt("ledger", ".loop/verification-ledger.json");
const kind = String(opt("kind", "")).toUpperCase();
const itemId = opt("item", "");
const actor = opt("actor", "");
const note = opt("note", "");
const disposition = opt("disposition");
const confidence = opt("confidence");
let artifactHash = opt("hash");

const filesArg = opt("files");
if (!artifactHash && filesArg) {
  const files = filesArg.split(",").map((s) => s.trim()).filter(Boolean);
  const missing = files.filter((f) => !existsSync(f));
  if (missing.length) {
    console.error("FAIL these files do not exist: " + missing.join(", "));
    process.exit(1);
  }
  artifactHash = sha256(files.map((f) => hashFile(f)).join(""));
  console.log("derived artifact hash from " + files.length + " files");
}
if (!artifactHash) {
  console.error("FAIL provide either --hash or --files");
  process.exit(1);
}

const ledger = new VerificationLedger(ledgerPath);
try {
  const event = ledger.append({ kind, itemId, actor, artifactHash, disposition, confidence, note });
  ledger.save();
  console.log("recorded " + event.kind + " seq " + event.seq + " for " + event.itemId + " by " + event.actor);
  console.log("artifact " + event.artifactHash);
  console.log("chained  " + event.contentHash);
  const integrity = ledger.verifyIntegrity();
  if (!integrity.ok) {
    console.error("FAIL the ledger no longer verifies after this append");
    process.exit(1);
  }
} catch (err) {
  console.error("REFUSED " + err.constructor.name + ": " + err.message);
  process.exit(2);
}
