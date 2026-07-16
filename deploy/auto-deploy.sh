#!/usr/bin/env bash
# ============================================================
# VOXEMPIRE — Auto-Deploy: holt neuen Code von GitHub und startet
# den Dienst NUR bei tatsaechlichen Aenderungen neu.
# Wird per systemd-Timer (voxempire-deploy.timer) regelmaessig ausgefuehrt.
# ============================================================
set -euo pipefail

REPO_DIR=/opt/voxempire
BRANCH=main

# Git akzeptiert das fremde Besitzverhaeltnis (Repo gehoert dem Nutzer voxempire,
# Skript laeuft als root) — system-weit, damit es unabhaengig von HOME greift.
git config --system --add safe.directory "$REPO_DIR" 2>/dev/null || true

cd "$REPO_DIR"
git fetch --quiet origin "$BRANCH"

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" != "$REMOTE" ]; then
  # Harter Abgleich auf den GitHub-Stand (lokale Datei-Aenderungen werden verworfen;
  # die .env liegt ausserhalb der Versionskontrolle und bleibt unberuehrt).
  git reset --hard "origin/$BRANCH"
  chown -R voxempire:voxempire "$REPO_DIR"
  systemctl restart voxempire
  echo "VOXEMPIRE aktualisiert: $LOCAL -> $REMOTE, Dienst neu gestartet."
else
  echo "VOXEMPIRE ist aktuell ($LOCAL)."
fi
