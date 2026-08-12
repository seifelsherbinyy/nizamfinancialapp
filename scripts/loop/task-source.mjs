#!/usr/bin/env node
/**
 * Enumerates the open spec tasks the autonomous builder is allowed to work.
 * Owner: build tooling. Contract: PFOS build loop. Phase: build loop.
 *
 * TWO RULES LEARNED FROM A DRY RUN THAT SELECTED THE WRONG THING:
 *
 *  1. A checkbox is not a task. tasks.md nests acceptance criteria as their own unnumbered
 *     "- [ ]" bullets. The first version returned one of those, so the builder was about to
 *     hand a subagent the fragment "Interactive sign-in yields a token with exactly drive.file"
 *     with no surrounding task. Only NUMBERED items are tasks; unnumbered ones are context and
 *     are attached to the task above them. The count of skipped ones is reported, not hidden.
 *
 *  2. Prefer the LEAF. "6. RUNG 1" with children 6.1 to 6.4 is a heading, not a unit of work;
 *     working it means working four things at once. A task with any open numbered descendant
 *     is a container and is skipped in favour of its first open child.
 *
 * Dependency ordering is declared, never inferred, so renaming a spec cannot silently reorder
 * the build.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const SPEC_ROOT = ".kiro/specs";

/** Declared dependency order. A spec absent from this list is NOT worked, by design. */
export const SPEC_ORDER = [
  "01-foundation",
  "02-drive-data-layer",
  "03-budget-engine",
  "04-ui-ynab",
  "05-reports-release",
  "06-two-agent-vps",
  "07-bot-bringup-v1",
  "08-knowledge-ingestion",
  "ship-run-live-bringup",
];

const OPEN = /^(\s*)- \[ \] (.+)$/;
const DONE = /^(\s*)- \[x\] (.+)$/i;
const NUMBERED = /^([0-9]+(?:\.[0-9]+)*)[.)]?\s+(.*)$/;
const CONTEXT_LINES = 10;

/** Forward slashes so a path in a prompt works for whatever tool reads it. */
const norm = (p) => String(p).replace(/\\/g, "/");

/**
 * @returns {{tasks:object[],unnumbered:number,containers:number}}
 */
export function scanTasks({ specRoot = SPEC_ROOT, order = SPEC_ORDER } = {}) {
  const tasks = [];
  let unnumbered = 0;
  for (const spec of order) {
    const file = norm(join(specRoot, spec, "tasks.md"));
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = OPEN.exec(lines[i]);
      if (!m) continue;
      const indent = m[1].length;
      const title = m[2].trim();
      const num = NUMBERED.exec(title);
      if (!num) { unnumbered++; continue; }     // an acceptance bullet, not a task
      const ctx = [];
      for (let j = i + 1; j < lines.length && ctx.length < CONTEXT_LINES; j++) {
        const l = lines[j];
        if (/^\s*$/.test(l)) continue;
        const li = (l.match(/^\s*/) ?? [""])[0].length;
        if (li <= indent) break;                // dedent ends this task's block
        if (NUMBERED.test(l.replace(/^\s*- \[[ x]\] /i, "").trim()) && (OPEN.test(l) || DONE.test(l))) break;
        ctx.push(l.trim());
      }
      tasks.push({ spec, file, line: i + 1, id: num[1], title, text: [title, ...ctx].join("\n"), indent });
    }
  }
  // leaf preference: drop any task that has an open numbered descendant
  const ids = new Map();
  for (const t of tasks) ids.set(`${t.spec}:${t.id}`, t);
  const containers = tasks.filter((t) =>
    tasks.some((o) => o.spec === t.spec && o.id !== t.id && o.id.startsWith(t.id + ".")));
  const containerKeys = new Set(containers.map((t) => `${t.spec}:${t.id}`));
  const leaves = tasks.filter((t) => !containerKeys.has(`${t.spec}:${t.id}`));
  return { tasks: leaves, unnumbered, containers: containers.length, all: tasks };
}

/** Backwards-compatible accessor: the workable leaf tasks, in declared order. */
export function readOpenTasks(opts) {
  return scanTasks(opts).tasks;
}

export function countTasks({ specRoot = SPEC_ROOT, order = SPEC_ORDER } = {}) {
  const tally = {};
  for (const spec of order) {
    const file = join(specRoot, spec, "tasks.md");
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    let open = 0, done = 0;
    for (const l of lines) {
      if (OPEN.test(l)) open++;
      else if (DONE.test(l)) done++;
    }
    tally[spec] = { open, done };
  }
  return tally;
}

/** Specs present on disk but absent from SPEC_ORDER. Reported, never silently worked. */
export function unlistedSpecs({ specRoot = SPEC_ROOT, order = SPEC_ORDER } = {}) {
  if (!existsSync(specRoot)) return [];
  return readdirSync(specRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name)
    .filter((n) => !order.includes(n));
}

export function taskKey(t) { return `${t.spec}:${t.id}`; }
