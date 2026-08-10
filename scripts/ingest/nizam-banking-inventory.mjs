#!/usr/bin/env node
/**
 * NIZAM · Spec 08 phase A, wave A0 — the banking-tree inventory and EXCLUSION REGISTER.
 * Owning spec: `.kiro/specs/08-knowledge-ingestion/` tasks A0.1, A0.2, A0.3.
 *
 * ## What this produces
 *
 * One row per DETECTED object in the owner's banking tree, each assigned exactly one class, with a
 * reason. Then it asserts the only property that makes an inventory trustworthy:
 *
 *     detected === tier1 + tier2 + tier3 + excluded
 *
 * A completeness check over the things you already listed cannot find what you forgot. So nothing is
 * dropped silently: every object lands in a class or the run REFUSES.
 *
 * ## Why the particulars arrive from the environment (R24, steering §0b)
 *
 * This repository is public. A storage folder identifier is a deployment particular and never appears
 * in a tracked file. So is the name of the owner's employment-related subtree, which is excluded by
 * rule — and a rule that names it here would put work material in a public repository to describe
 * keeping work material out. Both arrive as environment entries, and an unresolved entry FAILS CLOSED.
 *
 * ## Why the exclusion list may not be empty
 *
 * An absent exclusion list is not "exclude nothing", it is "the operator forgot". Ingesting the work
 * subtree is the single worst outcome this script can produce, so an unset or empty exclusion entry is
 * a refusal, not a default. Widening it requires an explicit flag that says so out loud.
 *
 * ## No second authentication implementation
 *
 * `scripts/ingest/pfos-drive-pull.mjs` already owns the loopback consent flow and the token cache.
 * This script only READS the cached access token. If it is missing or expired, the run refuses and
 * prints the one command that refreshes it, rather than duplicating thirty lines of token handling
 * that would then have to be kept in step.
 *
 * Read only. No write scope is requested, nothing is uploaded, nothing is modified in the drive.
 *
 * Usage
 *   NIZAM_BANKING_FOLDER_ID=<ref> NIZAM_INGEST_EXCLUDE_SUBTREES="<prefix>,<prefix>" \
 *     node scripts/ingest/nizam-banking-inventory.mjs
 *   ... --out outputs/ingest        (default)
 *   ... --allow-empty-exclusions    (explicit, loud, and recorded in the artifact)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const API = "https://www.googleapis.com/drive/v3";
const TOKEN_FILE = ".secrets/pfos-ingest.token.json";
const FOLDER_FILE_LIMIT = 5000;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes("--" + n);
const opt = (n, d = "") => {
  const i = argv.indexOf("--" + n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

// ---------------------------------------------------------------------------------------------
// Fail-closed configuration
// ---------------------------------------------------------------------------------------------

function refuse(code, message) {
  console.error(`REFUSED [${code}] ${message}`);
  process.exit(2);
}

const FOLDER = opt("folder", process.env.NIZAM_BANKING_FOLDER_ID ?? "");
if (!FOLDER) {
  refuse(
    "FOLDER_REF_UNRESOLVED",
    "no banking folder reference. Supply NIZAM_BANKING_FOLDER_ID or --folder. There is no default: " +
      "a storage identifier is a deployment particular and this repository is public.",
  );
}

const ALLOW_EMPTY = flag("allow-empty-exclusions");
const rawExcl = process.env.NIZAM_INGEST_EXCLUDE_SUBTREES ?? "";
const EXCLUDE_PREFIXES = rawExcl
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
if (EXCLUDE_PREFIXES.length === 0 && !ALLOW_EMPTY) {
  refuse(
    "EXCLUSIONS_UNSET",
    "NIZAM_INGEST_EXCLUDE_SUBTREES is unset or empty. An absent exclusion list is not 'exclude " +
      "nothing', it is an operator omission, and ingesting non-financial work material is the worst " +
      "outcome this script can produce. Set it, or pass --allow-empty-exclusions to say so out loud.",
  );
}

const OUT_DIR = opt("out", "outputs/ingest");

// ---------------------------------------------------------------------------------------------
// Token: read only, never refreshed here (see header)
// ---------------------------------------------------------------------------------------------

function accessToken() {
  if (!existsSync(TOKEN_FILE)) {
    refuse("TOKEN_ABSENT", `no cached token at ${TOKEN_FILE}. Run: node scripts/ingest/pfos-drive-pull.mjs --list-only`);
  }
  let rec;
  try {
    rec = JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
  } catch {
    refuse("TOKEN_UNREADABLE", `${TOKEN_FILE} is not readable JSON. Re-run the puller to rebuild it.`);
  }
  if (!rec.access_token) refuse("TOKEN_EMPTY", "the cached token record holds no access token.");
  if (rec.expires_at && Date.parse(rec.expires_at) - Date.now() < 60_000) {
    refuse(
      "TOKEN_EXPIRED",
      "the cached access token is expired or about to be. Refresh it with the tool that owns the " +
        "consent flow: node scripts/ingest/pfos-drive-pull.mjs --list-only",
    );
  }
  return rec.access_token;
}

// ---------------------------------------------------------------------------------------------
// Drive walk, paginated
// ---------------------------------------------------------------------------------------------

async function api(token, path, params) {
  const u = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) refuse("DRIVE_STATUS", `${path} answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function listChildren(token, id) {
  const out = [];
  let pageToken = "";
  do {
    const page = await api(token, "files", {
      q: `'${id}' in parents and trashed = false`,
      fields: "nextPageToken, files(id,name,mimeType,size,modifiedTime)",
      pageSize: "1000",
      ...(pageToken ? { pageToken } : {}),
    });
    out.push(...(page.files ?? []));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

async function walk(token, id, prefix = "") {
  const found = [];
  for (const e of await listChildren(token, id)) {
    if (e.mimeType === FOLDER_MIME) {
      found.push(...(await walk(token, e.id, `${prefix}${e.name}/`)));
    } else {
      found.push({ path: `${prefix}${e.name}`, name: e.name, mimeType: e.mimeType, size: Number(e.size ?? 0) });
    }
    if (found.length > FOLDER_FILE_LIMIT) refuse("TREE_TOO_LARGE", `more than ${FOLDER_FILE_LIMIT} objects; refusing rather than paging forever.`);
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Classification. Exactly one class per object, and a reason for every one.
// ---------------------------------------------------------------------------------------------

/** Tier 1: transactional truth. Matched by exact file name, never by a loose pattern. */
const TIER1_EXACT = new Map([
  ["master_ledger_jul2025_jul_2026.csv", "canonical 25-column ledger, the row contract in data/ledgers/LEDGER_SCHEMA.md"],
  ["credit_limits.csv", "limits and statement close day for the revolving accounts"],
]);
/** Tier 1 by shape: the per-account validated tables and the pre-computed gate results. */
const TIER1_VALIDATED_TXN = /(^|\/)validated\/transactions__[A-Za-z0-9_]+\.csv$/;
const TIER1_GATE_RESULTS = /(^|\/)validated\/[A-Za-z0-9_]+\.json$/;

/** Tier 2: knowledge. Documents the agent reasons WITH, never rows it reasons OVER. */
const TIER2_DOC = /\.(md|markdown)$/i;
const TIER2_GOOGLE_DOC = "application/vnd.google-apps.document";

/** Tier 3: deferred to v2, each for a stated reason. */
const TIER3_RULES = [
  [/\.pdf$/i, "source document; needs a parser, deferred to v2"],
  [/\.xlsx$/i, "spreadsheet rendering of the canonical ledger; duplicates tier 1"],
  [/\.parquet$/i, "columnar copy; duplicates the validated tables"],
  [/\.html?$/i, "derived report; ingesting it would import conclusions instead of evidence"],
  [/(^|\/)raw\/.*__(meta\.json|pages\.txt)$/i, "extracted statement text and sidecar; input to a v2 parser"],
  [/(^|\/)analytics\/.*\.json$/i, "derived metric; recomputed from tier 1 rather than trusted"],
];

/** Excluded regardless of the operator's list: never financial evidence. */
const EXCLUDE_ALWAYS = [
  [/__pycache__|\.pyc$/i, "interpreter cache"],
  [/\.py$/i, "source code of another component, not financial evidence"],
];

function classify(f) {
  for (const p of EXCLUDE_PREFIXES) {
    if (f.path === p || f.path.startsWith(p.endsWith("/") ? p : `${p}/`)) {
      return { cls: "EXCLUDED", reason: "operator exclusion rule: non-financial subtree, excluded by rule not by filter" };
    }
  }
  for (const [re, reason] of EXCLUDE_ALWAYS) if (re.test(f.path)) return { cls: "EXCLUDED", reason };

  const exact = TIER1_EXACT.get(f.name);
  if (exact) return { cls: "TIER1", reason: exact };
  if (TIER1_VALIDATED_TXN.test(f.path)) return { cls: "TIER1", reason: "per-account validated table; reconciliation source, not a second insert path" };
  if (TIER1_GATE_RESULTS.test(f.path)) return { cls: "TIER1", reason: "pre-computed gate result; the independent third opinion in wave A3" };

  for (const [re, reason] of TIER3_RULES) if (re.test(f.path)) return { cls: "TIER3", reason };

  if (TIER2_DOC.test(f.name) || f.mimeType === TIER2_GOOGLE_DOC) {
    return { cls: "TIER2", reason: "knowledge document; indexed into document_index, never into transactions" };
  }
  return { cls: "TIER3", reason: "unclassified by every rule; deferred rather than assumed. Review before v2." };
}

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------

const token = accessToken();
const detected = await walk(token, FOLDER);
if (detected.length === 0) refuse("EMPTY_TREE", "the folder reference resolved but the tree is empty; an empty scan is a finding, never a pass.");

const rows = detected.map((f) => ({ ...f, ...classify(f) }));
const counts = { TIER1: 0, TIER2: 0, TIER3: 0, EXCLUDED: 0 };
for (const r of rows) counts[r.cls] += 1;

// A0.1 — the completeness assertion. This is the whole point of the artifact.
const summed = counts.TIER1 + counts.TIER2 + counts.TIER3 + counts.EXCLUDED;
if (summed !== detected.length) {
  refuse("COMPLETENESS_BROKEN", `detected ${detected.length} but classified ${summed}; every object must land in exactly one class.`);
}
const unreasoned = rows.filter((r) => !r.reason || r.reason.length === 0);
if (unreasoned.length > 0) refuse("REASON_MISSING", `${unreasoned.length} row(s) carry no reason; an unexplained exclusion is not a register.`);

// Tier 1 must actually be present, or the load downstream has nothing to reconcile.
const missingT1 = [...TIER1_EXACT.keys()].filter((n) => !rows.some((r) => r.name === n && r.cls === "TIER1"));
if (missingT1.length > 0) refuse("TIER1_ABSENT", `expected tier-1 artifact(s) not found in the tree: ${missingT1.join(", ")}`);

mkdirSync(OUT_DIR, { recursive: true });
const artifact = {
  spec: "08-knowledge-ingestion",
  wave: "A0",
  generated_at: new Date().toISOString(),
  scope: "banking tree, read only",
  exclusion_mode: EXCLUDE_PREFIXES.length > 0 ? "rule" : "EMPTY (explicitly allowed)",
  exclusion_prefix_count: EXCLUDE_PREFIXES.length,
  detected: detected.length,
  counts,
  completeness: { detected: detected.length, classified: summed, holds: true },
  rows: rows.map((r) => ({ path: r.path, mime: r.mimeType, bytes: r.size, class: r.cls, reason: r.reason })),
};
const jsonPath = join(OUT_DIR, "INVENTORY.json");
writeFileSync(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`);

const lines = [
  "# Spec 08 wave A0 — banking-tree inventory and exclusion register",
  "",
  `Generated ${artifact.generated_at}. Read-only scan. This file is gitignored by design: it lists real file paths.`,
  "",
  `- detected: **${detected.length}**`,
  `- tier 1 transactional: **${counts.TIER1}**`,
  `- tier 2 knowledge: **${counts.TIER2}**`,
  `- tier 3 deferred to v2: **${counts.TIER3}**`,
  `- excluded by rule: **${counts.EXCLUDED}**`,
  `- completeness: detected === classified (**${detected.length} === ${summed}**)`,
  "",
  "## Tier 1 — transactional truth",
  "",
  ...rows.filter((r) => r.cls === "TIER1").map((r) => `- \`${r.path}\` — ${r.reason}`),
  "",
  "## Tier 2 — knowledge",
  "",
  ...rows.filter((r) => r.cls === "TIER2").map((r) => `- \`${r.path}\``),
  "",
  "## Excluded by rule",
  "",
  `${counts.EXCLUDED} object(s). Paths are recorded in INVENTORY.json and not restated here.`,
  "",
];
writeFileSync(join(OUT_DIR, "INVENTORY.md"), `${lines.join("\n")}\n`);

console.log(`detected ${detected.length} object(s) in the banking tree`);
console.log(`  TIER1 transactional : ${counts.TIER1}`);
console.log(`  TIER2 knowledge     : ${counts.TIER2}`);
console.log(`  TIER3 deferred (v2) : ${counts.TIER3}`);
console.log(`  EXCLUDED by rule    : ${counts.EXCLUDED}`);
console.log(`completeness holds: ${detected.length} detected === ${summed} classified`);
console.log(`written ${jsonPath} and ${join(OUT_DIR, "INVENTORY.md")} (both gitignored)`);
