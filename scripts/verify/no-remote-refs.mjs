#!/usr/bin/env node
/**
 * Acceptance criterion six: the built output holds no remote asset reference,
 * so the application loads with the network disabled.
 * Owner: build tooling.
 * A remote origin inside a script string is a runtime application programming
 * interface call, which is expected, so it is reported as information only.
 * A remote origin in a markup source or link attribute, or in a stylesheet url,
 * is a hard failure because the shell would not paint offline.
 */
import { existsSync } from "node:fs";
import { walk, read, verdict } from "./_util.mjs";
const target = process.argv[2] ?? "dist";
if (!existsSync(target)) {
  console.error("FAIL no built output at " + target + ". Run npm run build first.");
  process.exit(1);
}
const ATTR = /(?:src|href)\s*=\s*["\x27](https?:)?\/\/[^"\x27]+/gi;
const CSSURL = /url\(\s*["\x27]?(https?:)?\/\/[^)]+/gi;
const ALLOW = [/www\.w3\.org/i];
const findings = [];
const info = [];
for (const f of walk(target, [".html", ".css", ".js", ".webmanifest", ".json"])) {
  const t = read(f);
  if (/\.html$/i.test(f)) for (const m of t.match(ATTR) ?? []) if (!ALLOW.some((a) => a.test(m))) findings.push(f + " markup references a remote asset: " + m.slice(0, 90));
  if (/\.css$/i.test(f)) for (const m of t.match(CSSURL) ?? []) if (!ALLOW.some((a) => a.test(m))) findings.push(f + " stylesheet references a remote url: " + m.slice(0, 90));
  if (/\.js$/i.test(f)) {
    const origins = [...new Set((t.match(/https?:\/\/[a-z0-9.-]+/gi) ?? []).map((s) => s.toLowerCase()))];
    origins.forEach((o) => info.push("script origin string, allowed as a runtime call: " + o));
  }
}
verdict("built output has no remote asset reference", findings, info.slice(0, 15));
