# syntax=docker/dockerfile:1.19@sha256:b6afd42430b15f2d2a4c5a02b919e98a525b785b1aaff16747d2f623364e39b6

FROM ghcr.io/astral-sh/uv:0.13.0@sha256:cdc6093146eb3ff6a40107b38f008b789e050e77ad87865e381d9917da55a168 AS uv

FROM scratch AS model
ADD --checksum=sha256:15313b51ace64cbfa81f8f6ef25ad64f04e5a6fb7f7823e67b107527bc081ac9 \
    https://zenodo.org/api/records/21788410/files/medium.safetensors/content /medium.safetensors

FROM scratch AS ner
ADD --checksum=sha256:666ce15c968ca49874d2449aa9b83164dbb1126090d012dda7c35b2ef3672e1d \
    https://huggingface.co/cmarkea/distilcamembert-base-ner/resolve/e539d952f70088b450c300c28ba455da87f2dc4b/model.onnx /model.onnx
ADD --checksum=sha256:103f36a11079994f128a20c46cb388912dc9d481fded4ce12fbfe2d9f63d2662 \
    https://huggingface.co/cmarkea/distilcamembert-base-ner/resolve/e539d952f70088b450c300c28ba455da87f2dc4b/config.json /config.json
ADD --checksum=sha256:2fe563b59de779621fa6ef3756e7ae565a87d78ac249afb728daf743ba3821ed \
    https://huggingface.co/Xenova/camembert-ner/resolve/8e1988247e872ba0137062653b1e5033a31e14fc/tokenizer.json /tokenizer.json

FROM python:3.13.15-slim-trixie@sha256:7c61056e61ac89e852de05f3dc6fa51a6dd2181797bceed46aa725dd7cb2cd3b AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    READING_MODEL=/models/medium.safetensors \
    READING_NER=/models/ner \
    ORT_DISABLE_TELEMETRY=1
WORKDIR /app
COPY --from=uv /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY --from=model --chmod=a=rX /medium.safetensors /models/medium.safetensors
COPY --from=ner --chmod=a=rX / /models/ner/
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
