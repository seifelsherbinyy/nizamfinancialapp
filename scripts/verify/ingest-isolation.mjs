#!/usr/bin/env node
/**
 * Acceptance criterion eight b: code that is not part of the shipped application stays
 * out of the shipped application. Owner: build tooling.
 *
 * Two boundaries, one criterion, because they are the same rule about the same bundle.
 *
 * Boundary one - the ingestion tooling (original AC08b)
 *   The application holds the narrow per file drive scope, which cannot read a folder
 *   the owner created by hand. Ingesting the product contracts therefore needed a local
 *   tool holding a broader read only scope. That is acceptable for a local tool and
 *   unacceptable inside the application, so the boundary is enforced here rather than
 *   trusted to memory.
 *
 * Boundary two - the server tier (added by PFOS Contract 06 / Phase 2.3)
 *   `src/server/**` is the VPS side data tier. It opens a local SQLite file through the
 *   runtime's built in binding and reads the filesystem, so it cannot run in a browser
 *   at all; shipping it would at best bloat the bundle and at worst publish the shape of
 *   the store to anyone who opens dev tools. The same exclusion the steering already
 *   states for `src/features/benchmark/**` and `src/features/routing/**` therefore
 *   applies to it, and is asserted here instead of remembered.
 *
 *   Both directions are asserted, because they fail differently:
 *     SOURCE  no module reachable from the browser entry points imports the tier, and no
 *             browser side module imports it even if it is not wired up yet.
 *     OUTPUT  no server only symbol appears anywhere under dist, which catches a path
 *             the source walk cannot see, such as a bundler alias or a plugin injection.
 *
 *   The check FAILS CLOSED. A missing dist, a missing tier, an unreadable file, an empty
 *   probe list, a probe that no longer exists in the tier, or a probe that is ambiguous
 *   because it also appears in browser source are all failures. A scanner that passes
 *   vacuously is worse than no scanner.
 */
import { existsSync } from "node:fs";
import { dirname, posix } from "node:path";
import { walk, read, git, verdict } from "./_util.mjs";

const TOOL = "scripts/ingest/pfos-drive-pull.mjs";
const TOKEN_CACHE = ".secrets/pfos-ingest.token.json";

// Assembled from fragments so this checker never holds a contiguous copy of the
// unrestricted scope it forbids.
const BASE = "https://www.googleapis.com/auth/";
const READ_ONLY = BASE + "drive.readonly";
const UNRESTRICTED = new RegExp("[\"'`]" + BASE.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "drive[\"'`]");

const findings = [];
const notes = [];

// 1. The broader read only scope must never appear in application source.
const appFiles = walk("src", [".ts", ".tsx"]);
let appScopeHits = 0;
for (const f of appFiles) {
  read(f).split("\n").forEach((line, i) => {
    if (line.includes(READ_ONLY)) {
      appScopeHits += 1;
      findings.push(f + ":" + (i + 1) + " references the broader read only drive scope, which belongs to local tooling only");
    }
  });
}
notes.push("application files scanned: " + appFiles.length + " (broader scope references: " + appScopeHits + ")");

// 2. Application source must never reach into the tooling directory.
const TOOLING_IMPORT = /(?:from\s*|require\(\s*|import\(\s*)["'][^"']*scripts\//;
for (const f of appFiles) {
  read(f).split("\n").forEach((line, i) => {
    if (TOOLING_IMPORT.test(line)) {
      findings.push(f + ":" + (i + 1) + " imports from the tooling directory, so tooling could be bundled into the application");
    }
  });
}

// 3. The ingestion tool itself must stay read only.
if (!existsSync(TOOL)) {
  findings.push("the ingestion tool is missing at " + TOOL);
} else {
  const tool = read(TOOL);
  const offending = tool.split("\n").filter((line) => UNRESTRICTED.test(line));
  if (offending.length) {
    findings.push(TOOL + " references the unrestricted drive scope on " + offending.length + " line(s); ingestion must stay read only");
  }
  if (!tool.includes(READ_ONLY)) {
    findings.push(TOOL + " no longer declares the read only scope, so its permission is unclear");
  }
  // 5. A widened grant must always be withdrawable. Documenting a revoke flag is not
  //    enough; the flag must be wired to code that calls the provider revoke endpoint.
  const documentsRevoke = tool.includes("--revoke");
  const wiresRevoke = /flag\(\s*["'`]revoke["'`]\s*\)/.test(tool);
  const callsRevokeEndpoint = /oauth2\.googleapis\.com\/revoke/.test(tool);
  if (!documentsRevoke || !wiresRevoke || !callsRevokeEndpoint) {
    const missing = [
      documentsRevoke ? null : "a documented revoke flag",
      wiresRevoke ? null : "the flag wired into the entry point",
      callsRevokeEndpoint ? null : "a call to the provider revoke endpoint",
    ].filter(Boolean);
    findings.push(TOOL + " cannot withdraw the read grant: missing " + missing.join(", "));
  }
  notes.push("ingestion tool: read only scope declared; revoke documented, wired and calls the provider endpoint");
}

// 4. The cached token must never become committable.
const ignored = git(["check-ignore", TOKEN_CACHE]);
if (!ignored) {
  findings.push("the ingestion token cache path " + TOKEN_CACHE + " is not git ignored");
} else {
  notes.push("token cache is git ignored: " + TOKEN_CACHE);
}

// ---------------------------------------------------------------------------
// Boundary two: the server tier stays out of the browser bundle. Phase 2.3.
// ---------------------------------------------------------------------------

/**
 * Directory prefixes that are tested modules or a separate runtime tier, never part of
 * the browser bundle. A list rather than a constant so a later phase can claim
 * `src/features/benchmark` and `src/features/routing` under the same mechanism without
 * rewriting the walk.
 */
const EXCLUDED_TIERS = ["src/server"];

/**
 * The browser entry points. `main.tsx` is what `index.html` loads, so it is the true
 * root; the rest are seeded explicitly because they are the files the rule names, and
 * seeding them means the walk still covers them if the graph is ever restructured.
 * Every seed must exist - a vanished seed would shrink the walk silently.
 */
const ENTRY_SEEDS = ["src/main.tsx", "src/App.tsx", "src/app", "src/state"];

/**
 * Symbols that exist ONLY if the server tier was bundled. Each is the *content* of a
 * string literal - a SQLite trigger name, a column name inside DDL text, or a typed
 * error code passed to a constructor - so minification and identifier mangling preserve
 * it verbatim, which is not true of a class or function name.
 *
 * Accidental collision is not merely unlikely, it is checked: every probe below must be
 * present somewhere in the tier AND absent from every other file under `src`, or this
 * check fails before it ever looks at dist. A probe that rots into a false positive or a
 * false negative therefore surfaces as a harness failure rather than as silence.
 */
const BUNDLE_PROBES = [
  "raw_payload_pruned_at", // src/server/db/schema.ts, migration 002 DDL
  "decisions_append_only_delete", // src/server/db/schema.ts, migration 004 trigger
  "spend_ledger_append_only_update", // src/server/db/schema.ts, migration 005 trigger
  "STORE_PATH_ESCAPES_DATA_DIR", // src/server/db/paths.ts, typed error code
  "MIGRATION_CHECKSUM_MISMATCH", // src/server/db/errors.ts, typed error code
  "TURN_MODEL_GRANT_NOT_MINTED", // src/server/routing/turnDispatch.ts, typed error code
  "ELIGIBILITY_REGISTRY_PROVISIONAL_FLAG_ABSENT", // src/server/routing/eligibilityRegistry.ts, typed error code
  "queue_worker_not_reporting", // src/server/ops/healthProbe.ts, readiness failure code (task 7.5)
  "no_field_beyond_the_record_shape", // src/server/ops/redactedLogger.ts, log line claim (task 7.5)
];

const SOURCE_EXTS = [".ts", ".tsx"];
const DIST_TEXT_EXTS = [".js", ".mjs", ".cjs", ".css", ".html", ".json", ".webmanifest", ".map", ".txt"];
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;

function inTier(path) {
  return EXCLUDED_TIERS.some((t) => path === t || path.startsWith(t + "/"));
}

function isTest(path) {
  return /\.test\.[tj]sx?$/.test(path);
}

/** Read a file, or record the unreadable path as a finding. Never returns silently empty. */
function readOrFail(path, why) {
  try {
    return read(path);
  } catch (e) {
    findings.push(path + " could not be read while " + why + " (" + String(e && e.message) + "); the scan cannot be trusted");
    return null;
  }
}

/**
 * Normalize an import specifier to a repo relative path guess. Returns null for a bare
 * package specifier. Deliberately textual: the guess is made BEFORE resolution, so a
 * specifier that points into the tier is caught even if it never resolves to a file on
 * this machine.
 */
function normalizeSpecifier(fromFile, spec) {
  if (spec.startsWith("@/")) return posix.normalize("src/" + spec.slice(2));
  if (spec.startsWith("./") || spec.startsWith("../")) {
    return posix.normalize(posix.join(dirname(fromFile).split("\\").join("/"), spec));
  }
  if (spec.startsWith("src/") || spec.startsWith("/src/")) return posix.normalize(spec.replace(/^\//, ""));
  return null;
}

/** Resolve a normalized path to an actual source file, honouring implicit extensions. */
function resolveModule(base) {
  const candidates = [base, ...SOURCE_EXTS.map((e) => base + e), ...SOURCE_EXTS.map((e) => base + "/index" + e), base + ".js", base + ".jsx"];
  return candidates.find((c) => existsSync(c) && !c.endsWith("/")) ?? null;
}

const serverTierBefore = findings.length;

// 1. The tier must exist and be non empty. An empty tier makes every later assertion vacuous.
const tierFiles = EXCLUDED_TIERS.flatMap((t) => walk(t, SOURCE_EXTS));
if (!tierFiles.length) {
  findings.push("the excluded tier(s) " + EXCLUDED_TIERS.join(", ") + " contain no source file, so this check would pass vacuously");
}

// 2. The probe list must be non empty.
if (!BUNDLE_PROBES.length) {
  findings.push("the built output probe list is empty, so the dist scan would pass vacuously");
}

// 3. Every probe must still exist in the tier, and must be unique to it.
const allSrc = walk("src", SOURCE_EXTS);
const nonTierSrc = allSrc.filter((f) => !inTier(f));
const tierText = tierFiles.map((f) => ({ f, text: readOrFail(f, "collecting tier source") })).filter((x) => x.text !== null);
const nonTierText = nonTierSrc.map((f) => ({ f, text: readOrFail(f, "collecting browser source") })).filter((x) => x.text !== null);

for (const probe of BUNDLE_PROBES) {
  if (!tierText.some((x) => x.text.includes(probe))) {
    findings.push('built output probe "' + probe + '" no longer appears in ' + EXCLUDED_TIERS.join(", ") + "; it can no longer detect a bundled tier and must be replaced");
  }
  const ambiguous = nonTierText.filter((x) => x.text.includes(probe)).map((x) => x.f);
  if (ambiguous.length) {
    findings.push('built output probe "' + probe + '" also appears in browser source (' + ambiguous.slice(0, 3).join(", ") + "); it cannot distinguish a bundled tier and must be replaced");
  }
}

// 4. SOURCE direction: nothing reachable from the browser entry imports the tier, and no
//    browser side module imports it even if it is not reachable yet.
const missingSeeds = ENTRY_SEEDS.filter((s) => !existsSync(s));
if (missingSeeds.length) {
  findings.push("browser entry seed(s) missing: " + missingSeeds.join(", ") + "; the reachability walk would be incomplete");
}

const seedFiles = ENTRY_SEEDS.flatMap((s) => {
  if (!existsSync(s)) return [];
  return SOURCE_EXTS.some((e) => s.endsWith(e)) ? [s] : walk(s, SOURCE_EXTS);
});
const seeds = [...new Set(seedFiles)].filter((f) => !isTest(f));
if (!seeds.length) {
  findings.push("no browser entry file was found, so the reachability walk would pass vacuously");
}

/** file -> the importer that first reached it, for a readable chain in the failure text. */
const reachedVia = new Map(seeds.map((s) => [s, null]));
const queue = [...seeds];
const unresolved = [];
let edges = 0;

function chainOf(file) {
  const parts = [];
  let cur = file;
  while (cur && parts.length < 12) {
    parts.unshift(cur);
    cur = reachedVia.get(cur) ?? null;
  }
  return parts.join(" -> ");
}

while (queue.length) {
  const file = queue.shift();
  const text = readOrFail(file, "walking the browser import graph");
  if (text === null) continue;
  SPECIFIER.lastIndex = 0;
  let m;
  while ((m = SPECIFIER.exec(text)) !== null) {
    const spec = m[1];
    const guess = normalizeSpecifier(file, spec);
    if (!guess) continue;
    edges += 1;
    if (inTier(guess)) {
      findings.push('"' + spec + '" in ' + file + " reaches the excluded tier from the browser entry: " + chainOf(file) + " -> " + guess);
      continue;
    }
    const resolved = resolveModule(guess);
    if (!resolved) {
      unresolved.push(file + " -> " + spec);
      continue;
    }
    if (!SOURCE_EXTS.some((e) => resolved.endsWith(e))) continue;
    if (isTest(resolved)) continue;
    if (reachedVia.has(resolved)) continue;
    reachedVia.set(resolved, file);
    queue.push(resolved);
  }
}

// The broad scan: a browser side module that imports the tier is a violation even if the
// router has not wired it up yet, because wiring it up later would be a one line change
// that this check would then have to catch after the fact.
for (const { f, text } of nonTierText) {
  if (isTest(f)) continue;
  SPECIFIER.lastIndex = 0;
  let m;
  while ((m = SPECIFIER.exec(text)) !== null) {
    const guess = normalizeSpecifier(f, m[1]);
    if (guess && inTier(guess) && !reachedVia.has(f)) {
      findings.push('"' + m[1] + '" in ' + f + " imports the excluded tier; a browser side module must never reference " + EXCLUDED_TIERS.join(" or "));
    }
  }
}

notes.push(
  "browser import graph: " +
    reachedVia.size +
    " module(s) reachable from " +
    seeds.length +
    " entry seed(s) over " +
    edges +
    " local edge(s); tier files held out: " +
    tierFiles.length,
);
if (unresolved.length) notes.push("non source specifiers skipped (assets and generated types): " + unresolved.length);

// 5. OUTPUT direction: no probe appears anywhere under dist.
if (!existsSync("dist")) {
  findings.push("dist does not exist, so the built output could not be scanned; run npm run build before this check");
} else {
  const distFiles = walk("dist").filter((f) => DIST_TEXT_EXTS.some((e) => f.endsWith(e)));
  const distJs = distFiles.filter((f) => f.endsWith(".js"));
  if (!distJs.length) {
    findings.push("dist contains no javascript asset, so scanning it for server tier symbols proves nothing");
  }
  let scanned = 0;
  for (const f of distFiles) {
    const text = readOrFail(f, "scanning the built output");
    if (text === null) continue;
    scanned += 1;
    for (const probe of BUNDLE_PROBES) {
      if (text.includes(probe)) {
        findings.push(f + ' contains the server tier symbol "' + probe + '", so ' + EXCLUDED_TIERS.join(" or ") + " was bundled into the browser output");
      }
    }
  }
  if (scanned !== distFiles.length) {
    findings.push("only " + scanned + " of " + distFiles.length + " built assets could be read; the built output scan is incomplete");
  }
  notes.push("built output scanned: " + scanned + " text asset(s) (" + distJs.length + " script) against " + BUNDLE_PROBES.length + " server tier probe(s)");
}

if (findings.length === serverTierBefore) {
  notes.push("server tier isolated: no browser module imports " + EXCLUDED_TIERS.join(" or ") + ", and no server tier symbol reached dist");
}

verdict("ingestion tooling and the server tier stay out of the application bundle", findings, notes);
