from __future__ import annotations

import pytest
from pydantic import ValidationError

from green.core.models import Fill, Order, OrderType, Side


def test_market_order_defaults() -> None:
    order = Order(symbol="AAPL", side=Side.BUY, quantity=10)
    assert order.order_type is OrderType.MARKET
    assert order.limit_price is None


def test_order_is_frozen() -> None:
    order = Order(symbol="AAPL", side=Side.BUY, quantity=10)
    with pytest.raises(ValidationError):
        order.quantity = 20


def test_quantity_must_be_positive() -> None:
    with pytest.raises(ValidationError):
        Order(symbol="AAPL", side=Side.SELL, quantity=0)


def test_limit_order_requires_price() -> None:
    with pytest.raises(ValidationError):
        Order(symbol="AAPL", side=Side.BUY, quantity=5, order_type=OrderType.LIMIT)


def test_limit_order_with_price_ok() -> None:
    order = Order(
        symbol="AAPL",
        side=Side.BUY,
        quantity=5,
        order_type=OrderType.LIMIT,
        limit_price=150.0,
    )
    assert order.limit_price == 150.0


def test_market_order_rejects_limit_price() -> None:
    with pytest.raises(ValidationError):
        Order(
            symbol="AAPL",
            side=Side.BUY,
            quantity=5,
            order_type=OrderType.MARKET,
            limit_price=150.0,
        )


def test_fill_construction() -> None:
    fill = Fill(symbol="AAPL", side=Side.BUY, quantity=10, price=150.0, fee=0.5, t=3)
    assert fill.fee == 0.5
    assert fill.t == 3
