# syntax=docker/dockerfile:1.19@sha256:b6afd42430b15f2d2a4c5a02b919e98a525b785b1aaff16747d2f623364e39b6

FROM ghcr.io/astral-sh/uv:0.13.0@sha256:cdc6093146eb3ff6a40107b38f008b789e050e77ad87865e381d9917da55a168 AS uv

FROM scratch AS model
ADD --checksum=sha256:15313b51ace64cbfa81f8f6ef25ad64f04e5a6fb7f7823e67b107527bc081ac9 \
    https://zenodo.org/api/records/21788410/files/medium.safetensors/content /medium.safetensors

FROM python:3.13.15-slim-trixie@sha256:7c61056e61ac89e852de05f3dc6fa51a6dd2181797bceed46aa725dd7cb2cd3b AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    READING_MODEL=/models/medium.safetensors
WORKDIR /app
COPY --from=uv /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY --from=model --chmod=a=rX /medium.safetensors /models/medium.safetensors
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-editable \
    && useradd --system --uid 10001 --user-group --no-create-home reading

FROM base AS check
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-editable
ENV XDG_CACHE_HOME=/tmp/cache UV_CACHE_DIR=/tmp/cache/uv RUFF_CACHE_DIR=/tmp/cache/ruff
COPY tests ./tests
COPY check.sh audit-allowlist.txt ./
USER reading
CMD ["sh", "check.sh"]

FROM base AS runtime
USER reading
EXPOSE 8080
CMD ["python", "-m", "reading"]
