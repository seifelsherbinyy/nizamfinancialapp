#!/usr/bin/env node
/**
 * Acceptance criterion eighteen: no deployment particular in `ops/**` or in any fixture, and the two
 * store-isolation bans hold over `src/server/**`. Owner: build tooling.
 *
 * Steering §0b keeps both repositories public and pays for that with one rule: the repository may
 * hold the design, never a particular that would let a reader reach or impersonate the running
 * system. Six per-artifact checkers hold that rule over the artifact each of them owns. Nothing held
 * it over the TREE, so an `ops/` file that no checker claims, and a fixture wherever it lives, was
 * covered by nobody. This is that check, and it is its own named check rather than a clause added to
 * a check whose name already covers something else.
 *
 * THE BRIDGE. R24 has ONE implementation - `scanForParticulars` in `src/server/ops/composeTemplate.ts`
 * - and this script reuses it rather than restating a pattern of its own, so a later widening of R24
 * moves every artifact at once. Node 24 strips types natively, so the two modules are imported
 * directly with an explicit extension; nothing is transpiled, no dependency is added, and there is no
 * second copy of the scan. The audit module takes the scanner as an argument for the same reason: a
 * runtime relative import inside it would need an extension the project's TypeScript settings
 * deliberately forbid, while a type-only import is erased before resolution.
 *
 * IT FAILS CLOSED. A missing root, a root that matched nothing, an empty scan set, an unreadable
 * file, a fixture-shaped path outside the scan set and a scan code this checker cannot map are all
 * failures. The counts below are printed and asserted, because a check that examined nothing must
 * never be able to report success.
 */
import { scanForParticulars } from "../../src/server/ops/composeTemplate.ts";
import {
  SCAN_ROOTS,
  SERVER_ROOT,
  auditDeploymentParticularsFiles,
} from "../../src/server/ops/deploymentParticulars.ts";
import { verdict } from "./_util.mjs";

const report = auditDeploymentParticularsFiles(scanForParticulars);
const findings = report.findings.map((f) => f.code + " - " + f.detail);

const notes = [
  "declared scan roots: " + SCAN_ROOTS.map((r) => r + "/** (" + (report.perRoot[r] ?? 0) + " files)").join(", "),
  "artifacts scanned for a deployment particular: " + report.artifactsScanned,
  "files scanned under " + SERVER_ROOT + "/** for the two store-isolation bans: " + report.serverFilesScanned,
];

// The check must not be able to pass by having examined nothing.
if (report.artifactsScanned === 0) {
  findings.push("SCAN_SET_EMPTY - no artifact was read, so this check would have passed without scanning anything");
}
if (report.serverFilesScanned === 0) {
  findings.push("SERVER_TREE_EMPTY - no file was read under " + SERVER_ROOT + ", so both named bans would have passed vacuously");
}

verdict("no deployment particular in ops or any fixture", findings, notes);
