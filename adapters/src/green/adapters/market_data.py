"""MarketDataAdapter — the first *faithful* environment (equities/crypto OHLCV).

Where `ToyAdapter` fills instantly at the current price with no costs, this
adapter models the frictions that make a backtest trustworthy:

- **Next-bar-open fills.** A strategy decides on bar `t` (it has seen data
  through `close[t]`); the order executes at `open[t+1]`. You can never trade on
  a price your decision was derived from. Orders on the final bar have no next
  bar to fill against, so they are dropped.
- **Slippage** — a flat bps haircut: buys pay up, sells receive less.
- **Fees** — per-share commission.
- **Position limits** — fills are clipped so `|position|` never exceeds a cap.

Lookahead note: the *trusted* simulator reads `open[t+1]` to price the fill, but
the strategy never sees it — `make_view` still slices the dataset to `[0, t]`.
Peeking forward inside the simulator is not strategy lookahead; the guarantee is
about what the `MarketView` exposes, and it exposes nothing past `t`.

Point-in-time data is loaded from a committed, versioned parquet fixture (see
`synthetic.py`); the adapter only ever reads it.
"""

from __future__ import annotations

import os
import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Literal, cast

import polars as pl

from green.adapters.synthetic import FIXTURE_PATH
from green.core.adapter import EnvironmentAdapter
from green.core.dataset import Dataset, Field, Symbol
from green.core.marketview import MarketView
from green.core.models import Fill, Order, Side
from green.core.portfolio import PortfolioState
from green.core.views import SlicedView

_FIELDS: tuple[Field, ...] = ("open", "high", "low", "close", "volume")
_CACHE_DIR = Path("data") / "market_data" / "yahoo"


def _default_cache_dir() -> Path:
    """The provider cache location. Overridable via env so tests can isolate it
    (never poison the shared cache) and production can point it at a volume."""
    return Path(os.environ.get("GREEN_MARKET_DATA_CACHE", str(_CACHE_DIR)))


class MarketDataAdapter(EnvironmentAdapter):
    def __init__(
        self,
        *,
        provider: Literal["fixture", "yahoo", "delta"] = "fixture",
        path: Path | str = FIXTURE_PATH,
        symbols: str | Sequence[str] = ("SYN",),
        table: str | None = None,
        as_of: str | None = None,
        start: str | None = None,
        end: str | None = None,
        period: str = "5y",
        interval: str = "1d",
        auto_adjust: bool = True,
        cache_dir: Path | str | None = None,
        refresh: bool = False,
        fee_per_share: float = 0.005,
        slippage_bps: float = 1.0,
        max_position: float = 1000.0,
    ) -> None:
        self.provider = provider
        self.path = Path(path)
        self.symbols = _symbols(symbols)
        self.start = start
        self.end = end
        self.period = period
        self.interval = interval
        self.auto_adjust = auto_adjust
        self.table = table if table is not None else os.environ.get("GREEN_MARKET_TABLE")
        self.as_of = as_of  # pin a Delta version/timestamp for reproducible reads
        self.cache_dir = Path(cache_dir) if cache_dir is not None else _default_cache_dir()
        self.refresh = refresh
        self.fee_per_share = fee_per_share
        self.slippage_bps = slippage_bps
        self.max_position = max_position

    def load_data(self) -> Dataset:
        df = self._load_frame()
        symbol_col: list[str] = df["symbol"].to_list()
        t_col: list[int] = df["t"].to_list()
        field_cols: dict[Field, list[float]] = {field: df[field].to_list() for field in _FIELDS}
        date_col: list[str] = df["date"].cast(pl.String).to_list() if "date" in df.columns else []

        rows_by_symbol: dict[Symbol, list[int]] = {}
        for i, symbol in enumerate(symbol_col):
            rows_by_symbol.setdefault(symbol, []).append(i)

        series: dict[Symbol, dict[Field, Sequence[float]]] = {}
        for symbol, rows in rows_by_symbol.items():
            rows.sort(key=lambda i: t_col[i])
            series[symbol] = {field: tuple(field_cols[field][i] for i in rows) for field in _FIELDS}
        if date_col:
            first_symbol = next(iter(rows_by_symbol))
            dates = tuple(date_col[i] for i in rows_by_symbol[first_symbol])
        else:
            dates = ()
        return Dataset(series=series, dates=dates)

    def _load_frame(self) -> pl.DataFrame:
        if self.provider == "fixture":
            return pl.read_parquet(self.path)
        if self.provider in ("yahoo", "delta"):
            cache_path = self._cache_path()
            if cache_path.exists() and not self.refresh:
                return pl.read_parquet(cache_path)
            if self.provider == "yahoo":
                df = _fetch_yahoo(
                    self.symbols,
                    start=self.start,
                    end=self.end,
                    period=self.period,
                    interval=self.interval,
                    auto_adjust=self.auto_adjust,
                )
            else:
                df = _fetch_delta(
                    self.symbols,
                    table=self.table,
                    start=self.start,
                    end=self.end,
                    as_of=self.as_of,
                )
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            df.write_parquet(cache_path)
            return df
        raise ValueError(f"unknown market data provider: {self.provider}")

    def _cache_path(self) -> Path:
        dates = f"{self.start or 'period-' + self.period}_{self.end or 'latest'}"
        flags = "adj" if self.auto_adjust else "raw"
        name = "_".join(self.symbols)
        safe = "".join(c if c.isalnum() or c in "._-" else "-" for c in name)
        pin = f"_v{self.as_of}" if self.as_of else ""  # pinned reads cache separately
        fname = f"{self.provider}_{safe}_{dates}_{self.interval}_{flags}{pin}.parquet"
        return self.cache_dir / fname

    def make_view(self, dataset: Dataset, t: int) -> MarketView:
        return SlicedView(t, dataset.slice_at(t))

    def apply_orders(
        self, orders: Sequence[Order], state: PortfolioState, dataset: Dataset, t: int
    ) -> list[Fill]:
        fill_t = t + 1
        if fill_t > dataset.length - 1:
            return []  # no next bar to execute against

        fills: list[Fill] = []
        for order in orders:
            base = dataset.price(order.symbol, fill_t, "open")
            signed = order.quantity if order.side is Side.BUY else -order.quantity
            current = state.position(order.symbol)
            target = max(-self.max_position, min(self.max_position, current + signed))
            quantity = abs(target - current)
            if quantity == 0.0:
                continue  # blocked by position limit

            haircut = self.slippage_bps / 10_000.0
            price = base * (1.0 + haircut) if order.side is Side.BUY else base * (1.0 - haircut)
            fills.append(
                Fill(
                    symbol=order.symbol,
                    side=order.side,
                    quantity=quantity,
                    price=price,
                    fee=self.fee_per_share * quantity,
                    t=fill_t,
                )
            )
        return fills


def _symbols(symbols: str | Sequence[str]) -> tuple[str, ...]:
    raw = [symbols] if isinstance(symbols, str) else list(symbols)
    cleaned = tuple(s.strip().upper() for s in raw if s.strip())
    if not cleaned:
        raise ValueError("at least one symbol is required")
    return cleaned


def _delta_query(
    table: str,
    symbols: tuple[str, ...],
    *,
    start: str | None,
    end: str | None,
    as_of: str | None,
) -> tuple[str, list[str]]:
    """Build the (sql, params) for a Delta read. `as_of` pins the read for
    reproducibility: a bare integer → Delta `VERSION AS OF`, otherwise a
    timestamp → `TIMESTAMP AS OF`. Symbols/dates are bound params; table and
    as_of are config (guarded) since Spark can't parameterize them."""
    if not re.fullmatch(r"[A-Za-z0-9_.`]+", table):  # table is config, not user input
        raise ValueError(f"invalid table identifier: {table!r}")
    travel = ""
    if as_of:
        if re.fullmatch(r"\d+", as_of):
            travel = f" VERSION AS OF {int(as_of)}"
        elif re.fullmatch(r"[0-9 :.\-]+", as_of):  # date / timestamp
            travel = f" TIMESTAMP AS OF '{as_of}'"
        else:
            raise ValueError(f"invalid as_of (want a version int or timestamp): {as_of!r}")

    placeholders = ", ".join("?" for _ in symbols)
    sql = (
        f"SELECT date, symbol, open, high, low, close, volume FROM {table}{travel} "
        f"WHERE upper(symbol) IN ({placeholders})"
    )
    params: list[str] = [s.upper() for s in symbols]
    if start:
        sql += " AND date >= ?"
        params.append(start)
    if end:
        sql += " AND date <= ?"
        params.append(end)
    sql += " ORDER BY symbol, date"
    return sql, params


def _fetch_delta(
    symbols: tuple[str, ...],
    *,
    table: str | None,
    start: str | None,
    end: str | None,
    as_of: str | None = None,
) -> pl.DataFrame:
    """Read OHLCV from a Databricks Delta table via the SQL connector. Credentials
    come from env (GREEN_DATABRICKS_HOST/HTTP_PATH/TOKEN). Returns the same frame
    shape as _fetch_yahoo. `as_of` pins a Delta version/timestamp for reproducibility."""
    from databricks import sql as _dbsql  # type: ignore[import-untyped]

    dbsql = cast("Any", _dbsql)  # untyped SDK — keep types out of pyright strict
    host = os.environ.get("GREEN_DATABRICKS_HOST")
    http_path = os.environ.get("GREEN_DATABRICKS_HTTP_PATH")
    token = os.environ.get("GREEN_DATABRICKS_TOKEN")
    table = table or os.environ.get("GREEN_MARKET_TABLE")
    if not (host and http_path and token and table):
        raise ValueError(
            "Databricks delta provider needs GREEN_DATABRICKS_HOST, _HTTP_PATH, "
            "_TOKEN and GREEN_MARKET_TABLE (or a `table` arg)"
        )
    sql, params = _delta_query(table, symbols, start=start, end=end, as_of=as_of)

    with (
        dbsql.connect(server_hostname=host, http_path=http_path, access_token=token) as conn,
        conn.cursor() as cur,
    ):
        cur.execute(sql, params)
        rows = cast("list[tuple[Any, ...]]", cur.fetchall())
    if not rows:
        raise ValueError(f"Databricks returned no rows for {', '.join(symbols)} from {table}")

    by_symbol: dict[str, list[tuple[Any, ...]]] = {}
    for r in rows:
        by_symbol.setdefault(str(r[1]), []).append(r)
    frames = [
        pl.DataFrame(
            {
                "t": list(range(len(rs))),
                "date": [str(r[0])[:10] for r in rs],
                "symbol": [sym] * len(rs),
                "open": [float(r[2]) for r in rs],
                "high": [float(r[3]) for r in rs],
                "low": [float(r[4]) for r in rs],
                "close": [float(r[5]) for r in rs],
                "volume": [float(r[6]) for r in rs],
            }
        )
        for sym, rs in by_symbol.items()
    ]
    return pl.concat(frames).sort(["symbol", "t"])


def _fetch_yahoo(
    symbols: tuple[str, ...],
    *,
    start: str | None,
    end: str | None,
    period: str,
    interval: str,
    auto_adjust: bool,
) -> pl.DataFrame:
    # yfinance is intentionally isolated here: core + API depend only on Dataset.
    import yfinance as yf  # type: ignore[import-untyped]

    frames = [
        _fetch_one_yahoo(
            yf,
            symbol,
            start=start,
            end=end,
            period=period,
            interval=interval,
            auto_adjust=auto_adjust,
        )
        for symbol in symbols
    ]
    return pl.concat(frames).sort(["symbol", "t"])


def _fetch_one_yahoo(
    yf: Any,
    symbol: str,
    *,
    start: str | None,
    end: str | None,
    period: str,
    interval: str,
    auto_adjust: bool,
) -> pl.DataFrame:
    ticker = yf.Ticker(symbol)
    kwargs: dict[str, Any] = {
        "interval": interval,
        "auto_adjust": auto_adjust,
        "actions": False,
    }
    if start or end:
        kwargs["start"] = start
        kwargs["end"] = end
    else:
        kwargs["period"] = period
    df = ticker.history(**kwargs)
    if getattr(df, "empty", True):
        raise ValueError(f"Yahoo returned no rows for {symbol}")

    reset = df.reset_index()
    columns = {str(col).lower(): str(col) for col in reset.columns}
    date_key = columns.get("date") or columns.get("datetime")
    if date_key is None:
        raise ValueError(f"Yahoo response for {symbol} did not include dates")

    required = {"open", "high", "low", "close", "volume"}
    missing = sorted(required - set(columns))
    if missing:
        raise ValueError(f"Yahoo response for {symbol} missing columns: {', '.join(missing)}")

    dates = [str(value)[:10] for value in cast("Sequence[object]", reset[date_key].tolist())]
    return pl.DataFrame(
        {
            "t": list(range(len(reset))),
            "date": dates,
            "symbol": [symbol] * len(reset),
            "open": _float_col(reset, columns["open"]),
            "high": _float_col(reset, columns["high"]),
            "low": _float_col(reset, columns["low"]),
            "close": _float_col(reset, columns["close"]),
            "volume": _float_col(reset, columns["volume"]),
        }
    ).drop_nulls()


def _float_col(frame: Any, column: str) -> list[float]:
    return [float(v) for v in frame[column].tolist()]
