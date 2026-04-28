#!/bin/bash
# ─── DevWell Database Backup Script ───────────────────────────────────────────
# Creates timestamped, gzipped backups of the PostgreSQL database.
#
# Usage:
#   ./scripts/backup-db.sh                  # Backs up using docker compose
#   BACKUP_DIR=/mnt/backups ./scripts/backup-db.sh  # Custom backup directory
#
# Cron example (daily at 2 AM):
#   0 2 * * * cd /path/to/DevWell && ./scripts/backup-db.sh >> /var/log/devwell-backup.log 2>&1

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/devwell_${TIMESTAMP}.sql.gz"
RETAIN_DAYS="${RETAIN_DAYS:-30}"

# Load env vars
if [ -f .env ]; then
  set -a; source .env; set +a
fi

DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-devwell_dev}"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup of database '${DB_NAME}'..."

docker compose exec -T db pg_dump \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  | gzip > "$BACKUP_FILE"

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[$(date)] Backup completed: ${BACKUP_FILE} (${BACKUP_SIZE})"

# Clean up old backups
if [ "$RETAIN_DAYS" -gt 0 ]; then
  DELETED=$(find "$BACKUP_DIR" -name "devwell_*.sql.gz" -mtime +"$RETAIN_DAYS" -delete -print | wc -l)
  if [ "$DELETED" -gt 0 ]; then
    echo "[$(date)] Cleaned up ${DELETED} backup(s) older than ${RETAIN_DAYS} days"
  fi
fi

echo "[$(date)] Backup finished successfully"
