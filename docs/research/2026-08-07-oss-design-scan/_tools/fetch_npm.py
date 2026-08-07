#!/usr/bin/env python3
"""npm registry + downloads + bundlephobia capture (primary/registry sources).

ATTRIBUTION GATE (non-negotiable rule 1 + doctrine "attribute before writing"):
a package's metrics are only attached to a repo when registry.repository.url
resolves to that same owner/name. Mismatch -> attribution=MISMATCH and the
metrics are stored but flagged, never silently merged.

Inputs : _tools/npm_targets.json  [{"pkg": "...", "repo": "owner/name"}, ...]
Outputs: _raw/npm/<pkg-safe>.json (one dated record per package)
"""
import json, os, re, time, urllib.request, urllib.error, urllib.parse
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "_raw", "npm")
UA = {"User-Agent": "nizam-oss-research/1.0"}
NOW = datetime.now(timezone.utc)

def get(url, timeout=35, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"_http": 404}
            time.sleep(3 * (i + 1))
        except Exception:
            time.sleep(3 * (i + 1))
    return None

def norm_repo(u):
    if not u:
        return None
    m = re.search(r"github\.com[:/]+([^/]+)/([^/#.]+)", u)
    return f"{m.group(1)}/{m.group(2)}".lower() if m else None

def main():
    os.makedirs(RAW, exist_ok=True)
    targets = json.load(open(os.path.join(ROOT, "_tools", "npm_targets.json"), encoding="utf-8"))
    for t in targets:
        pkg, repo = t["pkg"], t.get("repo")
        safe = pkg.replace("/", "__").replace("@", "at-")
        out = os.path.join(RAW, safe + ".json")
        if os.path.exists(out):
            print("SKIP", pkg); continue
        reg = get("https://registry.npmjs.org/" + urllib.parse.quote(pkg, safe="@"))
        if reg is None:
            print("FAIL registry", pkg); continue
        rec = {"pkg": pkg, "claimed_repo": repo,
               "fetched_at": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
               "sources": {"registry": "https://registry.npmjs.org/" + pkg,
                           "downloads": "https://api.npmjs.org/downloads/point/last-week/" + pkg,
                           "bundle": "https://bundlephobia.com/api/size?package=" + pkg}}
        if reg.get("_http") == 404:
            rec["registry_status"] = 404
            json.dump(rec, open(out, "w", encoding="utf-8"), indent=1); print("404", pkg); continue
        latest = (reg.get("dist-tags") or {}).get("latest")
        vmeta = (reg.get("versions") or {}).get(latest, {})
        times = reg.get("time") or {}
        rels = sorted((v, ts) for v, ts in times.items()
                      if v not in ("created", "modified") and not re.search(r"-(alpha|beta|rc|canary|next|dev)", v))
        def days(ts):
            try:
                return (NOW - datetime.fromisoformat(ts.replace("Z", "+00:00"))).days
            except Exception:
                return None
        rel12 = [v for v, ts in rels if (days(ts) or 9999) <= 365]
        rec.update({
            "registry_status": 200,
            "latest_version": latest,
            "latest_published": times.get(latest),
            "first_published": times.get("created"),
            "last_modified": times.get("modified"),
            "stable_release_count_total": len(rels),
            "stable_releases_last_365d": len(rel12),
            "license_registry": reg.get("license") or vmeta.get("license"),
            "deprecated": vmeta.get("deprecated"),
            "types_field": vmeta.get("types") or vmeta.get("typings"),
            "has_exports": bool(vmeta.get("exports")),
            "side_effects": vmeta.get("sideEffects"),
            "peer_dependencies": vmeta.get("peerDependencies") or {},
            "dependencies_count": len(vmeta.get("dependencies") or {}),
            "engines": vmeta.get("engines"),
            "repository_url_registry": ((reg.get("repository") or {}) or {}).get("url")
                                        or ((vmeta.get("repository") or {}) or {}).get("url"),
            "homepage": reg.get("homepage"),
        })
        rr = norm_repo(rec["repository_url_registry"])
        rec["repo_from_registry"] = rr
        rec["attribution"] = ("MATCH" if rr and repo and rr == repo.lower()
                              else "UNKNOWN" if not rr else "MISMATCH")
        dl = get("https://api.npmjs.org/downloads/point/last-week/" + urllib.parse.quote(pkg, safe="@"))
        rec["weekly_downloads"] = (dl or {}).get("downloads")
        rec["downloads_window"] = f"{(dl or {}).get('start')}..{(dl or {}).get('end')}"
        bp = get("https://bundlephobia.com/api/size?package=" + urllib.parse.quote(pkg, safe="@"), timeout=60)
        if bp and "size" in bp:
            rec["bundle"] = {"version": bp.get("version"), "min_bytes": bp.get("size"),
                             "gzip_bytes": bp.get("gzip"), "dependency_count": bp.get("dependencyCount"),
                             "has_side_effects": bp.get("hasSideEffects"),
                             "has_jsmodule": bp.get("hasJSModule"), "is_module_type": bp.get("isModuleType")}
        else:
            rec["bundle"] = None
            rec["bundle_note"] = "bundlephobia returned no size (build failed, native/CSS-only pkg, or too large)"
        json.dump(rec, open(out, "w", encoding="utf-8"), indent=1)
        print(f"ok {pkg:34s} v{latest or '?'} lic={rec['license_registry']} "
              f"dl/wk={rec['weekly_downloads']} gzip={(rec['bundle'] or {}).get('gzip_bytes')} "
              f"rel12m={rec['stable_releases_last_365d']} attr={rec['attribution']}", flush=True)
        time.sleep(0.4)

if __name__ == "__main__":
    main()
