"""green.strategies — canonical example strategies. Each is just a
green.core.Strategy subclass, exactly what a user (or the generator) supplies.
"""

from green.strategies.buy_and_hold import BuyAndHold
from green.strategies.mean_reversion import MeanReversion
from green.strategies.moving_average_crossover import MovingAverageCrossover

__all__ = ["BuyAndHold", "MeanReversion", "MovingAverageCrossover"]
