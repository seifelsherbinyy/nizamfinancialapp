#!/usr/bin/env node
/**
 * Negative tests for the autonomous builder's refusal boundary.
 * Owner: build tooling. Contract: PFOS build loop. Phase: build loop.
 *
 * A guard only ever observed passing is unproven, so every case below is run in BOTH
 * directions: the guard must REFUSE gated work AND must RELEASE ordinary work. A guard that
 * refuses everything would satisfy every refusal test on its own and be useless, so the
 * release cases are not optional extras, they are half the proof.
 *
 * This file deliberately does NOT import autobuild.mjs. That module runs on load and calls
 * process.exit, which is exactly why the guard and the task reader live in their own modules.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gateVerdict, assertNotGated, GateRefusal, GATE_RULES } from "./gate-guard.mjs";
import { readOpenTasks, scanTasks, countTasks, unlistedSpecs, taskKey, SPEC_ORDER } from "./task-source.mjs";
import { parseHarnessOutput } from "./harness-read.mjs";

// ------------------------------------------------------------------ N: it must REFUSE
const MUST_REFUSE = [
  ["N1  a gate identifier",        "Complete G3 and create the two bots", null, "R-GATE-ID"],
  ["N2  the register itself",      "Fill in the verification line", "ops/GATE_REGISTER.md", "R-PATH-REGISTER"],
  ["N3  awaiting human marker",    "Status: BLOCKED - awaiting human", null, "R-AWAITING-HUMAN"],
  ["N4  minting a credential",     "Mint the two model keys and set the weekly limit", null, "R-MINT-SECRET"],
  ["N5  placing a real secret",    "Write the token into /etc/nizam/life.env and chmod 600", null, "R-PLACE-SECRET"],
  ["N6  a public DNS record",      "Create the A record for the two hostnames at the registrar", null, "R-PUBLIC-RECORD"],
  ["N7  an interactive consent",   "Complete the oauth consent screen and store the refresh token", null, "R-CONSENT"],
  ["N8  webhook registration",     "Register both webhooks with setWebhook", null, "R-WEBHOOK-REG"],
  ["N9  spending money",           "Purchase a domain and add a payment method", null, "R-SPEND"],
  ["N10 mutating the live host",   "ssh into the box and run systemctl restart caddy", null, "R-HOST-MUTATE"],
];

for (const [label, text, path, expectedRule] of MUST_REFUSE) {
  test(`REFUSE ${label}`, () => {
    const v = gateVerdict(text, path);
    assert.equal(v.gated, true, `${label}: the guard did NOT fire, so this gated task would have been executed`);
    const ids = v.reasons.map((r) => r.id);
    assert.ok(ids.includes(expectedRule), `${label}: fired ${ids.join(",")} but the case exists to exercise ${expectedRule}`);
    assert.throws(() => assertNotGated(text, path), GateRefusal, `${label}: assertNotGated must throw, not merely report`);
  });
}

// ------------------------------------------------------------------ P: it must RELEASE
const MUST_RELEASE = [
  ["P1  an ordinary source task", "Write src/features/budget/allocate.ts and its unit tests", ".kiro/specs/03-budget-engine/tasks.md"],
  ["P2  a pure test task",        "Add a property test asserting money stays integral", ".kiro/specs/03-budget-engine/tasks.md"],
  ["P3  a docs task",             "Document the envelope shape in the design note", ".kiro/specs/01-foundation/tasks.md"],
  ["P4  a refactor task",         "Extract the reducer into its own module and keep the public shape", ".kiro/specs/04-ui-ynab/tasks.md"],
];

for (const [label, text, path] of MUST_RELEASE) {
  test(`RELEASE ${label}`, () => {
    const v = gateVerdict(text, path);
    assert.equal(v.gated, false,
      `${label}: the guard refused ordinary work, firing ${v.reasons.map((r) => r.id).join(",")}. ` +
      `A guard that refuses everything is indistinguishable from a broken one.`);
    assert.doesNotThrow(() => assertNotGated(text, path));
  });
}

// ------------------------------------------------------------------ the guard is not vacuous
test("the guard is not always-closed against the REAL task surface", () => {
  const open = readOpenTasks();
  assert.ok(open.length > 0, "no open tasks were read at all, so this assertion would be vacuous");
  const released = open.filter((t) => !gateVerdict(t.text, t.file).gated);
  const refused = open.length - released.length;
  assert.ok(released.length > 0,
    `every one of ${open.length} real open tasks was refused. The builder would have nothing to do ` +
    `and the guard is miscalibrated.`);
  console.log(`      real surface: ${open.length} open, ${released.length} workable, ${refused} refused as gated`);
});

test("the guard is not always-open against the REAL task surface", () => {
  const open = readOpenTasks();
  const refused = open.filter((t) => gateVerdict(t.text, t.file).gated);
  assert.ok(refused.length > 0,
    "not one real open task tripped the guard. Given 06-two-agent-vps carries gate work, a zero here " +
    "means the guard is not reading the task text it thinks it is.");
});

// ------------------------------------------------------------------ fail-closed on an unevaluatable rule
test("a rule that throws is treated as FIRED, never as passed", () => {
  // Patch the rule's regex to an object that throws the moment it is touched. The guard reads
  // rule.re.test for path rules and rule.re.source for text rules, so either access faults.
  const original = GATE_RULES[0].re;
  GATE_RULES[0].re = {
    get source() { throw new Error("deliberate rule fault"); },
    test() { throw new Error("deliberate rule fault"); },
    flags: "",
  };
  try {
    const v = gateVerdict("an entirely ordinary task", ".kiro/specs/01-foundation/tasks.md");
    assert.equal(v.gated, true, "a guard that cannot evaluate itself must refuse, not wave the task through");
    assert.ok(v.reasons.some((r) => r.id === GATE_RULES[0].id));
  } finally {
    GATE_RULES[0].re = original;
  }
});

// ------------------------------------------------------------------ tamper proof: the input really changed
test("each refusal case genuinely differs from its released control", () => {
  const control = "Write src/features/budget/allocate.ts and its unit tests";
  let applied = 0;
  for (const [, text] of MUST_REFUSE) {
    assert.notEqual(text, control, "a tamper identical to the control proves nothing");
    applied++;
  }
  assert.equal(applied, MUST_REFUSE.length);
  assert.equal(gateVerdict(control, null).gated, false, "the control must be clean or every comparison is meaningless");
});

// ------------------------------------------------------------------ the task reader
test("the task reader separates open from done and captures context", () => {
  const open = readOpenTasks();
  for (const t of open.slice(0, 40)) {
    assert.ok(t.spec && t.file && t.id, "every task needs a spec, a file and an id");
    assert.ok(!/^\s*- \[x\]/i.test(t.title), "a done task leaked into the open set");
    assert.ok(t.text.length >= t.title.length, "context must extend the title, never truncate it");
  }
});

test("the declared spec order is the only surface, and drift is reported", () => {
  const tally = countTasks();
  for (const spec of Object.keys(tally)) {
    assert.ok(SPEC_ORDER.includes(spec), `${spec} was counted but is not in the declared order`);
  }
  const unlisted = unlistedSpecs();
  assert.ok(Array.isArray(unlisted), "unlisted specs must be enumerable so they can be reported, not silently worked");
});

test("task keys are stable and unique enough to cap attempts", () => {
  const open = readOpenTasks();
  const keys = open.map(taskKey);
  assert.equal(keys.length, open.length);
  for (const t of open) assert.equal(taskKey(t), `${t.spec}:${t.id}`);
});

// ------------------------------------------------------------------ the harness parser
// This fixture is the real shape: verdicts at column zero, a check's own detail indented by
// six spaces. The indented lines here start with PASS/FAIL-looking words on purpose, because
// that is exactly what the first parser mistook for extra failing checks.
const HARNESS_FIXTURE = [
  "PASS AC16  toolchain pin, lockfile and launch path",
  "PASS AC10  source files declare their contract and phase",
  "FAIL AC14  working tree is clean",
  "        - uncommitted entry: M src/App.tsx",
  "        - uncommitted entry:  M src/styles/globals.css",
  "FAIL AC15  repository is push ready and unpushed",
  "      remotes:         origin",
  "      working tree:    dirty",
  "      FAIL repository release state is deliberate and recorded: 1 finding(s)",
  "        - the working tree is not clean: 6 entry(ies)",
  "",
  "verification harness: 18 of 20 executed checks passed",
].join("\n");

test("the harness parser reads verdicts only, never a check's own detail lines", () => {
  const r = parseHarnessOutput(HARNESS_FIXTURE);
  assert.deepEqual(r.failing, ["AC14", "AC15"],
    `failing set was ${JSON.stringify(r.failing)}. Anything beyond AC14 and AC15 means an ` +
    `indented detail line was promoted to a phantom check, which is the defect this test exists for.`);
  assert.deepEqual(r.passing, ["AC10", "AC16"]);
  assert.equal(r.passed, 18);
  assert.equal(r.total, 20);
  assert.equal(r.measured, true);
});

test("the parser rejects the phantom check names the trimming version invented", () => {
  const r = parseHarnessOutput(HARNESS_FIXTURE);
  for (const junk of ["repository", "working", "remotes:", "-"]) {
    assert.ok(!r.failing.includes(junk) && !r.passing.includes(junk),
      `"${junk}" was parsed as a check id`);
  }
});

test("the parser reports measured false when there is no tally line", () => {
  const r = parseHarnessOutput("PASS AC01  something\nnothing else here");
  assert.equal(r.measured, false, "a run with no tally must not be treated as a usable baseline");
});

test("the parser survives an empty or absent reading without inventing a pass", () => {
  for (const input of ["", null, undefined]) {
    const r = parseHarnessOutput(input);
    assert.equal(r.passed, 0);
    assert.equal(r.measured, false);
  }
});

// ------------------------------------------------------------------ task selection quality
test("an unnumbered acceptance bullet is never returned as a task", () => {
  const scan = scanTasks();
  for (const t of scan.tasks) {
    assert.match(t.id, /^[0-9]+(\.[0-9]+)*$/,
      `task id "${t.id}" is not a task number, so an acceptance bullet leaked into the work surface`);
  }
  assert.ok(scan.unnumbered > 0,
    "zero unnumbered bullets were seen across nine specs, which means the filter is not being exercised");
  console.log(`      selection: ${scan.tasks.length} leaf tasks, ${scan.containers} containers skipped, ${scan.unnumbered} bullets skipped`);
});

test("a container task with open numbered children is skipped in favour of the children", () => {
  const scan = scanTasks();
  const keys = new Set(scan.tasks.map(taskKey));
  for (const t of scan.tasks) {
    const hasOpenChild = scan.all.some((o) => o.spec === t.spec && o.id.startsWith(t.id + "."));
    assert.equal(hasOpenChild, false,
      `${taskKey(t)} still has an open numbered child, so the builder would work a heading`);
  }
  assert.ok(scan.containers > 0, "no containers were detected at all, so leaf preference is untested");
  assert.ok(keys.size === scan.tasks.length, "leaf task keys must be unique");
});

test("every task path uses forward slashes so a prompt can be followed", () => {
  for (const t of readOpenTasks()) {
    assert.ok(!t.file.includes("\\"), `${t.file} carries a backslash and will break a tool call in a prompt`);
  }
});

// ------------------------------------------------------------------ negation scoping
// The point of these eight cases is that suppression must reduce NOISE without reducing SAFETY.

const NEGATED_MUST_RELEASE = [
  ["a pure offline test task that lists what it avoids",
   "Write the offline smoke test against a fake responder. No loopback listener, no port, no DNS, no recorded transcript."],
  ["a task that explicitly forbids gate work",
   "Build the image layer. Do not perform any G1-G8 step and do not touch the register contents."],
  ["a task that says it never mutates the host",
   "Author the compose file only. This task must not ssh into the host and cannot run systemctl restart anything."],
  ["a task that says webhooks are out of scope",
   "Wire the local route table. There is no webhook registration in this task."],
];

for (const [label, text] of NEGATED_MUST_RELEASE) {
  test(`RELEASE negated mention: ${label}`, () => {
    const v = gateVerdict(text, ".kiro/specs/07-bot-bringup-v1/tasks.md");
    assert.equal(v.gated, false,
      `a negated capability mention still refused, firing ${v.reasons.map((r) => r.id + "=" + JSON.stringify(r.matched)).join(", ")}. ` +
      `A guard that blocks a task for saying it will NOT do something gets switched off by its owner.`);
  });
}

// The mirror image, and the more important half: negation must NOT rescue a real action.
const NEGATED_MUST_STILL_REFUSE = [
  ["minting is not negatable", "Do not delay: mint the two model keys now and record the caps.", "R-MINT-SECRET"],
  ["consent is not negatable", "This is not optional, complete the oauth consent screen and store the refresh token.", "R-CONSENT"],
  ["spend is not negatable", "No hesitation, add a payment method and purchase the domain.", "R-SPEND"],
  ["the awaiting-human marker is not negatable", "This is not done. Status: BLOCKED - awaiting human.", "R-AWAITING-HUMAN"],
];

for (const [label, text, expected] of NEGATED_MUST_STILL_REFUSE) {
  test(`REFUSE despite a negator nearby: ${label}`, () => {
    const v = gateVerdict(text, ".kiro/specs/06-two-agent-vps/tasks.md");
    assert.equal(v.gated, true,
      `${label}: a negator in the sentence suppressed a high-consequence rule. Suppression is scoped to ` +
      `capability mentions on purpose, and that scoping just broke.`);
    assert.ok(v.reasons.map((r) => r.id).includes(expected),
      `${label}: expected ${expected}, got ${v.reasons.map((r) => r.id).join(",")}`);
  });
}

test("every rule declares whether it is negatable, so the scoping is auditable", () => {
  for (const r of GATE_RULES) {
    assert.equal(typeof r.negatable, "boolean", `${r.id} does not declare negatable`);
    assert.ok(r.re instanceof RegExp, `${r.id} does not carry an inspectable regex`);
  }
  const hard = GATE_RULES.filter((r) => !r.negatable).map((r) => r.id);
  for (const id of ["R-MINT-SECRET", "R-PLACE-SECRET", "R-CONSENT", "R-SPEND", "R-AWAITING-HUMAN", "R-PATH-REGISTER"]) {
    assert.ok(hard.includes(id), `${id} must never be suppressible by a negation`);
  }
});

test("a refusal reports the substring that fired it, so a false positive is diagnosable", () => {
  const v = gateVerdict("Complete G3 and create the two bots", null);
  assert.equal(v.gated, true);
  assert.ok(v.reasons.every((r) => "matched" in r), "every reason must carry what it matched");
  assert.ok(v.reasons.some((r) => typeof r.matched === "string" && r.matched.includes("G3")));
});
