#!/usr/bin/env python3
"""Read a Cloudflare API response on stdin, evaluate one expression against it, print the result.

Companion to scripts/cf_dns.sh. It exists as its own file rather than a heredoc inside the shell
script because a heredoc feeding python3 occupies stdin, which is where the piped JSON has to
arrive: the two cannot share it.

Contract:
  argv[1]  an expression evaluated with `d` = the whole response and `r` = response["result"]
  stdin    the JSON body
  exit 1   when the API reported success=false, when the body is unparseable, or when the
           expression raises. Every failure prints a diagnosis to stderr and prints nothing to
           stdout, so a caller that pipes stdout onward can never mistake an error for a value.

A list or tuple result prints one element per line. None prints nothing.
"""

from __future__ import annotations

import json
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("cf_json: an expression argument is required", file=sys.stderr)
        return 2
    expr = sys.argv[1]

    try:
        body = json.load(sys.stdin)
    except Exception as exc:
        print(f"cf_json: unparseable response: {exc}", file=sys.stderr)
        return 1

    if isinstance(body, dict) and body.get("success") is False:
        errors = body.get("errors") or [{"code": "?", "message": "unspecified"}]
        for err in errors:
            print(f"cf_json: API error {err.get('code')}: {err.get('message')}", file=sys.stderr)
        return 1

    result = body.get("result") if isinstance(body, dict) else body
    # A deliberately tiny builtins surface: this evaluates expressions written in cf_dns.sh, which is
    # a tracked file in this repository, not anything supplied by a caller or by the network.
    safe_builtins = {"len": len, "sorted": sorted, "str": str, "bool": bool, "int": int}
    scope = {"d": body, "r": result, "result": result}

    try:
        out = eval(expr, {"__builtins__": safe_builtins}, scope)  # noqa: S307
    except Exception as exc:
        print(f"cf_json: expression failed: {exc}", file=sys.stderr)
        return 1

    if isinstance(out, (list, tuple)):
        for row in out:
            print(row)
    elif out is not None:
        print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
