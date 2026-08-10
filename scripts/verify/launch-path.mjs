#!/usr/bin/env node
/**
 * The launch path: the pinned runtime can actually START what the images run.
 * Owner: build tooling. Reported under **AC16**, not as a twenty-first check - see the note at the
 * bottom of this header.
 *
 * Owning contract: PFOS 12 - Two-Agent VPS Deployment & Operations, §2.1 (the six services), §7.3
 *   (the readiness command the orchestrator polls). Spec: `.kiro/specs/06-two-agent-vps/` - task
 *   10.23, closing finding **F20**. Owning requirements **R28** (a documented build path producing a
 *   runnable image), **R29** (the finance-agent process starts and refuses an incomplete environment).
 *
 * ## The defect this exists to prevent coming back
 *
 * Every relative import under `src/` used to be written extensionless - `import { main } from './main'`.
 * The project's own toolchain resolves that (`moduleResolution: "bundler"`, and Vite and Vitest search
 * the same way). **Node's ESM resolver performs no extension search.** All three owned images run
 * source directly with bare `node`, so every `ENTRYPOINT` and every `--health` command died on its
 * first import, before any environment was read - and rung L2 was unreachable with every gate G1-G8
 * observed, because each container exited immediately.
 *
 * The lesson of F20 is not the missing extension. It is that **2126 passing tests proved nothing about
 * the launch**, because Vitest imports through a resolver the container does not have. So this checker
 * asserts the launch itself, in two halves that fail differently:
 *
 *   STATIC   no relative specifier under `src/` or `tests/` is extensionless. Catches a module that is
 *            not reachable from an entrypoint *yet*, which is where the next instance would start.
 *   LAUNCH   every entrypoint an image invokes is spawned with bare `node` and a CLEAN environment,
 *            and must reach the loader - refuse the environment, or answer not-ready - rather than
 *            die on module resolution.
 *
 * ## It fails closed, and it proves it is not vacuous
 *
 * A missing entrypoint, an empty case list, an unreadable file, a static half that finds suspiciously
 * few specifiers, an exit code that is not the refusal, output on a stream that should be silent, and a
 * detector that can no longer detect the defect are all findings. The last one is the important one: the
 * LAUNCH half ends by spawning a synthetic module that HAS the F20 shape and requiring it to fail. A
 * guard that cannot fail is not a guard.
 *
 * ## Nothing here runs a deployment
 *
 * Each spawn is a local read that exits at once. The environment handed to it holds only `PATH` and the
 * platform's own root, so no entry from the developer machine can leak into the observation and none of
 * the seven can proceed past its loader. No image is built, no stack started, no port published and no
 * outbound call made - this build's live provider client refuses by construction until G3/G6, which is
 * what makes spawning the agent safe (steering §2, §2a).
 *
 * ## Why AC16 rather than a new check
 *
 * The harness runs twenty checks and that count is asserted in several documents. AC16 is the check that
 * already reads `.nvmrc`, compares it with the runtime it is running on, and fails if they disagree - it
 * is the one place that owns the claim "this repository runs on the runtime it pins". "…and that runtime
 * can start the entrypoints" is the same claim, finished. `toolchain-pin.mjs` imports the function below
 * and merges its findings.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { read, git } from './_util.mjs';

/** The four shims the three owned images and the restore drill invoke, and how each is invoked. */
const LAUNCHES = [
  {
    // The finance agent's boot. The bot identity is an argument rather than an entry (finding F19).
    argv: ["src/server/process/start.ts", "--bot-id", "launch-path-check"],
    expect: "refuses the environment",
    invokedBy: "ops/images/finance-agent/Dockerfile ENTRYPOINT, and npm start",
  },
  {
    argv: ["src/server/process/start.ts", "--health"],
    expect: "answers not ready",
    invokedBy: "the finance image's nizam-finance-health, and npm run health",
  },
  {
    argv: ["src/server/process/busStart.ts"],
    expect: "refuses the environment",
    invokedBy: "ops/images/signal-bus/Dockerfile ENTRYPOINT",
  },
  {
    argv: ["src/server/process/busStart.ts", "--health"],
    expect: "answers not ready",
    invokedBy: "the bus image's nizam-bus-health",
  },
  {
    argv: ["src/server/process/schedulerStart.ts"],
    expect: "refuses the environment",
    invokedBy: "ops/images/scheduler/Dockerfile ENTRYPOINT",
  },
  {
    argv: ["src/server/process/schedulerStart.ts", "--health"],
    expect: "answers not ready",
    invokedBy: "the scheduler image's nizam-scheduler-health",
  },
  {
    argv: ["src/server/process/probe.ts"],
    expect: "answers not ready",
    invokedBy: "nizam-health-probe in all three images, and ops/restore/restore.sh",
  },
];

/** The substring the loader's aggregate refusal always carries (R27). */
const AGGREGATE_MARK = "entries to fix";

/** Markers that mean the process never reached its own code. This is the F20 signature. */
const RESOLUTION_FAILURES = [
  "ERR_MODULE_NOT_FOUND",
  "ERR_UNSUPPORTED_DIR_IMPORT",
  "ERR_UNKNOWN_FILE_EXTENSION",
  "Cannot find module",
  "Cannot find package",
];

/** A specifier that already says what it is. */
const HAS_EXTENSION = /\.(?:[cm]?[jt]sx?|json|node|css|svg|png)$/;

/** How long one spawn may take before it is a finding rather than something to wait on. */
const LAUNCH_TIMEOUT_MS = 40_000;

/** The static half must see at least this many relative specifiers, or it is scanning nothing. */
const SPECIFIER_FLOOR = 500;

function walkSource(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkSource(p, acc);
    else if ([".ts", ".tsx"].includes(extname(p))) acc.push(p.split("\\").join("/"));
  }
  return acc;
}

/**
 * Every relative specifier in a source text, with the ones inside a string literal held out.
 *
 * A test that asserts an import PARSER holds import statements as data - `"import { b } from './other'"` -
 * and those are not imports. The rule is textual and deliberately blunt: if the same line already
 * carries a quote before the specifier's own, it is inside something. That over-excludes rather than
 * under-excluding, so the counted total is checked against a floor above.
 */
function relativeSpecifiers(text) {
  const found = [];
  const rx = /from(?:\s*)(['"])(\.[^'"\n]*)\1/g;
  let m;
  while ((m = rx.exec(text)) !== null) {
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    if (/['"`]/.test(text.slice(lineStart, m.index))) continue;
    found.push({ specifier: m[2], line: text.slice(0, m.index).split("\n").length });
  }
  return found;
}

/** Spawn one entrypoint with bare `node` and an environment that carries nothing of this machine. */
function launch(argv) {
  return spawnSync(process.execPath, argv, {
    encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
    timeout: LAUNCH_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** The runtime's own warnings are not the process's output. Everything else on the stream is. */
function withoutRuntimeNoise(stderr) {
  return (stderr ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .filter((line) => !/^\(node:\d+\)/.test(line))
    .filter((line) => !/^\(Use `node --trace-warnings/.test(line))
    .join("\n");
}

export function launchPathFindings() {
  const findings = [];
  const notes = [];

  // --- static half ---------------------------------------------------------------------------
  // The specifier rule is asserted over the repository's OWN content. An untracked file is not that,
  // and nothing is lost by the exclusion: AC14 fails the harness on ANY untracked file, so when the
  // gate is green there is no untracked source file this rule could have missed. The two checks
  // compose. If git cannot answer, nothing is excluded - the stricter direction.
  const untracked = new Set(
    git(["ls-files", "--others", "--exclude-standard"])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const files = [...walkSource("src"), ...walkSource("tests")].filter((f) => !untracked.has(f));
  if (files.length === 0) {
    findings.push("no source file was found under src or tests, so the static half would pass vacuously");
  }
  let counted = 0;
  for (const file of files) {
    let text;
    try {
      text = read(file);
    } catch (e) {
      findings.push(file + " could not be read while scanning specifiers (" + String(e && e.message) + "); the scan cannot be trusted");
      continue;
    }
    for (const { specifier, line } of relativeSpecifiers(text)) {
      counted += 1;
      if (!HAS_EXTENSION.test(specifier)) {
        findings.push(
          file + ":" + line + ' imports "' + specifier + '" with no extension; Node performs no extension search, so bare `node` cannot start any module that reaches this one (finding F20)',
        );
      }
    }
  }
  if (counted < SPECIFIER_FLOOR) {
    findings.push("only " + counted + " relative specifier(s) were counted across " + files.length + " file(s), below the floor of " + SPECIFIER_FLOOR + "; the scanner is no longer seeing the tree it is meant to guard");
  }
  notes.push("relative specifiers checked: " + counted + " across " + files.length + " source file(s)");

  // --- the npm scripts name the same entrypoints ----------------------------------------------
  const entrypoints = new Set(LAUNCHES.map((l) => l.argv[0]));
  for (const missing of [...entrypoints].filter((p) => !existsSync(p))) {
    findings.push("the entrypoint " + missing + " does not exist, so the launch half cannot observe it");
  }
  let pkg = null;
  try {
    pkg = JSON.parse(read("package.json"));
  } catch (e) {
    findings.push("package.json could not be read (" + String(e && e.message) + ")");
  }
  if (pkg) {
    for (const script of ["start", "health"]) {
      const command = String(pkg.scripts?.[script] ?? "");
      const named = command.match(/(src\/[^\s]+\.ts)/);
      if (!named) {
        findings.push('the "' + script + '" script does not name a source entrypoint, so it is not the launch path this check observes: ' + JSON.stringify(command));
      } else if (!entrypoints.has(named[1])) {
        findings.push('the "' + script + '" script names ' + named[1] + ", which is not among the entrypoints this check launches");
      }
    }
  }

  // --- launch half ---------------------------------------------------------------------------
  if (LAUNCHES.length === 0) {
    findings.push("the launch case list is empty, so the launch half would pass vacuously");
  }
  let launched = 0;
  for (const { argv, expect, invokedBy } of LAUNCHES) {
    if (!existsSync(argv[0])) continue;
    const r = launch(argv);
    const label = "`node " + argv.join(" ") + "`";
    if (r.error) {
      findings.push(label + " could not be spawned (" + String(r.error.message) + "); " + invokedBy + " would fail the same way");
      continue;
    }
    launched += 1;
    const stderr = r.stderr ?? "";
    const hit = RESOLUTION_FAILURES.find((mark) => stderr.includes(mark));
    if (hit) {
      findings.push(label + " never reached its own code: the runtime answered " + hit + ". " + invokedBy + " cannot start (finding F20)");
      continue;
    }
    if (r.signal !== null && r.signal !== undefined) {
      findings.push(label + " was killed by " + r.signal + " rather than exiting; " + invokedBy + " would hang the same way");
      continue;
    }
    if (r.status !== 1) {
      findings.push(label + " exited " + r.status + " on an empty environment; an unconfigured service must refuse with 1 rather than proceed or crash");
      continue;
    }
    const spoken = withoutRuntimeNoise(stderr);
    if (expect === "refuses the environment") {
      if (!spoken.includes(AGGREGATE_MARK)) {
        findings.push(label + " exited 1 without the loader's aggregate refusal, so it did not reach the loader: " + JSON.stringify(spoken.slice(0, 200)));
      }
    } else if (spoken.length > 0) {
      findings.push(label + " wrote to the error stream while answering readiness, which a readiness command must not do: " + JSON.stringify(spoken.slice(0, 200)));
    }
  }
  notes.push("entrypoints launched with bare node: " + launched + " of " + LAUNCHES.length);

  // --- the guard proves it can still fail ----------------------------------------------------
  // A synthetic module with exactly the F20 shape. If the runtime resolves it, this checker's whole
  // launch half has become unable to detect the defect and must say so rather than pass.
  let sandbox = null;
  try {
    sandbox = mkdtempSync(join(tmpdir(), "nizam-launch-path-"));
    writeFileSync(join(sandbox, "b.ts"), "export const b = 1;\n");
    writeFileSync(join(sandbox, "a.ts"), "import { b } from './b';\nif (b !== 1) throw new Error('unreachable');\n");
    const r = launch([join(sandbox, "a.ts")]);
    const detected = RESOLUTION_FAILURES.some((mark) => (r.stderr ?? "").includes(mark));
    if (!detected) {
      findings.push(
        "the detector no longer detects finding F20: an extensionless relative import resolved under " +
          process.version +
          " (exit " +
          r.status +
          "). Either the runtime gained an extension search - in which case say so here and keep the static half - or this check is now passing vacuously",
      );
    } else {
      notes.push("detector proved live: an extensionless relative import still fails under " + process.version);
    }
  } catch (e) {
    findings.push("the detector self-test could not be run (" + String(e && e.message) + "), so the launch half is unproven");
  } finally {
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
  }

  return { findings, notes };
}

// Runnable on its own for diagnosis, while AC16 is what reports it in the harness.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { findings, notes } = launchPathFindings();
  notes.forEach((n) => console.log(n));
  if (findings.length) {
    console.error("FAIL the pinned runtime cannot start every entrypoint: " + findings.length + " finding(s)");
    findings.forEach((f) => console.error("  - " + f));
    process.exit(1);
  }
  console.log("PASS the pinned runtime starts every entrypoint the images invoke");
}
