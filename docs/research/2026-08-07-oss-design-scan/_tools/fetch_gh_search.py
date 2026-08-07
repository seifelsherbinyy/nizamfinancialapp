#!/usr/bin/env python3
"""Axis sweep against the GitHub Search API (primary source).

Why search API and not /repos/{o}/{n}: unauthenticated core limit is 60/hour,
search is a separate 10/minute bucket AND each response carries the FULL repo
object (stars, licence, pushed_at, open_issues_count, topics, archived).
So discovery and metric capture happen in the same primary-source call.

Writes one raw JSON per query to _raw/gh/<slug>.json with the query + fetched_at
so every downstream number is traceable to a dated response.
"""
import json, os, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "_raw", "gh")
UA = {"User-Agent": "nizam-oss-research/1.0", "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"}

# (slug, axis, query) - sort=stars desc, per_page=100
QUERIES = [
    ("a1-component-library", "A1", "topic:component-library topic:react stars:>800"),
    ("a1-ui-components",     "A1", "topic:ui-components stars:>1500"),
    ("a1-headless",          "A1", "topic:headless-ui stars:>300"),
    ("a1-radix-shadcn",      "A1", "topic:radix-ui stars:>300"),
    ("a2-charts-react",      "A2", "topic:charts topic:react stars:>400"),
    ("a2-dataviz",           "A2", "topic:data-visualization stars:>2500"),
    ("a3-dashboard-react",   "A3", "topic:dashboard topic:react stars:>900"),
    ("a3-admin-template",    "A3", "topic:admin-dashboard stars:>1500"),
    ("a4-design-system",     "A4", "topic:design-system stars:>1800"),
    ("a4-design-tokens",     "A4", "topic:design-tokens stars:>200"),
    ("a5-icons",             "A5", "topic:icons topic:svg stars:>1500"),
    ("a5-animation",         "A5", "topic:animation topic:react stars:>1200"),
    ("a6-table",             "A6", "topic:table topic:react stars:>400"),
    ("a6-virtualization",    "A6", "topic:virtualization stars:>400"),
    ("a6-datepicker",        "A6", "topic:datepicker stars:>400"),
    ("a6-command-palette",   "A6", "topic:command-palette stars:>200"),
    ("a7-personal-finance",  "A7", "topic:personal-finance stars:>800"),
    ("a7-accounting",        "A7", "topic:accounting stars:>1200"),
    ("a9-local-first",       "A9", "topic:local-first stars:>500"),
    ("a9-offline-pwa",       "A9", "topic:offline-first stars:>500"),
    ("a10-i18n",             "A10", "topic:i18n topic:react stars:>1200"),
    ("a10-currency",         "A10", "topic:currency stars:>400"),
    ("a1-tailwind-comp",     "A1", "topic:tailwind topic:components stars:>1200"),
    ("a4-css-in-js",         "A4", "topic:css-in-js stars:>2000"),
]

FIELDS = ("full_name", "html_url", "description", "stargazers_count", "forks_count",
          "open_issues_count", "pushed_at", "created_at", "updated_at", "archived",
          "disabled", "fork", "topics", "homepage", "size", "default_branch",
          "language", "subscribers_count", "watchers_count")

def slim(r):
    o = {k: r.get(k) for k in FIELDS}
    lic = r.get("license") or {}
    o["license_spdx"] = lic.get("spdx_id")
    o["license_name"] = lic.get("name")
    o["license_url"] = lic.get("url")
    o["owner"] = (r.get("owner") or {}).get("login")
    return o

def fetch(q, tries=4):
    url = ("https://api.github.com/search/repositories?q=" +
           urllib.parse.quote(q) + "&sort=stars&order=desc&per_page=100")
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read()[:200].decode("utf-8", "replace")
            print(f"  HTTP {e.code} attempt {i+1}: {body}", flush=True)
            if e.code in (403, 429):
                time.sleep(20 * (i + 1))
            else:
                time.sleep(5)
        except Exception as e:
            print(f"  ERR attempt {i+1}: {type(e).__name__} {e}", flush=True)
            time.sleep(8)
    return None

def main():
    os.makedirs(RAW, exist_ok=True)
    manifest = []
    for slug, axis, q in QUERIES:
        out = os.path.join(RAW, slug + ".json")
        if os.path.exists(out):                      # idempotent / resumable
            d = json.load(open(out, encoding="utf-8"))
            print(f"SKIP {slug} (cached, {len(d['items'])} items)", flush=True)
            manifest.append({k: d[k] for k in ("slug", "axis", "query", "fetched_at", "total_count")}
                            | {"kept": len(d["items"])})
            continue
        print(f"GET {slug} :: {q}", flush=True)
        d = fetch(q)
        if d is None:
            print(f"FAIL {slug}", flush=True)
            continue
        rec = {"slug": slug, "axis": axis, "query": q,
               "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
               "endpoint": "GET /search/repositories?sort=stars",
               "total_count": d.get("total_count"),
               "items": [slim(x) for x in d.get("items", [])]}
        json.dump(rec, open(out, "w", encoding="utf-8"), indent=1)
        print(f"  ok {len(rec['items'])} of total_count={rec['total_count']}", flush=True)
        manifest.append({"slug": slug, "axis": axis, "query": q, "fetched_at": rec["fetched_at"],
                         "total_count": rec["total_count"], "kept": len(rec["items"])})
        time.sleep(7)                                # 10 req/min unauth search bucket
    json.dump(manifest, open(os.path.join(ROOT, "_raw", "sweep_manifest.json"), "w",
                             encoding="utf-8"), indent=1)
    print("MANIFEST", len(manifest), "queries;",
          sum(m["kept"] for m in manifest), "raw hits")

if __name__ == "__main__":
    import urllib.parse
    main()
