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
   violated on 2026-08-09 and the token is compromised until rotated.
4. **One entry point:** `sh scripts/cf_dns.sh <verify|zones|records|resolve|audit|upsert|nizam>`. Do not
   write a fresh curl line; extend the script. It feeds the token to curl over stdin so the value never
   reaches `ps` or a history file.
5. **Reads are free, writes are gated.** `upsert` and `nizam` refuse unless the operator sets
   `CF_ALLOW_MUTATE=1`. An agent may diagnose the zone. An agent does not change it.
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
