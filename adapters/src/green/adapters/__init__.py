"""green.adapters — pluggable environments. Each adapter depends on green.core
only and must not import other adapters.
"""

from green.adapters.toy import ToyAdapter

__all__ = ["ToyAdapter"]
