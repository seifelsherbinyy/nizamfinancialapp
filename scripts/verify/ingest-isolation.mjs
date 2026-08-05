#!/usr/bin/env node
/**
 * Acceptance criterion eight b: contract ingestion tooling stays isolated from the
 * shipped application. Owner: build tooling.
 *
 * Why this exists
 *   The application holds the narrow per file drive scope, which cannot read a folder
 *   the owner created by hand. Ingesting the product contracts therefore needed a local
 *   tool holding a broader read only scope. That is acceptable for a local tool and
 *   unacceptable inside the application, so the boundary is enforced here rather than
 *   trusted to memory.
 */
import { existsSync } from "node:fs";
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

verdict("contract ingestion tooling is isolated from the application", findings, notes);
