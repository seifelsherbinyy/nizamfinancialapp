#!/bin/sh
# NIZAM Cloudflare DNS helper.
#
# Purpose: the only two DNS mutations the deployment needs are the pair of grey-cloud A records that
# gate G2 requires. This wraps them so both the Aki CLI and the Kiro IDE reach Cloudflare the same
# way, through one audited entry point, instead of each inventing its own curl line.
#
# Why this lives in scripts/ and not ops/: `src/server/ops/deploymentParticulars.ts` declares
# SCAN_ROOTS = ['ops', 'src/server/mocks/fixtures'] and fails any tracked file in those roots that
# contains an undeclared dotted token. A host name is a dotted token. Putting this file under ops/
# would either break `npm run verify:all` or force host names into DECLARED_DOTTED_TOKENS, which is
# a contract list about this repository's own artifacts. scripts/ is not a scan root, so the API host
# can be written plainly here.
#
# This file is TRACKED and PUBLIC. It contains no token, no domain, and no address. Every particular
# is read at run time from a gitignored env file.
#
# AUTHORITY. `docs/CLOUDFLARE_DNS_SETUP_G2.md` is the operator walkthrough for this gate and it wins
# wherever this script disagrees with it. Two of its rules are enforced in code below:
#   * its "For an AI agent reading this file" section says an agent does not execute the gate. So the
#     read commands run freely and the two MUTATING commands refuse unless the operator sets
#     CF_ALLOW_MUTATE=1 in the invoking shell. An agent can therefore diagnose without being able to
#     change the zone by accident.
#   * its step 4 says a gate is answered by RESOLUTION, not by the console. `records` and `audit` read
#     the provider's API, which is the console's view; `resolve` asks DNS. Use `resolve` for evidence.
# Its trap 4 is why the second label below is `money` and not `finance`.
#
# Usage:
#   sh scripts/cf_dns.sh verify                       token is live, and what it can see
#   sh scripts/cf_dns.sh zones                        list zones the token can reach
#   sh scripts/cf_dns.sh records <zone>               list A records in a zone
#   sh scripts/cf_dns.sh upsert <zone> <name> <ip>    create or repoint one grey-cloud A record
#   sh scripts/cf_dns.sh nizam                        both G2 records, from the env file
#   sh scripts/cf_dns.sh audit <zone>                 fail if any record is proxied (orange cloud)
#   sh scripts/cf_dns.sh resolve                      ask DNS, not the console: the real evidence
#
# The two mutating commands, upsert and nizam, additionally require CF_ALLOW_MUTATE=1.
#
# Credential resolution order, first hit wins:
#   1. CLOUDFLARE_API_TOKEN already exported in the environment
#   2. .secrets/cloudflare.env            (gitignored, the operator laptop holding place)
#   3. ops/env/cloudflare.env             (gitignored by rule `ops/env/*.env`)
#
# The token is never passed on the command line. It is fed to curl through `--config -` on stdin so
# it cannot appear in `ps` output or in a shell history file.

set -eu

API='https://api.cloudflare.com/client/v4'
TTL=60          # low while the host address is still unstable
PROXIED=false   # grey cloud is mandatory: Caddy terminates TLS and fetches its own certificate,
                # and an orange-cloud record breaks the ACME challenge and puts Cloudflare's
                # certificate in front of Telegram instead of ours.

# ---------------------------------------------------------------------------------------------
# repo root, so the script works from any working directory
# ---------------------------------------------------------------------------------------------
script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH='' cd -- "$script_dir/.." && pwd)

die() { printf '%s\n' "cf_dns: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing required program: $1"; }

need curl
need python3

# ---------------------------------------------------------------------------------------------
# credential + zone binding
# ---------------------------------------------------------------------------------------------
# The env file is sourced for EVERY command, because CF_ZONE_NAME and HOST_IP live in it and `resolve`
# needs both. The TOKEN, however, is required only by the commands that call the API. `resolve` asks
# DNS and authenticates with nothing, so demanding a token for it would put the one credential-free
# command behind a credential - and that command is the only one steering section 2 leaves open to an
# agent, since "any use of a production secret" is in its STOP column. So: source the file if it is
# there, and let each command state its own requirement.
#
# There is deliberately NO tracked `ops/env/cloudflare.env.example`. That directory holds the six
# container service templates, each audited against ENV_ENTRIES in src/server/ops/envTemplates.ts, and
# this token belongs to the operator's laptop, not to any container. Write the file by hand with:
#
#   CLOUDFLARE_API_TOKEN=   zone-scoped: My Profile > API Tokens > Create Token > template
#                           "Edit zone DNS", Zone Resources scoped to the one zone. Shown once.
#                           docs/CLOUDFLARE_DNS_SETUP_G2.md section 7.
#   CF_ZONE_NAME=           the domain, once one exists. Until then `nizam` and `resolve` refuse.
#   HOST_IP=                the host address, from outputs/DEPLOYMENT_PARTICULARS.local.md
# An exported token still wins, per the documented order above: the file is sourced for CF_ZONE_NAME and
# HOST_IP regardless, but a token already in the environment is preserved across the source. Without this
# the file would silently override an explicit `CLOUDFLARE_API_TOKEN=... sh scripts/cf_dns.sh ...`, which
# is the opposite of "first hit wins".
_preset_token=${CLOUDFLARE_API_TOKEN:-}
ENV_FILE=''
for candidate in "$repo_root/.secrets/cloudflare.env" "$repo_root/ops/env/cloudflare.env"; do
  if [ -f "$candidate" ]; then ENV_FILE="$candidate"; break; fi
done
if [ -n "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi
[ -z "$_preset_token" ] || CLOUDFLARE_API_TOKEN=$_preset_token

# need_token  called by every command that touches the API, and by none that does not.
need_token() {
  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] || die "no token. Export CLOUDFLARE_API_TOKEN, or write ${ENV_FILE:-.secrets/cloudflare.env} with the three entries listed in this file's header"
}

# ---------------------------------------------------------------------------------------------
# transport
# ---------------------------------------------------------------------------------------------
# api METHOD PATH [JSON_BODY]
api() {
  _method=$1; _path=$2; _body=${3:-}
  if [ -n "$_body" ]; then
    printf 'header = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\n' "$CLOUDFLARE_API_TOKEN" \
      | curl -sS -m 30 --config - -X "$_method" "$API/$_path" -d "$_body"
  else
    printf 'header = "Authorization: Bearer %s"\n' "$CLOUDFLARE_API_TOKEN" \
      | curl -sS -m 30 --config - -X "$_method" "$API/$_path"
  fi
}

# jparse EXPR  reads JSON on stdin, evaluates EXPR, exits 1 when the API reported failure.
# The parser is a separate file on purpose: see the docstring in scripts/cf_json.py.
jparse() {
  python3 "$repo_root/scripts/cf_json.py" "$1"
}

zone_id_for() {
  _zone=$1
  case "$_zone" in
    *.*) api GET "zones?name=$_zone" | jparse "r[0]['id'] if r else ''" ;;
    *)   printf '%s' "$_zone" ;;   # already an id
  esac
}

# ---------------------------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------------------------
cmd_verify() {
  need_token
  printf 'token   : '
  api GET 'user/tokens/verify' | jparse "r['status'] + '  (id ' + r['id'] + ')'"
  printf 'zones   : '
  api GET 'zones?per_page=50' | jparse "str(len(r)) + ' reachable' + ('' if r else '   <- no domain exists in this account yet, gate G2 cannot proceed')"
  printf 'accounts: '
  api GET 'accounts' | jparse "str(len(r)) + ' reachable' + ('' if r else '   <- no account scope; the Cloudflare API MCP server will reject this token with insufficient_scope')"
}

cmd_zones() {
  need_token
  api GET 'zones?per_page=50' \
    | jparse "[f\"{z['name']}\t{z['id']}\t{z['status']}\" for z in r] or ['(none)']"
}

cmd_records() {
  need_token
  [ $# -ge 1 ] || die 'usage: records <zone-name-or-id>'
  _zid=$(zone_id_for "$1"); [ -n "$_zid" ] || die "zone not found: $1"
  api GET "zones/$_zid/dns_records?type=A&per_page=100" \
    | jparse "[f\"{x['name']}\t{x['content']}\tttl={x['ttl']}\tproxied={x['proxied']}\" for x in r] or ['(no A records)']"
}

require_mutate() {
  [ "${CF_ALLOW_MUTATE:-0}" = '1' ] || die "refusing to mutate DNS: set CF_ALLOW_MUTATE=1 to confirm you are the operator. docs/CLOUDFLARE_DNS_SETUP_G2.md reserves this gate for a human session, and its trap 8 warns not to create records before the host address is stable."
}

cmd_upsert() {
  need_token
  require_mutate
  [ $# -ge 3 ] || die 'usage: upsert <zone> <record-name> <ip>'
  _zone=$1; _name=$2; _ip=$3
  _zid=$(zone_id_for "$_zone"); [ -n "$_zid" ] || die "zone not found: $_zone"
  case "$_name" in *.*) _fqdn=$_name ;; *) _fqdn="$_name.$_zone" ;; esac

  _existing=$(api GET "zones/$_zid/dns_records?type=A&name=$_fqdn" | jparse "r[0]['id'] if r else ''")
  _body=$(printf '{"type":"A","name":"%s","content":"%s","ttl":%s,"proxied":%s}' "$_fqdn" "$_ip" "$TTL" "$PROXIED")

  if [ -n "$_existing" ]; then
    api PATCH "zones/$_zid/dns_records/$_existing" "$_body" \
      | jparse "'repointed  ' + r['name'] + ' -> ' + r['content'] + '  proxied=' + str(r['proxied'])"
  else
    api POST "zones/$_zid/dns_records" "$_body" \
      | jparse "'created    ' + r['name'] + ' -> ' + r['content'] + '  proxied=' + str(r['proxied'])"
  fi
}

cmd_nizam() {
  require_mutate
  [ -n "${CF_ZONE_NAME:-}" ] || die 'CF_ZONE_NAME is empty. Buy or transfer the domain first, then set it in .secrets/cloudflare.env'
  [ -n "${HOST_IP:-}" ]      || die 'HOST_IP is empty. Provision the host (gate G1) first, then set it in .secrets/cloudflare.env'
  # The two hostnames gate G2 names. The signal bus deliberately gets NO public record, ever.
  for label in life money; do
    cmd_upsert "$CF_ZONE_NAME" "$label" "$HOST_IP"
  done
  printf '%s\n' 'reminder: create no public record for the signal bus, and open 80 as well as 443 in ufw so the ACME challenge can complete'
}

cmd_audit() {
  need_token
  [ $# -ge 1 ] || die 'usage: audit <zone-name-or-id>'
  _zid=$(zone_id_for "$1"); [ -n "$_zid" ] || die "zone not found: $1"
  _bad=$(api GET "zones/$_zid/dns_records?type=A&per_page=100" \
    | jparse "[x['name'] for x in r if x['proxied']]")
  if [ -n "$_bad" ]; then
    printf '%s\n' "$_bad" | while read -r n; do printf 'PROXIED (orange cloud, breaks ACME): %s\n' "$n"; done
    die 'audit failed: set Proxy status to DNS only on the records above'
  fi
  printf '%s\n' 'audit passed: every A record is DNS only (grey cloud)'
}

cmd_resolve() {
  [ -n "${CF_ZONE_NAME:-}" ] || die 'CF_ZONE_NAME is empty; nothing to resolve'
  _tool=''
  for t in dig nslookup; do command -v "$t" >/dev/null 2>&1 && { _tool=$t; break; }; done
  [ -n "$_tool" ] || die 'neither dig nor nslookup is available; resolve from another machine'
  for label in life money; do
    printf '%s -> ' "$label.$CF_ZONE_NAME"
    if [ "$_tool" = 'dig' ]; then
      _got=$(dig +short A "$label.$CF_ZONE_NAME" 2>/dev/null | tr '\n' ' ')
    else
      _got=$(nslookup -type=A "$label.$CF_ZONE_NAME" 2>/dev/null | sed -n 's/^Address: *//p' | tr '\n' ' ')
    fi
    [ -n "$_got" ] || _got='(no answer)'
    printf '%s' "$_got"
    if [ -n "${HOST_IP:-}" ]; then
      case " $_got " in *" $HOST_IP "*) printf '  MATCHES HOST_IP' ;; *) printf '  DOES NOT MATCH HOST_IP' ;; esac
    fi
    printf '\n'
  done
}

case "${1:-}" in
  verify)  shift; cmd_verify "$@" ;;
  zones)   shift; cmd_zones "$@" ;;
  records) shift; cmd_records "$@" ;;
  upsert)  shift; cmd_upsert "$@" ;;
  nizam)   shift; cmd_nizam "$@" ;;
  resolve) shift; cmd_resolve "$@" ;;
  audit)   shift; cmd_audit "$@" ;;
  ''|-h|--help|help)
    sed -n '/^# Usage:/,/^# The two mutating/p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "unknown command: $1  (try: verify zones records resolve audit upsert nizam)" ;;
esac
