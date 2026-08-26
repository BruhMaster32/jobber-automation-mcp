#!/bin/sh
set -eu

export PORT=18080
export PUBLIC_BASE_URL=http://localhost:18080
export MCP_PATH_TOKEN=local-test-mcp-path-token-longer-than-thirty-two
export SETUP_KEY=local-test-setup-key-longer-than-thirty-two
export JOBBER_CLIENT_ID=7b19a96d-e880-4dcd-8de4-adc49f6b9bf8
export JOBBER_CLIENT_SECRET=local-test-secret-not-real
export JOBBER_GRAPHQL_VERSION=2025-04-16
export DATABASE_PATH=/tmp/jobber-mcp-smoke.sqlite
export ENABLE_AUTOMATION_WORKER=false

node dist/server.js >/tmp/jobber-mcp-smoke.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

attempt=0
while [ "$attempt" -lt 20 ]; do
  if curl --fail --silent http://127.0.0.1:18080/health; then
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 0.1
done

sed -n '1,120p' /tmp/jobber-mcp-smoke.log
exit 1
