"""Maps a request onto concrete core objects: which environment to run in, and
how to build the (sandboxed) strategy. Keeping this in one small module means
the job runner and the app stay free of environment knowledge.
"""

from __future__ import annotations

from typing import Any

from green.adapters import MarketDataAdapter, ToyAdapter
from green.api.models import AdapterSpec, RunRequest
from green.core import Dataset, EnvironmentAdapter
from green.core.overfit.gate import StrategyFactory
from green.sandbox import SandboxedStrategy


class ConfigError(ValueError):
    """The request cannot be turned into a runnable configuration."""


def build_adapter(spec: AdapterSpec) -> tuple[EnvironmentAdapter, Dataset]:
    """Construct the environment and load its dataset. Unknown params surface as
    a ConfigError (→ HTTP 400) rather than an opaque 500."""
    try:
        adapter: EnvironmentAdapter
        if spec.name == "toy":
            adapter = ToyAdapter(**spec.params)
        else:
            adapter = MarketDataAdapter(**spec.params)
    except TypeError as exc:
        raise ConfigError(f"invalid params for adapter {spec.name!r}: {exc}") from exc
    return adapter, adapter.load_data()


def make_strategy_factory(request: RunRequest) -> StrategyFactory:
    """Every strategy instance the gate builds is sandboxed — the untrusted
    source runs in a separate locked-down process, never in this one."""
    source = request.source
    class_name = request.class_name

    def factory(params: dict[str, Any]) -> SandboxedStrategy:
        return SandboxedStrategy(dict(params), source=source, class_name=class_name)

    return factory
