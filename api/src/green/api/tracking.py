"""Read-side of MLflow tracking: list logged backtests for the in-app browser.

Writes happen in `jobs._log_mlflow`. This module only reads, and is deliberately
forgiving: when tracking isn't configured (or the backend is unreachable) it
returns an empty list rather than raising, so the experiments page degrades to a
clean empty state instead of a 500.
"""

from __future__ import annotations

import os

from green.api.models import TrackedRun


def _configure_mlflow(uri: str) -> None:
    import mlflow

    if uri == "databricks":  # reuse the Delta workspace creds for MLflow auth
        host = os.environ.get("GREEN_DATABRICKS_HOST", "")
        os.environ.setdefault("DATABRICKS_HOST", host if host.startswith("http") else f"https://{host}")
        os.environ.setdefault("DATABRICKS_TOKEN", os.environ.get("GREEN_DATABRICKS_TOKEN", ""))
    mlflow.set_tracking_uri(uri)


def list_tracked_runs(limit: int = 100) -> list[TrackedRun]:
    uri = os.environ.get("GREEN_MLFLOW_TRACKING_URI")
    if not uri:
        return []
    try:
        from mlflow.tracking import MlflowClient

        _configure_mlflow(uri)
        experiment = os.environ.get("GREEN_MLFLOW_EXPERIMENT", "apollo")
        client = MlflowClient(tracking_uri=uri)
        exp = client.get_experiment_by_name(experiment)
        if exp is None:
            return []
        runs = client.search_runs(
            [exp.experiment_id], max_results=limit, order_by=["attributes.start_time DESC"]
        )
        out: list[TrackedRun] = []
        for r in runs:
            tags = r.data.tags
            metrics = r.data.metrics
            passed_tag = tags.get("passed")
            out.append(
                TrackedRun(
                    run_id=r.info.run_id,
                    name=tags.get("mlflow.runName") or r.info.run_id[:8],
                    symbol=tags.get("symbol"),
                    adapter=tags.get("adapter"),
                    run_kind=tags.get("run_kind"),
                    passed=(passed_tag == "True") if passed_tag is not None else None,
                    oos_sharpe=metrics.get("oos_sharpe"),
                    retention=metrics.get("retention"),
                    oos_trades=metrics.get("oos_trades"),
                    created_at=r.info.start_time or 0,
                )
            )
        return out
    except Exception:
        return []
