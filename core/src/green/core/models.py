"""Core data contracts shared across every layer.

These are the vocabulary the engine, adapters, and strategies all speak in.
They are deliberately immutable (frozen): an `Order` a strategy emits or a
`Fill` the adapter produces must not be mutated downstream.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Side(StrEnum):
    BUY = "buy"
    SELL = "sell"


class OrderType(StrEnum):
    MARKET = "market"
    LIMIT = "limit"


class Order(BaseModel):
    """A desired order emitted by a strategy. The engine + adapter decide fills."""

    model_config = ConfigDict(frozen=True)

    symbol: str
    side: Side
    quantity: float = Field(gt=0)
    order_type: OrderType = OrderType.MARKET
    limit_price: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _check_limit_price(self) -> Order:
        if self.order_type is OrderType.LIMIT and self.limit_price is None:
            raise ValueError("limit orders require a limit_price")
        if self.order_type is OrderType.MARKET and self.limit_price is not None:
            raise ValueError("market orders must not set a limit_price")
        return self


class Fill(BaseModel):
    """The result of (partially) executing an order, produced by the adapter."""

    model_config = ConfigDict(frozen=True)

    symbol: str
    side: Side
    quantity: float = Field(gt=0)
    price: float = Field(gt=0)
    fee: float = Field(default=0.0, ge=0)
    t: int = Field(ge=0)
