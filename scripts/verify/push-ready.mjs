#!/usr/bin/env node
/** Acceptance criterion fifteen: the repository is push ready and has not been pushed. Owner: build tooling. */
import { existsSync } from "node:fs";
import { git, verdict } from "./_util.mjs";
const findings = [];
if (!existsSync("RELEASE_CHECKLIST.md")) findings.push("RELEASE_CHECKLIST.md is missing");
const dirty = git(["status", "--porcelain"]);
if (dirty) findings.push("the working tree is not clean: " + dirty.split("\n").length + " entry(ies)");
const remotes = git(["remote"]).split("\n").filter(Boolean);
const remoteBranches = git(["branch", "-r"]).split("\n").map((s) => s.trim()).filter(Boolean);
if (remoteBranches.length) findings.push("remote tracking branches exist, which indicates a push already happened: " + remoteBranches.join(", "));
const head = git(["log", "-1", "--format=%h %s"]);
console.log("head:            " + (head || "none"));
console.log("remotes:         " + (remotes.join(", ") || "none configured, which is the expected pre release state"));
console.log("remote branches: " + (remoteBranches.join(", ") || "none"));
console.log("working tree:    " + (dirty ? "dirty" : "clean"));
verdict("repository is push ready and unpushed", findings);
