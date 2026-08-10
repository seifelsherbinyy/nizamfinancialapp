/**
 * NIZAM · Structural audit of the image ownership record and the port posture it assumes
 * Implemented by: PFOS Contract 12 / Phase 10.8 (spec 06-two-agent-vps)
 * Owning requirements: R28 (a Dockerfile for every image this repository owns, and a documented
 *   build path producing the exact tag `ops/docker-compose.yml` references), R30 (the firewall
 *   posture and the port bindings agree, and the certificate-challenge resolution is recorded
 *   rather than inferred), R22 (the readiness command an image declares exists inside it),
 *   R24 (no secret and no deployment particular in a tracked file)
 * Depends on: `./composeTemplate` (the ONE compose parser and the service vocabulary),
 *   `./caddyTemplate` (the directive name the proxy configuration is asserted on, read rather than
 *   respelled), `./healthProbe` (the readiness command NAME, which that module owns).
 *   `node:fs` and `node:path` are used by the file entry point only; the audit itself is a pure
 *   function over text with the on-disk existence probe injected.
 *
 * ## Why this exists
 *
 * `ops/docker-compose.yml` names six image references. Finding **O1** is that the tree held zero
 * build recipes, so after every one of the gates G1 through G8 clears, `docker compose up` still
 * could not run. R28's answer is not "write six recipes" - four of the six are not this
 * repository's to write, or are not writable yet - so the answer is a **complete record**, in
 * `ops/IMAGE_BUILD.md`, of which reference is in which state and why.
 *
 * A record in prose rots in one direction only: toward describing a tree that has moved. So the
 * record is READ here rather than trusted. Every failure mode is a finding and never a skip: a
 * reference with no row, a row for a reference the topology does not name, a state nobody declared,
 * a recipe a row names and the tree does not hold, a recipe the tree holds and no row claims, a
 * recipe whose base disagrees with the pinned runtime, a recipe that ends privileged, and a
 * `BUILT_HERE` row with no build invocation anywhere in the document.
 *
 * ## The second half: the port posture (R30, finding F12)
 *
 * Two individually true statements were together insufficient. The topology publishes exactly one
 * host port; the register's G1 correction advised opening a second one for a cleartext certificate
 * challenge. Opening a port in the firewall reaches nothing if the topology never binds it, so the
 * challenge fails **while the firewall looks correct**, which is the expensive shape of this class
 * of defect. {@link auditPortPosture} is the cross-artifact assertion that was missing, and it is
 * deliberately **neutral about which resolution was chosen**: it reads the challenge the register
 * names and then requires the topology and the proxy configuration to match THAT choice. Either
 * admissible resolution passes it; a resolution recorded in one artifact and contradicted by
 * another does not.
 *
 * ## Nothing here is executed
 *
 * Steering §2 permits writing a build recipe and forbids running one. No image is built, no
 * registry is contacted, no tag is resolved, and no command in any document is run. This module
 * only reads text and asks whether a path exists.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { HTTP_CHALLENGE_DISABLE_DIRECTIVE } from './caddyTemplate.ts';
import { PROXY_SERVICE, parseComposeSubset, type YamlMap } from './composeTemplate.ts';
import { PROBE_COMMAND_NAME } from './healthProbe.ts';

// ---------------------------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------------------------

/**
 * The three states a reference may be in. Enumerated, so a state nobody declared is a finding
 * rather than a fourth policy invented in a table cell.
 *
 * `OWNED_BUILD_PENDING` is a state R28 did not anticipate, and it is recorded rather than avoided.
 * R28 has a binary ownership axis - the repository owns an image, or it does not - and two of the
 * six references sit in neither box: the consent bus and the scheduler are owned here **in library
 * form** and have no process to package. Calling them `EXTERNAL` would hand them to a repository
 * that does not hold their code; calling them `BUILT_HERE` would need an entry point nobody has
 * written. The third state is the honest shape, and {@link auditImageOwnership} makes it strictly
 * stronger than silence, because a row in it must name the task or finding that closes it.
 */
export const OWNERSHIP_STATES = ['BUILT_HERE', 'EXTERNAL', 'OWNED_BUILD_PENDING'] as const;
export type OwnershipState = (typeof OWNERSHIP_STATES)[number];

/** Exactly the states that may name a recipe, and exactly the states that must name a blocker. */
export const STATES_WITH_RECIPE: readonly OwnershipState[] = ['BUILT_HERE'];
export const STATES_WITH_BLOCKER: readonly OwnershipState[] = ['OWNED_BUILD_PENDING'];

/** An image reference is an upper-snake-case placeholder ending in `_IMAGE_REF` and nothing else. */
export const IMAGE_REFERENCE_SHAPE = /^<[A-Z][A-Z0-9_]*_IMAGE_REF>$/;

/** Where a recipe this repository owns lives. One directory per image, named for the service. */
export const RECIPE_ROOT = 'ops/images';
export const RECIPE_FILE_NAME = 'Dockerfile';

/**
 * The two certificate challenges, named by the vocabulary an operator would recognise. The register
 * names one of them; the topology and the proxy configuration must match the one it names.
 */
export const CHALLENGE_NEEDING_CLEARTEXT_PORT = 'HTTP-01';
export const CHALLENGE_ON_TLS_PORT = 'TLS-ALPN-01';

/**
 * The administrative port is allowed by the host firewall and is deliberately NOT bound by the
 * topology: it admits the operator's own session, which no container serves. So it is excluded from
 * the firewall-versus-bindings comparison by name, rather than by a rule about which ports look
 * administrative.
 */
export const ADMIN_PORT_PLACEHOLDER = '<ADMIN_PORT>';

// ---------------------------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------------------------

export const IMAGE_OWNERSHIP_FINDING_CODES = [
  // the inputs themselves
  'RECORD_UNREADABLE',
  'COMPOSE_UNREADABLE',
  'RECIPE_UNREADABLE',
  'RECORD_TABLE_MISSING',
  'CROSS_READ_EMPTY',
  // the record against the topology, in both directions
  'IMAGE_REFERENCE_UNRECORDED',
  'RECORDED_REFERENCE_UNKNOWN',
  'RECORD_ROW_DUPLICATED',
  // each row's own shape
  'OWNERSHIP_STATE_UNDECLARED',
  'ROW_REASON_MISSING',
  'ROW_NAMES_RECIPE_IT_MAY_NOT',
  'ROW_NAMES_NO_RECIPE',
  'ROW_NAMES_NO_BLOCKER',
  'ROW_NAMES_BLOCKER_IT_MAY_NOT',
  // the record against the recipes on disk, in both directions
  'RECIPE_ABSENT',
  'RECIPE_UNCLAIMED',
  'BUILD_PATH_UNDOCUMENTED',
  // what a recipe this repository owns must and must not contain
  'RECIPE_BASE_NOT_PINNED_TO_RUNTIME',
  'RECIPE_ENDS_PRIVILEGED',
  'RECIPE_OMITS_PROBE_COMMAND',
  'RECIPE_DECLARES_HEALTHCHECK',
  'RECIPE_PUBLISHES_PORT',
  'RECIPE_CARRIES_ENV_DEFAULT',
  'RECIPE_HAS_NO_ENTRYPOINT',
  // R30: the firewall posture and the bindings, and the resolution recorded for the challenge
  'FIREWALL_POSTURE_UNREADABLE',
  'FIREWALL_OPENS_UNBOUND_PORT',
  'BINDING_NOT_ADMITTED_BY_FIREWALL',
  'CHALLENGE_RESOLUTION_UNRECORDED',
  'CHALLENGE_RESOLUTION_AMBIGUOUS',
  'CHALLENGE_PORT_BINDING_DISAGREES',
  'CHALLENGE_DISABLED_STATE_DISAGREES',
  'CHALLENGE_RESOLUTION_NOT_IN_RECORD',
] as const;

export type ImageOwnershipFindingCode = (typeof IMAGE_OWNERSHIP_FINDING_CODES)[number];

export interface ImageOwnershipFinding {
  readonly code: ImageOwnershipFindingCode;
  readonly detail: string;
}

// ---------------------------------------------------------------------------------------------
// Parsing the record
// ---------------------------------------------------------------------------------------------

export interface OwnershipRow {
  readonly reference: string;
  /** As written. Validated against {@link OWNERSHIP_STATES} by the audit, not by the parser. */
  readonly state: string;
  readonly recipe: string | null;
  readonly blockedBy: string | null;
  readonly reason: string;
}

/** A cell holding only a dash, or nothing, means "not applicable" rather than "empty by accident". */
function cellOrNull(cell: string): string | null {
  const text = cell.replace(/`/g, '').trim();
  if (text === '' || text === '-' || text === '--') return null;
  return text;
}

/**
 * Every row of the record whose first cell is an image reference.
 *
 * Deliberately shape-driven rather than heading-driven: the row is recognised by its first cell
 * being a `<*_IMAGE_REF>` placeholder, so reformatting the document, renaming its headings or
 * adding a second table cannot silently empty the record. A record that parses to nothing is
 * `RECORD_TABLE_MISSING`, which is a finding, so "recognised nothing" cannot read as "all well".
 */
export function parseOwnershipRecord(source: string): readonly OwnershipRow[] {
  const rows: OwnershipRow[] = [];
  let inFence = false;
  for (const raw of source.split(/\r?\n/)) {
    if (raw.trimStart().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
    const reference = (cells[0] ?? '').replace(/`/g, '').trim();
    if (!IMAGE_REFERENCE_SHAPE.test(reference)) continue;
    rows.push({
      reference,
      state: (cells[1] ?? '').replace(/`/g, '').trim(),
      recipe: cellOrNull(cells[2] ?? ''),
      blockedBy: cellOrNull(cells[3] ?? ''),
      reason: (cells[4] ?? '').trim(),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Parsing a recipe
// ---------------------------------------------------------------------------------------------

export interface RecipeFacts {
  /** Every base image named by a stage, in document order. */
  readonly bases: readonly string[];
  /** The user the LAST directive names, or `null` when the recipe never sets one. */
  readonly finalUser: string | null;
  /** Command names the recipe installs onto the executable path. */
  readonly installedCommands: readonly string[];
  readonly declaresHealthcheck: boolean;
  readonly publishesPort: boolean;
  /** An `ENV` or `ARG` carrying a value - a default, which R27 forbids the image to hold. */
  readonly carriesEnvDefault: boolean;
  readonly hasEntrypoint: boolean;
}

/** Where an installed command lands. The recipe writes into this directory and nowhere else. */
const COMMAND_DIRECTORY = '/usr/local/bin/';

/**
 * Read a recipe as facts rather than as text.
 *
 * Line continuations are joined first, because a directive split across a backslash is one
 * directive and a per-line scan would read its tail as prose. Comments are dropped, so a directive
 * quoted inside the header commentary is not mistaken for one the builder would execute - which
 * matters here, since every recipe in this repository documents what it deliberately omits.
 */
export function parseRecipe(source: string): RecipeFacts {
  const joined = source.replace(/\\\r?\n\s*/g, ' ');
  const lines = joined
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));

  const bases: string[] = [];
  let finalUser: string | null = null;
  const installedCommands = new Set<string>();
  let declaresHealthcheck = false;
  let publishesPort = false;
  let carriesEnvDefault = false;
  let hasEntrypoint = false;

  for (const line of lines) {
    const directive = (/^([A-Za-z]+)\b/.exec(line)?.[1] ?? '').toUpperCase();
    const rest = line.slice(directive.length).trim();
    switch (directive) {
      case 'FROM': {
        const base = rest.split(/\s+/)[0] ?? '';
        if (base !== '') bases.push(base);
        break;
      }
      case 'USER':
        finalUser = rest.split(/\s+/)[0] ?? null;
        break;
      case 'HEALTHCHECK':
        declaresHealthcheck = true;
        break;
      case 'EXPOSE':
        publishesPort = true;
        break;
      case 'ENV':
      case 'ARG':
        // A bare `ARG NAME` declares a build argument and carries nothing; `ARG NAME=value` is a
        // default. Only the second is refused, because only the second is a value in the image.
        if (rest.includes('=') || /^\S+\s+\S/.test(rest)) carriesEnvDefault = true;
        break;
      case 'ENTRYPOINT':
        hasEntrypoint = true;
        break;
      default:
        break;
    }
    for (const match of line.matchAll(new RegExp(`${COMMAND_DIRECTORY}([A-Za-z0-9_-]+)`, 'g'))) {
      installedCommands.add(match[1] ?? '');
    }
  }

  return {
    bases,
    finalUser,
    installedCommands: [...installedCommands],
    declaresHealthcheck,
    publishesPort,
    carriesEnvDefault,
    hasEntrypoint,
  };
}

/**
 * Is `base` pinned to the runtime major the repository pins?
 *
 * A MAJOR rather than a patch, deliberately: a patch this repository invented would be a version
 * nobody verified exists, and the immutable identity of the bytes is the digest, which is resolved
 * at build time and recorded in the operator's own build receipt. What this refuses is a base with
 * no tag at all, a floating word for a tag, and a major that disagrees with the pinned one.
 */
export function baseMatchesRuntimeMajor(base: string, major: string): boolean {
  const separator = base.lastIndexOf(':');
  if (separator <= 0) return false;
  const tag = base.slice(separator + 1);
  const tagMajor = /^(\d+)(?:[.-]|$)/.exec(tag)?.[1] ?? null;
  return tagMajor === major;
}

/** Users that are root by another name. A recipe that ends on one of these ends privileged. */
const PRIVILEGED_USERS: readonly string[] = ['root', '0', '0:0'];

// ---------------------------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------------------------

export interface RecipeInput {
  readonly path: string;
  /** `null` when the file could not be read, which is a finding rather than a skip. */
  readonly text: string | null;
}

export interface ImageOwnershipInput {
  /** `ops/IMAGE_BUILD.md`, or `null` when it could not be read. */
  readonly record: string | null;
  /** `ops/docker-compose.yml`, or `null` when it could not be read. */
  readonly compose: string | null;
  /** The runtime major the repository pins, from `.nvmrc`. */
  readonly runtimeMajor: string;
  /** Every recipe the tree actually holds, discovered rather than taken from the record. */
  readonly recipesOnDisk: readonly RecipeInput[];
  /** Does this path exist? Injected, so the audit stays a pure function over text. */
  readonly probe: (path: string) => boolean;
}

export interface ImageOwnershipReport {
  readonly findings: readonly ImageOwnershipFinding[];
  readonly referencesExamined: number;
  readonly rowsExamined: number;
  readonly recipesExamined: number;
}

/** Every `<*_IMAGE_REF>` the topology names, keyed by the service that runs it. */
export function imageReferencesOf(composeSource: string): ReadonlyMap<string, string> {
  const services = (parseComposeSubset(composeSource).services ?? {}) as YamlMap;
  const found = new Map<string, string>();
  for (const [name, value] of Object.entries(services)) {
    const image = (value as YamlMap).image;
    if (typeof image === 'string') found.set(name, image);
  }
  return found;
}

export function auditImageOwnership(input: ImageOwnershipInput): ImageOwnershipReport {
  const findings: ImageOwnershipFinding[] = [];
  const note = (code: ImageOwnershipFindingCode, detail: string): void => {
    findings.push({ code, detail });
  };

  if (input.record === null) {
    note('RECORD_UNREADABLE', 'the ownership record could not be read, so every reference below is unaccounted for');
  }
  if (input.compose === null) {
    note('COMPOSE_UNREADABLE', 'the topology could not be read, so the set of image references it names is unknown');
  }

  const references = new Map<string, string>();
  if (input.compose !== null) {
    try {
      for (const [service, image] of imageReferencesOf(input.compose)) references.set(image, service);
    } catch (e) {
      note('COMPOSE_UNREADABLE', `the topology could not be parsed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const rows = input.record === null ? [] : parseOwnershipRecord(input.record);
  if (input.record !== null && rows.length === 0) {
    note(
      'RECORD_TABLE_MISSING',
      'the ownership record holds no row whose first cell is an image reference, so it accounts for nothing; a record that parses to nothing must never read as a record in which all is well',
    );
  }

  // --- the record against the topology, in both directions --------------------------------------
  const byReference = new Map<string, OwnershipRow>();
  for (const row of rows) {
    if (byReference.has(row.reference)) {
      note('RECORD_ROW_DUPLICATED', `"${row.reference}" is recorded more than once, so which row governs it is a guess`);
      continue;
    }
    byReference.set(row.reference, row);
    if (references.size > 0 && !references.has(row.reference)) {
      note(
        'RECORDED_REFERENCE_UNKNOWN',
        `the record accounts for "${row.reference}", which the topology does not name; a row for an image nothing runs is a row nobody maintains`,
      );
    }
  }
  for (const [reference, service] of references) {
    if (!byReference.has(reference)) {
      note(
        'IMAGE_REFERENCE_UNRECORDED',
        `service "${service}" runs "${reference}" and the record accounts for it nowhere, so whether this repository builds it is unknown - which is finding O1 exactly`,
      );
    }
  }

  // --- each row's own shape ---------------------------------------------------------------------
  const claimedRecipes = new Map<string, OwnershipRow>();
  for (const row of byReference.values()) {
    const state = OWNERSHIP_STATES.find((s) => s === row.state) ?? null;
    if (state === null) {
      note(
        'OWNERSHIP_STATE_UNDECLARED',
        `"${row.reference}" is recorded in state "${row.state}"; the declared states are [${OWNERSHIP_STATES.join(', ')}] and a fourth invented in a table cell is a policy no checker holds`,
      );
      continue;
    }
    if (row.reason.replace(/[.\s]/g, '') === '') {
      note('ROW_REASON_MISSING', `"${row.reference}" is recorded in state ${state} with no reason; an unexplained state is one the next reader changes`);
    }

    const mayHaveRecipe = STATES_WITH_RECIPE.includes(state);
    if (row.recipe !== null && !mayHaveRecipe) {
      note(
        'ROW_NAMES_RECIPE_IT_MAY_NOT',
        `"${row.reference}" is in state ${state} and names recipe "${row.recipe}"; only [${STATES_WITH_RECIPE.join(', ')}] builds here, so this row both disclaims and claims the image`,
      );
    }
    if (row.recipe === null && mayHaveRecipe) {
      note('ROW_NAMES_NO_RECIPE', `"${row.reference}" is in state ${state} and names no recipe, so nothing in the tree builds it and R28 is unmet for it`);
    }

    const mustHaveBlocker = STATES_WITH_BLOCKER.includes(state);
    if (row.blockedBy === null && mustHaveBlocker) {
      note(
        'ROW_NAMES_NO_BLOCKER',
        `"${row.reference}" is in state ${state} and names no blocking task or finding; a pending build with no owner is a hope, and this state is only stronger than silence while it carries one`,
      );
    }
    if (row.blockedBy !== null && !mustHaveBlocker) {
      note(
        'ROW_NAMES_BLOCKER_IT_MAY_NOT',
        `"${row.reference}" is in state ${state} and names blocker "${row.blockedBy}"; only [${STATES_WITH_BLOCKER.join(', ')}] is blocked, so this row reads as both settled and waiting`,
      );
    }

    if (row.recipe === null || !mayHaveRecipe) continue;
    claimedRecipes.set(row.recipe, row);
    if (!input.probe(row.recipe)) {
      note('RECIPE_ABSENT', `"${row.reference}" names recipe "${row.recipe}", which is not on disk; a record that points at a file that does not exist is one nobody trusts`);
      continue;
    }
    if (input.record !== null && !documentsBuildPath(input.record, row.recipe, row.reference)) {
      note(
        'BUILD_PATH_UNDOCUMENTED',
        `the record holds no build invocation naming both recipe "${row.recipe}" and reference "${row.reference}"; R28 asks for a documented path producing the exact tag the topology references, and one value resolved once is what keeps the build and the topology from disagreeing`,
      );
    }
  }

  // --- the recipes on disk against the record ---------------------------------------------------
  for (const recipe of input.recipesOnDisk) {
    const claimedBy = claimedRecipes.get(recipe.path) ?? null;
    if (claimedBy === null) {
      note(
        'RECIPE_UNCLAIMED',
        `"${recipe.path}" is a recipe the tree holds and no row claims; an unclaimed recipe builds an image nothing runs, or runs an image nothing records`,
      );
    }
    if (recipe.text === null) {
      note('RECIPE_UNREADABLE', `"${recipe.path}" could not be read, so none of the properties R28 asks of it was checked`);
      continue;
    }
    const facts = parseRecipe(recipe.text);

    for (const base of facts.bases) {
      if (!baseMatchesRuntimeMajor(base, input.runtimeMajor)) {
        note(
          'RECIPE_BASE_NOT_PINNED_TO_RUNTIME',
          `"${recipe.path}" builds on base "${base}", which is not pinned to the runtime major ${input.runtimeMajor} that .nvmrc names; an image on an unverified runtime is one the gates were never run against`,
        );
      }
    }
    if (facts.finalUser === null || PRIVILEGED_USERS.includes(facts.finalUser.toLowerCase())) {
      note(
        'RECIPE_ENDS_PRIVILEGED',
        `"${recipe.path}" ends on user "${facts.finalUser ?? 'none declared'}"; the last directive must name an unprivileged account, so the process has no privilege to lose`,
      );
    }
    if (!facts.installedCommands.includes(PROBE_COMMAND_NAME)) {
      note(
        'RECIPE_OMITS_PROBE_COMMAND',
        `"${recipe.path}" installs [${facts.installedCommands.join(', ') || 'nothing'}] and not "${PROBE_COMMAND_NAME}"; the restore drill invokes that name and R22 holds only if the command exists inside the image`,
      );
    }
    if (facts.declaresHealthcheck) {
      note(
        'RECIPE_DECLARES_HEALTHCHECK',
        `"${recipe.path}" declares a healthcheck of its own; the topology declares one per service with its interval, timeout, retries and grace period, and two policies drift`,
      );
    }
    if (facts.publishesPort) {
      note(
        'RECIPE_PUBLISHES_PORT',
        `"${recipe.path}" documents a port; §2.2.1 gives the published port to the proxy service and to nothing else, and phase 1 binds none at all`,
      );
    }
    if (facts.carriesEnvDefault) {
      note(
        'RECIPE_CARRIES_ENV_DEFAULT',
        `"${recipe.path}" carries a configuration value; R27 supplies no default for any entry, and a default in the image turns a refused boot into a guessed one`,
      );
    }
    if (!facts.hasEntrypoint) {
      note('RECIPE_HAS_NO_ENTRYPOINT', `"${recipe.path}" names no entry point, so what the image runs is whatever the base image happened to declare`);
    }
  }

  // --- a check that examined nothing must never pass ---------------------------------------------
  if (references.size === 0 || rows.length === 0) {
    note(
      'CROSS_READ_EMPTY',
      `the cross read examined ${references.size} image reference(s) and ${rows.length} record row(s); at zero on either side every assertion above would hold vacuously`,
    );
  }

  return { findings, referencesExamined: references.size, rowsExamined: rows.length, recipesExamined: input.recipesOnDisk.length };
}

/**
 * The two flags a documented build invocation names its inputs with. Enumerated, because the check
 * below is about an invocation and not about two strings appearing near each other: the record's own
 * table row names a recipe and a reference on one line, and a rule that accepted that would be
 * satisfied by the very document it is supposed to hold to account.
 */
export const RECIPE_FLAG = '--file';
export const TAG_FLAG = '--tag';

/**
 * Does the record document a build invocation for this recipe that produces this exact tag?
 *
 * Both on the same statement, because that is the property: **one value is resolved once** and both
 * the build and the topology receive that same string, so they cannot disagree. Two mentions in
 * separate paragraphs would be a convention that they should match; a single invocation naming both
 * leaves nothing to match. Line continuations are joined first so a wrapped command still reads as
 * one statement.
 */
export function documentsBuildPath(record: string, recipe: string, reference: string): boolean {
  const joined = record.replace(/\\\r?\n\s*/g, ' ');
  for (const line of joined.split(/\r?\n/)) {
    if (line.includes(`${RECIPE_FLAG} ${recipe}`) && line.includes(`${TAG_FLAG} ${reference}`)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// R30: the firewall posture, the bindings, and the challenge resolution
// ---------------------------------------------------------------------------------------------

export interface PortPostureInput {
  /** `ops/GATE_REGISTER.md` - where the firewall posture and the resolution are recorded. */
  readonly register: string;
  /** `ops/docker-compose.yml` - what is actually bound. */
  readonly compose: string;
  /** `ops/Caddyfile` - which challenge the proxy is configured to attempt. */
  readonly proxyConfig: string;
  /** `ops/IMAGE_BUILD.md` - where the decision and its reasoning are recorded. */
  readonly record: string;
}

/**
 * Every port the recorded firewall posture opens. Read off the `ufw allow` lines, which is where the
 * register states the posture, rather than off the prose around them.
 */
export function firewallAllowedPorts(register: string): readonly string[] {
  const ports = new Set<string>();
  for (const match of register.matchAll(/\bufw\s+allow\s+(\S+?)\/tcp\b/g)) {
    ports.add(match[1] ?? '');
  }
  return [...ports];
}

/**
 * Every host port the topology publishes, as written - the left half of each mapping.
 *
 * An unreadable or unparseable topology yields the empty set, which reads downstream as "binds
 * nothing" and therefore as a disagreement rather than as an agreement. That is the fail-closed
 * direction: the alternative would be an audit that passes because it could not read the file.
 */
export function publishedHostPorts(compose: string): readonly string[] {
  let services: YamlMap;
  try {
    services = (parseComposeSubset(compose).services ?? {}) as YamlMap;
  } catch {
    return [];
  }
  const ports = new Set<string>();
  for (const value of Object.values(services)) {
    const declared = (value as YamlMap).ports;
    if (!Array.isArray(declared)) continue;
    for (const entry of declared) {
      if (typeof entry !== 'string') continue;
      ports.add(entry.split(':')[0] ?? entry);
    }
  }
  return [...ports];
}

/**
 * The R30 cross-artifact assertion, in both directions, plus the record of the F12 resolution.
 *
 * **Neutral about which resolution was chosen.** It reads the challenge the register names and then
 * requires the topology and the proxy configuration to match THAT choice, so either admissible
 * resolution passes and a resolution recorded in one artifact and contradicted by another does not.
 * Naming neither challenge is a finding, and naming both is a different finding, because "the
 * register mentions the words" is not a decision.
 */
export function auditPortPosture(input: PortPostureInput): readonly ImageOwnershipFinding[] {
  const findings: ImageOwnershipFinding[] = [];
  const note = (code: ImageOwnershipFindingCode, detail: string): void => {
    findings.push({ code, detail });
  };

  const allowed = firewallAllowedPorts(input.register);
  if (allowed.length === 0) {
    note(
      'FIREWALL_POSTURE_UNREADABLE',
      'the register states no firewall allowance at all, so there is no posture for the bindings to agree with and R30 cannot be evaluated in either direction',
    );
  }
  const published = publishedHostPorts(input.compose);
  const deploymentPorts = allowed.filter((p) => p !== ADMIN_PORT_PLACEHOLDER);

  for (const port of deploymentPorts) {
    if (!published.includes(port)) {
      note(
        'FIREWALL_OPENS_UNBOUND_PORT',
        `the recorded firewall posture opens ${port} and the topology binds no such host port; an open port that reaches nothing fails WHILE THE FIREWALL LOOKS CORRECT, which is the shape of defect R30 exists to close`,
      );
    }
  }
  for (const port of published) {
    if (!deploymentPorts.includes(port)) {
      note(
        'BINDING_NOT_ADMITTED_BY_FIREWALL',
        `the topology binds host port ${port} and the recorded firewall posture does not admit it; the service would start, report healthy, and be unreachable`,
      );
    }
  }

  // --- which challenge was chosen, and does everything else match it ---------------------------
  const namesCleartext = input.register.includes(CHALLENGE_NEEDING_CLEARTEXT_PORT);
  const namesTlsPort = input.register.includes(CHALLENGE_ON_TLS_PORT);
  const challengeDisabled = input.proxyConfig.includes(HTTP_CHALLENGE_DISABLE_DIRECTIVE);

  if (!namesCleartext && !namesTlsPort) {
    note(
      'CHALLENGE_RESOLUTION_UNRECORDED',
      `the register names neither ${CHALLENGE_NEEDING_CLEARTEXT_PORT} nor ${CHALLENGE_ON_TLS_PORT}; R30 requires the chosen resolution to be RECORDED there rather than inferred from either artifact alone`,
    );
  } else if (namesCleartext && namesTlsPort) {
    note(
      'CHALLENGE_RESOLUTION_AMBIGUOUS',
      `the register names both ${CHALLENGE_NEEDING_CLEARTEXT_PORT} and ${CHALLENGE_ON_TLS_PORT}; exactly one is chosen, and a document naming both records a discussion rather than a decision`,
    );
  } else if (namesCleartext) {
    // Option 1: the cleartext challenge. It needs a second published port and the proxy must be
    // left free to attempt it.
    if (published.length < 2) {
      note(
        'CHALLENGE_PORT_BINDING_DISAGREES',
        `the register chooses ${CHALLENGE_NEEDING_CLEARTEXT_PORT}, which needs the cleartext port, and the topology publishes ${published.length} host port(s); that challenge cannot complete against a port nothing binds`,
      );
    }
    if (challengeDisabled) {
      note(
        'CHALLENGE_DISABLED_STATE_DISAGREES',
        `the register chooses ${CHALLENGE_NEEDING_CLEARTEXT_PORT} and the proxy configuration carries "${HTTP_CHALLENGE_DISABLE_DIRECTIVE}", so the challenge the register relies on is switched off in the file that would perform it`,
      );
    }
  } else {
    // Option 2: the challenge that needs only the TLS port. Exactly one published port, and the
    // cleartext challenge must be off so issuance is deterministic rather than a failed attempt.
    if (published.length !== 1) {
      note(
        'CHALLENGE_PORT_BINDING_DISAGREES',
        `the register chooses ${CHALLENGE_ON_TLS_PORT}, which needs the TLS port alone, and the topology publishes ${published.length} host port(s); a second binding is a port opened for a challenge nothing performs`,
      );
    }
    if (!challengeDisabled) {
      note(
        'CHALLENGE_DISABLED_STATE_DISAGREES',
        `the register chooses ${CHALLENGE_ON_TLS_PORT} and the proxy configuration does not carry "${HTTP_CHALLENGE_DISABLE_DIRECTIVE}"; the proxy would attempt the cleartext challenge against a port nothing publishes, and issuance becomes a failed attempt and a retry`,
      );
    }
  }

  const recorded = namesTlsPort ? CHALLENGE_ON_TLS_PORT : namesCleartext ? CHALLENGE_NEEDING_CLEARTEXT_PORT : null;
  if (recorded !== null && !input.record.includes(recorded)) {
    note(
      'CHALLENGE_RESOLUTION_NOT_IN_RECORD',
      `the register chooses ${recorded} and the ownership record does not name it; the build path assumes a port posture, so a recipe built for the other challenge would ask for a port nobody opened`,
    );
  }

  return findings;
}

// ---------------------------------------------------------------------------------------------
// The file entry points
// ---------------------------------------------------------------------------------------------

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** Every recipe the tree holds, discovered by walking {@link RECIPE_ROOT} rather than by trusting the record. */
export function recipesOnDisk(root: string): readonly RecipeInput[] {
  const base = join(root, RECIPE_ROOT);
  let entries: readonly string[];
  try {
    entries = readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const found: RecipeInput[] = [];
  for (const name of entries) {
    const relative = `${RECIPE_ROOT}/${name}/${RECIPE_FILE_NAME}`;
    if (!existsSync(join(root, relative))) continue;
    found.push({ path: relative, text: readOrNull(join(root, relative)) });
  }
  return found;
}

/** The whole audit against the real tree. Reads; runs nothing. */
export function auditImageOwnershipFiles(root: string): ImageOwnershipReport {
  const runtimeMajor = (readOrNull(join(root, '.nvmrc')) ?? '').trim().split(/[.\s]/)[0] ?? '';
  return auditImageOwnership({
    record: readOrNull(join(root, 'ops/IMAGE_BUILD.md')),
    compose: readOrNull(join(root, 'ops/docker-compose.yml')),
    runtimeMajor,
    recipesOnDisk: recipesOnDisk(root),
    probe: (relative) => existsSync(join(root, relative)),
  });
}

/** The R30 audit against the real tree. An unreadable artifact yields the empty string, which fails closed. */
export function auditPortPostureFiles(root: string): readonly ImageOwnershipFinding[] {
  return auditPortPosture({
    register: readOrNull(join(root, 'ops/GATE_REGISTER.md')) ?? '',
    compose: readOrNull(join(root, 'ops/docker-compose.yml')) ?? '',
    proxyConfig: readOrNull(join(root, 'ops/Caddyfile')) ?? '',
    record: readOrNull(join(root, 'ops/IMAGE_BUILD.md')) ?? '',
  });
}

/** The service the topology gives the one published port to, re-exported so a caller need not restate it. */
export { PROXY_SERVICE };
