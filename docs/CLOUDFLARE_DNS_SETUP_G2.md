# Point the two hostnames at the host (gate G2) - operator walkthrough

> **Register:** `ops/GATE_REGISTER.md` section G2 is the authority on what this gate means and how it is
> verified. This file is the click-by-click half the register deliberately does not carry.
> **Contract:** PFOS 12 section 2.2.1 to 2.2.4 (one public port, automatic TLS, two hostnames, and the
> secret path segment that must not reach a proxy log), section 3.1 (one environment file per service).
> **Sibling walkthrough:** `docs/TELEGRAM_BOTS_SETUP_G3.md` does the same job for the two bots.
> **Value ledger:** `.kiro/specs/06-two-agent-vps/TELEGRAM_VALUE_LEDGER.md` carries the `DOMAIN` row and
> the two webhook-path rows this gate makes routable.
> **Worksheet (untracked):** `outputs/DNS_SETUP_WORKSHEET.local.md` - where you record what you did.
> **Console URLs (untracked):** `outputs/OPERATOR_URL_WORKSHEET.md`.
> **Public-repository constraint (R24):** no domain, no hostname, no address and no zone identifier
> appears in this file, and none ever will. Every value is an `<ANGLE_BRACKET>` placeholder.

## BLUF

G2 is blocked on one input that does not exist yet: **a domain**. Everything else in this gate is ten
minutes of console work once you own one.

Two records, both **DNS only (grey cloud)**, both pointing at the host's address. Not proxied. The
proxied setting is the default the console offers you, it looks like the safer choice, and for this
deployment it is the wrong one for four separate reasons, all of them recorded in section 6 with the
provider's own documentation behind each. Read that section before you touch the toggle, because the
toggle is a one-click change that silently breaks two security properties this deployment builds
elsewhere at some cost.

Order of work: acquire the zone, create the two records grey-clouded, create nothing for the bus, then
verify by resolution rather than by looking at the console.

## For an AI agent reading this file

1. **Do not execute anything here.** Every step is for a human in the operator's own session. Steering
   section 2 gates every outbound call from an agent process.
2. **Never invent a value.** Not a domain, not a hostname, not an address, not a zone identifier, and
   not an example of the right shape. A plausible-looking example is the thing that gets copied.
3. **"Is G2 done?" is answered by resolution, not by this file.** Two `dig` answers that equal the host
   address recorded in the untracked particulars file, and nothing else. A document asserting a gate is
   complete is not evidence.
4. **If this file disagrees with `ops/GATE_REGISTER.md`, `ops/Caddyfile`, or `ops/env/proxy.env.example`,
   those win** and this file is the bug. Report the disagreement, do not reconcile it silently.

## Before you start

| Check | Why it matters |
|---|---|
| The host exists and you know its address | Both records point at it. The address lives only in `outputs/DEPLOYMENT_PARTICULARS.local.md` |
| You own a domain, or are about to buy one | This is the gate's only real blocker |
| You accept that the domain is permanent-ish | Both hostnames, both certificates, and both webhook registrations derive from it. Changing it later is a full G2 + G6 redo |
| Your password manager is open | The optional API token in section 7 is shown once |

## Step 1 - acquire the zone

Two paths, and the choice has consequences.

**Path A - buy the domain at the same provider that will host the DNS.** The zone is created for you and
its nameservers are already correct: a domain acquired from that provider "already uses Cloudflare
nameservers". No registrar step, no propagation wait, nothing to get wrong. The trade is that such a
domain "must remain on Cloudflare nameservers" - moving DNS elsewhere later means transferring the
domain out first.

**Path B - buy the domain anywhere, then move DNS to the provider.** You add the zone, the provider
assigns you **two authoritative nameservers**, and you set those at your registrar. This is the "primary
(full)" setup, and it is **the only setup available on the Free and Pro plans** - the CNAME/partial
setup that skips the nameserver change is Business and Enterprise only. Budget for propagation, and note
the provider's own caution about downtime-sensitive domains.

Either path ends the same way: a zone you control, with a DNS record editor.

Recommendation for this deployment: **Path A**. It removes the one step in G2 that is outside your own
console and the one step that can sit half-finished for a day.

## Step 2 - create the two records, DNS only

Two `A` records. The Caddyfile is the authority on the two names it will answer for, and it answers for
exactly these two:

| Record | Type | Name | Content | Proxy status |
|---|---|---|---|---|
| life agent | `A` | `life` (giving `life.<DOMAIN>`) | `<HOST_IPV4>` | **DNS only (grey cloud)** |
| finance agent | `A` | `money` (giving `money.<DOMAIN>`) | `<HOST_IPV4>` | **DNS only (grey cloud)** |

The two toggle states, in the provider's own words: **Proxied (orange cloud)** means "web traffic goes
through the Cloudflare network"; **DNS only (gray cloud)** means the provider "returns the DNS record
value but does not proxy traffic". You want the second one. Section 6 is why.

TTL is not load-bearing here. Leave it on the automatic setting.

If the host has an IPv6 address and you intend to serve on it, the same two names get `AAAA` records on
the same grey-cloud setting. If you do not, create none: a name that resolves to an address nothing
listens on is a delivery failure that looks like a certificate problem.

## Step 3 - create nothing for the consent bus

There is no third record. `ops/Caddyfile` says it in the negative and means it: the bus has **no route,
no hostname, and no port**, "not commented out, and not for local debugging", because the proxy is on
neither internal network and a commented-out route is a route somebody uncomments. `ops/env/proxy.env.example`
carries no reference to the bus for the same reason (R9).

A DNS record for the bus would be the first half of exposing it. Do not create one, and if one exists,
delete it.

## Step 4 - verify by resolution, not by the console

The console showing a grey cloud is not evidence. Resolve both names from a machine that is not the host:

```
dig +short life.<DOMAIN>  A
dig +short money.<DOMAIN> A
```

| Expected | What it proves |
|---|---|
| Each answer is exactly one address | No stray extra record |
| Both answers equal `<HOST_IPV4>` from the untracked particulars file | The records are **DNS only**. This is the whole test |
| Neither answer is an address you do not recognise | A proxied record answers with the provider's own anycast address instead of yours. If you see one, the toggle is wrong |
| `dig +short <DOMAIN> A` for the bare domain | Optional. Nothing in this deployment needs the apex to resolve |

That third row is the discriminator and it is worth restating: **grey cloud returns your address, orange
cloud returns theirs.** You cannot get this wrong silently, provided you check by resolution.

Record the observation, never the values, in `outputs/DNS_SETUP_WORKSHEET.local.md`.

## Step 5 - the port the certificate needs

Not part of G2, and the reason G2 is verified before G6: automatic certificate issuance performs an
HTTP-01 challenge, which arrives on **port 80**. The register's G1 step 4 as originally written opens
only the TLS and admin ports. Open 80 as well or the proxy cannot obtain its own certificate, and the
symptom presents as a DNS or firewall fault rather than as a missing port.

The messaging provider accepts a webhook on 443, 80, 88 or 8443 only, so the TLS port must be one of
those. Both facts are already recorded under G1 in the register.

## Step 6 - why DNS only, and never proxied

The register mandates grey cloud. It does not say why, and the why matters, because "turn the proxy on,
it is free protection" is exactly the kind of change a future session makes in good faith. Four reasons,
each independently sufficient.

**6.1 The secret webhook path segment would enter a third party's request logs.** This is the decisive
one. Contract 12 section 2.2.4 requires the path segment to be high-entropy and **not** the bot token,
and its stated reason is that the token would then sit in proxy logs. `ops/Caddyfile` follows the same
reasoning to its conclusion and keeps **no access log at all**, because "the request URI carries the
secret path segment". A proxied record routes every request through an intermediary that terminates the
connection and whose HTTP-requests log dataset carries `ClientRequestURI`, documented as "URI requested
by the client, which includes the full path and query string of the requested URL". Proxying therefore
writes the secret path into a log the deployment does not own, cannot rotate, and cannot inspect - which
is the precise outcome section 2.2.4 exists to prevent, one layer up from where it was written.

**6.2 Deny-by-default stops being indistinguishable.** The Caddyfile's default route **closes the
connection with no HTTP response**, so a request to a known hostname with a wrong path is answered
exactly like a read of the right path with a wrong secret: nothing. Its own comment names the property -
a probe cannot learn "whether the hostname was right, whether the path was close, or whether an agent is
behind it". An intermediary in front does not forward a closed connection; it generates its own error
page. The probe then learns that the hostname is real, that something is behind it, and that the request
reached a proxy. The indistinguishability is a property of the whole path, not of the Caddyfile alone,
and one toggle is enough to lose it.

**6.3 The origin can no longer issue its own certificate over HTTP-01.** With a proxied record the
provider answers on 80 and 443 at the edge, so the challenge the origin's automatic TLS issues is
answered before it reaches the origin. Contract 12 section 2.2.2 wants automatic TLS at the origin; grey
cloud is what makes that possible without adding a DNS-01 credential to the proxy service, which would
mean giving the internet-facing container a zone-scoped API token it has no other use for.

**6.4 Only a fixed list of ports is proxied at all.** The provider proxies HTTP on 80, 8080, 8880, 2052,
2082, 2086 and 2095, and HTTPS on 443, 2053, 2083, 2087, 2096 and 8443. Anything else must be grey-clouded
or run through their Layer-4 product, which is Enterprise for arbitrary ports. The TLS port here is
inside that list, so this reason does not bite today - but `<ADMIN_PORT>` is operator-chosen and almost
certainly is not, and their managed WAF ships a rule that blocks non-standard ports outright. A future
flip to orange cloud would take the admin path down as a side effect.

**What you give up by choosing grey cloud, stated honestly.** No caching, which this deployment does not
want; no edge DDoS absorption, so the host's own firewall and the proxy's own rate limiting are the whole
defence, which is what `ops/runbook/RATE_LIMIT_POSTURE.md` already assumes; and the host address is
publicly visible in DNS, which it would be anyway for a single-operator deployment whose only inbound
traffic is one provider's webhook deliveries to two secret paths behind a secret-token check.

## Step 7 - optional: a scoped API token, if an agent is to prepare the records

You can do all of section 2 by hand and never mint a token. If you would rather have the records
prepared for you, mint the **narrowest** token that can do it, not the account-wide OAuth grant.

1. Go to **My Profile** then **API Tokens** then **Create Token**.
2. Start from the **Edit zone DNS** template rather than building a custom token.
3. Under **Zone Resources**, scope it to **the one zone** and nothing else. A token used against a
   different zone returns an error, which is the property you want.
4. Optionally add a **client IP filter** and a **TTL** on the token itself.
5. The secret is displayed **once**. Copy it to the password manager immediately. Treat it as a password,
   because anyone holding it can do everything you authorised.

Account-owned tokens (secret prefixed `cfat_`) require Superadmin and are the wrong shape for this: this
is one person editing one zone. The zone identifier and account identifier are both on the zone's
**Overview** page if a tool asks for them.

Do not paste the token into a chat, including to an assistant. If something needs to confirm the token
exists, it can count a line or make a scoped call; it never needs the value.

## Traps

1. **Grey cloud, not orange.** The console defaults to proxied and it is one click. Section 6.
2. **Verify by resolution, not by the console.** The toggle can be right in the UI and the record can
   still be the old one in cache.
3. **No record for the bus.** Ever, under any hostname.
4. **`money`, not `finance`.** The Caddyfile's second hostname is `money.<DOMAIN>` while the service and
   its environment file are named `finance`. That asymmetry is in the Caddyfile deliberately; copying the
   service name into DNS produces a name nothing answers for.
5. **Open port 80 for the certificate**, even though nothing serves content on it.
6. **Nameservers are the slow step on path B.** Until the registrar shows the provider's two nameservers,
   nothing you do in the DNS editor resolves anywhere.
7. **One address per name.** Two A records on one name round-robins deliveries to a host that may not
   exist.
8. **Do not create the records before the host has a stable address.** A rebuilt host with a new address
   means both records are wrong and both certificates fail, which reads like a TLS bug.

## Findings raised while writing this file

**F5 - the register mandates grey cloud without recording why.** G2's step says DNS only; nothing in
`ops/**` states the reason, so the constraint reads as a preference rather than as a consequence of
contract 12 section 2.2.4. Section 6.1 and 6.2 above supply the two repository-grounded reasons and 6.3
and 6.4 the two provider-grounded ones. Promoting a short form of 6.1 into the register is an `ops/**`
edit and is left for the next ops increment, for the same reason finding F3 was: `ops/**` is scanned for
declared dotted tokens and any new filename reference there needs a matching entry in
`src/server/ops/deploymentParticulars.ts` and its sibling list.

**F6 - the closed-connection property is not attributable to the Caddyfile alone.** `ops/Caddyfile`
documents indistinguishability as a property of its own default route. It is in fact a property of every
hop in front of the proxy, and no test or register line records that dependency. Worth one sentence in
the register beside the grey-cloud step.

**F7 - `ACME_CONTACT` is an operator entry with no gate and a real consequence.** It sits in
`ops/env/proxy.env.example` gated `operator`, and it is the address that receives certificate expiry
notices. No gate step asks for it and no worksheet row records it. It belongs in the set of
operator-chosen entries that appear in no gate.

**F8 - `<ADMIN_PORT>` is unconstrained and the proxy port list is not.** Nothing records that the admin
port must avoid the provider's proxied-port list should the records ever be flipped to proxied. Not a
defect today, because grey cloud makes it moot; recorded so a later change does not learn it the hard way.

## Primary sources

Verified against the provider's own documentation on 2026-08-09, not from memory:

- `https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/` - the proxy-status toggle and the
  two states in the provider's own wording; nameserver assignment; the downtime caution; where the zone
  and account identifiers live.
- `https://developers.cloudflare.com/dns/nameservers/update-nameservers/` - full setup is the only option
  on Free and Pro; a Registrar domain already uses and must remain on their nameservers; the partial
  CNAME setup is Business and Enterprise only.
- `https://developers.cloudflare.com/fundamentals/reference/network-ports/` - the exact HTTP and HTTPS
  port lists the proxy covers, the grey-cloud instruction for anything outside them, and the managed WAF
  rule that blocks non-standard ports.
- `https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/http_requests/` -
  `ClientRequestURI`, documented as the full path and query string of the requested URL. The basis of
  finding 6.1.
- `https://developers.cloudflare.com/videos/create-api-tokens/` and
  `https://developers.cloudflare.com/fundamentals/api/get-started/create-token/` - the Edit zone DNS
  template, zone-resource scoping, the client-IP and TTL restrictions, the secret shown once, and the
  account-token prefix and Superadmin requirement.
