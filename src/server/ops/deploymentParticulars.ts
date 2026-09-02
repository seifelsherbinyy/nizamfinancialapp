/**
 * NIZAM · Repository-wide audit: no deployment particular in ops or in any fixture
 * Implemented by: PFOS Contract 12 / Phase 9.0 (spec 06-two-agent-vps)
 * Owning requirements: R24 (no deployment particular in a tracked file), steering §0b (the repository
 *   may contain the design, never a deployment particular), steering §4.1 (separate stores; no
 *   process opens another agent's database on an existing connection)
 * Depends on: node:fs and node:path for the file entry point only; node:child_process to ask git
 *   which files are tracked. The audit itself is a pure function over text.
 *   The no-deployment-particular scan is INJECTED, never re-derived - see below.
 *
 * WHY THIS EXISTS. Steering §0b keeps both repositories public and pays for that with one rule: the
 * repository may contain the design, but never a particular that would let a reader reach or
 * impersonate the running system. Six per-artifact checkers already hold that rule over the artifact
 * each of them owns - the topology template, the proxy template, the environment templates, the
 * backup and restore scripts, the runbooks, the cross-repo series. Nothing held it over the TREE, so
 * a file under `ops/` that no checker claims - and every fixture, wherever it lives - was covered by
 * nobody. This module is that tree-level gate, and the harness runs it as its own named check rather
 * than as a clause bolted onto a check whose name already covers something else.
 *
 * R24 HAS ONE IMPLEMENTATION. `scanForParticulars` in `./composeTemplate` is it. This module takes it
 * as an injected function and never restates a pattern of its own, so a later widening of R24 moves
 * every artifact at once instead of moving five of them and leaving this one behind. Injection rather
 * than a static import is also what lets the harness load this module directly: the harness is plain
 * Node, and a runtime relative import would need an extension the project's TypeScript settings do
 * not permit. A type-only import is erased before resolution, so the types below are the real ones.
 *
 * IT FAILS CLOSED, and that is the whole point of the task. A declared root that does not exist, a
 * declared root that matches no file, an empty scan set, a file that cannot be read, a stale entry in
 * the declared-token list, a fixture-shaped tracked file the scan set does not contain, and a scan
 * finding this module has no code for are all FINDINGS. A check that passes by not running is the
 * failure mode this module exists to prevent, so the report carries the number of files actually
 * examined and the caller asserts it is not zero.
 *
 * IT ALSO HOLDS TWO NAMED BANS OVER `src/server/**`, in code and in prose alike (steering §4.1):
 *   - the row-append data statement used as a BARE BINDING NAME. A store write is spelled through a
 *     repository or through a named prepared statement; a local called after the statement itself is
 *     how ad-hoc row writing gets in beside the boundary guards that refuse non-integer money.
 *   - the keyword that opens a SECOND store on an existing connection. Steering §4.1 permits none,
 *     ever, and a mention in a comment is where the idea starts.
 * Neither banned token is written out contiguously anywhere in this file or its test: both are
 * assembled from fragments at construction, the same technique `runbookTemplate.test.ts` and
 * `patchSeries.test.ts` already use, so the checker cannot flag itself.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { ComposeFinding } from './composeTemplate.ts';

// ---------------------------------------------------------------------------------------------
// What is scanned, and why exactly this
// ---------------------------------------------------------------------------------------------

/**
 * The declared scan roots. Each MUST exist and MUST contribute at least one file: a root that
 * matches nothing is reported, never skipped.
 *
 *   `ops`  - every tracked artifact of the deployment, template and prose alike. Steering §0b's rule
 *            is about the whole directory, not about the files that happen to have a checker.
 *   `src/server/mocks/fixtures` - the recorded-replay fixtures. This is where every fixture in this
 *            repository actually lives, and a fixture is exactly the file where anonymized real data
 *            would look harmless and would not be.
 *
 * A third pattern - a file NAMED like a fixture rather than living in a fixture directory - is
 * deliberately NOT declared as a root, because nothing in this repository matches it today and a
 * declared root that matches nothing is a failure by the rule above. It is covered more strongly
 * instead: {@link FIXTURE_SHAPED_PATH} is applied to every tracked file, and a fixture-shaped path
 * outside the scan set is `FIXTURE_OUTSIDE_SCAN_SET`. A glob can be wrong silently; that assertion
 * cannot.
 */
export const SCAN_ROOTS: readonly string[] = ['ops', 'src/server/mocks/fixtures'];

/** The tree the two named bans below are held over. */
export const SERVER_ROOT = 'src/server';

/**
 * A tracked path that is a fixture by name or by directory. Either a path segment `fixture`/
 * `fixtures`, or a dotted `.fixture.`/`.fixtures.` infix in the file name.
 *
 * A module that LOADS fixtures is not a fixture - `src/server/mocks/fixtures.ts` and
 * `tests/helpers/fixtures.ts` are code, and code is where the scan's own patterns legitimately
 * appear - so the shape below deliberately does not match a bare `fixtures.ts`.
 */
export const FIXTURE_SHAPED_PATH = /(?:^|\/)fixtures?\/|\.fixtures?\./;

/** Extensions that are not text. Reading one as text would produce a meaningless scan. */
const BINARY_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.age', '.pyc'];

// ---------------------------------------------------------------------------------------------
// The dotted-token vocabulary
// ---------------------------------------------------------------------------------------------

/** The same token shape the shared scan reads as a possible hostname. */
const DOTTED_TOKEN = /(?<![A-Za-z0-9<>_-])([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)(?![A-Za-z0-9>])/g;

/**
 * Every dotted token the scanned tree may contain: a file it names, or an attribute access in source
 * it quotes. Enumerated exactly rather than matched by pattern - the same decision, for the same
 * reason, as `./patchSeries` - so a token that is neither, a hostname say, cannot slip in behind a
 * rule written to admit an attribute access.
 *
 * Two assertions keep the list honest and are findings of this module, not remarks in a test:
 * a token in the tree that is absent here is `DOTTED_TOKEN_UNDECLARED`, and an entry here that is
 * absent from the tree is `DECLARED_TOKEN_UNUSED`. A list with a stale entry is a list nobody reads.
 *
 * The overlap with `./patchSeries` is real and is not shared code: this module cannot import that
 * one at run time (see the header), and the test asserts the two lists agree wherever they meet, so
 * they cannot drift apart unobserved.
 */
export const DECLARED_DOTTED_TOKENS: readonly string[] = [
  // ingress template file names referenced by ops/hermes/README.md
  'nizam-ingress.config.yaml.example',
  'nizam-ingress.env.example',
  'nizam-ingress.service.example',
  // internal and rollback profile template names
  'nizam.service.example',
  'nizam.env.example',
  'nizam.config.yaml.example',
  'pfos.service.example',
  'pfos.env.example',
  'pfos.config.yaml.example',
  // config and env file names referenced by Hermes deployment docs
  'config.yaml',
  'config.yaml.example',
  'nizam-ingress.env',
  // Google Drive file scope and .env.local — named in security boundaries
  'drive.file',
  'env.local',
  // artifacts of this repository named by an ops document
  '001-fastapi-wrapper.patch',
  '002-dedup-per-bot.patch',
  '003-signalbus-egress-target.patch',
  '004-hermes-profile-adapter.md',
  'cross-repo-001.diff',
  'two-agent-vps.md',
  'NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md',
  'nizam-signalbus.envelope.schema.json',
  // the two cross-repository documents of phase 10 tasks 10.16 and 10.17, and each other's name
  'INTEROP_CONTRACT.md',
  'AGENT_CAPABILITY_SPLIT.md',
  'consentGate.ts',
  'envelopeValidation.ts',
  'internalEndpoint.ts',
  'updateDedupRepo.ts',
  'backup.sh',
  'restore.sh',
  'docker-compose.yml',
  'ROLLBACK.md',
  'drive-db.md',
  'auth.ts',
  'drive.ts',
  'backupScripts.ts',
  'busServer.ts',
  'busStart.ts',
  'caddyTemplate.ts',
  'composeTemplate.ts',
  'envTemplates.ts',
  'healthProbe.ts',
  'imageOwnership.ts',
  'appServer.ts',
  'main.ts',
  'migrations.ts',
  'probe.ts',
  'runbookTemplate.ts',
  'scheduler.ts',
  'schedulerMain.ts',
  'schedulerStart.ts',
  'signalBus.ts',
  'signalStore.ts',
  'start.ts',
  'telegram.ts',
  // the two files a build recipe copies, named by the recipe and by the build path that produces it
  'package.json',
  'package-lock.json',
  // the launch path, named by ops/IMAGE_BUILD.md's F20 section (spec 06 task 10.23): the compiler
  // setting the repair turns on, the checker that holds it, its test, the ladder rung that launches
  // the entrypoint with bare `node`, and the resolve hook the repair retired
  'tsconfig.json',
  'launch-path.mjs',
  'launchPath.test.ts',
  'l0-config.mjs',
  'ts-resolve.mjs',
  // store file names and environment file names the ops documents refer to by name
  'finance.db',
  'life.db',
  'signals.db',
  'restored.db',
  'backup.env',
  'finance.env',
  'life.env',
  // the abbreviation, which is a dotted token and is not a name of anything
  'e.g',
  // files in the other repository, quoted by the cross-repo series
  'asgi_app.py',
  'test_asgi_app.py',
  'webhook.py',
  'poller.py',
  'dedup.py',
  'test_dedup.py',
  'classifier.py',
  'test_classifier.py',
  'auth.py',
  'PRIVACY_CLASSIFICATION.json',
  // attribute access in quoted source
  'SignalBusPortConfig.internalEndpointRef',
  'os.environ.get',
  'request.headers.get',
  'configured.startswith',
  'pytest.fixture',
  'os.path.exists',
  'os.path.dirname',
  'os.path.basename',
  'os.path.join',
  'os.access',
  'os.replace',
  'os.fsync',
  'os.W_OK',
  'os.R_OK',
  're.compile',
  're.IGNORECASE',
  'json.loads',
  'json.load',
  'json.dump',
  'hmac.compare_digest',
  'fastapi.testclient',
  'importlib.reload',
  'pytest.raises',
  'asgi_app.app',
  'app.post',
  'app.get',
  'client.post',
  'client.get',
  'monkeypatch.setenv',
  'monkeypatch.delenv',
  'request.body',
  'request.headers',
  'response.status_code',
  'first.status_code',
  'second.status_code',
  'first.claim',
  'second.claim',
  'state.claim',
  'state.max_seen',
  'dedup.claim',
  'dedup.max_seen',
  'handle.flush',
  'handle.fileno',
  'window.append',
  'entries.items',
  'raw.get',
  'path.write_text',
  'path.is',
  'path.read',
  'item.get',
  'values.append',
  'packet.get',
  'labels.append',
  'value.lower',
  'label.lower',
  // file names and tool namespace prefixes introduced by ops/HERMES_CAPABILITY_EXPANSION_REGISTER.md
  'toolBoundary.ts',
  'profilePolicy.ts',
  'knowledgeBoundary.ts',
  'Number.isSafeInteger',
  'calendar.readonly',
  'nizamcore.read',
  'nizamcore.append',
  'nizamcore.request',
  'nizamcore.update',
  'nizamcore.schedule',
  'pfos.read',
  'pfos.run',
  'pfos.query',
  'pfos.compute',
  'pfos.request',
  'signalbus.publish',
  'signalbus.read',
  'signalbus.query',
  'knowledge.read',
  'knowledge.load',
  'knowledge.list',
  'knowledge.search',
  'knowledge.propose',
  'calendar.read',
  'calendar.create',
  'integrations.fetch',
  // WHOOP personal-health ops runbook script names, event types, and env files.
  // Added per owner decision D8 (2026-09-02): these are legitimate ops artifact
  // references, not deployment hostnames. The tokens appear in ops/hermes/WHOOP_RUNBOOK.md.
  'reconcile.py',
  'reconcile.sh',
  'cron.log',
  'env.mcp',
  'recovery.updated',
  'sql.gz',
  'urllib.parse',
  'urllib.parse.urlencode',
  'secrets.token',
  'tokens.json',
];

/** Replace every declared token with a dotless stand-in, longest first so a shorter token cannot
 *  consume part of a longer one. What stays dotted is a hostname the shared scan reports, or a token
 *  nobody declared, which this module reports. */
export function maskDeclaredTokens(source: string): string {
  let out = source;
  for (const token of [...DECLARED_DOTTED_TOKENS].sort((a, b) => b.length - a.length)) {
    out = out.split(token).join('DECLAREDTOKEN');
  }
  return out;
}

/** Every dotted token in `source` whose last label carries a letter. A section number is not one. */
export function dottedTokensIn(source: string): readonly string[] {
  const seen = new Set<string>();
  for (const match of source.matchAll(DOTTED_TOKEN)) {
    const token = match[1] ?? '';
    const labels = token.split('.');
    const last = labels[labels.length - 1] ?? '';
    if (!/[A-Za-z]/.test(last)) continue;
    seen.add(token);
  }
  return [...seen];
}

/**
 * An absolute address whose authority is a placeholder carries no particular: the host is injected at
 * run time and the document is showing a human the shape of a command. The scheme is masked ONLY in
 * that case, so an address with a concrete authority still reaches the shared scan and still reports
 * `PARTICULAR_URL_SCHEME`. This narrows nothing the shared scan would otherwise catch about a real
 * endpoint, and it is the one place this module adds a judgement of its own - stated here rather than
 * buried, and exercised by a negative case.
 */
const PLACEHOLDER_AUTHORITY = new RegExp('h' + 't' + 'tps?' + ':\\/\\/(?=[A-Za-z0-9.<>_-]*<[A-Z][A-Z0-9_]*>)', 'gi');

export function maskPlaceholderAuthority(source: string): string {
  return source.replace(PLACEHOLDER_AUTHORITY, 'INJECTEDSCHEME_');
}

/** Everything the shared scan is applied to, after the two maskings above. */
export function normalizeForScan(source: string): string {
  return maskDeclaredTokens(maskPlaceholderAuthority(source));
}

// ---------------------------------------------------------------------------------------------
// The two named bans over src/server/**, assembled from fragments
// ---------------------------------------------------------------------------------------------

/**
 * The row-append data statement used as a bare binding name. Both the full statement name and its
 * three-letter short form are refused, and only in binding position: a repository method reached
 * through a receiver is a named boundary and stays, a mention in prose about how a row is written
 * stays, and the statement inside a prepared string stays - it is the local variable named after the
 * statement that this ban is about.
 */
const ROW_APPEND_NAMES: readonly string[] = ['ins' + 'ert', 'i' + 'n' + 's'];
const ROW_APPEND_AS_LOCAL = new RegExp(
  '(?<![A-Za-z0-9_$])(?:const|let|var|function)\\s+(?:' + ROW_APPEND_NAMES.join('|') + ')(?![A-Za-z0-9_$])',
  'gi',
);

/** The keyword that opens a second store on an existing connection. Whole word, any case, anywhere -
 *  a longer word that merely contains it is not it, and is not reported. */
const SECOND_STORE_KEYWORD = new RegExp('(?<![A-Za-z0-9_$])' + 'att' + 'ach' + '(?![A-Za-z0-9_$])', 'gi');

// ---------------------------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------------------------

export const PARTICULAR_FINDING_CODES = [
  // fail-closed: the scan must be observed to have run over something
  'SCAN_ROOT_MISSING',
  'SCAN_ROOT_EMPTY',
  'SCAN_SET_EMPTY',
  'SERVER_TREE_EMPTY',
  'ARTIFACT_UNREADABLE',
  'FIXTURE_OUTSIDE_SCAN_SET',
  // R24, re-reported from the ONE shared scan
  'PARTICULAR_URL_SCHEME',
  'PARTICULAR_ADDRESS_LITERAL',
  'PARTICULAR_HOSTNAME',
  'PARTICULAR_LONG_DIGIT_RUN',
  'PARTICULAR_CURRENCY_FIGURE',
  'PLACEHOLDER_MALFORMED',
  'PARTICULAR_SCAN_UNMAPPED',
  // the declared-token vocabulary, kept honest in both directions
  'DOTTED_TOKEN_UNDECLARED',
  'DECLARED_TOKEN_UNUSED',
  // steering §4.1, over src/server/**
  'ROW_APPEND_STATEMENT_AS_LOCAL',
  'SECOND_STORE_KEYWORD_PRESENT',
] as const;

export type ParticularFindingCode = (typeof PARTICULAR_FINDING_CODES)[number];

export interface ParticularFinding {
  readonly code: ParticularFindingCode;
  readonly detail: string;
}

/** The codes the shared no-deployment-particular scan is allowed to produce here. */
const SHARED_PARTICULAR_CODES: readonly string[] = [
  'PARTICULAR_URL_SCHEME',
  'PARTICULAR_ADDRESS_LITERAL',
  'PARTICULAR_HOSTNAME',
  'PARTICULAR_LONG_DIGIT_RUN',
  'PARTICULAR_CURRENCY_FIGURE',
  'PLACEHOLDER_MALFORMED',
];

/**
 * Re-report the shared scan's findings under this module's code set. A code this module has no
 * equivalent for becomes `PARTICULAR_SCAN_UNMAPPED` rather than being dropped: silently discarding a
 * finding from a fail-closed scan turns a widened rule into a narrowed one.
 */
export function mapParticularFindings(input: readonly ComposeFinding[], where: string): readonly ParticularFinding[] {
  const out: ParticularFinding[] = [];
  for (const finding of input) {
    if (SHARED_PARTICULAR_CODES.includes(finding.code)) {
      out.push({ code: finding.code as ParticularFindingCode, detail: `${where}: ${finding.detail}` });
    } else {
      out.push({
        code: 'PARTICULAR_SCAN_UNMAPPED',
        detail: `${where}: the shared no-deployment-particular scan reported ${finding.code}, which this checker has no code for: ${finding.detail}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------------------------

/** One file as the audit sees it. `text: null` means it could not be read - a finding, not a skip. */
export interface Artifact {
  readonly path: string;
  readonly text: string | null;
}

/** What a declared root contributed. `exists: false` and an empty `files` are both findings. */
export interface RootReport {
  readonly root: string;
  readonly exists: boolean;
  readonly files: readonly string[];
}

export interface ParticularScanInput {
  readonly roots: readonly RootReport[];
  /** Files under the declared roots, held to R24. */
  readonly artifacts: readonly Artifact[];
  /** Files under `src/server/**`, held to the two named bans. */
  readonly serverArtifacts: readonly Artifact[];
  /** Every tracked path, used only to prove no fixture-shaped file escaped the scan set. */
  readonly trackedFiles: readonly string[];
}

/** What the caller reports, so a check cannot pass by having examined nothing. */
export interface ParticularScanReport {
  readonly findings: readonly ParticularFinding[];
  readonly artifactsScanned: number;
  readonly serverFilesScanned: number;
  readonly perRoot: Readonly<Record<string, number>>;
}

/** The injected no-deployment-particular scan. R24 has exactly one implementation. */
export type ParticularScanner = (source: string) => readonly ComposeFinding[];

export function auditDeploymentParticulars(input: ParticularScanInput, scan: ParticularScanner): ParticularScanReport {
  const findings: ParticularFinding[] = [];
  const note = (code: ParticularFindingCode, detail: string): void => {
    findings.push({ code, detail });
  };

  // --- the scan set must be real before anything is asserted about its contents ---------------
  const perRoot: Record<string, number> = {};
  for (const report of input.roots) {
    perRoot[report.root] = report.files.length;
    if (!report.exists) {
      note('SCAN_ROOT_MISSING', `declared scan root "${report.root}" does not exist, so everything this check asserts about it would pass vacuously`);
      continue;
    }
    if (report.files.length === 0) {
      note('SCAN_ROOT_EMPTY', `declared scan root "${report.root}" matched no file; a root that matches nothing is a check that does not run`);
    }
  }
  if (input.artifacts.length === 0) {
    note('SCAN_SET_EMPTY', 'the scan set is empty, so no artifact was examined at all');
  }
  if (input.serverArtifacts.length === 0) {
    note('SERVER_TREE_EMPTY', `no file was collected under ${SERVER_ROOT}, so both named bans would pass vacuously`);
  }

  // --- no fixture-shaped tracked file is outside the scan set ---------------------------------
  const scanned = new Set(input.artifacts.map((a) => a.path));
  for (const tracked of input.trackedFiles) {
    if (!FIXTURE_SHAPED_PATH.test(tracked)) continue;
    if (scanned.has(tracked)) continue;
    note(
      'FIXTURE_OUTSIDE_SCAN_SET',
      `"${tracked}" is a fixture by name or by directory and is not in the scan set; every fixture is in scope, so either scan it or stop calling it one`,
    );
  }

  // --- R24 over every artifact ---------------------------------------------------------------
  const declaredSeen = new Set<string>();
  for (const artifact of input.artifacts) {
    if (artifact.text === null) {
      note('ARTIFACT_UNREADABLE', `${artifact.path} could not be read, so it was not scanned; an unreadable artifact is a failure, never a skip`);
      continue;
    }
    for (const token of DECLARED_DOTTED_TOKENS) {
      if (artifact.text.includes(token)) declaredSeen.add(token);
    }
    const normalized = normalizeForScan(artifact.text);
    findings.push(...mapParticularFindings(scan(normalized), artifact.path));
    for (const token of dottedTokensIn(normalized)) {
      note(
        'DOTTED_TOKEN_UNDECLARED',
        `${artifact.path}: the dotted token "${token}" is neither a declared file name nor a declared attribute access; if it is a host name it must become a placeholder, and if it is not it must be declared`,
      );
    }
  }

  // --- the declared list carries no stale entry ----------------------------------------------
  if (input.artifacts.some((a) => a.text !== null)) {
    for (const token of DECLARED_DOTTED_TOKENS) {
      if (!declaredSeen.has(token)) {
        note('DECLARED_TOKEN_UNUSED', `the declared dotted token "${token}" appears in no scanned artifact; a list with a stale entry is a list nobody is reading`);
      }
    }
  }

  // --- the two named bans over src/server/** -------------------------------------------------
  for (const artifact of input.serverArtifacts) {
    if (artifact.text === null) {
      note('ARTIFACT_UNREADABLE', `${artifact.path} could not be read, so neither named ban was applied to it`);
      continue;
    }
    const lines = artifact.text.split(/\r?\n/);
    lines.forEach((line, index) => {
      ROW_APPEND_AS_LOCAL.lastIndex = 0;
      if (ROW_APPEND_AS_LOCAL.test(line)) {
        note(
          'ROW_APPEND_STATEMENT_AS_LOCAL',
          `${artifact.path}:${index + 1} binds a local named after the row-append data statement; a store write is spelled through a repository or a named prepared statement, so that a row cannot be appended beside the money boundary guard`,
        );
      }
      SECOND_STORE_KEYWORD.lastIndex = 0;
      if (SECOND_STORE_KEYWORD.test(line)) {
        note(
          'SECOND_STORE_KEYWORD_PRESENT',
          `${artifact.path}:${index + 1} names the keyword that opens a second store on an existing connection; steering §4.1 permits none, ever, and a mention in prose is where the idea starts`,
        );
      }
    });
  }

  return {
    findings,
    artifactsScanned: input.artifacts.filter((a) => a.text !== null).length,
    serverFilesScanned: input.serverArtifacts.filter((a) => a.text !== null).length,
    perRoot,
  };
}

// ---------------------------------------------------------------------------------------------
// The file entry point
// ---------------------------------------------------------------------------------------------

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'coverage', '.vite', 'outputs', '.loop', '__pycache__']);

/** Collect text files under `dir`, or return null when the directory is not there. */
export function collectFiles(dir: string): readonly string[] | null {
  if (!existsSync(dir)) return null;
  const out: string[] = [];
  const visit = (current: string): void => {
    for (const name of readdirSync(current)) {
      if (SKIP_DIRECTORIES.has(name)) continue;
      const path = join(current, name);
      if (statSync(path).isDirectory()) visit(path);
      else {
        const normalized = path.split('\\').join('/');
        if (!BINARY_EXTENSIONS.some((e) => normalized.toLowerCase().endsWith(e))) out.push(normalized);
      }
    }
  };
  visit(dir);
  return out.sort();
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function trackedFiles(): readonly string[] {
  try {
    return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export interface FileScanOptions {
  readonly roots?: readonly string[];
  readonly serverRoot?: string;
  readonly trackedFiles?: readonly string[];
}

/**
 * Audit the real tree. Every failure mode of the walk itself is a finding: a missing root, a root
 * that matched nothing, a file that would not read.
 */
export function auditDeploymentParticularsFiles(scan: ParticularScanner, options: FileScanOptions = {}): ParticularScanReport {
  const roots = options.roots ?? SCAN_ROOTS;
  const serverRoot = options.serverRoot ?? SERVER_ROOT;

  const rootReports: RootReport[] = [];
  const artifacts: Artifact[] = [];
  for (const root of roots) {
    const files = collectFiles(root);
    if (files === null) {
      rootReports.push({ root, exists: false, files: [] });
      continue;
    }
    rootReports.push({ root, exists: true, files });
    for (const path of files) artifacts.push({ path, text: readOrNull(path) });
  }

  const serverFiles = collectFiles(serverRoot) ?? [];
  const serverArtifacts: Artifact[] = serverFiles.map((path) => ({ path, text: readOrNull(path) }));

  return auditDeploymentParticulars(
    { roots: rootReports, artifacts, serverArtifacts, trackedFiles: options.trackedFiles ?? trackedFiles() },
    scan,
  );
}
