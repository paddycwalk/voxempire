#!/usr/bin/env bash
# ============================================================
# VOXEMPIRE — Auto-Deploy: holt neuen Code von GitHub und startet
# den Dienst NUR bei tatsaechlichen Aenderungen neu.
# Wird per systemd-Timer (voxempire-deploy.timer) regelmaessig ausgefuehrt.
# ============================================================
set -euo pipefail

REPO_DIR=/opt/voxempire

# Git akzeptiert das fremde Besitzverhaeltnis (Repo gehoert dem Nutzer voxempire,
# Skript laeuft als root).
git config --global --add safe.directory "$REPO_DIR" 2>/dev/null || true

cd "$REPO_DIR"
git fetch --quiet origin

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse '@{u}')

if [ "$LOCAL" != "$REMOTE" ]; then
  git pull --quiet --ff-only
  chown -R voxempire:voxempire "$REPO_DIR"
  systemctl restart voxempire
  echo "VOXEMPIRE aktualisiert: $LOCAL -> $REMOTE, Dienst neu gestartet."
else
  echo "VOXEMPIRE ist aktuell ($LOCAL)."
fi
