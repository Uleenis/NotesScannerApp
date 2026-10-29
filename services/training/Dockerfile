# syntax=docker/dockerfile:1.19@sha256:b6afd42430b15f2d2a4c5a02b919e98a525b785b1aaff16747d2f623364e39b6

FROM ghcr.io/astral-sh/uv:0.13.5@sha256:32a7bb39b496babbd997b0a39a4d66c126bdaf5661b302bf6f06abda8deca6ff AS uv

FROM scratch AS model
ADD --checksum=sha256:15313b51ace64cbfa81f8f6ef25ad64f04e5a6fb7f7823e67b107527bc081ac9 \
    https://zenodo.org/api/records/21788410/files/medium.safetensors/content /medium.safetensors

FROM python:3.13.15-slim-trixie@sha256:7c61056e61ac89e852de05f3dc6fa51a6dd2181797bceed46aa725dd7cb2cd3b AS runtime
ARG TORCH_CUDA=cu130
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PATH=/opt/venv/bin:$PATH \
    TRAINING_MODEL=/models/medium.safetensors \
    TRAINING_WORK=/work \
    HF_HUB_OFFLINE=1 \
    TORCHDYNAMO_DISABLE=1 \
    PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
WORKDIR /app
COPY --from=uv /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv venv /opt/venv \
    && uv export --frozen --no-dev --no-emit-project --format requirements-txt --no-header --no-annotate \
        --output-file /tmp/locked.txt > /dev/null \
    && awk '/^(torch|torchvision)==/ { skip = 1; next } /^[^ ]/ { skip = 0 } !skip' /tmp/locked.txt > /tmp/requirements.txt \
    && sed -n 's/^\([A-Za-z0-9_.-]*==[^ ;]*\).*/\1/p' /tmp/requirements.txt > /tmp/constraints.txt \
    && uv pip install --python /opt/venv --no-deps --require-hashes --requirement /tmp/requirements.txt \
    && uv pip install --python /opt/venv --index-url "https://download.pytorch.org/whl/$TORCH_CUDA" \
        --constraint /tmp/constraints.txt "torch==2.14.0+$TORCH_CUDA" "torchvision==0.29.0+$TORCH_CUDA"
COPY --from=model --chmod=a=rX /medium.safetensors /models/medium.safetensors
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --python /opt/venv --no-deps . \
    && useradd --system --uid 10002 --user-group --no-create-home trainer \
    && mkdir /work && chown trainer:trainer /work && chmod 0700 /work
USER trainer
CMD ["python", "-m", "reading.trainer"]
