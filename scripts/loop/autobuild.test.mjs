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
import { readOpenTasks, countTasks, unlistedSpecs, taskKey, SPEC_ORDER } from "./task-source.mjs";

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
  const original = GATE_RULES[0].test;
  GATE_RULES[0].test = () => { throw new Error("deliberate rule fault"); };
  try {
    const v = gateVerdict("an entirely ordinary task", ".kiro/specs/01-foundation/tasks.md");
    assert.equal(v.gated, true, "a guard that cannot evaluate itself must refuse, not wave the task through");
    assert.ok(v.reasons.some((r) => r.id === GATE_RULES[0].id));
  } finally {
    GATE_RULES[0].test = original;
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
