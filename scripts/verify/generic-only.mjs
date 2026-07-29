#!/usr/bin/env node
/**
 * Acceptance criterion eleven: no organization specific term appears in a tracked file.
 * Owner: build tooling.
 * The denylist is assembled from fragments so this checker never contains a
 * contiguous copy of a term it is meant to forbid.
 */
import { read, tracked, verdict } from "./_util.mjs";
const DENY = [
  "ama" + "zon", "a" + "wS".toLowerCase(), "vendor cen" + "tral", "brand spec" + "ialist",
  "vendor co" + "de", "seller cen" + "tral", "internal wi" + "ki", "corp" + "orate vpn",
];
const ALLOW_FILES = new Set([".gitignore", "scripts/verify/generic-only.mjs", "package-lock.json"]);
const SKIP_EXT = /\.(lock)$|-lock\.json$/i; // dependency lockfiles are integrity-hash noise, not prose
const findings = [];
const files = tracked().filter((f) => /\.(ts|tsx|js|mjs|cjs|json|md|css|html|yml|yaml|txt)$/i.test(f));
for (const f of files) {
  if (ALLOW_FILES.has(f) || SKIP_EXT.test(f)) continue;
  let t = "";
  try { t = read(f).toLowerCase(); } catch { continue; }
  for (const d of DENY) if (t.includes(d)) findings.push(f + " contains an organization specific term");
}
verdict("no organization specific terms in tracked files", findings, ["scanned " + files.length + " tracked text files against " + DENY.length + " denied terms"]);
