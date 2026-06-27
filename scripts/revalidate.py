#!/usr/bin/env python
"""
Apollo — scheduled re-validation of promoted strategies.

Calls the API's POST /maintenance/revalidate, which re-runs formal validation for
every promoted ("champion") strategy on *current* market data. Run it on a
schedule (cron, a CI job, or a Databricks Workflow) to catch edge decay — a
strategy that passed last quarter but no longer holds out-of-sample.

Usage:
    GREEN_API_URL=http://localhost:8000 \
    GREEN_API_TOKEN=<supabase-bearer-if-auth-on> \
    python scripts/revalidate.py

Auth: when the API has auth enabled, set GREEN_API_TOKEN to a bearer token for
the owner whose strategies should be re-validated. With auth off (local dev),
no token is needed.

Example cron (daily 06:00):
    0 6 * * *  cd /path/to/project-green && GREEN_API_URL=https://api.example.com \
               GREEN_API_TOKEN=$TOKEN python scripts/revalidate.py >> revalidate.log 2>&1
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request


def main() -> int:
    base = os.environ.get("GREEN_API_URL", "http://localhost:8000").rstrip("/")
    token = os.environ.get("GREEN_API_TOKEN")
    headers = {"content-type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    url = f"{base}/maintenance/revalidate"
    req = urllib.request.Request(url, data=b"", headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.load(resp)
    except urllib.error.HTTPError as exc:
        print(f"revalidate failed: HTTP {exc.code} {exc.read().decode(errors='replace')[:200]}")
        return 1
    except urllib.error.URLError as exc:
        print(f"revalidate failed: cannot reach {base} ({exc.reason})")
        return 1

    count = payload.get("count", 0)
    print(f"re-validation submitted for {count} promoted strateg{'y' if count == 1 else 'ies'}")
    for run_id in payload.get("run_ids", []):
        print(f"  run: {run_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
