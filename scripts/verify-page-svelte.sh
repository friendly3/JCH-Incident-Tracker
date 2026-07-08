#!/usr/bin/env bash
# Verify src/routes/+page.svelte is complete (not a stub) and passes type/a11y checks.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAGE_SVELTE="${ROOT}/src/routes/+page.svelte"
MIN_LINES=200

if [[ ! -f "${PAGE_SVELTE}" ]]; then
  echo "ERROR: Missing ${PAGE_SVELTE}" >&2
  exit 1
fi

line_count="$(wc -l < "${PAGE_SVELTE}" | tr -d ' ')"
if [[ "${line_count}" -lt "${MIN_LINES}" ]]; then
  echo "ERROR: ${PAGE_SVELTE} has ${line_count} lines (minimum ${MIN_LINES})" >&2
  exit 1
fi

if grep -qE 'PLACEHOLDER|LOAD_FROM_FILE|WILL_FAIL' "${PAGE_SVELTE}"; then
  echo "ERROR: ${PAGE_SVELTE} contains stub marker (PLACEHOLDER, LOAD_FROM_FILE, or WILL_FAIL)" >&2
  exit 1
fi

echo "OK: ${PAGE_SVELTE} has ${line_count} lines and no stub markers"

cd "${ROOT}"
npm run check