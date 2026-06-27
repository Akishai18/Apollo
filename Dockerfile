# Apollo API (FastAPI + WebSocket + sandboxed gate). Container host: Render etc.
# The web frontend is deployed separately (Vercel); this image is the backend only.
FROM python:3.13-slim-bookworm

# uv for fast, locked installs of the whole workspace.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

# Workspace manifest + lock first (better layer caching), then the members the
# API actually needs. `uv sync --frozen` installs green-api + its deps exactly
# as pinned in uv.lock.
COPY pyproject.toml uv.lock ./
COPY core ./core
COPY adapters ./adapters
COPY strategies ./strategies
COPY sandbox ./sandbox
COPY generator ./generator
COPY api ./api
RUN uv sync --frozen

EXPOSE 8000
# Render (and most hosts) inject $PORT; default to 8000 locally.
CMD ["sh", "-c", "uv run --no-sync uvicorn green.api:app --host 0.0.0.0 --port ${PORT:-8000}"]
