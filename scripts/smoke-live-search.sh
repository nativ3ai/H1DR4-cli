#!/usr/bin/env bash
set -euo pipefail

MODEL="${OLLAMA_MODEL:-closex/neuraldaredevil-8b-abliterated:Q6_K}"
HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"

echo "Checking Ollama at ${HOST}..."
if ! curl -fsS "${HOST}/api/tags" >/dev/null; then
  echo "Ollama is not responding. Start it with: ollama serve"
  exit 1
fi

if command -v ollama >/dev/null; then
  if ! ollama list | grep -q "${MODEL}"; then
    echo "Pulling model: ${MODEL}"
    ollama pull "${MODEL}"
  fi
else
  echo "Ollama CLI not found; skipping model pull check."
fi

CLI_CMD=""
if [ -f "dist/index.js" ]; then
  CLI_CMD="node dist/index.js"
else
  CLI_CMD="npx tsx src/index.ts"
fi

echo "Running smoke test..."
H1DR4_PROVIDER=ollama \
H1DR4_LIVE_SEARCH=on \
H1DR4_MAX_SOURCES=3 \
${CLI_CMD} --prompt "latest on EU AI Act enforcement" --live-search on --citations on
