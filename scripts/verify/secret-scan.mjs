#!/usr/bin/env node
/** Acceptance criterion nine: no secret and no real ledger data is tracked. Owner: build tooling. */
import { existsSync } from "node:fs";
import { read, tracked, verdict } from "./_util.mjs";
const PATTERNS = [
  { name: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "client secret json field", re: /"client_secret"\s*:/ },
  { name: "browser api key literal", re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: "bearer token literal", re: /\bBearer\s+[A-Za-z0-9._-]{25,}\b/ },
  { name: "oauth refresh token field", re: /"refresh_token"\s*:\s*"[^"]{10,}/ },
];
const FORBIDDEN_PATHS = [/^\.env(\.local|\.production|\.development)?$/, /^data\/ledgers\/(?!.*\.example\.).*\.(csv|json)$/i, /token\.json$/, /client_secret/i];
const findings = [];
const files = tracked();
for (const f of files) {
  if (/\.example$/i.test(f) || f.endsWith(".example.json") || f === ".env.example") continue;
  for (const p of FORBIDDEN_PATHS) if (p.test(f)) findings.push("tracked path is forbidden: " + f);
  if (!/\.(ts|tsx|js|mjs|cjs|json|md|css|html|yml|yaml|example|cfg|txt)$/i.test(f)) continue;
  let t = "";
  try { t = read(f); } catch { continue; }
  if (/\.example$/i.test(f) || f.endsWith(".example.json") || f === ".env.example") continue;
  for (const p of PATTERNS) if (p.re.test(t)) findings.push(f + " contains what looks like a " + p.name);
}
if (existsSync(".env.local") && files.includes(".env.local")) findings.push(".env.local is tracked by git");
verdict("no secrets and no real ledger data are tracked", findings, ["scanned " + files.length + " tracked files"]);
