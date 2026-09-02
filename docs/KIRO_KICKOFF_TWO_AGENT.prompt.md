# NIZAM two-agent continuation prompt

Paste the prompt below into the authorized AI developer with the NIZAM repository open.

## Prompt

```text
Continue the NIZAM build from the current authorized state.

Repositories:
https://github.com/seifelsherbinyy/nizamcore
https://github.com/seifelsherbinyy/nizamfinancialapp

Read first:
1. AGENTS.md
2. contracts/pfos/12_PFOS_Two_Agent_VPS_Deployment_and_Operations.md
3. ops/DEPLOYMENT_CONTROL.md
4. docs/NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md

Current state:
- Phase 1 is active on the VPS.
- signalbus, finance-agent, and scheduler are healthy.
- finance-agent uses protected host environment files assembled from .secrets.
- Telegram long polling is active.
- The outbound finance-agent test succeeded.
- The owner must reply to the test message before inbound handling can be verified.
- life-agent, backup, proxy, DNS, webhooks, and live model routing are not fully activated.
- The eligibility registry remains fail-closed while it is provisional or incomplete.

Authority and safety:
- Preserve AGENTS.md, the money rules, Drive drive.file scope, deterministic finance engines, and all intentional user changes and deletions.
- Do not reset, clean, overwrite, revert, commit, or push without explicit owner authorization.
- Do not execute or mark complete any human gate in ops/DEPLOYMENT_CONTROL.md.
- Use .secrets only through protected environment-file handling. Never print, log, commit, or expose secret values.
- Do not place hostnames, addresses, messaging identifiers, storage identifiers, credentials, or real financial data in tracked files.
- Do not make live model calls or spend against a production key unless the applicable human gate and owner authorization are already satisfied.
- Keep the signal bus internal only. Keep finance and life stores, credentials, and volumes isolated.
- Do not apply changes directly to nizamcore from this repository. Create a reviewable patch under ops/nizamcore-patches when a cross-repository change is required.

Style requirements for new or edited text:
- Use plain ASCII punctuation.
- Do not add em dashes, curly quotes, decorative stars, emoji, filler, or generic AI headings.
- Use normal hyphens, short headings, and direct technical language.
- Preserve code operators and required Markdown syntax when changing existing files.

Work sequence:
1. Inspect the local worktree without removing existing user changes.
2. Inspect the VPS service status and redacted logs without exposing secrets.
3. Confirm whether the owner has replied to the finance bot. If not, report that inbound verification is waiting for the owner and continue with safe offline work.
4. Run focused tests for any changed area, then run typecheck, lint, the full test suite, build, and verify:all -- --all.
5. Inspect nizamcore at its current main revision. Confirm whether it has a production life-agent image and the required HTTP, scheduler, signal-bus, health, and privacy boundaries before proposing deployment.
6. If nizamcore is missing required production artifacts, do not invent them and do not deploy placeholders. Produce a precise patch plan or reviewable patch series for the owner.
7. Keep backup, proxy, DNS, webhook, OAuth, and model-routing work behind their human gates.
8. Rebuild and redeploy only after the local checks pass and the deployment scope is authorized.
9. Report exact commands run, observed results, changed files, live service status, communication evidence, and remaining blockers.

Do not claim full activation until inbound Telegram handling, persistence, signal publication, scheduler delivery, health behavior, retry behavior, and failure behavior have been observed and tested.
```

## Operating note

This prompt is a continuation guide. The active authority is the contract and the deployment control record, not this file. It does not authorize human gates, secret exposure, commits, pushes, or public activation by itself.
