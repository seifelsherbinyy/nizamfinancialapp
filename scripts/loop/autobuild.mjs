#!/usr/bin/env node
/**
 * The autonomous builder. Selects the next open spec task, refuses anything gated, delegates
 * the build to one isolated subagent, re-runs the acceptance harness, and records the result
 * to the hash-chained ledger. Terminates by construction.
 * Owner: build tooling. Contract: PFOS build loop. Phase: build loop.
 *
 * FOUR PROPERTIES, each of which exists because its absence has already cost something:
 *
 *  1. It cannot work a gated item. ops/GATE_REGISTER.md forbids agent execution of every
 *     G1-G8 step in its own text. gate-guard.mjs is fail-closed and negative-tested.
 *  2. It refuses to run while another writer is changing the tree. A verdict measured on a
 *     tree a parallel agent is rewriting describes a tree that will never exist. Foreign dirty
 *     paths are pinned by content hash and any drift stops the run.
 *  3. It cannot advance on a regression. The rule is not "the harness is green", because the
 *     harness is legitimately red on a dirty tree. The rule is that the FAILING SET may not
 *     grow. A new red is a stop, always.
 *  4. It provably terminates. Per-task attempt cap, per-run cycle cap, and a lock with a
 *     staleness bound. No unbounded retry anywhere.
 *
 * It records PRODUCE as one actor and VERIFY as another because the ledger refuses
 * self-approval (SelfApprovalError). That refusal is load-bearing, so it is honoured rather
 * than worked around.
 *
 * USAGE
 *   node scripts/loop/autobuild.mjs --dry               plan one cycle, mutate nothing
 *   node scripts/loop/autobuild.mjs --emit              print the next task packet as JSON
 *   node scripts/loop/autobuild.mjs --cycles 1          run one real cycle
 *   node scripts/loop/autobuild.mjs --adopt-dirty       pin the current foreign dirty set first
 *   node scripts/loop/autobuild.mjs --only 07-bot-bringup-v1   aim it at one spec
 *   node scripts/loop/autobuild.mjs --status            print state and stop
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { assertNotGated, GateRefusal, gateVerdict } from "./gate-guard.mjs";
import { readOpenTasks, countTasks, unlistedSpecs, taskKey } from "./task-source.mjs";

// ---------------------------------------------------------------- constants, all tunable
const STATE_DIR = ".loop/tmp";                 // gitignored: builder state never dirties the tree
const STATE_FILE = `${STATE_DIR}/autobuild-state.json`;
const LOCK_FILE = `${STATE_DIR}/autobuild.lock`;
const LOCK_STALE_MS = 2 * 60 * 60 * 1000;      // a lock older than this is assumed abandoned
const MAX_ATTEMPTS_PER_TASK = 2;               // then the task is parked and the owner is asked
const DEFAULT_CYCLES = 1;                      // opt in to more, deliberately
const AGENT_TIMEOUT_S = 1800;
const AGENT_PROFILE = "akisa";
const PRODUCER_ACTOR = "autobuilder";
const VERIFIER_ACTOR = "gate-runner";

// ---------------------------------------------------------------- tiny helpers
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const num = (f, d) => { const v = Number(val(f, d)); return Number.isFinite(v) ? v : d; };
const say = (a, b) => console.log(String(a).padEnd(34) + (b ?? ""));
const rule = () => console.log("-".repeat(78));

function sh(bin, args, opts = {}) {
  return spawnSync(bin, args, { encoding: "utf8", shell: bin === "npm", ...opts });
}
function gitDirty() {
  const r = sh("git", ["status", "--porcelain"]);
  if (r.status !== 0) return null;
  return (r.stdout ?? "").split(/\r?\n/).filter((l) => l.trim())
    .map((l) => l.slice(3).trim().replace(/^"|"$/g, ""));
}
function hashOf(path) {
  try { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
  catch { return "ABSENT"; }
}
function loadState() {
  if (!existsSync(STATE_FILE)) {
    return { version: 1, attempts: {}, ownedPaths: [], foreignBaseline: {}, cycles: [], parked: {} };
  }
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); }
  catch { return { version: 1, attempts: {}, ownedPaths: [], foreignBaseline: {}, cycles: [], parked: {} }; }
}
function saveState(s) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------- the harness reading
/**
 * Runs the acceptance harness and returns a structured reading.
 * The failing SET matters more than the count: a dirty tree makes AC14 and AC15 red by
 * definition, so "green" is the wrong bar and "no NEW red" is the right one.
 */
function readHarness() {
  const r = sh("npm", ["run", "verify:all", "--", "--all"]);
  const out = (r.stdout ?? "") + "\n" + (r.stderr ?? "");
  const failing = [];
  const passing = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^(PASS|FAIL)\s+(\S+)\s+(.*)$/.exec(line.trim());
    if (!m) continue;
    (m[1] === "FAIL" ? failing : passing).push(m[2]);
  }
  const tally = /verification harness:\s*(\d+)\s+of\s+(\d+)/.exec(out);
  return {
    ok: r.status === 0,
    passed: tally ? Number(tally[1]) : passing.length,
    total: tally ? Number(tally[2]) : passing.length + failing.length,
    failing: [...new Set(failing)].sort(),
    passing: [...new Set(passing)].sort(),
    measured: Boolean(tally) || passing.length + failing.length > 0,
  };
}

// ---------------------------------------------------------------- preflight
function preflight(state, opts) {
  const findings = [];

  // P0  the runtime must be Node. On this machine a bare `node` on PATH can resolve to a
  // different runtime whose --test semantics differ, which would make the builder's own
  // negative suite report a failure that is really a runtime mismatch. Fail closed and name
  // the fix rather than producing a verdict from the wrong interpreter.
  const isNode = typeof process.versions?.node === "string" && !process.versions.bun && !process.versions.deno;
  if (!isNode) {
    findings.push({
      id: "P0",
      detail: "this is not the Node runtime (" + JSON.stringify(process.versions) + "). "
        + "Run it as: npm run loop:auto -- <flags>",
    });
    return findings;   // nothing below can be trusted, so do not pretend to measure it
  }
  say("P0 runtime", "node " + process.versions.node);

  // P1  no second instance
  if (existsSync(LOCK_FILE)) {
    const age = Date.now() - statSync(LOCK_FILE).mtimeMs;
    if (age < LOCK_STALE_MS) {
      findings.push({ id: "P1", detail: `a lock is held and is only ${Math.round(age / 1000)}s old: ${LOCK_FILE}` });
    } else {
      rmSync(LOCK_FILE, { force: true });
      say("P1 stale lock removed", `age ${Math.round(age / 60000)} min`);
    }
  }

  // P2  the tree has no writer other than this builder
  const dirty = gitDirty();
  if (dirty === null) {
    findings.push({ id: "P2", detail: "git status could not be read, so ownership cannot be established" });
  } else {
    const owned = new Set(state.ownedPaths ?? []);
    const pinned = state.foreignBaseline ?? {};
    const unknown = dirty.filter((p) => !owned.has(p) && !(p in pinned));
    if (unknown.length && !opts.adoptDirty) {
      findings.push({
        id: "P2",
        detail: `${unknown.length} dirty path(s) belong to neither this builder nor the pinned foreign set. `
          + `Re-run with --adopt-dirty to pin them as somebody else's work: ${unknown.slice(0, 6).join(", ")}`,
      });
    }
    // P3  a pinned foreign file that CHANGED means the other writer is active right now
    const drifted = Object.entries(pinned).filter(([p, h]) => hashOf(p) !== h).map(([p]) => p);
    if (drifted.length) {
      findings.push({
        id: "P3",
        detail: `${drifted.length} pinned foreign file(s) changed since the last cycle, so another writer is live: `
          + drifted.slice(0, 6).join(", "),
      });
    }
    say("P2 dirty paths", `${dirty.length} total, ${Object.keys(pinned).length} pinned foreign, ${owned.size} owned`);
  }

  // P4  the builder's own refusal tests must pass before it is trusted to refuse anything
  const t = sh(process.execPath, ["--test", "scripts/loop/autobuild.test.mjs"]);
  if (t.status !== 0) {
    findings.push({ id: "P4", detail: "the builder's own negative tests are RED, so its guards are unproven" });
  } else {
    say("P4 own negative tests", "pass");
  }

  // P5  specs on disk that the declared order does not cover
  const unlisted = unlistedSpecs();
  if (unlisted.length) say("P5 unlisted specs (not worked)", unlisted.join(", "));

  return findings;
}

// ---------------------------------------------------------------- the executor prompt
function buildPrompt(task) {
  return [
    `Work exactly one task in the NIZAM repository at ${process.cwd()}.`,
    ``,
    `TASK ${task.id} from ${task.file} line ${task.line}:`,
    task.text,
    ``,
    `BEFORE YOU WRITE ANYTHING, read in this order:`,
    `  1. ${task.file.replace(/tasks\.md$/, "requirements.md")}`,
    `  2. ${task.file.replace(/tasks\.md$/, "design.md")}`,
    `  3. .kiro/steering/loop-protocol.md and .kiro/steering/pfos-current.md`,
    ``,
    `HARD RULES, non-negotiable:`,
    `  - Do NOT touch ops/GATE_REGISTER.md and do NOT perform any G1-G8 gate step.`,
    `  - Do NOT invent a secret value, not even as an example or a placeholder that looks real.`,
    `  - Do NOT weaken, skip or relax any check in scripts/verify to make something pass.`,
    `  - Do NOT commit. Leave your work uncommitted; the driver verifies and records it.`,
    `  - Do NOT modify scripts/verify/all.mjs; its check count is a documented acceptance number.`,
    `  - Write tests for what you build, and show a negative test actually FIRING, not just passing.`,
    ``,
    `WHEN DONE, run: npm run verify:all -- --all`,
    `Then reply with at most 12 lines: the files you changed, the tests you added, the harness`,
    `pass count, and any check that went red. If you could not finish, say so and say why in one line.`,
  ].join("\n");
}

// ---------------------------------------------------------------- record to the ledger
function record(kind, itemId, actor, files, note) {
  const args = ["scripts/loop/record.mjs", "--kind", kind, "--item", itemId, "--actor", actor, "--note", note];
  if (files.length) args.push("--files", files.join(","));
  const r = sh(process.execPath, args);
  return { ok: r.status === 0, out: ((r.stdout ?? "") + (r.stderr ?? "")).trim() };
}

// ---------------------------------------------------------------- main
function main() {
  const opts = {
    dry: has("--dry"),
    emit: has("--emit"),
    status: has("--status"),
    adoptDirty: has("--adopt-dirty"),
    noRecord: has("--no-record"),
    cycles: num("--cycles", DEFAULT_CYCLES),
    maxAttempts: num("--max-attempts", MAX_ATTEMPTS_PER_TASK),
    timeout: num("--timeout", AGENT_TIMEOUT_S),
    profile: val("--profile", AGENT_PROFILE),
    model: val("--model", null),
  };
  const state = loadState();

  rule();
  console.log("NIZAM autonomous builder");
  rule();

  const tally = countTasks();
  const totals = Object.values(tally).reduce((a, b) => ({ open: a.open + b.open, done: a.done + b.done }), { open: 0, done: 0 });
  say("task surface", `${totals.open} open, ${totals.done} done, across ${Object.keys(tally).length} specs`);
  say("mode", opts.dry ? "DRY, mutates nothing" : opts.emit ? "EMIT, prints the packet only" : `LIVE, up to ${opts.cycles} cycle(s)`);

  if (opts.status) {
    rule();
    for (const [spec, t] of Object.entries(tally)) say("  " + spec, `open ${t.open}  done ${t.done}`);
    say("attempts recorded", String(Object.keys(state.attempts ?? {}).length));
    say("parked tasks", Object.keys(state.parked ?? {}).join(", ") || "none");
    say("pinned foreign files", String(Object.keys(state.foreignBaseline ?? {}).length));
    say("cycles in state", String((state.cycles ?? []).length));
    return 0;
  }

  // ---- adopt-dirty pins the current foreign set BEFORE preflight judges it
  if (opts.adoptDirty) {
    const dirty = gitDirty() ?? [];
    const owned = new Set(state.ownedPaths ?? []);
    const pinned = {};
    for (const p of dirty) if (!owned.has(p)) pinned[p] = hashOf(p);
    state.foreignBaseline = pinned;
    if (!(opts.dry || opts.emit)) saveState(state);
    say("adopted foreign dirty set", `${Object.keys(pinned).length} path(s) pinned by content hash`);
  }

  rule();
  const findings = preflight(state, opts);
  if (findings.length) {
    rule();
    console.error("PREFLIGHT REFUSED. Nothing was executed.");
    for (const f of findings) console.error(`  ${f.id}  ${f.detail}`);
    return 2;
  }
  say("preflight", "clear");

  // ---- select
  rule();
  const only = val("--only", null);
  let open = readOpenTasks();
  if (only) {
    const n = open.length;
    open = open.filter((t) => t.spec === only);
    say("restricted to spec", `${only}  (${open.length} of ${n} open tasks)`);
    if (open.length === 0) { console.error(`NO OPEN TASK in spec ${only}. Check the name against --status.`); return 0; }
  }
  const parked = state.parked ?? {};
  const candidate = open.find((t) => !parked[taskKey(t)]);
  if (!candidate) {
    console.log("NO WORKABLE TASK. Every open task is parked or the surface is empty.");
    return 0;
  }
  const key = taskKey(candidate);
  say("selected", `${key}  (${candidate.file} line ${candidate.line})`);
  console.log("  " + candidate.title.slice(0, 140));

  // ---- gate guard, the whole reason this driver is allowed to exist
  try {
    assertNotGated(candidate.text, candidate.file);
    say("gate guard", "clear, this task is not gated");
  } catch (e) {
    if (!(e instanceof GateRefusal)) throw e;
    rule();
    console.error("STOPPED: the next task is GATED and an agent may not execute it.");
    for (const r of e.reasons) console.error(`  ${r.id}  ${r.why}`);
    console.error("");
    console.error("ONE SPECIFIC REQUEST FOR THE OWNER:");
    console.error(`  ${candidate.title}`);
    console.error(`  source: ${candidate.file} line ${candidate.line}`);
    console.error("  Do that step yourself, tick the box, then re-run this builder.");
    console.error("  If you judge the refusal wrong, park it: --status shows the key, and a parked");
    console.error("  task is skipped rather than silently marked done.");
    if (opts.dry || opts.emit) {
      console.error("  (dry run: nothing was parked and no state was written)");
    } else {
      state.parked[key] = { reason: "GATED", at: new Date().toISOString(), rules: e.reasons.map((r) => r.id) };
      saveState(state);
    }
    return 3;
  }

  // ---- attempt cap
  const attempts = state.attempts[key] ?? 0;
  if (attempts >= opts.maxAttempts) {
    rule();
    console.error(`STOPPED: ${key} has had ${attempts} attempt(s), at the cap of ${opts.maxAttempts}.`);
    console.error("  Parking it so the loop cannot spin. Read the last cycle note and decide.");
    if (!(opts.dry || opts.emit)) {
      state.parked[key] = { reason: "ATTEMPT_CAP", at: new Date().toISOString(), attempts };
      saveState(state);
    }
    return 4;
  }
  say("attempts on this task", `${attempts} of ${opts.maxAttempts}`);

  // ---- baseline
  rule();
  say("measuring baseline", "npm run verify:all -- --all");
  const before = readHarness();
  if (!before.measured) {
    console.error("STOPPED: the harness produced no readable result, so there is no baseline to protect.");
    return 5;
  }
  say("baseline", `${before.passed} of ${before.total} pass; failing: ${before.failing.join(", ") || "none"}`);

  const packet = {
    key, spec: candidate.spec, id: candidate.id, file: candidate.file, line: candidate.line,
    title: candidate.title, text: candidate.text,
    gateVerdict: gateVerdict(candidate.text, candidate.file),
    baseline: before, attempts, prompt: buildPrompt(candidate),
  };

  if (opts.emit) { rule(); console.log(JSON.stringify(packet, null, 2)); return 0; }
  if (opts.dry) {
    rule();
    console.log("DRY RUN. This is the prompt that would be sent to one isolated subagent:");
    rule();
    console.log(packet.prompt);
    rule();
    console.log("Nothing was executed, nothing was recorded, no state was written.");
    return 0;
  }

  // ---- execute
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, key, at: new Date().toISOString() }), "utf8");
  let exit = 0;
  try {
    state.attempts[key] = attempts + 1;
    saveState(state);
    const dirtyBefore = new Set(gitDirty() ?? []);

    rule();
    say("delegating to", `agent run --profile ${opts.profile} --timeout ${opts.timeout}`);
    const agentArgs = ["run", "--name", "autobuild", "--profile", opts.profile,
      "--mode", "act", "--timeout", String(opts.timeout), "--task", packet.prompt];
    if (opts.model) agentArgs.push("--model", opts.model);
    const run = sh("agent", agentArgs, { maxBuffer: 32 * 1024 * 1024 });
    const answer = ((run.stdout ?? "") + (run.stderr ?? "")).trim();
    say("subagent exit", String(run.status));
    rule();
    console.log(answer.split(/\r?\n/).slice(-24).join("\n"));

    // ---- verify: the failing set may not grow
    rule();
    say("re-measuring", "npm run verify:all -- --all");
    const after = readHarness();
    const newRed = after.failing.filter((f) => !before.failing.includes(f));
    const dirtyAfter = gitDirty() ?? [];
    const produced = dirtyAfter.filter((p) => !dirtyBefore.has(p));
    say("after", `${after.passed} of ${after.total} pass; failing: ${after.failing.join(", ") || "none"}`);
    say("new red", newRed.join(", ") || "none");
    say("files this cycle produced", String(produced.length));

    const regressed = newRed.length > 0 || after.passed < before.passed;
    if (regressed) {
      rule();
      console.error("STOPPED: this cycle REGRESSED the harness. Not recording, not advancing.");
      if (newRed.length) console.error("  new red checks: " + newRed.join(", "));
      if (after.passed < before.passed) console.error(`  pass count fell ${before.passed} -> ${after.passed}`);
      console.error("  The work is left uncommitted on disk so you can inspect or discard it:");
      console.error("    git diff        then      git checkout -- <path>   to discard");
      exit = 6;
    } else if (produced.length === 0) {
      rule();
      console.error("STOPPED: the subagent changed nothing. Treating a no-op as a failure, not a success.");
      exit = 7;
    } else if (!opts.noRecord) {
      state.ownedPaths = [...new Set([...(state.ownedPaths ?? []), ...produced])];
      const item = `AB:${key}`;
      const note = `autobuild ${key}: ${after.passed}/${after.total} harness, ${produced.length} file(s)`;
      const p = record("PRODUCE", item, PRODUCER_ACTOR, produced, note);
      const v = p.ok ? record("VERIFY", item, VERIFIER_ACTOR, produced, `no new red; failing set unchanged`) : { ok: false, out: "skipped" };
      say("ledger PRODUCE", p.ok ? "recorded" : "FAILED: " + p.out.slice(0, 90));
      say("ledger VERIFY", v.ok ? "recorded" : "FAILED: " + v.out.slice(0, 90));
      if (!p.ok || !v.ok) exit = 8;
    }

    state.cycles.push({
      at: new Date().toISOString(), key, attempts: state.attempts[key],
      before: { passed: before.passed, failing: before.failing },
      after: { passed: after.passed, failing: after.failing },
      produced, newRed, exit,
    });
    saveState(state);
  } finally {
    rmSync(LOCK_FILE, { force: true });
  }

  rule();
  console.log(exit === 0 ? "CYCLE COMPLETE." : `CYCLE STOPPED with code ${exit}.`);
  console.log("State: " + STATE_FILE + "   Ledger: .loop/verification-ledger.json");
  return exit;
}

process.exit(main());
