set -eu
ruff check
ruff format --check
mypy
pytest
uv export --frozen --format requirements-txt --no-hashes --no-emit-project --no-header --no-annotate \
    --output-file /tmp/locked.txt > /dev/null
sed 's/+cpu//' /tmp/locked.txt > /tmp/requirements.txt
grep -q '^kraken==7\.1\.1' /tmp/requirements.txt
grep -q '^torch==2\.14\.0' /tmp/requirements.txt
set --
while read -r advisory || [ -n "$advisory" ]; do
    if [ -n "$advisory" ]; then
        set -- "$@" --ignore-vuln "$advisory"
    fi
done < audit-allowlist.txt
pip-audit --strict --disable-pip --no-deps --progress-spinner off --requirement /tmp/requirements.txt "$@"
