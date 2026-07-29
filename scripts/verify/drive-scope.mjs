#!/usr/bin/env node
/** Acceptance criterion eight: the cloud drive scope is the per file scope only. Owner: build tooling. */
import { walk, read, verdict } from "./_util.mjs";
// A forbidden full scope is a quoted string literal that is exactly the broad drive scope.
// A .startsWith guard or a variable comparison that DETECTS a broad scope is defensive and allowed.
const FULL = /["']https:\/\/www\.googleapis\.com\/auth\/drive["']/;
const DEFENSIVE = /(startsWith|includes|forbidden|assert|reject|throw|!==|===|filter)\b/;
const NARROW = /auth\/drive\.file/;
const files = walk("src", [".ts", ".tsx"]).concat(walk("scripts", [".mjs"]));
const findings = [];
let narrowSeen = 0;
for (const f of files) {
  read(f).split("\n").forEach((line, i) => {
    if (FULL.test(line) && !DEFENSIVE.test(line)) findings.push(f + ":" + (i + 1) + " references the full drive scope, which is forbidden");
    if (NARROW.test(line)) narrowSeen += 1;
  });
}
if (narrowSeen === 0) findings.push("the narrow per file drive scope was never found in source, so the scope assertion may have been removed");
verdict("drive scope is per file only", findings, ["narrow scope references found: " + narrowSeen]);
