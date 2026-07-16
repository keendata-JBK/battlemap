#!/bin/zsh

set -euo pipefail

keychain_secret() {
  /usr/bin/security find-generic-password -s "$1" -w
}

CONNECTOR_DIR="${CONNECTOR_DIR:-/Users/jbk/Documents/销售管理/battlemap-sites/services/dingtalk-connector}"
NODE_BIN="${NODE_BIN:-/Users/jbk/.local/bin/node}"

export DINGTALK_CLIENT_ID="$(keychain_secret battlemap-dingtalk-client-id)"
export DINGTALK_CLIENT_SECRET="$(keychain_secret battlemap-dingtalk-client-secret)"
export DINGTALK_CONNECTOR_TOKEN="$(keychain_secret battlemap-dingtalk-connector-token)"

cd "$CONNECTOR_DIR"
exec "$NODE_BIN" src/index.mjs
