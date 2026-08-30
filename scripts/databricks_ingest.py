# ruff: noqa
# pyright: reportUndefinedVariable=false
"""
Apollo — Databricks market-data ingestion.

Run this as a Databricks **notebook** or a scheduled **Job** to (re)populate the
Delta OHLCV table that the `delta` market-data provider reads
(`adapters/src/green/adapters/market_data.py`). It fetches daily OHLCV per
symbol and writes it to `apollo.market.apollo_market_ohlcv` in the schema Apollo
expects: columns symbol, date (YYYY-MM-DD string), open, high, low, close, volume.

Schema must match what the adapter selects:
    SELECT date, symbol, open, high, low, close, volume FROM <table> ...

--------------------------------------------------------------------------------
How to schedule it (Databricks UI)
--------------------------------------------------------------------------------
1. Workspace → import this file as a notebook (or paste it into a new one).
2. Workflows → Create Job → add a Notebook task pointing at it, on a Serverless
   or small cluster. Optionally add Job parameters `symbols` and `table`.
3. Set a schedule (e.g. daily 23:00 ET, after the US close) → Save.

The app needs no redeploy — it reads whatever rows are in the table.
--------------------------------------------------------------------------------
"""

import pandas as pd

# --- config (override via Job parameters / notebook widgets) -----------------
DEFAULT_TABLE = "apollo.market.apollo_market_ohlcv"
DEFAULT_SYMBOLS = ["SLS", "AAPL", "SPY", "MSFT", "KO", "PEP"]
PERIOD = "5y"  # how much history to (re)load


def _params() -> tuple[str, list[str]]:
    """Read `table` / `symbols` from notebook widgets when available, else defaults."""
    table, symbols = DEFAULT_TABLE, DEFAULT_SYMBOLS
    try:
        dbutils.widgets.text("table", DEFAULT_TABLE)  # type: ignore[name-defined]  # noqa: F821
        dbutils.widgets.text("symbols", ",".join(DEFAULT_SYMBOLS))  # type: ignore[name-defined]  # noqa: F821
        table = dbutils.widgets.get("table") or DEFAULT_TABLE  # type: ignore[name-defined]  # noqa: F821
        raw = dbutils.widgets.get("symbols")  # type: ignore[name-defined]  # noqa: F821
        if raw:
            symbols = [s.strip().upper() for s in raw.split(",") if s.strip()]
    except Exception:
        pass  # not in a notebook with widgets — use defaults
    return table, symbols


def fetch_ohlcv(symbols: list[str], period: str = PERIOD) -> pd.DataFrame:
    import yfinance as yf

    frames = []
    for sym in symbols:
        df = yf.Ticker(sym).history(period=period, auto_adjust=True, actions=False).reset_index()
        if df.empty:
            print(f"  ! no rows for {sym}, skipping")
            continue
        df.columns = [str(c).lower() for c in df.columns]
        df = df[["date", "open", "high", "low", "close", "volume"]].copy()
        df["date"] = df["date"].astype(str).str[:10]
        df["symbol"] = sym
        df["volume"] = df["volume"].astype(float)
        frames.append(df)
        print(f"  ok {sym}: {len(df)} bars {df['date'].min()}..{df['date'].max()}")
    if not frames:
        raise RuntimeError("no data fetched for any symbol")
    return pd.concat(frames, ignore_index=True)


def _clean(sdf):  # type: ignore[no-untyped-def]
    """Same data-quality rules as the DLT pipeline, in plain PySpark so this runs
    as an ordinary notebook/job (no `dlt` runtime needed): drop incomplete or
    incoherent bars and de-duplicate per (symbol, date)."""
    from pyspark.sql import functions as F  # provided on a Databricks cluster

    before = sdf.count()
    clean = (
        sdf.withColumn("symbol", F.upper(F.col("symbol")))
        .where(F.col("symbol").isNotNull() & (F.col("symbol") != ""))
        .where(F.col("date").isNotNull())
        .where(
            F.col("open").isNotNull()
            & F.col("high").isNotNull()
            & F.col("low").isNotNull()
            & F.col("close").isNotNull()
        )
        .where(
            (F.col("open") > 0) & (F.col("high") > 0) & (F.col("low") > 0) & (F.col("close") > 0)
        )
        .where(F.col("high") >= F.col("low"))
        .where(F.col("volume") >= 0)
        .dropDuplicates(["symbol", "date"])
    )
    after = clean.count()
    if before != after:
        print(f"  dropped {before - after} bad/duplicate rows ({after} kept)")
    return clean


def main() -> None:
    table, symbols = _params()
    print(f"Ingesting {symbols} → {table}")
    pdf = fetch_ohlcv(symbols)
    # `spark` is provided by the Databricks runtime.
    sdf = _clean(spark.createDataFrame(pdf))  # type: ignore[name-defined]  # noqa: F821
    # Full refresh; overwriteSchema handles any column/type drift from prior loads.
    sdf.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(table)
    print(f"wrote to {table}")


main()
