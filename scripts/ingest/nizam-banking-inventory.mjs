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
 *   ... --fetch-tier1 data/ledgers  (materialise tier 1 locally; destination must be gitignored)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, sep, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

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

/**
 * Optional tier-1 materialisation. Validated HERE, before the drive is touched: a run that is going to
 * refuse its destination must refuse before it reads a single financial row, not after.
 *
 * A local cache of real account rows may only land on a path git already ignores. That is a guard, not
 * a convention, because this repository is public.
 */
const FETCH_DIR = opt("fetch-tier1", "");
const ALLOWED_DEST = ["data/ledgers/", "outputs/"];
let FETCH_DEST = "";
if (FETCH_DIR) {
  // Separator normalisation via path.sep, so this source carries no escaped-backslash literals.
  FETCH_DEST = `${FETCH_DIR.split(sep).join("/").replace(/[/]+$/, "")}/`;
  // Resolve before comparing. A prefix test on the raw string is defeated by traversal: the literal
  // "outputs/../src" satisfies startsWith("outputs/") while landing in tracked source. Proven by
  // negative test, and caught downstream by assertAllIgnored, which is why both layers exist.
  const resolvedDest = `${resolve(FETCH_DEST).split(sep).join("/").replace(/[/]+$/, "")}/`;
  const resolvedAllowed = ALLOWED_DEST.map((p) => `${resolve(p).split(sep).join("/").replace(/[/]+$/, "")}/`);
  if (!resolvedAllowed.some((p) => resolvedDest.startsWith(p))) {
    refuse(
      "DEST_NOT_IGNORED",
      `refusing to write financial rows to "${FETCH_DEST}". Allowed prefixes are ${ALLOWED_DEST.join(", ")}, ` +
        "which .gitignore already covers. Anything else risks committing account rows to a public repository.",
    );
  }
}

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

/**
 * Read-only byte fetch for one object. Verbatim bytes only: no export conversion, because a converted
 * document is a derived artifact and tier 1 is evidence. Returns a Buffer.
 */
/**
 * Ask GIT, not a hardcoded prefix list, whether every planned local path is ignored.
 *
 * The prefix allowlist above encodes an assumption about .gitignore. This asserts the fact. It matters
 * because .gitignore rules are narrower than they look and carry negations: `!data/ledgers/*.example.json`
 * would make a file called `x.example.json` trackable inside an otherwise-ignored directory. Checked
 * BEFORE any byte is downloaded, so a run that cannot store safely never reads a financial row at all.
 *
 * `git check-ignore -v --non-matching` prints one line per path; a path matching no rule is reported
 * with empty source fields, so any line beginning "::" is a path git would happily commit.
 */
function assertAllIgnored(paths) {
  const r = spawnSync("git", ["check-ignore", "-v", "--non-matching", ...paths], { encoding: "utf8" });
  if (r.error || typeof r.stdout !== "string") {
    refuse("IGNORE_UNVERIFIABLE", `could not run git check-ignore (${r.error?.message ?? "no output"}). Refusing rather than assuming these paths are ignored.`);
  }
  const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length !== paths.length) {
    refuse("IGNORE_UNVERIFIABLE", `asked git about ${paths.length} path(s) but it reported on ${lines.length}. Refusing on an incomplete answer.`);
  }
  const trackable = lines.filter((l) => l.startsWith("::")).map((l) => l.split("\t").pop());
  if (trackable.length > 0) {
    refuse(
      "DEST_TRACKABLE",
      `git would track ${trackable.length} of ${paths.length} planned file(s), including ${trackable[0]}. ` +
        "This repository is public and these are real account rows. Refusing before download.",
    );
  }
  return lines.length;
}

async function downloadBytes(token, file) {
  const u = new URL(`${API}/files/${file.id}`);
  u.searchParams.set("alt", "media");
  u.searchParams.set("supportsAllDrives", "true");
  const r = await fetch(u, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) {
    refuse("DOWNLOAD_STATUS", `${file.path} answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  return Buffer.from(await r.arrayBuffer());
}

async function walk(token, id, prefix = "") {
  const found = [];
  for (const e of await listChildren(token, id)) {
    if (e.mimeType === FOLDER_MIME) {
      found.push(...(await walk(token, e.id, `${prefix}${e.name}/`)));
    } else {
      found.push({ id: e.id, path: `${prefix}${e.name}`, name: e.name, mimeType: e.mimeType, size: Number(e.size ?? 0) });
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

// ---------------------------------------------------------------------------------------------
// Optional: materialise tier 1 locally, DRIVEN BY THE REGISTER above.
//
// The fetch deliberately consumes the classified rows rather than a hand-typed list of names. A
// hand-typed list would bypass the exclusion rule this script exists to enforce, so the rule and the
// fetch can never drift apart: if an object is not TIER1 by rule, it cannot be downloaded here.
// ---------------------------------------------------------------------------------------------

if (FETCH_DIR) {
  const dest = FETCH_DEST;
  const tier1 = rows.filter((r) => r.cls === "TIER1");
  mkdirSync(dest, { recursive: true });

  // Provenance survives in the local name, so a downstream row can always cite where it came from and
  // two same-named files in different folders can never collide.
  const localNameOf = (f) => f.path.split(sep).join("/").split("/").join("__");

  // Fail closed BEFORE the first byte: every planned path, plus the manifest, must be ignored by git.
  const planned = [...tier1.map((f) => join(dest, localNameOf(f))), join(dest, "TIER1_MANIFEST.json")];
  const verified = assertAllIgnored(planned);
  console.log(`git confirms all ${verified} planned local path(s) are ignored; proceeding to download`);

  const manifest = [];
  let fetched = 0;
  let bytesTotal = 0;
  for (const f of tier1) {
    const localName = localNameOf(f);
    const bytes = await downloadBytes(token, f);
    // Drive reports a size for binary objects. When it does, a mismatch means a truncated read.
    if (f.size > 0 && bytes.length !== f.size) {
      refuse(
        "SIZE_MISMATCH",
        `${f.path}: drive reported ${f.size} bytes but ${bytes.length} arrived. A short read is a ` +
          "corrupt cache, and a corrupt cache that parses is worse than one that fails.",
      );
    }
    writeFileSync(join(dest, localName), bytes);
    manifest.push({
      local_name: localName,
      source_path: f.path,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      tier: f.cls,
      reason: f.reason,
      fetched_at: new Date().toISOString(),
    });
    fetched += 1;
    bytesTotal += bytes.length;
  }

  if (fetched !== tier1.length) {
    refuse("FETCH_INCOMPLETE", `${tier1.length} tier-1 object(s) classified but ${fetched} fetched.`);
  }
  writeFileSync(
    join(dest, "TIER1_MANIFEST.json"),
    `${JSON.stringify({ spec: "08-knowledge-ingestion", wave: "A0/fetch", generated_at: new Date().toISOString(), count: fetched, bytes_total: bytesTotal, files: manifest }, null, 2)}\n`,
  );
  console.log(`fetched ${fetched} tier-1 object(s), ${bytesTotal} byte(s) -> ${dest} (gitignored)`);
  console.log(`manifest ${join(dest, "TIER1_MANIFEST.json")} carries a sha256 per file`);
}

console.log(`detected ${detected.length} object(s) in the banking tree`);
console.log(`  TIER1 transactional : ${counts.TIER1}`);
console.log(`  TIER2 knowledge     : ${counts.TIER2}`);
console.log(`  TIER3 deferred (v2) : ${counts.TIER3}`);
console.log(`  EXCLUDED by rule    : ${counts.EXCLUDED}`);
console.log(`completeness holds: ${detected.length} detected === ${summed} classified`);
console.log(`written ${jsonPath} and ${join(OUT_DIR, "INVENTORY.md")} (both gitignored)`);
