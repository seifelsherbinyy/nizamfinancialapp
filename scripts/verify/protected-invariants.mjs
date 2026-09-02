#!/usr/bin/env node
/**
 * UPOI task 8.2: fail-closed repository checks for protected invariants.
 * Owner: build tooling. This is a structural companion to the focused runtime tests.
 *
 * The check deliberately validates repository shape and check wiring, not live providers,
 * credentials, deployment records, or historical loop evidence. Missing roots, empty modules,
 * missing probes, and missing delegated checks are failures rather than vacuous passes.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { walk, verdict } from "./_util.mjs";

const findings = [];
const notes = [];
const PROTECTED_TEST_FLOOR = 2301;
const REQUIRED_FILES = [
  "src/lib/money/money.ts",
  "src/server/db/moneyBoundary.ts",
  "src/server/db/connection.ts",
  "src/server/db/store.ts",
  "src/server/db/repositories/index.ts",
  "src/server/db/repositories/accountsRepository.ts",
  "src/server/db/repositories/decisionsRepository.ts",
  "src/server/db/repositories/obligationsRepository.ts",
  "src/server/db/repositories/statementsRepository.ts",
  "src/server/db/repositories/transactionsRepository.ts",
  "src/server/db/repositories/fxRatesRepository.ts",
  "src/server/db/spendLedgerRepo.ts",
  "src/server/signals/signalStore.ts",
  "src/server/signals/signalStoreSchema.ts",
  "src/server/signals/schemaParity.test.ts",
  "src/server/signals/nizam-signalbus.envelope.schema.json",
  "src/lib/drive/oauth.ts",
  "src/server/hermes/browserBoundary.test.ts",
  "scripts/verify/money-invariant.mjs",
  "scripts/verify/drive-scope.mjs",
  "scripts/verify/secret-scan.mjs",
  "scripts/verify/no-deployment-particular.mjs",
  "src/server/ops/deploymentParticulars.ts",
  "scripts/verify/ingest-isolation.mjs",
  "scripts/verify/testcount.mjs",
  "scripts/verify/all.mjs",
];
const FINANCIAL_WRITERS = {
  accounts: "src/server/db/repositories/accountsRepository.ts",
  decisions: "src/server/db/repositories/decisionsRepository.ts",
  obligations: "src/server/db/repositories/obligationsRepository.ts",
  statements: "src/server/db/repositories/statementsRepository.ts",
  transactions: "src/server/db/repositories/transactionsRepository.ts",
  fx_rates: "src/server/db/repositories/fxRatesRepository.ts",
  spend_ledger: "src/server/db/spendLedgerRepo.ts",
};
const MONEY_REPOSITORIES = Object.values(FINANCIAL_WRITERS).filter((path) => !path.endsWith("spendLedgerRepo.ts"));
const FINANCE_TABLES = Object.keys(FINANCIAL_WRITERS);

function text(path) {
  try {
    const value = readFileSync(path, "utf8");
    if (value.trim() === "") {
      findings.push(path + " is empty; the invariant cannot be established");
      return "";
    }
    return value;
  } catch (error) {
    findings.push(path + " could not be read: " + String(error && error.message));
    return "";
  }
}

function requireNonEmpty(path) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    findings.push("required protected artifact is missing: " + path);
    return "";
  }
  return text(path);
}

for (const path of REQUIRED_FILES) requireNonEmpty(path);

// 1. Money is integer-only at both the pure and persistence boundaries.
const moneyCore = text("src/lib/money/money.ts");
const moneyBoundary = text("src/server/db/moneyBoundary.ts");
if (!/export function isMoney\s*\(/.test(moneyCore) || !/Number\.isSafeInteger/.test(moneyCore)) {
  findings.push("money core does not expose the safe-integer predicate used by the persistence boundary");
}
if (!/fromDecimalStrict|fromMilliunitsStrict/.test(moneyCore)) {
  findings.push("money core has no strict machine-boundary parser");
}
if (!/import\s*\{[^}]*\bisMoney\b[^}]*\}\s*from ['\"]\.\.\/\.\.\/lib\/money\/money\.ts['\"]/.test(moneyBoundary)) {
  findings.push("money persistence boundary does not reuse the canonical isMoney predicate");
}
if (/\bparseFloat\s*\(|\.toFixed\s*\(/.test(moneyBoundary)) {
  findings.push("money persistence boundary contains a floating-point conversion");
}
for (const path of MONEY_REPOSITORIES) {
  const source = text(path);
  if (!/moneyBoundary\.ts/.test(source)) findings.push(path + " is a financial writer without the canonical money boundary");
  if (!/assertMoneyField|assertOptionalMoneyField|assertRatePair/.test(source)) {
    findings.push(path + " has no executable integer-money/rate guard before its write path");
  }
}
const boundaryImporters = walk("src/server", [".ts", ".tsx"])
  .filter((path) => !/\.test\.[tj]sx?$/.test(path))
  .filter((path) => /moneyBoundary\.ts/.test(text(path)))
  .sort();
const expectedImporters = [...MONEY_REPOSITORIES, "src/server/db/index.ts"].sort();
if (boundaryImporters.length !== expectedImporters.length || boundaryImporters.some((path, i) => path !== expectedImporters[i])) {
  findings.push("money boundary has an unexpected writer/importer set: " + boundaryImporters.join(", "));
}
notes.push("canonical money boundary importers: " + boundaryImporters.length);

// 2. Each financial table has exactly one non-test SQL writer.
const serverFiles = walk("src/server", [".ts", ".tsx"]).filter((path) => !/\.test\.[tj]sx?$/.test(path));
const writerFindings = [];
for (const table of FINANCE_TABLES) {
  const target = new RegExp("(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(?:\\$\\{TABLE\\}|" + table + ")", "i");
  const tableConstant = new RegExp("const\\s+TABLE\\s*=\\s*['\\\"]" + table + "['\\\"]");
  const writers = serverFiles.filter((path) => {
    const source = text(path);
    return target.test(source) && (tableConstant.test(source) || source.includes("INSERT INTO " + table));
  });
  const expected = FINANCIAL_WRITERS[table];
  if (writers.length !== 1 || writers[0] !== expected) {
    writerFindings.push(table + " -> " + writers.join(", ") + " (expected " + expected + ")");
  }
}
if (writerFindings.length) findings.push("financial writer map is not single-writer: " + writerFindings.join("; "));
notes.push("financial tables checked for one writer: " + FINANCE_TABLES.length);

// 3. Drive scope and sensitive/deployment scans remain wired into the gate.
const drive = text("src/lib/drive/oauth.ts");
if (!/export const DRIVE_FILE_SCOPE\s*=\s*['"]https:\/\/www\.googleapis\.com\/auth\/drive\.file['"]/.test(drive)) {
  findings.push("Drive OAuth boundary does not define the exact drive.file scope as its canonical constant");
}
if (!/initTokenClient[\s\S]*?scope:\s*DRIVE_FILE_SCOPE/.test(drive) || !/assertDriveFileScopeOnly/.test(drive)) {
  findings.push("Drive OAuth sign-in does not request and validate the canonical drive.file scope");
}
const harness = text("scripts/verify/all.mjs");
for (const requiredCheck of [
  "money-invariant.mjs",
  "drive-scope.mjs",
  "secret-scan.mjs",
  "no-deployment-particular.mjs",
  "ingest-isolation.mjs",
  "testcount.mjs",
]) {
  if (!harness.includes(requiredCheck)) findings.push("verification harness does not run " + requiredCheck);
}
if (!/id:\s*["']AC19["'][\s\S]{0,180}protected-invariants\.mjs/.test(harness)) {
  findings.push("verification harness does not run the protected-invariants check as AC19");
}
const secretScan = text("scripts/verify/secret-scan.mjs");
for (const marker of ["tracked()", "PATTERNS", "FORBIDDEN_PATHS", "verdict("]) {
  if (!secretScan.includes(marker)) findings.push("secret scan is missing its fail-closed " + marker + " guard");
}
const deploymentScan = text("scripts/verify/no-deployment-particular.mjs");
for (const marker of ["auditDeploymentParticularsFiles", "artifactsScanned", "serverFilesScanned"]) {
  if (!deploymentScan.includes(marker)) findings.push("deployment-particular scan is missing its fail-closed " + marker + " assertion");
}
const deploymentAudit = text("src/server/ops/deploymentParticulars.ts");
for (const marker of ["SCAN_ROOTS", "src/server/mocks/fixtures", "FIXTURE_OUTSIDE_SCAN_SET", "collectFiles"]) {
  if (!deploymentAudit.includes(marker)) findings.push("deployment-particular audit does not cover " + marker);
}
notes.push("secret scan covers tracked files and deployment scan covers ops plus fixture roots");

// 4. All three non-browser tiers are explicitly excluded and have source probes.
const isolation = text("scripts/verify/ingest-isolation.mjs");
for (const tier of ["src/server", "src/features/routing", "src/features/benchmark"]) {
  if (!isolation.includes('"' + tier + '"')) findings.push("bundle isolation does not explicitly exclude " + tier);
}
for (const probe of ["SPEND_TOTAL_UNREPRESENTABLE", "LIVE_API_BASE_URL_UNRESOLVED"]) {
  if (!isolation.includes(probe)) findings.push("bundle isolation has no stable probe for " + probe);
}
for (const marker of ["BUNDLE_PROBES", "ENTRY_SEEDS", "dist", "verdict("]) {
  if (!isolation.includes(marker)) findings.push("bundle isolation is missing its fail-closed " + marker + " guard");
}
const browserBoundary = text("src/server/hermes/browserBoundary.test.ts");
if (!/routing|benchmark/.test(browserBoundary)) findings.push("browser boundary test does not name routing and benchmark modules");

// 5. Separate stores and closed signal schema are asserted by both source shape and tests.
const connection = text("src/server/db/connection.ts");
if ((connection.match(/new sqlite\.DatabaseSync/g) ?? []).length !== 1) {
  findings.push("SQLite connection factory does not contain exactly one database constructor");
}
const financeStore = text("src/server/db/store.ts");
const signalStore = text("src/server/signals/signalStore.ts");
if (!/openStore/.test(financeStore) || !/openStore/.test(signalStore)) findings.push("finance and signal stores do not share the connection factory");
if (!signalStore.includes("SIGNAL_STORE_FILE_NAME") || !/config\.fileName !== SIGNAL_STORE_FILE_NAME/.test(signalStore)) {
  findings.push("signal store does not enforce its isolated file boundary");
}
if (/openSignalStore/.test(financeStore) || /openFinanceStore/.test(signalStore)) {
  findings.push("finance and signal store entry points are coupled");
}
const schemaPath = "src/server/signals/nizam-signalbus.envelope.schema.json";
const schemaRaw = text(schemaPath);
let schema = null;
try {
  schema = JSON.parse(schemaRaw);
} catch {
  findings.push("vendored signal schema is not valid JSON");
}
function record(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    findings.push(label + " is not an object");
    return {};
  }
  return value;
}
if (schema) {
  const defs = record(schema.$defs, "signal schema $defs");
  const payload = record(defs.payload, "signal schema payload");
  const payloadProperties = record(payload.properties, "signal schema payload.properties");
  if (payload.additionalProperties !== false && payload.unevaluatedProperties !== false) {
    findings.push("signal payload is not closed");
  }
  if (JSON.stringify(Object.keys(payloadProperties).sort()) !== JSON.stringify(["direction", "level", "note"])) {
    findings.push("signal payload fields are not exactly level, direction, and note");
  }
  if (JSON.stringify(payload.required) !== JSON.stringify(["level"])) findings.push("signal payload does not require level");
  for (const form of ["draftEnvelope", "storedEnvelope"]) {
    const node = record(defs[form], "signal schema " + form);
    if (node.unevaluatedProperties !== false && node.additionalProperties !== false) {
      findings.push("signal " + form + " is not closed");
    }
  }
}
const signalSchemaSource = text("src/server/signals/signalStoreSchema.ts");
for (const trigger of ["signals_append_only_update", "signals_append_only_delete", "signal_audit_append_only_update", "signal_audit_append_only_delete"]) {
  if (!signalSchemaSource.includes(trigger)) findings.push("signal store is missing append-only trigger " + trigger);
}

// 6. The floor is ratcheted, not inferred from historical evidence.
const moneyInvariant = text("scripts/verify/money-invariant.mjs");
for (const marker of ["walk(\"src\"", "parseFloat", "toFixed", "verdict("]) {
  if (!moneyInvariant.includes(marker)) findings.push("money invariant scan is missing its fail-closed " + marker + " guard");
}
const testcount = text("scripts/verify/testcount.mjs");
if (!/passed\s*<\s*min/.test(testcount) || !/numPassedTests/.test(testcount) || !/numFailedTests/.test(testcount)) {
  findings.push("test-floor check does not fail on test failures and below-floor passes");
}
const floorMatches = [...harness.matchAll(/scripts\/verify\/testcount\.mjs[\s\S]{0,160}?--min[^0-9]*(\d+)/g)].map((match) => Number(match[1]));
if (floorMatches.length !== 1 || floorMatches.some((floor) => !Number.isSafeInteger(floor) || floor < PROTECTED_TEST_FLOOR)) {
  findings.push(
    "verification harness must have exactly one explicit test floor at or above " +
      PROTECTED_TEST_FLOOR + "; found " +
      (floorMatches.length ? floorMatches.join(", ") : "none"),
  );
}
notes.push("protected floor asserted: " + PROTECTED_TEST_FLOOR + " passing tests; historical receipts are not consulted");

verdict("protected repository invariants are fail-closed", findings, notes);
