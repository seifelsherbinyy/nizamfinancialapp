#!/usr/bin/env node
/**
 * Enumerates the open spec tasks the autonomous builder is allowed to work.
 * Owner: build tooling. Contract: PFOS build loop. Phase: build loop.
 *
 * Dependency ordering is declared, not inferred. Inferring an order from file names would
 * silently reorder itself the day a spec is renamed.
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
const CONTEXT_LINES = 8;

/**
 * @returns {{spec:string,file:string,line:number,id:string,title:string,text:string,indent:number}[]}
 */
export function readOpenTasks({ specRoot = SPEC_ROOT, order = SPEC_ORDER } = {}) {
  const out = [];
  for (const spec of order) {
    const file = join(specRoot, spec, "tasks.md");
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = OPEN.exec(lines[i]);
      if (!m) continue;
      const indent = m[1].length;
      const title = m[2].trim();
      const idMatch = /^([0-9]+(?:\.[0-9]+)*)[.)]?\s+(.*)$/.exec(title);
      const id = idMatch ? idMatch[1] : String(i + 1);
      // Gather the indented context beneath the task so the guard and the executor both
      // see the real requirement, not just the one-line title.
      const ctx = [];
      for (let j = i + 1; j < lines.length && ctx.length < CONTEXT_LINES; j++) {
        const l = lines[j];
        if (OPEN.test(l) || DONE.test(l)) break;
        if (/^\s*$/.test(l)) continue;
        if ((l.match(/^\s*/) ?? [""])[0].length <= indent && /^\s*-\s/.test(l)) break;
        ctx.push(l.trim());
      }
      out.push({
        spec, file, line: i + 1, id, title,
        text: [title, ...ctx].join("\n"),
        indent,
      });
    }
  }
  return out;
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
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => !order.includes(n));
}

export function taskKey(t) {
  return `${t.spec}:${t.id}`;
}
