#!/usr/bin/env python3
"""star_velocity_90d derived from the GitHub stargazers timeline (primary source).

Method: the stargazers list is oldest-first, so the LAST page holds the most
recent stargazers with starred_at timestamps. velocity = n_page / span_days * 90.
Hard limit: GitHub serves only the first 40,000 list results (400 pages x 100),
so for repos above ~40k stars the value is NOT derivable -> UNKNOWN + reason.
Costs exactly 1 core API call per repo (unauth core budget = 60/hour).
"""
import json, math, os, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "_raw", "star_velocity.json")
UA = {"User-Agent": "nizam-oss-research/1.0",
      "Accept": "application/vnd.github.star+json",
      "X-GitHub-Api-Version": "2022-11-28"}
CAP = 40000
NOW = datetime.now(timezone.utc)

def main():
    repos = json.load(open(os.path.join(ROOT, "_tools", "velocity_targets.json"), encoding="utf-8"))
    res = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {}
    for r in repos:
        full, stars = r["repo"], r["stars"]
        if full in res:
            print("SKIP", full); continue
        rec = {"repo": full, "stars_at_capture": stars,
               "fetched_at": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
               "method": "last page of GET /repos/{o}/{n}/stargazers (star+json), n/span*90"}
        if stars > CAP:
            rec.update({"star_velocity_90d": None,
                        "status": "UNKNOWN",
                        "reason": f"stars {stars} exceed the 40000-result list cap; timeline page unreachable"})
            res[full] = rec; print("UNKNOWN", full, stars); continue
        page = max(1, math.ceil(stars / 100))
        url = f"https://api.github.com/repos/{full}/stargazers?per_page=100&page={page}"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as resp:
                data = json.load(resp)
        except urllib.error.HTTPError as e:
            rec.update({"star_velocity_90d": None, "status": "UNKNOWN",
                        "reason": f"HTTP {e.code} on stargazers page {page}"})
            res[full] = rec; print("HTTPERR", full, e.code); continue
        stamps = sorted(x["starred_at"] for x in data if isinstance(x, dict) and x.get("starred_at"))
        if len(stamps) < 5:
            rec.update({"star_velocity_90d": None, "status": "UNKNOWN",
                        "reason": f"only {len(stamps)} timestamps on page {page}"})
        else:
            a = datetime.fromisoformat(stamps[0].replace("Z", "+00:00"))
            b = datetime.fromisoformat(stamps[-1].replace("Z", "+00:00"))
            span = max((b - a).total_seconds() / 86400.0, 0.5)
            rec.update({"page": page, "n": len(stamps), "window_start": stamps[0], "window_end": stamps[-1],
                        "span_days": round(span, 2),
                        "stars_per_day": round(len(stamps) / span, 3),
                        "star_velocity_90d": int(round(len(stamps) / span * 90)),
                        "window_end_lag_days": (NOW - b).days,
                        "status": "DERIVED"})
        res[full] = rec
        print(f"{full:40s} v90={rec.get('star_velocity_90d')} span={rec.get('span_days')}d "
              f"lag={rec.get('window_end_lag_days')}d {rec['status']}", flush=True)
        json.dump(res, open(OUT, "w", encoding="utf-8"), indent=1)
        time.sleep(1.2)
    json.dump(res, open(OUT, "w", encoding="utf-8"), indent=1)
    print("velocity records:", len(res))

if __name__ == "__main__":
    main()
