#!/usr/bin/env bash
# End-to-end checks: real fixture files through the real code, no mocks.
# Runs from the repository root: `npm run test:e2e`.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec npx vitest run --config tests/e2e/vitest.e2e.config.ts
