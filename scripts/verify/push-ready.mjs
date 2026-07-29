#!/usr/bin/env node
/**
 * Acceptance criterion fifteen: the repository is release-safe.
 * Owner: build tooling.
 *
 * Two valid states:
 *  - PRE-RELEASE: no remote tracking branch exists (nothing was pushed).
 *  - RELEASED: remote tracking branches exist AND RELEASE_CHECKLIST.md carries
 *    an explicit "Released" acknowledgement — proof the push was deliberate,
 *    owner-authorized, and recorded. An unacknowledged remote branch still fails,
 *    which is exactly the accidental-push case this check exists to catch.
 * In both states the checklist must exist and the working tree must be clean.
 */
import { existsSync, readFileSync } from "node:fs";
import { git, verdict } from "./_util.mjs";
const findings = [];
let checklist = "";
if (!existsSync("RELEASE_CHECKLIST.md")) findings.push("RELEASE_CHECKLIST.md is missing");
else checklist = readFileSync("RELEASE_CHECKLIST.md", "utf8");
const dirty = git(["status", "--porcelain"]);
if (dirty) findings.push("the working tree is not clean: " + dirty.split("\n").length + " entry(ies)");
const remotes = git(["remote"]).split("\n").filter(Boolean);
const remoteBranches = git(["branch", "-r"]).split("\n").map((s) => s.trim()).filter(Boolean);
const releaseAck = /^##\s*Released\b/im.test(checklist);
let state = "pre-release (unpushed)";
if (remoteBranches.length && !releaseAck) {
  findings.push(
    "remote tracking branches exist but RELEASE_CHECKLIST.md has no 'Released' acknowledgement — an unrecorded push: " +
      remoteBranches.join(", "),
  );
} else if (remoteBranches.length) {
  state = "released (push acknowledged in the checklist)";
}
const head = git(["log", "-1", "--format=%h %s"]);
console.log("head:            " + (head || "none"));
console.log("remotes:         " + (remotes.join(", ") || "none configured"));
console.log("remote branches: " + (remoteBranches.join(", ") || "none"));
console.log("working tree:    " + (dirty ? "dirty" : "clean"));
console.log("release state:   " + state);
verdict("repository release state is deliberate and recorded", findings);
