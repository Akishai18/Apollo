"""Strategy templates — real, registered strategies the frontend can run *now*,
before the NL→code generator exists.

Each template carries the actual strategy source (read from the `green.strategies`
package) plus a default grid / adapter / window config, packaged as a ready
`RunRequest`. The frontend picks one and submits it to `POST /runs` — so the full
sandbox + walk-forward gate runs for real; only the "natural language → code" step
is stubbed (that's the generator, coming later). When the generator lands, it
produces the same `source` field and nothing downstream changes.

Configs use the toy (Ornstein-Uhlenbeck) adapter, where the validation story is
honest and deterministic: mean-reversion has a real edge that survives out of
sample; trend-following on mean-reverting data does not.
"""

from __future__ import annotations

import inspect

import green.strategies.buy_and_hold as buy_and_hold
import green.strategies.mean_reversion as mean_reversion
import green.strategies.moving_average_crossover as moving_average_crossover
from green.api.models import AdapterSpec, RunRequest

# A seeded OU series: ~600 daily bars, train 200 / test 100 -> 4 walk-forward windows.
_TOY = AdapterSpec(
    name="toy", params={"n_steps": 600, "mu": 100.0, "theta": 0.1, "sigma": 1.0, "seed": 7}
)
_TRAIN = 200
_TEST = 100


def _request(module: object, grid: dict[str, list[object]]) -> RunRequest:
    return RunRequest(
        source=inspect.getsource(module),  # type: ignore[arg-type]
        class_name=None,  # each module defines exactly one Strategy
        grid=grid,
        adapter=_TOY,
        train_size=_TRAIN,
        test_size=_TEST,
    )


class Template:
    def __init__(self, key: str, name: str, blurb: str, prompt: str, request: RunRequest) -> None:
        self.key = key
        self.name = name
        self.blurb = blurb
        self.prompt = prompt
        self.request = request

    def as_dict(self) -> dict[str, object]:
        return {
            "key": self.key,
            "name": self.name,
            "blurb": self.blurb,
            "prompt": self.prompt,
            "request": self.request.model_dump(mode="json"),
        }


TEMPLATES: list[Template] = [
    Template(
        key="mean-reversion",
        name="Mean reversion",
        blurb="Fade extremes back to the average.",
        prompt="Mean-reversion on SYN: buy ~1.5 std below the 20-day average, exit at the mean.",
        request=_request(
            mean_reversion,
            {"symbol": ["SYN"], "lookback": [10, 20], "entry_z": [-1.5, -1.0], "quantity": [500]},
        ),
    ),
    Template(
        key="crossover",
        name="Trend crossover",
        blurb="Follow moving-average trends.",
        prompt="Moving-average crossover on SYN: long when the fast SMA crosses above the slow.",
        request=_request(
            moving_average_crossover,
            {"symbol": ["SYN"], "fast": [10, 20], "slow": [40, 60], "quantity": [500]},
        ),
    ),
    Template(
        key="buy-and-hold",
        name="Buy & hold",
        blurb="The baseline to beat.",
        prompt="Buy SYN and hold.",
        request=_request(buy_and_hold, {"symbol": ["SYN"], "quantity": [500]}),
    ),
]


def templates_payload() -> list[dict[str, object]]:
    return [t.as_dict() for t in TEMPLATES]
