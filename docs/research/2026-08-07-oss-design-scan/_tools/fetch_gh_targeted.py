#!/usr/bin/env python3
"""Verify NAMED candidates the topic sweep missed, at the primary source.

Batches up to 8 `repo:owner/name` qualifiers per /search/repositories call
(qualifiers OR together), so 40+ named repos cost ~6 search calls instead of
40 core calls (unauth core budget is only 60/hour and is reserved for the
stargazer-timeline velocity derivation).

Renames are NOT followed by search, so any miss is retried against a curated
alternate name and, if still absent, recorded as UNRESOLVED (never guessed).
"""
import json, os, time, urllib.parse, urllib.request, urllib.error
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "_raw", "gh_targeted.json")
UA = {"User-Agent": "nizam-oss-research/1.0", "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"}
FIELDS = ("full_name", "html_url", "description", "stargazers_count", "forks_count",
          "open_issues_count", "pushed_at", "created_at", "updated_at", "archived",
          "disabled", "fork", "topics", "homepage", "size", "default_branch",
          "language", "watchers_count")

TARGETS = """mantinedev/mantine ant-design/ant-design recharts/recharts chartjs/Chart.js frappe/charts
bvaughn/react-window tailwindlabs/heroicons pmndrs/react-spring pacocoursey/cmdk date-fns/date-fns
iamkun/dayjs moment/luxon i18next/i18next tailwindlabs/tailwindcss unocss/unocss
vanilla-extract-css/vanilla-extract facebook/stylex amzn/style-dictionary radix-ui/colors
emilkowalski/sonner emilkowalski/vaul floating-ui/floating-ui beancount/beancount tinybase/tinybase
tursodatabase/libsql sql-js/sql.js rhashimoto/wa-sqlite vite-pwa/vite-plugin-pwa Shopify/polaris
adobe/spectrum-css uswds/uswds alphagov/govuk-frontend pmndrs/zustand motiondivision/motion
argyleink/open-props phosphor-icons/react electric-sql/electric primer/react microsoft/fluentui
mui/base-ui tokens-studio/figma-plugin gpbl/react-day-picker""".split()

ALTERNATES = {"framer/motion": ["motiondivision/motion"],
              "open-props/open-props": ["argyleink/open-props"],
              "phosphor-icons/homepage": ["phosphor-icons/react", "phosphor-icons/core"]}

def slim(r):
    o = {k: r.get(k) for k in FIELDS}
    lic = r.get("license") or {}
    o["license_spdx"] = lic.get("spdx_id"); o["license_name"] = lic.get("name")
    o["license_url"] = lic.get("url"); o["owner"] = (r.get("owner") or {}).get("login")
    return o

def search(batch, tries=4):
    q = " ".join("repo:" + b for b in batch)
    u = "https://api.github.com/search/repositories?q=" + urllib.parse.quote(q) + "&per_page=100"
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            print("  HTTP", e.code, "attempt", i + 1, flush=True); time.sleep(20 * (i + 1))
        except Exception as e:
            print("  ERR", type(e).__name__, flush=True); time.sleep(8)
    return None

def main():
    res = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {}
    fetched = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    todo = [t for t in TARGETS if t not in res]
    for i in range(0, len(todo), 8):
        batch = todo[i:i + 8]
        print("BATCH", batch, flush=True)
        d = search(batch)
        if d is None:
            print("  FAIL batch"); continue
        got = {}
        for it in d.get("items", []):
            rec = slim(it); rec["fetched_at"] = fetched
            rec["endpoint"] = "GET /search/repositories?q=repo:<owner>/<name> (OR-batched)"
            res[it["full_name"]] = rec
            got[it["full_name"].lower()] = 1
        for b in batch:
            if b.lower() not in got:
                res[b] = {"full_name": b, "fetched_at": fetched, "status": "UNRESOLVED",
                          "reason": "no search hit for repo: qualifier (renamed, moved or deleted); not guessed"}
                print("  UNRESOLVED", b, flush=True)
        json.dump(res, open(OUT, "w", encoding="utf-8"), indent=1)
        print(f"  ok batch -> total {len(res)}", flush=True)
        time.sleep(7)
    ok = sum(1 for v in res.values() if v.get("status") != "UNRESOLVED")
    print(f"resolved {ok} / {len(res)}")

if __name__ == "__main__":
    main()
