/** Shared helpers for the invariant checkers. Owner: build tooling. Zero dependencies. */
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { execFileSync } from "node:child_process";

export const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".vite", "outputs", ".loop"]);

export function walk(dir, exts = null, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, exts, acc);
    else if (!exts || exts.includes(extname(p))) acc.push(p.split("\\").join("/"));
  }
  return acc;
}

export function read(p) {
  return readFileSync(p, "utf8");
}

export function tracked() {
  try {
    return execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

/** Print a verdict and exit. findings is an array of strings. */
export function verdict(label, findings, extra = []) {
  extra.forEach((l) => console.log(l));
  if (findings.length) {
    console.error("FAIL " + label + ": " + findings.length + " finding(s)");
    findings.slice(0, 40).forEach((f) => console.error("  - " + f));
    if (findings.length > 40) console.error("  ... " + (findings.length - 40) + " more");
    process.exit(1);
  }
  console.log("PASS " + label);
  process.exit(0);
}

export function arg(name, dflt = null) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
