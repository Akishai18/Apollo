"""Cheap, LLM-free static checks on generated source — caught before we spend a
sandbox run. The sandbox is still the real security boundary at execution time;
this just gives fast, legible feedback for the repair loop (and rejects obvious
junk early).
"""

from __future__ import annotations

import ast

# Modules a generated strategy may import. The sandbox enforces this at runtime
# too (new imports fail), but catching it statically gives a clean repair message.
_ALLOWED_ROOTS = {
    "green",  # green.core, green.core.indicators, ...
    "statistics",
    "math",
    "collections",
    "itertools",
    "typing",
    "__future__",
}

_INDICATOR_ARITY = {
    "sma": 2,
    "ema": 2,
    "zscore": 2,
}


def validate_source(source: str) -> list[str]:
    """Return a list of human-readable problems (empty = valid)."""
    errors: list[str] = []

    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return [f"SyntaxError: {exc.msg} (line {exc.lineno})"]

    # imports must be within the allowlist
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root not in _ALLOWED_ROOTS:
                    errors.append(f"import '{alias.name}' is not allowed")
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if root and root not in _ALLOWED_ROOTS:
                errors.append(f"import from '{node.module}' is not allowed")

    # exactly one Strategy subclass, with on_tick
    strategy_classes = [
        node
        for node in tree.body
        if isinstance(node, ast.ClassDef) and any(_base_name(b) == "Strategy" for b in node.bases)
    ]
    if len(strategy_classes) == 0:
        errors.append("no class subclassing Strategy was defined")
    elif len(strategy_classes) > 1:
        errors.append(f"expected exactly one Strategy subclass, found {len(strategy_classes)}")
    else:
        cls = strategy_classes[0]
        methods = {n.name for n in cls.body if isinstance(n, ast.FunctionDef)}
        if "on_tick" not in methods:
            errors.append(f"class {cls.name} does not implement on_tick")

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name = _call_name(node.func)
        expected = _INDICATOR_ARITY.get(name)
        if expected is not None and len(node.args) != expected:
            errors.append(
                f"{name}() expects {expected} positional arguments: "
                f"{name}(values, window); found {len(node.args)}"
            )

    return errors


def _base_name(base: ast.expr) -> str:
    if isinstance(base, ast.Name):
        return base.id
    if isinstance(base, ast.Attribute):
        return base.attr
    return ""


def _call_name(func: ast.expr) -> str:
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return ""
