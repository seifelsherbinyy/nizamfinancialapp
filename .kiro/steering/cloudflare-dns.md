# Cloudflare access (INVARIANT)

**Precedence:** `docs/CLOUDFLARE_DNS_SETUP_G2.md` is the authority on gate G2 and on the token itself.
Where this file disagrees with it, that file wins and this one is the bug.

1. **The credential is an API token, never an OAuth client.** The dashboard's `Manage account -> OAuth
   clients` page registers a third-party application that other Cloudflare users consent to. Nothing in
   this repository is that. Never open it for this project.
2. **One home for the value:** `.secrets/cloudflare.env` (gitignored in full). A filled-in
   `ops/env/*.env` is also gitignored as of 2026-08-09; before that it was not, on a public repository.
3. **Never read the token into a message, a log, a commit, or a report.** Confirm it by making a scoped
   call, never by echoing it. `docs/CLOUDFLARE_DNS_SETUP_G2.md` step 7 states this as a rule; it was
   violated on 2026-08-09 and the token is disclosed.

   **Rotation is DEFERRED by owner decision dated 2026-08-10 (D-ROTATE), and NO SESSION MAY ROTATE
   UNILATERALLY.** Not the zone token, and not either bot token. Authority:
   `.kiro/specs/06-two-agent-vps/KIRO_SHIP_LIVE.prompt.md` §1 **D-ROTATE** and §11 ("do not rotate
   anything"). The deferral runs until the deployment has been **tested in practical use and the owner
   reports it working**; rotation then becomes the **final acceptance test** rather than a step that was
   skipped. The disclosed tokens are the tokens this deployment uses - build with them.

   **The attached condition is not optional.** While the disclosed tokens are live, `getWebhookInfo` is
   checked **on every run** as the detection control that compensates for the deferral. A deferral without
   its compensating control is just an unrotated credential.

   **What did not change:** the non-disclosure prohibition above, in full force, for as long as the
   deferral lasts and after it. Creating, rotating or destroying a credential is a **mutation** - see
   `.kiro/steering/two-agent-vps.md` §2a for the reads/mutations boundary. This entry resequences the
   remedy; it does not soften the rule that caused it to be needed. It also does not disturb this file's
   precedence header: `docs/CLOUDFLARE_DNS_SETUP_G2.md` states the non-disclosure rule and states no
   rotation instruction, so there is nothing there for this deferral to disagree with.
4. **One entry point:** `sh scripts/cf_dns.sh <verify|zones|records|resolve|audit|upsert|nizam>`. Do not
   write a fresh curl line; extend the script. It feeds the token to curl over stdin so the value never
   reaches `ps` or a history file.
5. **Reads are free, writes are gated.** `upsert` and `nizam` refuse unless the operator sets
   `CF_ALLOW_MUTATE=1`. An agent may diagnose the zone. An agent does not change it. **This is now the
   general rule rather than one provider's local habit:** `.kiro/steering/two-agent-vps.md` §2a carries the
   standing read-only carve-out and its mutation boundary, which resolves finding **F11** - the two steering
   files previously disagreed on whether an agent could authenticate with the owner's token in order to read.
   They no longer do. Read that sub-section and this item as one rule.
6. **Grey cloud only.** Every A record is `proxied=false`. `audit` fails the zone if any record is
   proxied. Reason: four of them, in that document's section 6.
7. **Evidence is resolution, not the console.** `resolve` answers "is G2 done"; `records` only reports
   what the provider's API claims.
8. **G2 is blocked on a domain, not on tooling.** Measured 2026-08-09: the account holds zero zones.
   Until a zone exists there is nothing to point anywhere.
9. **The MCP path is off until the token is widened.** `https://mcp.cloudflare.com/mcp` returned 403
   `insufficient_scope` demanding `user:read account:read`; the token has neither. The server is
   registered in `~/.kiro/settings/mcp.json` as `cloudflare-api` with `"disabled": true` for that
   reason. Flip it only after a probe succeeds. Never add Client IP filtering to a token meant for it.
10. **`money`, not `finance`.** The two hostnames are `life` and `money`. The service is named finance;
    the hostname is not.
