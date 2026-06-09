"""Synthetic OHLCV generator — deterministic geometric-Brownian-motion bars.

Produces the committed parquet fixture the `MarketDataAdapter` reads. Kept apart
from the adapter on purpose: the adapter only ever *reads* point-in-time data
(it never regenerates it), exactly as a real market-data adapter would load a
pinned, versioned dataset. Regenerate the fixture with:

    uv run python -m green.adapters.synthetic
"""

from __future__ import annotations

import random
from pathlib import Path

import polars as pl

FIXTURE_PATH = Path(__file__).parent / "data" / "synthetic_ohlcv.parquet"


def generate_ohlcv(
    *,
    symbol: str = "SYN",
    n_bars: int = 756,
    start_price: float = 100.0,
    mu: float = 0.0001,
    sigma: float = 0.012,
    seed: int = 0,
) -> pl.DataFrame:
    """Generate `n_bars` daily OHLCV bars via GBM. Open[t] == Close[t-1] (no gaps).

    No-gap opens keep the next-bar-open fill model's arithmetic exact and easy to
    reason about; high/low straddle the open/close with bounded positive noise.
    """
    rng = random.Random(seed)
    ts: list[int] = []
    symbols: list[str] = []
    opens: list[float] = []
    highs: list[float] = []
    lows: list[float] = []
    closes: list[float] = []
    volumes: list[float] = []

    close = start_price
    for t in range(n_bars):
        open_ = close
        ret = mu + sigma * rng.gauss(0.0, 1.0)
        close = open_ * (1.0 + ret)
        high = max(open_, close) + abs(rng.gauss(0.0, sigma)) * open_
        low = min(open_, close) - abs(rng.gauss(0.0, sigma)) * open_
        volume = float(round(rng.uniform(1_000.0, 10_000.0)))

        ts.append(t)
        symbols.append(symbol)
        opens.append(open_)
        highs.append(high)
        lows.append(low)
        closes.append(close)
        volumes.append(volume)

    return pl.DataFrame(
        {
            "t": ts,
            "symbol": symbols,
            "open": opens,
            "high": highs,
            "low": lows,
            "close": closes,
            "volume": volumes,
        }
    )


def write_fixture() -> Path:
    df = generate_ohlcv()
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(FIXTURE_PATH)
    return FIXTURE_PATH


if __name__ == "__main__":
    path = write_fixture()
    print(f"wrote {path} ({generate_ohlcv().height} bars)")
