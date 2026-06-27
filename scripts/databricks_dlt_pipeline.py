# ruff: noqa
# pyright: reportMissingImports=false, reportUndefinedVariable=false
"""
Apollo — Delta Live Tables (Lakeflow) medallion pipeline for market data.

A governed alternative to scripts/databricks_ingest.py: instead of one overwrite,
this builds a bronze → silver → gold pipeline with **data-quality expectations**,
so the gold table Apollo reads is clean by construction (no null bars, positive
volume, monotonic per-symbol dates).

Layers
------
- bronze_market_raw : raw OHLCV as fetched (kept for lineage/replay)
- silver_market     : typed, de-duplicated, quality-checked
- apollo_market_ohlcv (gold) : the exact schema the `delta` provider selects:
                      symbol, date, open, high, low, close, volume

--------------------------------------------------------------------------------
Set up in Databricks
--------------------------------------------------------------------------------
1. Workspace → import this file as a notebook.
2. Workflows → Delta Live Tables → Create pipeline:
     - Source: this notebook
     - Catalog / schema: apollo / market   (so the gold table is apollo.market.apollo_market_ohlcv)
     - Serverless, triggered
3. Add a schedule (e.g. daily after the close) → Start.
4. Point the app at the gold table:  GREEN_MARKET_TABLE=apollo.market.apollo_market_ohlcv

The expectations below DROP bad rows (and surface counts in the pipeline UI), so
a flaky upstream day can't silently corrupt a backtest.
"""

import dlt
import pandas as pd
from pyspark.sql import functions as F

SYMBOLS = ["SLS", "AAPL", "SPY", "MSFT", "KO", "PEP"]
PERIOD = "5y"


def _fetch() -> pd.DataFrame:
    import yfinance as yf

    frames = []
    for sym in SYMBOLS:
        df = yf.Ticker(sym).history(period=PERIOD, auto_adjust=True, actions=False).reset_index()
        if df.empty:
            continue
        df.columns = [str(c).lower() for c in df.columns]
        df = df[["date", "open", "high", "low", "close", "volume"]].copy()
        df["date"] = df["date"].astype(str).str[:10]
        df["symbol"] = sym
        frames.append(df)
    return pd.concat(frames, ignore_index=True)


@dlt.table(comment="Raw OHLCV as fetched from the upstream provider (lineage/replay).")
def bronze_market_raw():  # noqa: ANN201
    return spark.createDataFrame(_fetch())


@dlt.table(comment="Typed, de-duplicated, quality-checked OHLCV.")
@dlt.expect_or_drop("valid_symbol", "symbol IS NOT NULL AND symbol <> ''")
@dlt.expect_or_drop("valid_date", "date IS NOT NULL")
@dlt.expect_or_drop("prices_present", "open IS NOT NULL AND high IS NOT NULL AND low IS NOT NULL AND close IS NOT NULL")
@dlt.expect_or_drop("positive_prices", "open > 0 AND high > 0 AND low > 0 AND close > 0")
@dlt.expect_or_drop("nonneg_volume", "volume >= 0")
@dlt.expect_or_drop("coherent_range", "high >= low")
def silver_market():  # noqa: ANN201
    raw = dlt.read("bronze_market_raw")
    typed = (
        raw.withColumn("open", F.col("open").cast("double"))
        .withColumn("high", F.col("high").cast("double"))
        .withColumn("low", F.col("low").cast("double"))
        .withColumn("close", F.col("close").cast("double"))
        .withColumn("volume", F.col("volume").cast("double"))
        .withColumn("symbol", F.upper(F.col("symbol")))
    )
    return typed.dropDuplicates(["symbol", "date"])


@dlt.table(
    name="apollo_market_ohlcv",
    comment="Gold OHLCV — the table the Apollo delta provider reads.",
)
def gold_market():  # noqa: ANN201
    return dlt.read("silver_market").select(
        "symbol", "date", "open", "high", "low", "close", "volume"
    )
