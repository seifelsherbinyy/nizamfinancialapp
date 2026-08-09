# Cloudflare credential: where it lives and how both agents reach it

> **Authority:** `docs/CLOUDFLARE_DNS_SETUP_G2.md` owns gate G2 and owns the token-minting steps
> (its step 7). This file owns only the part that document deliberately leaves out: where the value is
> stored on the operator machine, and how the Aki CLI and the Kiro IDE are wired to it.
> **Steering:** `.kiro/steering/cloudflare-dns.md` carries the same rules in invariant form.
> **Public-repository constraint:** no token, no domain, no address and no zone identifier appears in
> this file, and none ever will.

## BLUF

An **API token** is the credential. An **OAuth client** is not, and the dashboard page that offers one
is for publishing an application that other Cloudflare users consent to. Both agents reach the token
the same way, through `scripts/cf_dns.sh`, which reads it from a gitignored file. The MCP route exists
and is registered, but it is switched off until the token is widened, because the server rejects the
token as scoped today.

## Three consumers, one credential

| Consumer | How it reaches Cloudflare | Status |
|---|---|---|
| The deployment itself (gate G2) | It does not. Two A records created once by a human. No credential is compiled in, mounted, or passed to a container. | correct as designed |
| Aki CLI | `sh scripts/cf_dns.sh …` through its shell tool | live |
| Kiro IDE | the same script, plus a registered `cloudflare-api` MCP server held at `"disabled": true` | script live, MCP pending a scope change |

The deployment row is the important one. `ops/docker-compose.yml` gives no service a Cloudflare
credential, and it should stay that way: `docs/CLOUDFLARE_DNS_SETUP_G2.md` section 6.3 explains that
grey-cloud DNS is what lets the proxy issue its own certificate *without* a zone-scoped token, so
handing the internet-facing container one would give away a property the design paid for.

## Where the value lives

`.secrets/cloudflare.env`, which `.gitignore` line 54 ignores in full. Never `ops/env/` unless you have
re-checked the ignore rules: until 2026-08-09 a filled-in `ops/env/proxy.env` was **tracked** on this
public repository, because the `.env` rule matches only a file named exactly `.env`. That hole is closed
now by `ops/env/*.env`, `*cloudflare*.env` and `cf_token*`, each verified with `git check-ignore -v`.

Template, for a fresh machine. Copy it to `.secrets/cloudflare.env` and fill in the value by hand:

```sh
# quotes on the header value are load bearing: the file is sourced by POSIX sh, and an unquoted
# value containing a space parses as an assignment followed by a command
CLOUDFLARE_API_TOKEN=<TOKEN>
CF_API_TOKEN=<TOKEN>
CF_MCP_AUTH_HEADER="Bearer <TOKEN>"
CF_ZONE_NAME=<DOMAIN>
CF_ZONE_ID=<ZONE_ID>
HOST_IP=<HOST_ADDRESS>
```

## The one entry point

```
sh scripts/cf_dns.sh verify            token live, zone count, account scope
sh scripts/cf_dns.sh zones             zones the token can reach
sh scripts/cf_dns.sh records <zone>    A records, with each one's proxied flag
sh scripts/cf_dns.sh resolve           ask DNS: the only real evidence a record is live
sh scripts/cf_dns.sh audit <zone>      non-zero exit if any record is proxied
sh scripts/cf_dns.sh upsert <zone> <name> <ip>    needs CF_ALLOW_MUTATE=1
sh scripts/cf_dns.sh nizam                        needs CF_ALLOW_MUTATE=1
```

Reads run freely; the two writes refuse without `CF_ALLOW_MUTATE=1`. That asymmetry is deliberate:
`docs/CLOUDFLARE_DNS_SETUP_G2.md` reserves the gate for a human session, and its trap 8 warns against
creating records before the host address is stable. An agent can diagnose; an agent cannot change the
zone by accident. The token is passed to curl through `--config -` on stdin, so it never appears in
`ps` output or in a shell history file.

`scripts/cf_json.py` is the response parser. It is a separate file because a heredoc feeding `python3`
occupies stdin, which is where the piped JSON has to arrive.

Neither script sits under `ops/`. `src/server/ops/deploymentParticulars.ts` declares
`SCAN_ROOTS = ['ops', 'src/server/mocks/fixtures']` and fails any tracked file there containing an
undeclared dotted token. A host name is a dotted token, so a script under `ops/` would either break
`npm run verify:all` or force host names into a contract list that is about this repository's own
artifacts. This is the same reason findings F3 and F5 in the G2 walkthrough deferred their `ops/` edits.

## The MCP route, and why it is switched off

Cloudflare publishes one API MCP server that covers the whole API through a search-and-execute pair of
tools, and documents that an API token may be passed as a bearer credential instead of completing the
OAuth grant. Both are true. The token this project holds still cannot use it:

```
POST https://mcp.cloudflare.com/mcp
-> HTTP 403
   WWW-Authenticate: Bearer realm="OAuth", error="insufficient_scope",
                     scope="user:read account:read"
   {"error":"insufficient_scope"}
```

Measured, not assumed. The token is a zone/DNS token: `GET /zones` and `GET /accounts` are permitted,
while `GET /user`, `GET /user/tokens` and `GET /memberships` all refuse. So it holds neither
`user:read` nor `account:read`.

To enable it: edit the token in the dashboard, add `User -> User Details -> Read` (or
`Account -> Account Settings -> Read`), re-probe, and only then flip `"disabled": false` on the
`cloudflare-api` entry in `~/.kiro/settings/mcp.json`. Cloudflare separately documents that a token
using **Client IP Address Filtering is not accepted** by that server, so do not add IP filtering to a
token intended for this path. Weigh the change honestly: `user:read` lets any agent holding the token
read your account identity, which a two-A-record gate does not need.

For the Aki CLI the same server is staged at `.secrets/aki_cloudflare_mcp.json`, installed with
`mcp import <that file> --profile SESHAT`. Use the JSON import and not
`mcp install "npx -y mcp-remote@latest <url>"`: Aki names a server after the command string, so that
form registers it as `mcp-remote@latest` and overwrites the existing server of that name on this
machine.

Both configurations split the credential across `--header "Authorization:${AUTH_HEADER}"` and an
environment entry rather than writing one header string, because `mcp-remote` mangles an `args` entry
containing a space on Windows. Its README documents the split as the workaround.

## Rotation runbook

The value in use was pasted into an assistant chat on 2026-08-09, which step 7 of the G2 walkthrough
forbids in as many words. It is compromised until rotated. Rotation is free right now because no zone
exists, so nothing depends on it.

1. Dashboard -> My Profile -> API Tokens -> **Create Token** -> `Edit zone DNS` template.
2. Scope `Zone Resources` to the one zone once a zone exists; until then leave the template default and
   re-scope after the domain lands.
3. Copy the new secret. It is displayed once.
4. Overwrite the three value lines in `.secrets/cloudflare.env`. Do not send the value to anything.
5. **Delete the old token** in the dashboard. Rotation without deletion is not rotation.
6. Refresh `cloudflare.file_sha256` in `.secrets/MANIFEST.json`.
7. If the MCP route is in use, update `AUTH_HEADER` in `~/.kiro/settings/mcp.json` and in
   `.secrets/aki_cloudflare_mcp.json`.
8. Confirm with `sh scripts/cf_dns.sh verify`. A new token id proves the swap.

## Current state, measured 2026-08-09

| Fact | Value |
|---|---|
| Token type | user token, `cfut_` prefix |
| `GET /user/tokens/verify` | active |
| Zones reachable | **zero** |
| Account scope | none |
| MCP server | 403 `insufficient_scope` |
| Blocking input for G2 | a domain. Nothing else. |
