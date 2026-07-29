#!/usr/bin/env node
/** Acceptance criterion one: zero placeholder markers remain in src. Owner: build tooling. */
import { walk, read, verdict } from "./_util.mjs";
const MARKERS = [/placeholder\s*.{0,3}\s*replace on implementation/i, /Status:\s*PLACEHOLDER/i, /^\s*export\s*\{\s*\}\s*;?\s*\/\/\s*placeholder/im];
const findings = [];
for (const f of walk("src", [".ts", ".tsx"])) {
  const t = read(f);
  for (const m of MARKERS) if (m.test(t)) { findings.push(f + " still carries a placeholder marker"); break; }
}
verdict("no placeholders in src", findings, ["scanned " + walk("src", [".ts", ".tsx"]).length + " source files"]);
