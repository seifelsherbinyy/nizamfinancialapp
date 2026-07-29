#!/usr/bin/env node
/** Acceptance criterion fourteen: the working tree is clean. Owner: build tooling. */
import { git, verdict } from "./_util.mjs";
const dirty = git(["status", "--porcelain"]).split("\n").filter(Boolean);
verdict("working tree is clean", dirty.map((l) => "uncommitted entry: " + l), ["entries: " + dirty.length]);
