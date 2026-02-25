#!/usr/bin/env bash
# dev.sh — starts the Go launcher API server + Vite dev server together.
# Run with:  npm run dev:full   OR   ./dev.sh
set -e
cd "$(dirname "$0")"

# ── Locate Go ─────────────────────────────────────────────────────────────────
GO_BIN="$(command -v go 2>/dev/null || true)"
# Flatpak / restricted-PATH fallback
[[ -x "$GO_BIN" ]] || GO_BIN="/run/host/usr/lib/go/bin/go"
# Module cache fallback (e.g. toolchain downloaded by wails)
if [[ ! -x "$GO_BIN" ]]; then
  GO_BIN="$(find "$HOME/go/pkg/mod/golang.org" -name "go" -type f -executable 2>/dev/null | sort -r | head -1)"
fi
if [[ -z "$GO_BIN" || ! -x "$GO_BIN" ]]; then
  echo "[!] Could not find a Go binary. Install Go or add it to PATH."
  exit 1
fi
echo "[dev] Using Go: $GO_BIN"

# ── Build the launcher ────────────────────────────────────────────────────────
LAUNCHER_BIN="/tmp/shell-ads-launcher-dev"
echo "[dev] Building launcher..."
"$GO_BIN" build -o "$LAUNCHER_BIN" ../launcher/
echo "[dev] Launcher built → $LAUNCHER_BIN"

# ── Free port 6969 if something is already on it ─────────────────────────────
EXISTING_PID="$(fuser 6969/tcp 2>/dev/null || true)"
if [[ -n "$EXISTING_PID" ]]; then
  kill "$EXISTING_PID" 2>/dev/null || true
  echo "[dev] Killed existing process ($EXISTING_PID) on :6969"
  sleep 1
fi

# ── Start the launcher in the background ─────────────────────────────────────
# KIOSK_PATH is deliberately unset — the launcher will log retries for the
# kiosk binary but the dashboard API on :6969 works normally.
"$LAUNCHER_BIN" &
LAUNCHER_PID=$!
echo "[dev] Launcher running (PID $LAUNCHER_PID) on http://localhost:6969"

# ── Cleanup on exit ───────────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "[dev] Stopping launcher (PID $LAUNCHER_PID)..."
  kill "$LAUNCHER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── Install npm deps if needed ────────────────────────────────────────────────
if [[ ! -d node_modules ]]; then
  echo "[dev] Installing npm dependencies..."
  npm install
fi

# ── Start Vite dev server ─────────────────────────────────────────────────────
echo "[dev] Starting Vite on http://localhost:5173"
echo ""
# Use local vite binary directly (works whether called via npm or bash)
./node_modules/.bin/vite
