# PFOS Contract Ingestion Report

**Run date:** 2026-08-05
**Operator:** repository owner, interactively authorized
**Tool:** `scripts/ingest/pfos-drive-pull.mjs` (new in this change)
**Result:** 4 contracts ingested and hash-recorded · 4 expected contracts proven absent · 0 secrets written to the repository · baseline verification unchanged and green

---

## 1. What was asked and what was found

| Expected | Found | Note |
|---|---|---|
| 8 PFOS markdown contracts | **4** | 01-04 present; 05-08 do not exist in the drive account |
| Newer prerequisite / readiness / credential / OAuth / implementation files | **0** | No such file in the PFOS tree; keyword sweeps hit only unrelated projects |
| Copy unchanged into `contracts/pfos/` | **Done** | Byte-for-byte; SHA-256 recorded per file |

The absence of 05-08 is a verified finding, not a retrieval failure. Method and
corroborating evidence are in `contracts/pfos/_PFOS_CONTRACT_INDEX.md`.

---

## 2. Repository state before any change (recorded baseline)

Captured before writing a single file, on the pinned runtime, at commit `41cfb21`.

| Command | Result |
|---|---|
| `npm run lint` | exit 0 — zero errors, zero warnings |
| `npm run typecheck` | exit 0 — zero TypeScript errors |
| `npm run test` | exit 0 — **135 tests passed across 16 test files** |
| `npm run test:loop` | exit 0 — loop refusal paths hold |
| `npm run verify:ledger` | exit 0 — 56 events, chain intact, 14 certificates, 0 uncovered phases |
| `npm run build` | exit 0 — `dist/assets/index-AREuoWuV.js` 379.59 kB (gzip 116.79 kB), service worker emitted |
| `npm run verify:all` | exit 0 — **18 of 18 acceptance checks PASS** |

Runtime: Node v24.14.1 against `.nvmrc` pin `24`; npm 11.11.0; lockfile version 3.

Raw transcript retained outside the repository at
`~/.aki/tmp/nizam_baseline/baseline_raw.txt`.

### Post-change re-run

The same seven commands were re-run after all edits. Results are identical, with the
one intended difference that `verify:all` now reports **19 of 19** checks passing
(one new check was added, see section 5).

---

## 3. How the contracts were retrieved

The shipped application deliberately holds the narrowest useful drive permission — the
per-file scope — which can only see files the application itself created. It therefore
**cannot** read a folder the owner created by hand. Retrieval needed a separate path.

What was done:

1. A local, single-purpose tool was written at `scripts/ingest/pfos-drive-pull.mjs`.
2. It reads the desktop client credential already present in the git-ignored `.secrets/`
   directory. Nothing secret is printed, copied into the repository, or committed.
3. It runs the loopback authorization flow with PKCE (S256) on `127.0.0.1`, requesting a
   **read-only** scope, and verifies the returned state value before accepting the code.
4. The owner authorized the grant once, interactively, in the browser.
5. The folder tree was walked, markdown was downloaded, and each file was written with its
   byte count and SHA-256 into `contracts/pfos/_INGESTION_MANIFEST.json`.
6. The resulting token is cached only at `.secrets/pfos-ingest.token.json`, mode 0600,
   inside a git-ignored directory (confirmed with `git check-ignore`).

### Scope discipline and how the widened permission is contained

Using a read-only scope is a genuine, deliberate widening relative to the application's
per-file scope. It is contained four ways:

- **Separation.** The tool lives under `scripts/`, is never imported by `src/`, and is not
  part of the production bundle.
- **Enforcement.** A new automated check (section 5) fails the build if the broader scope
  ever appears under `src/`, or if application code imports the ingestion tool.
- **Revocation.** `node scripts/ingest/pfos-drive-pull.mjs --revoke` withdraws the grant at
  the provider and clears the cached token. **Recommended once the contracts are stable.**
- **Contract alignment.** Contract 02 section 9 asks for "minimal OAuth scopes" and
  "read-only drive access where possible". A read-only scope for a read-only ingestion task
  satisfies that; the application's per-file scope remains stricter than the contract asks.

---

## 4. Compatibility of the ingested files with existing repository invariants

Checked before committing, because the instruction to copy the contracts *unchanged*
could have collided with a repository rule and forced a choice.

| Invariant | Outcome |
|---|---|
| AC11 — no organization-specific term in any tracked file | **Clean.** All four contracts were scanned against the full denylist; zero hits. No checker had to be weakened and no contract text had to be altered. |
| AC09 — no secret material in tracked files | **Clean.** No key, token, or credential literal in any contract. |
| AC12 — contract index and build log agree | **Unaffected.** That check reads only `contracts/_CONTRACT_INDEX.md`, which still holds exactly the five original rows. The PFOS index is a separate file. |
| AC13 — verification ledger covers every logged phase | **Unaffected.** No phase line of the form that check recognizes was added to the build log, so no new certificate is required. This change is contract ingestion and analysis, not a build phase. |
| AC10 — source files declare contract and phase | **Unaffected.** That check scans `src/` and `tests/` only. |

Had a contract contained a denied term, the correct action would have been to record the
conflict here and seek a decision — not to edit the authoritative document. That did not
arise.

---

## 5. Changes made to the verification harness

One check was added; nothing was replaced or relaxed.

**`AC08b — ingestion tooling stays isolated from the application`**
(`scripts/verify/ingest-isolation.mjs`, wired into `scripts/verify/all.mjs` directly after
the existing scope check.)

It fails if any of the following is true:

1. A file under `src/` mentions the read-only drive scope.
2. A file under `src/` imports anything from `scripts/`.
3. The ingestion tool references the full, unrestricted drive scope.
4. The token cache path is not git-ignored.
5. The tool has lost its `--revoke` capability.

Rationale: this change introduced a broader permission into the workspace for the first
time. The repository already treats drive scope as a guarded invariant (AC08). Extending
that guard to cover the new capability keeps the guarantee mechanical rather than relying
on anyone remembering the rule. The check was negative-tested — each of the five
conditions was induced deliberately and observed to fail the harness — before being
accepted.

---

## 6. Files added by this change

| Path | Kind |
|---|---|
| `contracts/pfos/01..04_PFOS_*.md` | Ingested contracts, unmodified |
| `contracts/pfos/_INGESTION_MANIFEST.json` | Machine-readable provenance and checksums |
| `contracts/pfos/_PFOS_CONTRACT_INDEX.md` | Human index, including the absence finding |
| `docs/PFOS_REPOSITORY_GAP_ANALYSIS.md` | Contract-versus-repository comparison |
| `docs/PFOS_IMPLEMENTATION_ROADMAP.md` | Safest execution order |
| `docs/PFOS_HUMAN_DELIVERABLES.md` | What only the owner can supply or decide |
| `docs/PFOS_CONTRACT_INGESTION_REPORT.md` | This report |
| `scripts/ingest/pfos-drive-pull.mjs` | Ingestion tool |
| `scripts/verify/ingest-isolation.mjs` | New isolation check |

No file under `src/` was modified. No dependency was added, removed, or upgraded. No
existing test, contract, spec, or steering document was changed.

---

## 7. Honest limitations of this report

- **Four contracts are missing and their content is unknown.** Every statement in the gap
  analysis about agent orchestration, tooling, the knowledge model, testing standards, and
  the continuous-improvement loop is inferred from contracts 01-04, which reference those
  areas without specifying them. Those inferences are marked as inferred.
- **The credential list is derived, not quoted.** No credential or prerequisite document
  was found, so `docs/PFOS_HUMAN_DELIVERABLES.md` reads requirements out of the security
  and integration sections of contracts 02 and 04.
- **No live drive round-trip of the application itself was verified.** That still waits on
  the web-application client id and browser key noted as outstanding in
  `RELEASE_CHECKLIST.md`; the ingestion tool used a different credential type and does not
  discharge that item.
- **`RELEASE_CHECKLIST.md` carries stale counts** — it records 123 tests and 17 checks,
  while the tree now measures 135 tests and 19 checks. Left uncorrected on purpose: it is
  a dated record of the 0.1.0 release, not a live dashboard. Flagged so the discrepancy is
  not mistaken for a regression.
