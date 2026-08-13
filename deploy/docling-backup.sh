#!/usr/bin/env bash
# Docling Lab weekly backup (VPS cron)
# Backs up deploy config + env + systemd units + pdf-lab app to a dated tarball.
set -uo pipefail
BACKUP_DIR="/root/backups"
mkdir -p "$BACKUP_DIR"
TARBALL="$BACKUP_DIR/docling-$(date +%F).tgz"
tar czf "$TARBALL" \
  /opt/parentdataforce-tools/deploy \
  /etc/docling-serve.env \
  /etc/systemd/system/docling-serve.service \
  /etc/systemd/system/pdf-lab.service \
  /opt/pdf-lab/app.py \
  2>/dev/null
# Keep last 8 weekly backups
ls -1t "$BACKUP_DIR"/docling-*.tgz 2>/dev/null | tail -n +9 | xargs -r rm -f
echo "backup: $(ls -la "$TARBALL" 2>/dev/null | awk '{print $5, $9}')"
