#!/usr/bin/env python
"""
Apollo — decay alerting for promoted strategies.

Reads GET /maintenance/alerts and reports any promoted ("champion") strategy whose
latest held-out validation breached the bar (rejected out-of-sample, or held-out
Sharpe below the threshold). Exits non-zero when anything is flagged, so cron / CI
surfaces it; optionally posts to a Slack incoming webhook.

Pair with scripts/revalidate.py on a schedule:
    revalidate.py  → re-runs promoted strategies on fresh data
    decay_alerts.py → flags the ones that no longer hold up
Usage:
    GREEN_API_URL=http://localhost:8000 \
    GREEN_API_TOKEN=<bearer-if-auth-on> \
    GREEN_DECAY_MIN_SHARPE=0.5 \
    GREEN_SLACK_WEBHOOK=<optional> \
    python scripts/decay_alerts.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request


def _get_json(url: str, headers: dict[str, str]) -> object:
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as resp:
        return json.load(resp)


def _slack(webhook: str, text: str) -> None:
    body = json.dumps({"text": text}).encode()
    req = urllib.request.Request(
        webhook, data=body, headers={"content-type": "application/json"}, method="POST"
    )
    try:
        urllib.request.urlopen(req, timeout=15).close()
    except urllib.error.URLError as exc:
        print(f"  (slack post failed: {exc.reason})")


def main() -> int:
    base = os.environ.get("GREEN_API_URL", "http://localhost:8000").rstrip("/")
    token = os.environ.get("GREEN_API_TOKEN")
    threshold = os.environ.get("GREEN_DECAY_MIN_SHARPE", "0.5")
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    try:
        alerts = _get_json(f"{base}/maintenance/alerts?min_oos_sharpe={threshold}", headers)
    except (urllib.error.HTTPError, urllib.error.URLError) as exc:
        print(f"decay check failed: {exc}")
        return 2
    assert isinstance(alerts, list)

    if not alerts:
        print(f"✓ no decay: all promoted strategies hold above OOS Sharpe {threshold}")
        return 0

    lines = [f"⚠️ {len(alerts)} promoted strateg{'y' if len(alerts) == 1 else 'ies'} decayed:"]
    for a in alerts:
        sym = f" [{a['symbol']}]" if a.get("symbol") else ""
        lines.append(f"  • {a['title']}{sym} — {a['reason']}")
    report = "\n".join(lines)
    print(report)

    webhook = os.environ.get("GREEN_SLACK_WEBHOOK")
    if webhook:
        _slack(webhook, report)
    return 1


if __name__ == "__main__":
    sys.exit(main())
